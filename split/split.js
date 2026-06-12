// OmniChat — split view logic. One column + live iframe per enabled
// provider, channel chips to add/remove AIs on the fly (a toggled-on AI
// loads side by side immediately), a New session button that reloads
// every column into a fresh chat, and a floating composer that
// broadcasts to all open columns. Answers are read directly in the
// live pages; the side panel (if open) still records the transcript.

// Chat URLs/hosts mirror BUILTIN_PROVIDERS in background.js.
const BUILTIN = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/", host: "chatgpt.com" },
  { id: "claude", name: "Claude", url: "https://claude.ai/new", host: "claude.ai" },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app", host: "gemini.google.com" },
  { id: "deepseek", name: "DeepSeek", url: "https://chat.deepseek.com/", host: "chat.deepseek.com" },
  { id: "grok", name: "Grok", url: "https://grok.com/", host: "grok.com" },
];

const DEFAULT_ENABLED = {
  chatgpt: true,
  claude: true,
  gemini: true,
  deepseek: false,
  grok: false,
};

const columnsEl = document.getElementById("columns");
const reviewEl = document.getElementById("review");
const modelsBtn = document.getElementById("modelsBtn");
const modelListEl = document.getElementById("modelList");
const promptEl = document.getElementById("prompt");
const sendBtn = document.getElementById("send");
const newSessionBtn = document.getElementById("newSession");

let providers = []; // ordered: builtins then custom agents
let enabled = { ...DEFAULT_ENABLED };
const columns = new Map(); // provider id -> { col, frame }
let lastPromptId = null;
const generating = new Set();

const faviconUrl = (host) =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;

function activeIds() {
  return providers.filter((p) => enabled[p.id]).map((p) => p.id);
}

/* ------------------------------- columns ------------------------------- */

function buildColumn(p) {
  const col = document.createElement("section");
  col.className = "col";

  const head = document.createElement("header");
  if (p.host) {
    const logo = document.createElement("img");
    logo.className = "col-logo";
    logo.alt = "";
    logo.src = faviconUrl(p.host);
    logo.addEventListener("error", () => logo.remove());
    head.appendChild(logo);
  }
  head.appendChild(document.createTextNode(p.name));

  const frame = document.createElement("iframe");
  frame.src = p.url;
  frame.allow = "clipboard-read; clipboard-write";

  col.append(head, frame);
  return { col, frame };
}

// Insert keeping provider order, without touching existing columns
// (rebuilding would reload their conversations). The new column takes
// an equal share; existing custom sizes shrink proportionally.
function addColumn(p) {
  if (columns.has(p.id)) return;
  const entry = buildColumn(p);
  const after = providers
    .slice(providers.indexOf(p) + 1)
    .find((x) => columns.has(x.id));
  columnsEl.insertBefore(entry.col, after ? columns.get(after.id).col : null);
  columns.set(p.id, entry);

  const share = 1 / columns.size;
  widths.forEach((w, id) => widths.set(id, w * (1 - share)));
  widths.set(p.id, share);

  layoutGutters();
  updateEmptyState();
}

function removeColumn(id) {
  const entry = columns.get(id);
  if (!entry) return;
  entry.col.remove();
  columns.delete(id);
  generating.delete(id);
  widths.delete(id);
  const sum = [...widths.values()].reduce((a, b) => a + b, 0) || 1;
  widths.forEach((w, wid) => widths.set(wid, w / sum));
  layoutGutters();
  updateButton();
  updateEmptyState();
}

/* ------------------------------- resizing ------------------------------ */
// Draggable gutters between columns. Widths are fractions of the row
// mapped to flex-grow, so the math stays simple as columns come and go.

const widths = new Map(); // provider id -> fraction of the row
const MIN_FRAC = 0.08;

function orderedOpenIds() {
  return providers.filter((p) => columns.has(p.id)).map((p) => p.id);
}

function applyWidths() {
  columns.forEach(({ col }, id) => {
    col.style.flex = `${(widths.get(id) || 0.0001) * 1000} 1 0%`;
  });
}

