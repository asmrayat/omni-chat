// OmniChat — background service worker
// Owns the tab-per-provider session and routes prompts from the
// side panel to the content script in each AI tab. Providers are
// the built-ins plus any custom agents the user added in settings.

const BUILTIN_PROVIDERS = {
  chatgpt: {
    name: "ChatGPT",
    newChatUrl: "https://chatgpt.com/",
    hosts: ["chatgpt.com", "chat.openai.com"],
  },
  claude: {
    name: "Claude",
    newChatUrl: "https://claude.ai/new",
    hosts: ["claude.ai"],
  },
  gemini: {
    name: "Gemini",
    newChatUrl: "https://gemini.google.com/app",
    hosts: ["gemini.google.com"],
  },
  deepseek: {
    name: "DeepSeek",
    newChatUrl: "https://chat.deepseek.com/",
    hosts: ["chat.deepseek.com"],
  },
  grok: {
    name: "Grok",
    newChatUrl: "https://grok.com/",
    hosts: ["grok.com"],
  },
};

async function getProviders() {
  const { customAgents = [] } = await chrome.storage.sync.get("customAgents");
  const map = { ...BUILTIN_PROVIDERS };
  for (const a of customAgents) {
    if (!a || !a.id || !a.url || !a.host) continue;
    map[a.id] = {
      name: a.name || a.host,
      newChatUrl: a.url,
      hosts: [a.host],
      custom: true,
    };
  }
  return map;
}

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

/* ------------- per-provider tab keys (no shared map = no races) --------- */

const tabKey = (providerId) => "tab_" + providerId;

async function getProviderTabId(providerId) {
  const obj = await chrome.storage.session.get(tabKey(providerId));
  return obj[tabKey(providerId)] ?? null;
}

async function setProviderTabId(providerId, tabId) {
  await chrome.storage.session.set({ [tabKey(providerId)]: tabId });
}

async function clearProviderTabId(providerId) {
  await chrome.storage.session.remove(tabKey(providerId));
}

// Forget tabs the user closes so the next send opens a fresh one.
chrome.tabs.onRemoved.addListener(async (closedTabId) => {
  stopTicking(closedTabId, true);
  const all = await chrome.storage.session.get(null);
  for (const [key, tabId] of Object.entries(all)) {
    if (key.startsWith("tab_") && tabId === closedTabId) {
      await chrome.storage.session.remove(key);
      reportStatus(key.slice(4), "idle", "Tab closed");
    }
  }
  if (all.splitTabId === closedTabId) {
    await chrome.storage.session.remove("splitTabId");
    await clearSplitRules();
  }
});

/* ----------------------- background-tab heartbeat ----------------------- */
// Chrome throttles timers in hidden tabs (down to once a minute), which
// used to stall answer watching until the user visited the tab. While a
// content script is watching an answer it asks us for TICKs — message
// delivery to a tab is never throttled, and sending them keeps this
// worker alive for the duration of the watch.

// Refcounted per tab: in the split view several provider frames watch
// answers in the SAME tab, and one finishing must not stop the others'
// ticks.
const tickTimers = new Map(); // tabId -> { intervalId, watchers }

function startTicking(tabId) {
  if (tabId == null) return;
  const cur = tickTimers.get(tabId);
  if (cur) {
    cur.watchers++;
    return;
  }
  tickTimers.set(tabId, {
    watchers: 1,
    intervalId: setInterval(() => {
      chrome.tabs
        .sendMessage(tabId, { type: "TICK" })
        .catch(() => stopTicking(tabId, true));
    }, 1000),
  });
}

function stopTicking(tabId, force = false) {
  const cur = tickTimers.get(tabId);
  if (!cur) return;
  cur.watchers = force ? 0 : cur.watchers - 1;
  if (cur.watchers <= 0) {
    clearInterval(cur.intervalId);
    tickTimers.delete(tabId);
  }
}

/* ------------------------------ tab flash ------------------------------- */
// Hidden tabs produce no rendering frames, and some sites (DeepSeek)
// freeze their answer rendering entirely until they get one. Activating
// the tab for a beat and switching back forces a flush so the watcher
// can capture the COMPLETE answer without the user visiting the tab.

const flashing = new Set();

async function flashTab(tabId) {
  if (flashing.has(tabId)) return false;
  flashing.add(tabId);
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.active) return true; // already visible
    const [previous] = await chrome.tabs.query({
      active: true,
      windowId: tab.windowId,
    });
    await chrome.tabs.update(tabId, { active: true });
    await sleep(700);
    if (previous) {
      await chrome.tabs.update(previous.id, { active: true }).catch(() => {});
    }
    return true;
  } catch {
    return false;
  } finally {
    flashing.delete(tabId);
  }
}

