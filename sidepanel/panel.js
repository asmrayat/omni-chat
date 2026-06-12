// OmniChat — side panel logic (chat transcript + local history)

const BUILTIN = [
  { id: "chatgpt", name: "ChatGPT" },
  { id: "claude", name: "Claude" },
  { id: "gemini", name: "Gemini" },
  { id: "deepseek", name: "DeepSeek" },
  { id: "grok", name: "Grok" },
];

// Monogram fallbacks in each brand's signature color. The avatar itself
// loads the site's real favicon at runtime (the same icon Chrome shows
// on its tab) and falls back to the monogram if it can't load.
const AVATARS = {
  chatgpt: { label: "G", bg: "#10a37f", host: "chatgpt.com" },
  claude: { label: "C", bg: "#d97757", host: "claude.ai" },
  gemini: { label: "G", bg: "#4796e3", host: "gemini.google.com" },
  deepseek: { label: "D", bg: "#4d6bfe", host: "chat.deepseek.com" },
  grok: { label: "X", bg: "#5c6270", host: "grok.com" },
};
const CUSTOM_COLORS = ["#8b5cf6", "#ec4899", "#14b8a6", "#eab308", "#f97316"];

// Providers that can't generate photographic images.
const NO_IMAGE_GEN = new Set(["claude", "deepseek"]);

const IMAGE_INTENT =
  /\b(generate|create|make|draw|produce|design|render)\b[\s\S]{0,50}\b(image|picture|photo|illustration|logo|art|drawing)\b|\bimage of\b|\bpicture of\b/i;

let customAgents = [];
let providers = [...BUILTIN];

const chipsEl = document.getElementById("chips");
const transcriptEl = document.getElementById("transcript");
const emptyStateEl = document.getElementById("emptyState");
const promptEl = document.getElementById("prompt");
const sendBtn = document.getElementById("send");
const newSessionBtn = document.getElementById("newSession");
const settingsBtn = document.getElementById("settingsBtn");
const settingsEl = document.getElementById("settings");
const agentListEl = document.getElementById("agentList");
const agentNameEl = document.getElementById("agentName");
const agentUrlEl = document.getElementById("agentUrl");
const addAgentBtn = document.getElementById("addAgent");
const historyBtn = document.getElementById("historyBtn");
const historyEl = document.getElementById("history");
const historyListEl = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistory");

let enabled = { chatgpt: true, claude: true, gemini: true, deepseek: false, grok: false };
let chipEls = {};
const entries = {}; // promptId -> { msgs: {provider: {...}} }
let lastPromptId = null;

/* ----------------------------- session model --------------------------- */
// session = { id, title, createdAt, updatedAt,
//             turns: [{promptId, text, time, providers:[ids],
//                      answers: {id: {text, html, error, done}}}] }

let session = null;
let saveTimer = null;

function newSessionObject(firstPrompt) {
  return {
    id: "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: firstPrompt.slice(0, 70),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    turns: [],
  };
}

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

function findTurn(promptId) {
  return session ? session.turns.find((t) => t.promptId === promptId) : null;
}

/* ------------------------------ providers ------------------------------ */

function providerName(id) {
  const p = providers.find((x) => x.id === id);
  return p ? p.name : id;
}

function avatarFor(id) {
  if (AVATARS[id]) return AVATARS[id];
  const agent = customAgents.find((a) => a.id === id);
  const name = providerName(id);
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    label: (name[0] || "?").toUpperCase(),
    bg: CUSTOM_COLORS[hash % CUSTOM_COLORS.length],
    host: agent ? agent.host : null,
  };
}