function layoutGutters() {
  columnsEl.querySelectorAll(".gutter").forEach((g) => g.remove());
  const ids = orderedOpenIds();
  for (let i = 1; i < ids.length; i++) {
    const leftId = ids[i - 1];
    const rightId = ids[i];
    const gutter = document.createElement("div");
    gutter.className = "gutter";
    gutter.title = "Drag to resize";

    gutter.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      gutter.setPointerCapture(e.pointerId);
      gutter.classList.add("dragging");
      // Iframes would swallow pointer events mid-drag.
      document.body.classList.add("resizing");
      const startX = e.clientX;
      const startL = widths.get(leftId);
      const startR = widths.get(rightId);
      const rowWidth = columnsEl.getBoundingClientRect().width || 1;

      const onMove = (ev) => {
        let delta = (ev.clientX - startX) / rowWidth;
        delta = Math.max(
          MIN_FRAC - startL,
          Math.min(startR - MIN_FRAC, delta)
        );
        widths.set(leftId, startL + delta);
        widths.set(rightId, startR - delta);
        applyWidths();
      };
      const onUp = () => {
        gutter.classList.remove("dragging");
        document.body.classList.remove("resizing");
        gutter.removeEventListener("pointermove", onMove);
        gutter.removeEventListener("pointerup", onUp);
        gutter.removeEventListener("pointercancel", onUp);
      };
      gutter.addEventListener("pointermove", onMove);
      gutter.addEventListener("pointerup", onUp);
      gutter.addEventListener("pointercancel", onUp);
    });

    columnsEl.insertBefore(gutter, columns.get(rightId).col);
  }
  applyWidths();
}

let emptyEl = null;
function updateEmptyState() {
  if (columns.size === 0 && !emptyEl) {
    emptyEl = document.createElement("p");
    emptyEl.className = "empty";
    emptyEl.textContent =
      "Open the Models menu below — each AI you pick loads side by side.";
    columnsEl.appendChild(emptyEl);
  } else if (columns.size > 0 && emptyEl) {
    emptyEl.remove();
    emptyEl = null;
  }
  sendBtn.disabled = columns.size === 0 && generating.size === 0;
}

/* ---------------------------- models dropdown --------------------------- */
// One "Models ▾" button; the menu opens upward and lists every AI with
// its logo. Toggling one loads/removes its column side by side.

function updateModelsBtn() {
  const n = activeIds().length;
  modelsBtn.textContent = n ? `Models (${n}) ▾` : "Models ▾";
}

function renderModelList() {
  modelListEl.innerHTML = "";
  providers.forEach((p) => {
    const row = document.createElement("button");
    row.className = "model-row" + (enabled[p.id] ? " on" : "");
    row.setAttribute("role", "menuitemcheckbox");
    row.setAttribute("aria-checked", String(!!enabled[p.id]));

    if (p.host) {
      const logo = document.createElement("img");
      logo.alt = "";
      logo.src = faviconUrl(p.host);
      logo.addEventListener("error", () => logo.remove());
      row.appendChild(logo);
    }
    const name = document.createElement("span");
    name.className = "model-name";
    name.textContent = p.name;
    const check = document.createElement("span");
    check.className = "model-check";
    check.textContent = "✓";
    row.append(name, check);

    row.addEventListener("click", () => {
      enabled[p.id] = !enabled[p.id];
      row.classList.toggle("on", enabled[p.id]);
      row.setAttribute("aria-checked", String(enabled[p.id]));
      chrome.storage.sync.set({ enabledProviders: enabled });
      if (enabled[p.id]) addColumn(providers.find((x) => x.id === p.id));
      else removeColumn(p.id);
      updateModelsBtn();
    });

    modelListEl.appendChild(row);
  });
  updateModelsBtn();
}

function closeModelList() {
  modelListEl.setAttribute("hidden", "");
  modelsBtn.setAttribute("aria-expanded", "false");
}

modelsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = modelListEl.hasAttribute("hidden");
  if (open) {
    modelListEl.removeAttribute("hidden");
    modelsBtn.setAttribute("aria-expanded", "true");
  } else {
    closeModelList();
  }
});