function tabIsOnProviderHost(tab, provider) {
  if (!tab || !tab.url || !provider) return false;
  try {
    const host = new URL(tab.url).hostname;
    return provider.hosts.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

/* --------------------------- status reporting --------------------------- */

function reportStatus(provider, status, detail = "") {
  chrome.runtime
    .sendMessage({ type: "PROVIDER_STATUS", provider, status, detail })
    .catch(() => {});
}

/* ------------------------------ tab helpers ----------------------------- */

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab && tab.status === "complete") finish();
    }).catch(finish);
    setTimeout(finish, timeoutMs);
  });
}

async function getOrCreateProviderTab(providerId, provider) {
  const existingId = await getProviderTabId(providerId);

  if (existingId != null) {
    try {
      const tab = await chrome.tabs.get(existingId);
      if (tabIsOnProviderHost(tab, provider)) {
        return { tab, isNew: false };
      }
    } catch {
      /* tab no longer exists */
    }
    await clearProviderTabId(providerId);
  }

  const tab = await chrome.tabs.create({
    url: provider.newChatUrl,
    active: false,
  });
  await setProviderTabId(providerId, tab.id);
  return { tab, isNew: true };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Built-in sites get content.js via the manifest; custom agents (and any
// tab opened before the extension loaded) get it injected on demand.
async function ensureContentScript(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (res && res.ok) return true;
  } catch {
    /* not there yet */
  }
  try {
    // Keep-rendering-in-background hook (idempotent; built-ins already
    // get it from the manifest, custom agents only get it here).
    await chrome.scripting
      .executeScript({
        target: { tabId },
        files: ["page-hook.js"],
        world: "MAIN",
      })
      .catch(() => {});
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    return true;
  } catch {
    return false;
  }
}

async function sendPromptToTab(tabId, providerId, text, promptId, hosts = [], timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "No response from page";
  while (Date.now() < deadline) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, {
        type: "INJECT_PROMPT",
        provider: providerId,
        promptId,
        text,
        hosts,
      });
      if (res && res.ok) return { ok: true };
      if (res && res.error) lastError = res.error;
    } catch (e) {
      lastError = "Page not ready yet";
      await ensureContentScript(tabId);
    }
    await sleep(1200);
  }
  return { ok: false, error: lastError };
}

/* ------------------------------ split view ------------------------------ */
// ONE tab (split/split.html) embeds every selected AI side by side in
// iframes, with a slim floating composer at the bottom. The providers'
// frame-blocking headers (X-Frame-Options / CSP) are stripped by a
// session declarativeNetRequest rule scoped to JUST that tab's
// sub-frames — nothing else is touched.

const SPLIT_RULE_ID = 7001;

async function registerSplitRules(tabId) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [SPLIT_RULE_ID],
    addRules: [
      {
        id: SPLIT_RULE_ID,
        priority: 1,
        action: {
          type: "modifyHeaders",
          responseHeaders: [
            { header: "x-frame-options", operation: "remove" },
            { header: "frame-options", operation: "remove" },
            { header: "content-security-policy", operation: "remove" },
            {
              header: "content-security-policy-report-only",
              operation: "remove",
            },
          ],
        },
        condition: { tabIds: [tabId], resourceTypes: ["sub_frame"] },
      },
    ],
  });
}

async function clearSplitRules() {
  await chrome.declarativeNetRequest
    .updateSessionRules({ removeRuleIds: [SPLIT_RULE_ID] })
    .catch(() => {});
}

async function getSplitTabId() {
  const { splitTabId } = await chrome.storage.session.get("splitTabId");
  return splitTabId ?? null;
}

async function openSplitView() {
  const existing = await getSplitTabId();
  if (existing != null) {
    try {
      const tab = await chrome.tabs.get(existing);
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    } catch {
      await chrome.storage.session.remove("splitTabId");
    }
  }
  const tab = await chrome.tabs.create({
    url: chrome.runtime.getURL("split/split.html"),
  });
  await chrome.storage.session.set({ splitTabId: tab.id });
  await registerSplitRules(tab.id);
}

// Send a prompt to one provider's iframe inside the split tab. The
// content script runs in every provider frame; the hosts list tells
// the right frame to answer and the others to stay silent.
async function broadcastToSplitFrame(tabId, providerId, provider, text, promptId) {
  try {
    reportStatus(providerId, "working", "Typing your prompt…");
    await chrome.scripting
      .executeScript({
        target: { tabId, allFrames: true },
        files: ["content.js"],
      })
      .catch(() => {});
    const result = await sendPromptToTab(
      tabId,
      providerId,
      text,
      promptId,
      provider.hosts
    );
    if (result.ok) {
      reportStatus(providerId, "sent", "Prompt sent — waiting for answer");
    } else {
      reportStatus(
        providerId,
        "error",
        result.error || "Couldn't reach this AI's frame (signed in?)"
      );
      chrome.runtime
        .sendMessage({
          type: "ANSWER_UPDATE",
          provider: providerId,
          promptId,
          text: "",
          done: true,
          error: result.error || "Couldn't reach this AI's frame",
        })
        .catch(() => {});
    }
  } catch (e) {
    reportStatus(providerId, "error", e.message || "Unexpected error");
  }
}