// Avatar = the site's real favicon, with a colored monogram underneath
// as the fallback while it loads / if it fails.
function makeAvatar(id) {
  const av = avatarFor(id);
  const span = document.createElement("span");
  span.className = "avatar";
  span.style.background = av.bg;
  span.textContent = av.label;
  if (av.host) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(av.host)}&sz=64`;
    img.addEventListener("error", () => img.remove());
    img.addEventListener("load", () => {
      if (img.naturalWidth < 16) img.remove(); // service returned a stub
    });
    span.appendChild(img);
  }
  return span;
}

function rebuildProviders() {
  providers = [...BUILTIN, ...customAgents.map((a) => ({ id: a.id, name: a.name }))];
}

/* ------------------------------ channels ------------------------------- */

function renderChips() {
  chipsEl.innerHTML = "";
  chipEls = {};
  providers.forEach((p) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (enabled[p.id] ? " on" : "");
    chip.setAttribute("aria-pressed", String(!!enabled[p.id]));
    const lamp = document.createElement("span");
    lamp.className = "lamp";
    chip.append(lamp, document.createTextNode(p.name));
    chip.addEventListener("click", () => {
      enabled[p.id] = !enabled[p.id];
      chip.classList.toggle("on", enabled[p.id]);
      chip.setAttribute("aria-pressed", String(enabled[p.id]));
      chrome.storage.sync.set({ enabledProviders: enabled });
      updateSendState();
    });
    chipsEl.appendChild(chip);
    chipEls[p.id] = chip;
  });
}

function setChipStatus(provider, status) {
  const chip = chipEls[provider];
  if (!chip) return;
  chip.classList.remove("working", "sent", "error");
  if (status !== "idle") chip.classList.add(status);
}

/* ----------------------------- drawers (UI) ----------------------------- */

function toggleDrawer(btn, el, otherBtn, otherEl) {
  const open = el.hasAttribute("hidden");
  if (open) {
    el.removeAttribute("hidden");
    otherEl.setAttribute("hidden", "");
    otherBtn.setAttribute("aria-expanded", "false");
  } else {
    el.setAttribute("hidden", "");
  }
  btn.setAttribute("aria-expanded", String(open));
}

settingsBtn.addEventListener("click", () =>
  toggleDrawer(settingsBtn, settingsEl, historyBtn, historyEl)
);
historyBtn.addEventListener("click", () => {
  toggleDrawer(historyBtn, historyEl, settingsBtn, settingsEl);
  if (!historyEl.hasAttribute("hidden")) renderHistoryList();
});

/* ------------------------------- history ------------------------------- */

function fmtDate(ts) {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function renderHistoryList() {
  const sessions = await loadSessions();
  historyListEl.innerHTML = "";

  if (sessions.length === 0) {
    const p = document.createElement("p");
    p.className = "agent-empty";
    p.textContent = "No saved conversations yet.";
    historyListEl.appendChild(p);
    return;
  }

  sessions.forEach((s) => {
    const row = document.createElement("div");
    row.className = "history-row" + (session && session.id === s.id ? " active" : "");

    const main = document.createElement("button");
    main.className = "history-main";
    main.title = "Open this conversation";

    const title = document.createElement("span");
    title.className = "history-title";
    title.textContent = s.title || "(untitled)";

    const meta = document.createElement("span");
    meta.className = "history-meta";
    meta.textContent = `${fmtDate(s.updatedAt)} · ${s.turns.length} prompt${s.turns.length === 1 ? "" : "s"}`;

    main.append(title, meta);
    main.addEventListener("click", () => openSession(s.id));

    const del = document.createElement("button");
    del.className = "agent-remove";
    del.textContent = "Delete";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      const sessions = await loadSessions();
      await chrome.storage.local.set({
        sessions: sessions.filter((x) => x.id !== s.id),
      });
      if (session && session.id === s.id) {
        session = null;
        await chrome.storage.session.remove("activeSessionId");
        clearTranscript();
      }
      renderHistoryList();
    });

    row.append(main, del);
    historyListEl.appendChild(row);
  });
}

clearHistoryBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ sessions: [] });
  renderHistoryList();
});

async function openSession(id) {
  const sessions = await loadSessions();
  const s = sessions.find((x) => x.id === id);
  if (!s) return;
  session = s;
  await chrome.storage.session.set({ activeSessionId: s.id });
  renderSession(s);
  historyEl.setAttribute("hidden", "");
  historyBtn.setAttribute("aria-expanded", "false");
}

// Re-render a saved session into the transcript.
function renderSession(s) {
  clearTranscript(false);
  s.turns.forEach((turn) => {
    addEntry(turn.promptId, turn.text, turn.providers, new Date(turn.time));
    turn.providers.forEach((pid) => {
      const ans = (turn.answers || {})[pid];
      applySavedAnswer(turn.promptId, pid, ans);
    });
  });
  lastPromptId = s.turns.length ? s.turns[s.turns.length - 1].promptId : null;
  autoScroll(true);
}

function applySavedAnswer(promptId, provider, ans) {
  const entry = entries[promptId];
  if (!entry || !entry.msgs[provider]) return;
  const m = entry.msgs[provider];

  if (!ans || (!ans.text && !ans.html && !ans.error)) {
    m.msg.classList.remove("pending");
    m.state.textContent = "";
    m.bubble.classList.add("plain");
    m.bubble.textContent = "(no response captured)";
    m.msg.classList.add("failed");
    if (m.stopBtn) m.stopBtn.hidden = true;
    return;
  }
  handleAnswerUpdate({
    promptId,
    provider,
    text: ans.text || "",
    html: ans.html || "",
    done: true,
    error: ans.error || null,
  });
}

/* ----------------------------- chat helpers ---------------------------- */

function isNearBottom() {
  return (
    transcriptEl.scrollHeight - transcriptEl.scrollTop -
      transcriptEl.clientHeight < 80
  );
}

function autoScroll(force = false) {
  if (force || isNearBottom()) {
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }
}

function clearTranscript(showEmpty = true) {
  transcriptEl.querySelectorAll(".turn").forEach((e) => e.remove());
  Object.keys(entries).forEach((k) => delete entries[k]);
  lastPromptId = null;
  emptyStateEl.style.display = showEmpty ? "" : "none";
}

function typingDots() {
  const t = document.createElement("span");
  t.className = "typing";
  t.innerHTML = "<i></i><i></i><i></i>";
  return t;
}

/* ---------------------------- chat rendering ---------------------------- */

function addEntry(promptId, text, providerIds, date = new Date()) {
  emptyStateEl.style.display = "none";

  const turn = document.createElement("div");
  turn.className = "turn";

  const when = document.createElement("div");
  when.className = "when";
  when.textContent = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  turn.appendChild(when);

  const userMsg = document.createElement("div");
  userMsg.className = "msg user";
  const userBubble = document.createElement("div");
  userBubble.className = "bubble";
  userBubble.textContent = text;
  userMsg.appendChild(userBubble);
  turn.appendChild(userMsg);

  const imageIntent = IMAGE_INTENT.test(text);

  const msgs = {};
  providerIds.forEach((id) => {
    const msg = document.createElement("div");
    msg.className = "msg ai pending";

    const avatar = makeAvatar(id);

    const col = document.createElement("div");
    col.className = "msg-col";

    const head = document.createElement("div");
    head.className = "msg-head";

    const name = document.createElement("span");
    name.className = "msg-name";
    name.textContent = providerName(id);

    const state = document.createElement("span");
    state.className = "msg-state";
    state.textContent = "connecting…";

    head.append(name, state);
    col.appendChild(head);

    // Capability heads-up for image prompts.
    if (imageIntent && NO_IMAGE_GEN.has(id)) {
      const note = document.createElement("div");
      note.className = "msg-note";
      note.textContent = `⚠ ${providerName(id)} can't generate photographic images — expect a drawing or a text answer instead.`;
      col.appendChild(note);
    }

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.appendChild(typingDots());

    const actions = document.createElement("div");
    actions.className = "msg-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "msg-btn";
    copyBtn.textContent = "Copy";
    copyBtn.disabled = true;
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(bubble.innerText).then(() => {
        copyBtn.textContent = "Copied";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
      });
    });

    const openBtn = document.createElement("button");
    openBtn.className = "msg-btn";
    openBtn.textContent = "Open";
    openBtn.title = "Jump to this AI's tab";
    openBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "FOCUS_PROVIDER_TAB", provider: id });
    });

    // Visible only while this provider is still generating.
    const stopBtn = document.createElement("button");
    stopBtn.className = "msg-btn stop";
    stopBtn.textContent = "■ Stop";
    stopBtn.title = "Stop this AI's answer";
    stopBtn.addEventListener("click", () => {
      stopBtn.disabled = true;
      stopBtn.textContent = "Stopping…";
      chrome.runtime.sendMessage({
        type: "STOP_GENERATION",
        provider: id,
        promptId,
      });
    });

    actions.append(copyBtn, openBtn, stopBtn);

    bubble.addEventListener("click", (e) => {
      const a = e.target.closest("a[href]");
      if (a) {
        e.preventDefault();
        chrome.tabs.create({ url: a.href });
      }
    });

    col.append(bubble, actions);
    msg.append(avatar, col);
    turn.appendChild(msg);

    msgs[id] = { msg, state, bubble, copyBtn, stopBtn, hasContent: false };
  });

  transcriptEl.appendChild(turn);
  autoScroll(true);

  entries[promptId] = { msgs };
}