// Click anywhere else (or Esc) closes the open menus.
document.addEventListener("click", (e) => {
  if (!modelListEl.contains(e.target) && e.target !== modelsBtn) {
    closeModelList();
  }
  if (!historyPanel.contains(e.target) && e.target !== historyBtn) {
    closeHistory();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModelList();
    closeHistory();
  }
});

/* ------------------------------- history -------------------------------- */
// Split-view conversations are recorded into the SAME chrome.storage.local
// sessions the side panel uses, so history is one shared list. The
// History button opens a read-only browser above the bar.

const historyBtn = document.getElementById("historyBtn");
const historyPanel = document.getElementById("historyPanel");

let session = null;
let saveTimer = null;
let reviewingSessionId = null;

async function loadSessions() {
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  return sessions;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistSession, 700);
}

async function persistSession() {
  if (!session || session.turns.length === 0) return;
  session.updatedAt = Date.now();
  const sessions = await loadSessions();
  const i = sessions.findIndex((s) => s.id === session.id);
  if (i >= 0) sessions[i] = session;
  else sessions.unshift(session);
  if (sessions.length > 50) sessions.length = 50; // keep the newest 50
  await chrome.storage.local.set({ sessions });
}

function recordTurn(text, ids) {
  if (!session) {
    session = {
      id:
        "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: text.slice(0, 70),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      turns: [],
    };
  }
  chrome.storage.session.set({ activeSessionId: session.id });
  session.turns.push({
    promptId: lastPromptId,
    text,
    time: Date.now(),
    providers: ids,
    answers: {},
  });
  scheduleSave();
}

function recordAnswer(msg) {
  if (!session) return;
  const turn = session.turns.find((t) => t.promptId === msg.promptId);
  if (!turn) return;
  const prev = turn.answers[msg.provider] || {};
  turn.answers[msg.provider] = {
    text: msg.error ? "" : msg.text || prev.text || "",
    html: msg.error ? "" : (msg.done && msg.html ? msg.html : prev.html || ""),
    error: msg.error || null,
    done: !!msg.done || !!prev.done,
  };
  scheduleSave();
}

function providerName(id) {
  const p = providers.find((x) => x.id === id);
  return p ? p.name : id;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Same sanitizer as the side panel: strip active content before render.
function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll("script,style,link,iframe,object,embed,form")
    .forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      if (
        (name === "href" || name === "src") &&
        /^javascript:/i.test(attr.value)
      ) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
}

async function renderHistoryList() {
  historyPanel.innerHTML = "";
  const sessions = await loadSessions();

  if (!sessions.length) {
    const p = document.createElement("p");
    p.className = "hist-empty";
    p.textContent = "No saved conversations yet.";
    historyPanel.appendChild(p);
    return;
  }

  sessions.forEach((s) => {
    const row = document.createElement("button");
    row.className =
      "hist-row" +
      (reviewingSessionId === s.id || (session && session.id === s.id)
        ? " active"
        : "");
    const title = document.createElement("span");
    title.className = "hist-title";
    title.textContent = s.title || "(untitled)";
    const meta = document.createElement("span");
    meta.className = "hist-meta";
    meta.textContent = `${fmtDate(s.updatedAt)} · ${s.turns.length} prompt${
      s.turns.length === 1 ? "" : "s"
    }`;
    row.append(title, meta);
    row.addEventListener("click", () => openHistorySession(s.id));
    historyPanel.appendChild(row);
  });
}

function providerIdsForSession(s) {
  const ids = [];
  (s.turns || []).forEach((turn) => {
    (turn.providers || []).forEach((id) => {
      if (!ids.includes(id)) ids.push(id);
    });
  });

  return providers
    .map((p) => p.id)
    .filter((id) => ids.includes(id))
    .concat(ids.filter((id) => !providers.some((p) => p.id === id)));
}