/* ------------------------------ broadcast ------------------------------- */

async function broadcastToProvider(providerId, provider, text, promptId) {
  try {
    reportStatus(providerId, "working", "Opening tab…");
    const { tab, isNew } = await getOrCreateProviderTab(providerId, provider);

    if (isNew) {
      await waitForTabComplete(tab.id);
      await sleep(1500); // let the SPA render its composer
    }

    await ensureContentScript(tab.id);

    reportStatus(providerId, "working", "Typing your prompt…");
    const result = await sendPromptToTab(
      tab.id,
      providerId,
      text,
      promptId,
      provider.hosts
    );

    if (result.ok) {
      reportStatus(providerId, "sent", "Prompt sent — waiting for answer");
    } else {
      reportStatus(
        providerId,
        "error",
        result.error || "Couldn't reach the page (are you signed in?)"
      );
      chrome.runtime
        .sendMessage({
          type: "ANSWER_UPDATE",
          provider: providerId,
          promptId,
          text: "",
          done: true,
          error: result.error || "Couldn't reach the page",
        })
        .catch(() => {});
    }
  } catch (e) {
    reportStatus(providerId, "error", e.message || "Unexpected error");
  }
}

/* --------------------------- panel message API -------------------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "WATCH_START") {
    startTicking(sender.tab && sender.tab.id);
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "FLASH_TAB") {
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) {
      sendResponse({ ok: false });
      return;
    }
    flashTab(tabId).then((ok) => sendResponse({ ok }));
    return true;
  }

  if (msg.type === "WATCH_STOP") {
    stopTicking(sender.tab && sender.tab.id);
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "BROADCAST") {
    getProviders().then((providers) => {
      const ids = (msg.providers || []).filter((p) => providers[p]);
      if (msg.splitTab && sender.tab) {
        // From the split view: every provider lives in an iframe of the
        // sender's own tab — no provider tabs are opened.
        ids.forEach((p) =>
          broadcastToSplitFrame(
            sender.tab.id,
            p,
            providers[p],
            msg.text,
            msg.promptId
          )
        );
      } else {
        ids.forEach((p) =>
          broadcastToProvider(p, providers[p], msg.text, msg.promptId)
        );
      }
      sendResponse({ ok: true, count: ids.length });
    });
    return true;
  }

  if (msg.type === "OPEN_SPLIT_CHAT") {
    openSplitView().then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false })
    );
    return true;
  }

  if (msg.type === "OPEN_SIDE_PANEL") {
    const windowId = sender.tab && sender.tab.windowId;
    if (windowId != null) {
      chrome.sidePanel.open({ windowId }).catch(() => {});
    }
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "NEW_SESSION") {
    chrome.storage.session.get(null).then(async (all) => {
      const keys = Object.keys(all).filter((k) => k.startsWith("tab_"));
      await chrome.storage.session.remove(keys);
      const providers = await getProviders();
      Object.keys(providers).forEach((p) => reportStatus(p, "idle", ""));
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "STOP_GENERATION") {
    (async () => {
      const providers = await getProviders();
      const hosts = providers[msg.provider]
        ? providers[msg.provider].hosts
        : [];
      let tabId = await getProviderTabId(msg.provider);
      if (tabId == null) tabId = await getSplitTabId(); // split-view frames
      if (tabId == null) {
        sendResponse({ ok: false });
        return;
      }
      try {
        const res = await chrome.tabs.sendMessage(tabId, {
          type: "STOP_GENERATION",
          promptId: msg.promptId,
          hosts,
        });
        sendResponse(res || { ok: true });
      } catch {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  if (msg.type === "FOCUS_PROVIDER_TAB") {
    (async () => {
      let tabId = await getProviderTabId(msg.provider);
      if (tabId == null) tabId = await getSplitTabId(); // split-view frames
      if (tabId != null) {
        try {
          const tab = await chrome.tabs.get(tabId);
          await chrome.tabs.update(tabId, { active: true });
          await chrome.windows.update(tab.windowId, { focused: true });
          sendResponse({ ok: true });
          return;
        } catch {
          /* fall through */
        }
      }
      sendResponse({ ok: false });
    })();
    return true;
  }
});