function setMsgState(promptId, provider, status, detail) {
  const entry = entries[promptId];
  if (!entry || !entry.msgs[provider]) return;
  const m = entry.msgs[provider];

  if (status === "working") {
    m.state.textContent = detail || "working…";
  } else if (status === "sent") {
    m.state.textContent = "answering…";
  } else if (status === "error") {
    m.msg.classList.remove("pending");
    m.msg.classList.add("failed");
    m.state.textContent = "failed";
    if (m.stopBtn) m.stopBtn.hidden = true;
    m.bubble.classList.add("plain");
    m.bubble.textContent = detail || "Something went wrong.";
    const turn = findTurn(promptId);
    if (turn) {
      turn.answers[provider] = { error: detail || "failed", done: true };
      scheduleSave();
    }
  }
}

/* ------------------------------- answers ------------------------------- */

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

function ensureNote(m) {
  if (m.note) return m.note;
  const note = document.createElement("div");
  note.className = "msg-note";
  m.bubble.before(note);
  m.note = note;
  return note;
}

// Collapse very long answers behind a Show more toggle (no inner scroll).
function applyCollapse(m) {
  requestAnimationFrame(() => {
    const b = m.bubble;
    if (m.expander) {
      m.expander.remove();
      m.expander = null;
    }
    b.classList.remove("collapsed", "expandable");
    if (b.scrollHeight > 440) {
      b.classList.add("expandable", "collapsed");
      const btn = document.createElement("button");
      btn.className = "expander";
      btn.textContent = "Show more";
      btn.addEventListener("click", () => {
        const collapsed = b.classList.toggle("collapsed");
        btn.textContent = collapsed ? "Show more" : "Show less";
      });
      b.after(btn);
      m.expander = btn;
    }
  });
}