function answerNode(ans) {
  const body = document.createElement("div");
  if (ans && ans.html) {
    body.className = "review-answer rich";
    body.innerHTML = sanitizeHtml(ans.html);
  } else if (ans && ans.text) {
    body.className = "review-answer";
    body.textContent = ans.text;
  } else if (ans && ans.error) {
    body.className = "review-answer error";
    body.textContent = ans.error;
  } else {
    body.className = "review-answer empty-answer";
    body.textContent = "(no response captured)";
  }
  return body;
}

function renderSessionReview(s) {
  reviewEl.innerHTML = "";
  reviewingSessionId = s.id;

  const head = document.createElement("header");
  head.className = "review-head";

  const titleWrap = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = s.title || "(untitled)";
  const meta = document.createElement("p");
  meta.textContent = `${fmtDate(s.updatedAt)} · ${(s.turns || []).length} prompt${
    (s.turns || []).length === 1 ? "" : "s"
  }`;
  titleWrap.append(title, meta);

  const liveBtn = document.createElement("button");
  liveBtn.className = "ghost-btn";
  liveBtn.textContent = "Live columns";
  liveBtn.addEventListener("click", closeReview);

  head.append(titleWrap, liveBtn);
  reviewEl.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "review-grid";

  providerIdsForSession(s).forEach((pid) => {
    const col = document.createElement("article");
    col.className = "review-col";

    const colHead = document.createElement("h3");
    colHead.textContent = providerName(pid);
    col.appendChild(colHead);

    (s.turns || []).forEach((turn) => {
      if (!(turn.providers || []).includes(pid)) return;

      const item = document.createElement("section");
      item.className = "review-turn";

      const prompt = document.createElement("div");
      prompt.className = "review-prompt";
      prompt.textContent = turn.text;

      item.append(prompt, answerNode((turn.answers || {})[pid]));
      col.appendChild(item);
    });

    grid.appendChild(col);
  });

  reviewEl.appendChild(grid);
  columnsEl.setAttribute("hidden", "");
  reviewEl.removeAttribute("hidden");
}

function closeReview() {
  reviewingSessionId = null;
  reviewEl.setAttribute("hidden", "");
  columnsEl.removeAttribute("hidden");
}

async function openHistorySession(id) {
  await persistSession();
  const sessions = await loadSessions();
  const s = sessions.find((x) => x.id === id);
  if (!s) return;
  session = s;
  lastPromptId =
    s.turns && s.turns.length ? s.turns[s.turns.length - 1].promptId : null;
  generating.clear();
  updateButton();
  await chrome.storage.session.set({ activeSessionId: s.id });
  renderSessionReview(s);
  closeHistory();
}

function renderHistoryDetail(s) {
  historyPanel.innerHTML = "";

  const back = document.createElement("button");
  back.className = "ghost-btn hist-back";
  back.textContent = "← All conversations";
  back.addEventListener("click", renderHistoryList);
  historyPanel.appendChild(back);

  s.turns.forEach((turn) => {
    const user = document.createElement("div");
    user.className = "hist-user";
    user.textContent = turn.text;
    historyPanel.appendChild(user);

    (turn.providers || []).forEach((pid) => {
      const ans = (turn.answers || {})[pid];
      const prov = document.createElement("div");
      prov.className = "hist-prov";
      prov.textContent = providerName(pid);
      historyPanel.appendChild(prov);

      const body = document.createElement("div");
      if (ans && ans.html) {
        body.className = "hist-rich";
        body.innerHTML = sanitizeHtml(ans.html);
      } else if (ans && ans.text) {
        body.className = "hist-text";
        body.textContent = ans.text;
      } else if (ans && ans.error) {
        body.className = "hist-error";
        body.textContent = ans.error;
      } else {
        body.className = "hist-empty";
        body.textContent = "(no response captured)";
      }
      historyPanel.appendChild(body);
    });
  });
}

function closeHistory() {
  historyPanel.setAttribute("hidden", "");
  historyBtn.setAttribute("aria-expanded", "false");
}

historyBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (historyPanel.hasAttribute("hidden")) {
    closeModelList();
    historyPanel.removeAttribute("hidden");
    historyBtn.setAttribute("aria-expanded", "true");
    renderHistoryList();
  } else {
    closeHistory();
  }
});