// Wrap every image in the bubble with a hover Download button.
function addImageTools(bubble) {
  bubble.querySelectorAll("img").forEach((img) => {
    if (img.closest(".img-wrap")) return;
    const wrap = document.createElement("span");
    wrap.className = "img-wrap";
    img.replaceWith(wrap);
    wrap.appendChild(img);

    const dl = document.createElement("button");
    dl.className = "img-dl";
    dl.textContent = "↓ Save";
    dl.title = "Download this image";
    dl.addEventListener("click", (e) => {
      e.stopPropagation();
      downloadImage(img.src);
    });
    wrap.appendChild(dl);
  });
}

async function downloadImage(src) {
  try {
    let href = src;
    let revoke = null;
    if (!src.startsWith("data:")) {
      const blob = await (await fetch(src)).blob();
      href = URL.createObjectURL(blob);
      revoke = href;
    }
    const a = document.createElement("a");
    a.href = href;
    a.download = "omnichat-" + Date.now() + ".png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 5000);
  } catch {
    chrome.tabs.create({ url: src }); // last resort: open it
  }
}

/* ----------------------------- typewriter ------------------------------ */
// Streamed text arrives in bursts (captures, throttled checks). Reveal
// it a few characters at a time with a blinking caret, like the chatbots
// themselves do, so the user can see it's still generating. The reveal
// speeds up with backlog size, so it never falls behind the stream.

const TYPE_TICK_MS = 28;

function typeStep(m) {
  const t = m.typer;
  const backlog = t.target.length - t.shown;
  if (backlog <= 0) {
    t.timer = null;
    return;
  }
  t.shown = Math.min(t.target.length, t.shown + Math.max(2, Math.ceil(backlog / 40)));
  m.bubble.textContent = t.target.slice(0, t.shown);
  if (!m.hasContent) {
    m.hasContent = true;
    m.msg.classList.remove("pending");
    m.copyBtn.disabled = false;
  }
  autoScroll();
  t.timer = setTimeout(() => typeStep(m), TYPE_TICK_MS);
}

function setStreamingText(m, text) {
  m.bubble.classList.add("plain", "streaming");
  if (!m.typer) m.typer = { shown: 0, target: "", timer: null };
  const t = m.typer;
  // If the site rewrote earlier text instead of appending, resync.
  if (!text.startsWith(t.target.slice(0, t.shown))) {
    t.shown = 0;
  }
  t.target = text;
  if (!t.timer) typeStep(m);
}

function finishTyper(m) {
  if (m.typer && m.typer.timer) {
    clearTimeout(m.typer.timer);
    m.typer.timer = null;
  }
  m.bubble.classList.remove("streaming");
}

function handleAnswerUpdate(msg) {
  const { promptId, provider, text, html, done, error, warning } = msg;
  const entry = entries[promptId];
  if (!entry || !entry.msgs[provider]) return;
  const m = entry.msgs[provider];

  // A site notice (rate limit, high demand…) while we keep waiting.
  if (warning && !done && !error) {
    ensureNote(m).textContent = `⚠ ${providerName(provider)} says: ${warning}`;
    m.state.textContent = "site notice";
    autoScroll();
    return;
  }

  if (error) {
    finishTyper(m);
    m.msg.classList.remove("pending");
    m.msg.classList.add("failed");
    m.state.textContent = "unavailable";
    m.bubble.classList.add("plain");
    m.bubble.textContent = error;
    if (m.stopBtn) m.stopBtn.hidden = true;
  } else {
    // Real content arrived — clear any earlier failure/warning state.
    m.msg.classList.remove("failed");

    if (done && html) {
      finishTyper(m);
      const clean = sanitizeHtml(html);
      // Guard against content-free markup (empty divs after sanitizing).
      const probe = document.createElement("div");
      probe.innerHTML = clean;
      const hasReal =
        (probe.textContent || "").trim().length > 0 || probe.querySelector("img");

      if (hasReal) {
        m.bubble.classList.remove("plain");
        m.bubble.innerHTML = clean;
        addImageTools(m.bubble);
        m.hasContent = true;
      } else if (text) {
        m.bubble.classList.add("plain");
        m.bubble.textContent = text;
        m.hasContent = true;
      }
    } else if (text) {
      if (done) {
        // Final text-only answer: flush whatever is mid-type instantly.
        finishTyper(m);
        m.bubble.classList.add("plain");
        m.bubble.textContent = text;
        m.hasContent = true;
      } else {
        setStreamingText(m, text);
      }
    }

    if (m.hasContent) {
      m.msg.classList.remove("pending");
      m.copyBtn.disabled = false;
    }
    m.state.textContent = done ? "" : "answering…";
    if (done && m.stopBtn) m.stopBtn.hidden = true;
    if (done && m.hasContent) applyCollapse(m);
  }

  if ((done || error) && promptId === lastPromptId) {
    markDoneGenerating(provider);
  }

  // Persist into the session.
  const turn = findTurn(promptId);
  if (turn) {
    const prev = turn.answers[provider] || {};
    turn.answers[provider] = {
      text: error ? "" : text || prev.text || "",
      html: error ? "" : (done && html ? html : prev.html || ""),
      error: error || null,
      done: !!done || !!prev.done,
    };
    scheduleSave();
  }

  autoScroll();
}