/* ----------------------------- new session ----------------------------- */

function newSession() {
  persistSession();
  session = null;
  chrome.storage.session.remove("activeSessionId");
  closeReview();
  generating.clear();
  updateButton();
  columns.forEach(({ frame }, id) => {
    const p = providers.find((x) => x.id === id);
    if (!p) return;
    // Plain re-assignment of an identical src can be ignored — blank
    // the frame first so every column truly reloads into a new chat.
    frame.src = "about:blank";
    setTimeout(() => {
      frame.src = p.url;
    }, 60);
  });
  promptEl.focus();
}

/* ------------------------------ broadcast ------------------------------ */

function updateButton() {
  const stop = generating.size > 0;
  sendBtn.classList.toggle("stop-mode", stop);
  sendBtn.textContent = stop ? "■" : "↑";
  sendBtn.title = stop ? "Stop all answers" : "Broadcast";
  sendBtn.setAttribute("aria-label", sendBtn.title);
  sendBtn.disabled = columns.size === 0 && !stop;
}

function broadcast() {
  const text = promptEl.value.trim();
  const ids = activeIds().filter((id) => columns.has(id));
  if (!text || ids.length === 0) return;
  closeReview();

  lastPromptId =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  generating.clear();
  ids.forEach((id) => generating.add(id));
  updateButton();
  recordTurn(text, ids);

  chrome.runtime.sendMessage({
    type: "BROADCAST",
    text,
    providers: ids,
    promptId: lastPromptId,
    splitTab: true,
  });

  promptEl.value = "";
  promptEl.style.height = "auto";
  promptEl.focus();
}

sendBtn.addEventListener("click", () => {
  if (generating.size > 0) {
    [...generating].forEach((pid) =>
      chrome.runtime.sendMessage({
        type: "STOP_GENERATION",
        provider: pid,
        promptId: lastPromptId,
      })
    );
    sendBtn.disabled = true;
    setTimeout(() => {
      sendBtn.disabled = false;
    }, 1500);
    return;
  }
  broadcast();
});

newSessionBtn.addEventListener("click", newSession);

// Back to the side-panel "station": reopen it on this window. Must be
// called inside the click gesture; the background is the fallback.
document.getElementById("backPanel").addEventListener("click", async () => {
  try {
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id });
  } catch {
    chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" });
  }
});

promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (generating.size === 0) broadcast();
  }
});

promptEl.addEventListener("input", () => {
  promptEl.style.height = "auto";
  promptEl.style.height = Math.min(promptEl.scrollHeight, 140) + "px";
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "ANSWER_UPDATE") {
    recordAnswer(msg);
  }
  if (
    msg.type === "ANSWER_UPDATE" &&
    (msg.done || msg.error) &&
    msg.promptId === lastPromptId
  ) {
    generating.delete(msg.provider);
    updateButton();
  }
  if (
    msg.type === "PROVIDER_STATUS" &&
    (msg.status === "error" || msg.status === "idle")
  ) {
    generating.delete(msg.provider);
    updateButton();
  }
});

/* --------------------------------- init -------------------------------- */

async function init() {
  const { enabledProviders = {}, customAgents = [] } =
    await chrome.storage.sync.get(["enabledProviders", "customAgents"]);
  enabled = { ...DEFAULT_ENABLED, ...enabledProviders };

  providers = [
    ...BUILTIN,
    ...customAgents
      .filter((a) => a && a.id && a.url)
      .map((a) => ({ id: a.id, name: a.name || a.host, url: a.url, host: a.host })),
  ];

  renderModelList();
  providers.filter((p) => enabled[p.id]).forEach(addColumn);
  updateEmptyState();
  updateButton();

  const { activeSessionId } = await chrome.storage.session.get("activeSessionId");
  if (activeSessionId) {
    const sessions = await loadSessions();
    const s = sessions.find((x) => x.id === activeSessionId);
    if (s) {
      session = s;
      renderSessionReview(s);
    }
  }

  promptEl.focus();
}

init();