/* ------------------------------ broadcast ------------------------------ */

function selectedProviders() {
  return providers.map((p) => p.id).filter((id) => enabled[id]);
}

// Providers still generating for the latest prompt. While any are,
// the Broadcast button becomes a global ■ Stop.
const generating = new Set();

function updateComposerMode() {
  const stopMode = generating.size > 0;
  sendBtn.classList.toggle("stop-mode", stopMode);
  sendBtn.textContent = stopMode ? "■ Stop" : "Broadcast";
  updateSendState();
}

function markDoneGenerating(provider) {
  if (generating.delete(provider)) updateComposerMode();
}

function updateSendState() {
  sendBtn.disabled =
    generating.size === 0 &&
    (promptEl.value.trim().length === 0 || selectedProviders().length === 0);
}

function broadcast() {
  const text = promptEl.value.trim();
  const ids = selectedProviders();
  if (!text || ids.length === 0) return;

  const promptId =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  if (!session) {
    session = newSessionObject(text);
    chrome.storage.session.set({ activeSessionId: session.id });
  }
  session.turns.push({
    promptId,
    text,
    time: Date.now(),
    providers: ids,
    answers: {},
  });
  scheduleSave();

  lastPromptId = promptId;
  addEntry(promptId, text, ids);
  ids.forEach((p) => setChipStatus(p, "working"));
  generating.clear();
  ids.forEach((p) => generating.add(p));
  updateComposerMode();
  sendBtn.classList.add("busy");

  chrome.runtime.sendMessage({ type: "BROADCAST", text, providers: ids, promptId });

  promptEl.value = "";
  updateSendState();
  promptEl.focus();
}

/* ------------------------------- events -------------------------------- */

sendBtn.addEventListener("click", () => {
  if (generating.size > 0) {
    [...generating].forEach((pid) =>
      chrome.runtime.sendMessage({
        type: "STOP_GENERATION",
        provider: pid,
        promptId: lastPromptId,
      })
    );
    sendBtn.textContent = "Stopping…";
    return;
  }
  broadcast();
});

promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    broadcast();
  }
});

promptEl.addEventListener("input", () => {
  updateSendState();
  promptEl.style.height = "auto";
  promptEl.style.height = Math.min(promptEl.scrollHeight, 200) + "px";
});

// Split view: ONE tab with every selected AI side by side and a
// floating composer at the bottom. The side panel closes itself —
// the split view takes over; its ⬅ Panel button brings this back.
document.getElementById("splitBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_SPLIT_CHAT" }, () => {
    window.close();
  });
});

// Floating "jump to latest" button when scrolled up.
const jumpBtn = document.createElement("button");
jumpBtn.className = "jump";
jumpBtn.textContent = "↓ Latest";
jumpBtn.setAttribute("aria-label", "Scroll to latest messages");
jumpBtn.addEventListener("click", () => autoScroll(true));
document.body.appendChild(jumpBtn);

transcriptEl.addEventListener("scroll", () => {
  jumpBtn.classList.toggle("show", !isNearBottom());
});

newSessionBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "NEW_SESSION" }, async () => {
    await persistSession();
    session = null;
    await chrome.storage.session.remove("activeSessionId");
    providers.forEach((p) => setChipStatus(p.id, "idle"));
    generating.clear();
    updateComposerMode();
    clearTranscript();
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "PROVIDER_STATUS") {
    setChipStatus(msg.provider, msg.status === "idle" ? "idle" : msg.status);
    if (msg.status === "error" || msg.status === "idle") {
      markDoneGenerating(msg.provider);
    }
    if (lastPromptId) {
      setMsgState(lastPromptId, msg.provider, msg.status, msg.detail);
    }
    const anyWorking = Object.values(chipEls).some((c) =>
      c.classList.contains("working")
    );
    sendBtn.classList.toggle("busy", anyWorking);
  }

  if (msg.type === "ANSWER_UPDATE") {
    handleAnswerUpdate(msg);
  }
});

/* -------------------------------- init --------------------------------- */

async function init() {
  const { enabledProviders, customAgents: stored } =
    await chrome.storage.sync.get(["enabledProviders", "customAgents"]);
  if (enabledProviders) enabled = { ...enabled, ...enabledProviders };
  if (Array.isArray(stored)) customAgents = stored;
  rebuildProviders();
  renderChips();
  renderAgentList();
  updateSendState();

  // Restore the active session so reopening the panel keeps the thread.
  const { activeSessionId } = await chrome.storage.session.get("activeSessionId");
  if (activeSessionId) {
    const sessions = await loadSessions();
    const s = sessions.find((x) => x.id === activeSessionId);
    if (s) {
      session = s;
      renderSession(s);
    }
  }
}

/* ------------------------------ settings ------------------------------- */

function renderAgentList() {
  agentListEl.innerHTML = "";
  if (customAgents.length === 0) {
    const p = document.createElement("p");
    p.className = "agent-empty";
    p.textContent = "No custom agents yet.";
    agentListEl.appendChild(p);
    return;
  }
  customAgents.forEach((a) => {
    const row = document.createElement("div");
    row.className = "agent-row";

    const label = document.createElement("span");
    label.className = "agent-label";
    label.textContent = a.name;

    const host = document.createElement("span");
    host.className = "agent-host";
    host.textContent = a.host;

    const remove = document.createElement("button");
    remove.className = "agent-remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => removeAgent(a.id));

    row.append(label, host, remove);
    agentListEl.appendChild(row);
  });
}

async function saveAgents() {
  await chrome.storage.sync.set({ customAgents });
  rebuildProviders();
  renderChips();
  renderAgentList();
  updateSendState();
}

async function addAgent() {
  const name = agentNameEl.value.trim();
  const urlRaw = agentUrlEl.value.trim();
  if (!name || !urlRaw) {
    agentUrlEl.placeholder = "Both name and URL are needed";
    return;
  }

  let url;
  try {
    url = new URL(urlRaw.startsWith("http") ? urlRaw : "https://" + urlRaw);
    if (url.protocol !== "https:") throw new Error();
  } catch {
    agentUrlEl.value = "";
    agentUrlEl.placeholder = "Enter a valid https:// URL";
    return;
  }

  const origin = url.origin + "/*";
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [origin] });
  } catch {
    granted = false;
  }
  if (!granted) {
    agentUrlEl.placeholder = "Permission was declined";
    return;
  }

  customAgents.push({
    id: "c_" + Date.now().toString(36),
    name,
    url: url.href,
    host: url.hostname,
  });
  enabled[customAgents[customAgents.length - 1].id] = true;
  chrome.storage.sync.set({ enabledProviders: enabled });

  agentNameEl.value = "";
  agentUrlEl.value = "";
  agentUrlEl.placeholder = "Chat URL — e.g. https://chat.mistral.ai/";
  await saveAgents();
}

async function removeAgent(id) {
  customAgents = customAgents.filter((a) => a.id !== id);
  delete enabled[id];
  chrome.storage.sync.set({ enabledProviders: enabled });
  await saveAgents();
}

addAgentBtn.addEventListener("click", addAgent);

init();
