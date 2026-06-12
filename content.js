// OmniChat — content script
// Threading model: after sending the prompt, we locate the user's own
// prompt bubble in the page (the "anchor") and treat ONLY content that
// appears after it as the answer. The watcher tracks BOTH text and
// images, finishes when the combined state settles, and keeps watching
// afterwards so slow image generation still gets captured.

(() => {
  if (window.__omniChatLoaded) return;
  window.__omniChatLoaded = true;

  // Run in the page's top frame, or in a provider iframe sitting
  // directly inside our own split view — never in sites' nested frames.
  const inSplitFrame =
    location.ancestorOrigins &&
    location.ancestorOrigins.length === 1 &&
    location.ancestorOrigins[0].startsWith("chrome-extension://");
  if (window !== window.top && !inSplitFrame) return;

  // In the split tab every provider frame gets every message; the hosts
  // list says which frame a message is actually meant for.
  function frameMatches(msg) {
    if (!msg.hosts || !msg.hosts.length) return true;
    const h = location.hostname;
    return msg.hosts.some((x) => h === x || h.endsWith("." + x));
  }

  const GENERIC_ANSWER_SELECTORS = [
    '[data-message-author-role="assistant"]',
    'div[class*="assistant"]',
    'div[class*="response"] div[class*="markdown"]',
    ".markdown",
    ".prose",
    'div[class*="markdown"]',
  ];

  const GLOBAL_JUNK = [
    ".sr-only",
    '[class*="sr-only"]',
    '[class*="screen-reader"]',
    '[class*="screenreader"]',
  ];

  const SITES = [
    {
      id: "chatgpt",
      hosts: ["chatgpt.com", "chat.openai.com"],
      inputSelectors: [
        "#prompt-textarea",
        'div[contenteditable="true"].ProseMirror',
        'textarea[data-testid="prompt-textarea"]',
      ],
      sendSelectors: [
        'button[data-testid="send-button"]',
        'button[data-testid="composer-send-button"]',
        'button[aria-label*="Send" i]',
      ],
      answerSelectors: [
        'div[data-message-author-role="assistant"]',
        ".markdown.prose",
      ],
      streamingSelectors: ['button[data-testid="stop-button"]'],
      stopSelectors: [
        'button[data-testid="stop-button"]',
        'button[data-testid="composer-stop-button"]',
        'button[aria-label*="Stop" i]',
      ],
      junkSelectors: [],
    },
    {
      id: "claude",
      hosts: ["claude.ai"],
      inputSelectors: [
        'div[contenteditable="true"].ProseMirror',
        'div[aria-label*="Claude" i][contenteditable="true"]',
        'div[contenteditable="true"]',
      ],
      sendSelectors: [
        'button[aria-label="Send message"]',
        'button[aria-label*="Send" i]',
      ],
      answerSelectors: [
        ".font-claude-message",
        "div[data-is-streaming]",
        'div[data-testid="chat-message-content"]',
      ],
      streamingSelectors: ['div[data-is-streaming="true"]'],
      stopSelectors: ['button[aria-label*="Stop" i]'],
      // Tool-use / artifact UI that leaks into the message text
      junkSelectors: [
        '[class*="artifact"]',
        '[data-testid*="artifact"]',
        '[data-testid*="tool-use"]',
        '[class*="tool-use"]',
        '[class*="thinking"]',
        '[data-testid*="thinking"]',
      ],
    },
    {
      id: "gemini",
      hosts: ["gemini.google.com"],
      inputSelectors: [
        "rich-textarea .ql-editor",
        'div.ql-editor[contenteditable="true"]',
        'div[contenteditable="true"]',
      ],
      sendSelectors: [
        'button[aria-label="Send message"]',
        "button.send-button",
        'button[aria-label*="Send" i]',
        'button[mattooltip*="Send" i]',
      ],
      answerSelectors: [
        "message-content",
        "model-response",
        ".model-response-text",
        ".response-container-content",
        ".markdown",
      ],
      streamingSelectors: ['button[aria-label*="Stop" i]'],
      stopSelectors: [
        'button[aria-label*="Stop" i]',
        'button[mattooltip*="Stop" i]',
      ],
      junkSelectors: [],
    },
    {
      id: "deepseek",
      hosts: ["chat.deepseek.com"],
      inputSelectors: ["textarea#chat-input", "textarea"],
      sendSelectors: [
        'div[role="button"][aria-disabled="false"]',
        'button[type="submit"]',
      ],
      answerSelectors: [".ds-markdown", 'div[class*="markdown"]'],
      streamingSelectors: [],
      stopSelectors: [
        'div[role="button"][aria-label*="Stop" i]',
        'button[aria-label*="Stop" i]',
      ],
      junkSelectors: [],
    },
    {
      id: "grok",
      hosts: ["grok.com"],
      inputSelectors: [
        'textarea[aria-label*="Grok" i]',
        "form textarea",
        'div[contenteditable="true"]',
        "textarea",
      ],
      sendSelectors: [
        'button[type="submit"]',
        'button[aria-label*="Submit" i]',
        'button[aria-label*="Send" i]',
      ],
      answerSelectors: [
        ".response-content-markdown",
        'div[class*="message-bubble"]',
        'div[class*="markdown"]',
      ],
      streamingSelectors: ['button[aria-label*="Stop" i]'],
      stopSelectors: ['button[aria-label*="Stop" i]'],
      junkSelectors: [],
    },
  ];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function siteConfig() {
    const host = location.hostname;
    return (
      SITES.find((s) =>
        s.hosts.some((h) => host === h || host.endsWith("." + h))
      ) || {
        id: "custom",
        inputSelectors: [],
        sendSelectors: [],
        answerSelectors: GENERIC_ANSWER_SELECTORS,
        streamingSelectors: ['button[aria-label*="Stop" i]'],
        stopSelectors: ['button[aria-label*="Stop" i]'],
        junkSelectors: [],
      }
    );
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function queryVisible(selector) {
    const matches = [...document.querySelectorAll(selector)].filter(isVisible);
    return matches.sort(
      (a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top
    )[0];
  }

  function findInput() {
    const cfg = siteConfig();
    for (const sel of cfg.inputSelectors) {
      const el = queryVisible(sel);
      if (el) return el;
    }
    return (
      queryVisible("textarea") ||
      queryVisible('div[contenteditable="true"]') ||
      null
    );
  }

  function findSendButton(input) {
    const cfg = siteConfig();
    const inputRect = input ? input.getBoundingClientRect() : null;
    for (const sel of cfg.sendSelectors) {
      let candidates = [...document.querySelectorAll(sel)].filter(
        (el) =>
          isVisible(el) &&
          !el.disabled &&
          el.getAttribute("aria-disabled") !== "true"
      );
      if (!candidates.length) continue;
      if (inputRect && candidates.length > 1) {
        // Generic selectors can match composer mode toggles too
        // (DeepSeek's "DeepThink"/"Search" are role=button divs).
        // Keep candidates on the composer row and take the right-most
        // one — that's where send controls live.
        const near = candidates.filter((el) => {
          const r = el.getBoundingClientRect();
          return (
            Math.abs(
              (r.top + r.bottom) / 2 - (inputRect.top + inputRect.bottom) / 2
            ) < 220
          );
        });
        if (near.length) candidates = near;
        candidates.sort(
          (a, b) =>
            b.getBoundingClientRect().right - a.getBoundingClientRect().right
        );
      }
      return candidates[0];
    }
    const form = input && input.closest ? input.closest("form") : null;
    if (form) {
      const btn = [...form.querySelectorAll('button[type="submit"], button')]
        .filter((b) => isVisible(b) && !b.disabled)
        .pop();
      if (btn) return btn;
    }
    return null;
  }

  /* --------------------------- text insertion --------------------------- */

  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function insertText(el, text) {
    el.focus();

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      setNativeValue(el, text);
      return true;
    }

    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch {
      inserted = false;
    }

    const currentText = (el.innerText || "").trim();
    if (!inserted || currentText !== text.trim()) {
      try {
        el.dispatchEvent(
          new InputEvent("beforeinput", {
            inputType: "insertText",
            data: text,
            bubbles: true,
            cancelable: true,
          })
        );
      } catch {}
      if ((el.innerText || "").trim() !== text.trim()) {
        el.innerHTML = "";
        const p = document.createElement("p");
        p.textContent = text;
        el.appendChild(p);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    return true;
  }

  /* ------------------------------ sending ------------------------------- */

  function pressEnter(el) {
    const opts = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  async function submit(input) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const btn = findSendButton(input);
      if (btn) {
        btn.click();
        return true;
      }
      await sleep(300);
    }
    pressEnter(input);
    return true;
  }

  function composerHolds(input, text) {
    const el =
      input && input.isConnected ? input : findInput(); // sites re-render it
    if (!el) return false;
    const current =
      el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
        ? el.value
        : el.innerText || "";
    return current.trim() === text.trim();
  }

  // The click may have hit something other than Send (mode toggles match
  // generic selectors). The prompt only counts as sent once the composer
  // is cleared or the prompt bubble shows up in the conversation.
  async function verifySent(input, text) {
    for (let i = 0; i < 12; i++) {
      await sleep(500);
      if (!composerHolds(input, text)) return true;
      if (findPromptAnchor(text)) return true;
      if (i === 2) pressEnter(input);
      if (i === 5) {
        const btn = findSendButton(input);
        if (btn) btn.click();
      }
    }
    return !composerHolds(input, text);
  }

  /* ----------------------- prompt anchor (threading) --------------------- */

  // Find the user's own prompt bubble on the page. Everything that
  // appears AFTER it in document order belongs to the new answer.
  function findPromptAnchor(promptText) {
    const firstLine = (promptText.split("\n")[0] || promptText).trim();
    const needle = firstLine.slice(0, 60);
    if (needle.length < 4) return null;

    const scan = (root) => {
      let found = null;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.textContent && node.textContent.includes(needle)) {
          const el = node.parentElement;
          if (el && !el.closest('textarea, [contenteditable="true"]')) {
            found = el; // keep the LAST occurrence = the newest bubble
          }
        }
      }
      return found;
    };

    const light = scan(document.body);
    if (light) return light;

    // Some sites (Gemini) render the prompt bubble inside shadow roots,
    // where a body TreeWalker can't see it. Anchor on the shadow HOST so
    // document-order comparisons against light-DOM nodes still work.
    let found = null;
    try {
      document.body.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot && scan(el.shadowRoot)) found = el;
      });
    } catch {}
    return found;
  }

  function isAfter(el, anchor) {
    return !!(
      anchor.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
    );
  }

  /* --------------------------- answer location -------------------------- */

  // querySelectorAll that can also look inside open shadow roots —
  // only used as a fallback, since deep traversal is expensive.
  function deepQueryAll(selector, root = document) {
    const out = [...root.querySelectorAll(selector)];
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) out.push(...deepQueryAll(selector, el.shadowRoot));
    });
    return out;
  }

  function rawAnswerNodes() {
    const cfg = siteConfig();
    for (const sel of cfg.answerSelectors) {
      const nodes = [...document.querySelectorAll(sel)];
      if (nodes.length) return nodes;
    }
    // Nothing in the light DOM — some sites render inside shadow roots.
    for (const sel of cfg.answerSelectors) {
      try {
        const nodes = deepQueryAll(sel);
        if (nodes.length) return nodes;
      } catch {}
    }
    return [];
  }

  // Answer nodes scoped to the current prompt.
  // Strategy 1: nodes after the user's prompt bubble (precise threading).
  // Strategy 2: if that yields nothing, nodes beyond the pre-prompt count
  // (works on sites where the anchor can't be located/compared).
  function answerNodes(ctx) {
    const nodes = rawAnswerNodes();
    if (ctx.anchor) {
      try {
        const after = nodes.filter((n) => isAfter(n, ctx.anchor));
        if (after.length) return after;
      } catch {}
    }
    if (nodes.length > ctx.baselineCount) return nodes.slice(ctx.baselineCount);
    return [];
  }

  function answerText(ctx) {
    const nodes = answerNodes(ctx);
    if (nodes.length) {
      return nodes
        .map((n) => (n.innerText || "").trim())
        .filter(Boolean)
        .join("\n\n");
    }
    // Last-resort fallback: the final raw node changed since baseline.
    // Applies even when an anchor exists — sites that grow an existing
    // message node in place (no count change, anchor filter empty)
    // would otherwise stream nothing until the node count catches up.
    // Whitespace-insensitive compare: a cosmetic re-render of the OLD
    // answer must not be mistaken for a new one.
    const norm = (t) => t.replace(/\s+/g, " ").trim();
    const raw = rawAnswerNodes();
    if (raw.length) {
      const last = (raw[raw.length - 1].innerText || "").trim();
      if (last && norm(last) !== norm(ctx.baselineLastText || "")) return last;
    }
    return "";
  }

  function siteLooksBusy() {
    const cfg = siteConfig();
    return cfg.streamingSelectors.some((sel) =>
      [...document.querySelectorAll(sel)].some(isVisible)
    );
  }

  // Phrases that mean "the site refused / can't answer right now".
  const NOTICE_RX =
    /(high demand|heavy usage|under heavy|try again later|rate.?limit|usage limit|message limit|daily limit|limit reached|reached your|you've reached|out of free|too many requests|quota|temporarily unavailable|upgrade (your )?plan|please upgrade|something went wrong|server (is )?busy|at capacity)/i;

  // Visible site notices: rate limits, "high demand", errors, quota banners.
  function findAlertText() {
    const sels = [
      '[role="alert"]',
      '[class*="error" i]',
      '[class*="warning" i]',
      '[class*="limit" i]',
      '[class*="demand" i]',
      '[class*="quota" i]',
      '[class*="toast" i]',
      '[class*="banner" i]',
    ];
    for (const sel of sels) {
      let nodes = [];
      try {
        nodes = [...document.querySelectorAll(sel)];
      } catch {
        continue;
      }
      for (const el of nodes) {
        if (!isVisible(el)) continue;
        const t = (el.innerText || "").trim().replace(/\s+/g, " ");
        if (t.length >= 10 && t.length <= 300) return t;
      }
    }
    return "";
  }

  // Selector-based detection first, then a phrase scan — limit banners
  // (Grok's "High Demand" card, etc.) often carry no telling class name.
  function findNoticeText() {
    const fromSelectors = findAlertText();
    if (fromSelectors) return fromSelectors;

    let found = "";
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!NOTICE_RX.test(node.textContent || "")) continue;
      const el = node.parentElement;
      if (!el || !isVisible(el)) continue;
      if (el.closest('textarea, [contenteditable="true"]')) continue;
      const block = el.closest("p, li, div, section, aside") || el;
      const t = (block.innerText || "").trim().replace(/\s+/g, " ");
      if (t.length >= 8 && t.length <= 300) found = t; // keep the LAST = newest
    }
    return found;
  }

  /* ----------------------------- image tools ---------------------------- */

  const imgSrc = (img) => img.currentSrc || img.getAttribute("src") || "";

  // Climb out of shadow roots to the element's top-level light-DOM host,
  // so position/containment checks work for shadow content too.
  function lightHost(el) {
    let cur = el;
    while (cur && cur.getRootNode && cur.getRootNode() instanceof ShadowRoot) {
      cur = cur.getRootNode().host;
    }
    return cur || el;
  }

  function allImgs() {
    try {
      return deepQueryAll("img"); // sees inside open shadow roots
    } catch {
      return [...document.querySelectorAll("img")];
    }
  }

  function snapshotPageImages() {
    const set = new Set();
    allImgs().forEach((img) => {
      const s = imgSrc(img);
      if (s) set.add(s);
    });
    return set;
  }

  // The scrollable container holding the conversation messages. Foreign
  // extension popups and composer toolbars live OUTSIDE it.
  function scrollableAncestor(el) {
    let n = el;
    while (n && n !== document.body) {
      try {
        const st = getComputedStyle(n);
        if (
          /(auto|scroll)/.test(st.overflowY) &&
          n.scrollHeight > n.clientHeight + 40
        ) {
          return n;
        }
      } catch {}
      n = n.parentElement;
    }
    return null;
  }

  function conversationRoot(ctx) {
    const raw = rawAnswerNodes();
    const ref = (raw.length && lightHost(raw[raw.length - 1])) || ctx.anchor;
    return ref ? scrollableAncestor(ref) : null;
  }

  // New content images belonging to this answer. The filters are strict
  // on purpose: other extensions inject icons into these pages, and site
  // chrome around the composer must never be mistaken for the answer.
  function answerImages(ctx) {
    const nodes = answerNodes(ctx);
    const composer = findInput();
    const main = document.querySelector('main, [role="main"]');
    const scroller = conversationRoot(ctx);

    const candidates = allImgs().filter((img) => {
      const s = imgSrc(img);
      if (!s || ctx.baselineSrcs.has(s)) return false;
      // Never content injected by other browser extensions.
      if (/^(chrome|moz|edge|safari-web)-extension:/i.test(s)) return false;
      if (!isVisible(img)) return false;
      if (img.complete && (img.naturalWidth < 64 || img.naturalHeight < 64)) {
        return false; // loaded but tiny = icon/avatar
      }

      // Inside one of this prompt's answer nodes → definitely ours.
      if (nodes.some((n) => n.contains(img))) return true;

      const host = lightHost(img);

      // Stray images must sit inside the conversation scroller. This is
      // what excludes other extensions' popups (even with https/data
      // sources) and anything floating around the composer.
      if (scroller && !scroller.contains(host)) return false;

      // …never inside or after the composer row.
      if (composer) {
        try {
          if (composer.contains(host) || host.contains(composer)) return false;
          if (
            composer.compareDocumentPosition(host) &
            Node.DOCUMENT_POSITION_FOLLOWING
          ) {
            return false;
          }
        } catch {}
      }
      // …and inside the page's main content area when the page has one.
      if (main && !main.contains(host)) return false;
      return true;
    });

    // Prefer precise threading (after the prompt bubble); if the anchor
    // filter strands us with nothing, fall back to all in-conversation
    // candidates — mirrors answerNodes, fixes image-only answers when
    // the anchor was mislocated.
    if (ctx.anchor) {
      try {
        const after = candidates.filter((i) =>
          isAfter(lightHost(i), ctx.anchor)
        );
        if (after.length) return after.slice(0, 6);
      } catch {}
    }
    return candidates.slice(0, 6);
  }

  function imagesAllLoaded(imgs) {
    return imgs.every((img) => img.complete && img.naturalWidth > 0);
  }

  async function toDataUrl(src, liveImg) {
    if (!src || src.startsWith("data:")) return src || null;

    try {
      const res = await fetch(src, { credentials: "include" });
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size <= 4_000_000 && blob.type.startsWith("image/")) {
          return await new Promise((ok, err) => {
            const r = new FileReader();
            r.onload = () => ok(r.result);
            r.onerror = err;
            r.readAsDataURL(blob);
          });
        }
      }
    } catch {
      /* fall through to canvas */
    }

    const img =
      liveImg ||
      [...document.querySelectorAll("img")].find((i) => imgSrc(i) === src);
    if (img && img.complete && img.naturalWidth > 0) {
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 1600 / img.naturalWidth);
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/png");
      } catch {
        /* tainted canvas */
      }
    }
    return null;
  }

  async function inlineImages(container) {
    const imgs = [...container.querySelectorAll("img")].slice(0, 6);
    for (const img of imgs) {
      const src = img.getAttribute("src") || "";
      if (!src || src.startsWith("data:")) continue;
      const dataUrl = await toDataUrl(src);
      if (dataUrl) img.setAttribute("src", dataUrl);
    }
  }

  /* ------------------------ rich answer capture ------------------------- */

  function sanitizeNode(node) {
    const cfg = siteConfig();
    const clone = node.cloneNode(true);

    clone
      .querySelectorAll(
        "script,style,link,iframe,object,embed,button,input,textarea,select,svg,canvas,video,audio"
      )
      .forEach((n) => n.remove());

    // Remove site noise (thinking blocks, tool chrome, sr-only echoes) —
    // but NEVER let a junk selector swallow the actual answer. If a match
    // holds most of the message's text, it IS the message; keep it.
    const totalLen = (clone.textContent || "").trim().length;
    [...GLOBAL_JUNK, ...(cfg.junkSelectors || [])].forEach((sel) => {
      try {
        clone.querySelectorAll(sel).forEach((n) => {
          const nLen = (n.textContent || "").trim().length;
          if (totalLen > 0 && nLen > totalLen * 0.6) return; // too big — keep
          n.remove();
        });
      } catch {}
    });

    // KaTeX / MathML → LaTeX source (BEFORE stripping attributes)
    const mathToCode = (el) => {
      const ann = el.querySelector('annotation[encoding="application/x-tex"]');
      const code = document.createElement("code");
      code.setAttribute("data-math", "1");
      code.textContent = ann
        ? ann.textContent.trim()
        : (el.textContent || "").trim();
      el.replaceWith(code);
    };
    clone.querySelectorAll(".katex").forEach(mathToCode);
    clone.querySelectorAll("math").forEach(mathToCode);

    clone.querySelectorAll("img").forEach((cImg) => {
      const raw = cImg.getAttribute("src") || cImg.getAttribute("data-src") || "";
      let resolved = raw;
      try {
        resolved = new URL(raw, location.href).href;
      } catch {}
      cImg.setAttribute("src", resolved);
    });

    clone.querySelectorAll("*").forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const keep =
          name === "href" || name === "src" || name === "alt" || name === "data-math";
        if (!keep || /^javascript:/i.test(attr.value)) {
          el.removeAttribute(attr.name);
        }
      });
    });

    return clone;
  }

  async function captureAndSend(provider, promptId, ctx, fallbackText) {
    try {
      const wrapper = document.createElement("div");

      // All answer nodes for THIS prompt (text may be split across nodes).
      answerNodes(ctx).forEach((node) => {
        wrapper.appendChild(sanitizeNode(node));
      });

      // Drop exact-duplicate blocks (echoed announcements / summaries).
      const seenBlocks = new Set();
      [...wrapper.children].forEach((child) => {
        const t = (child.textContent || "").trim();
        if (t.length > 24) {
          if (seenBlocks.has(t)) child.remove();
          else seenBlocks.add(t);
        }
      });

      // Generated images living outside those nodes.
      const have = new Set(
        [...wrapper.querySelectorAll("img")].map((i) => i.getAttribute("src"))
      );
      answerImages(ctx).forEach((live) => {
        if (!(live.complete && live.naturalWidth > 0)) return;
        const s = imgSrc(live);
        if (!s || have.has(s)) return;
        const img = document.createElement("img");
        img.setAttribute("src", s);
        if (live.alt) img.setAttribute("alt", live.alt);
        wrapper.appendChild(img);
        have.add(s);
      });

      await inlineImages(wrapper);

      let html = wrapper.innerHTML || "";
      if (html.length > 4_000_000) html = "";

      // If sanitizing left only empty markup (no text, no images), don't
      // ship it — an empty html makes the panel fall back to the text.
      const meaningful =
        (wrapper.textContent || "").trim().length > 0 ||
        wrapper.querySelector("img");
      if (!meaningful) html = "";

      sendAnswerUpdate(provider, promptId, {
        text: fallbackText,
        html,
        done: true,
      });
    } catch {
      sendAnswerUpdate(provider, promptId, { text: fallbackText, done: true });
    }
  }

  /* --------------------------- answer watching -------------------------- */

  let watcherToken = 0;
  let activeWatchKick = null; // background TICKs nudge the live watcher
  let activeWatchStop = null; // panel Stop button finalizes the live watcher

  function clickStopButton() {
    const cfg = siteConfig();
    for (const sel of cfg.stopSelectors || []) {
      const btn = [...document.querySelectorAll(sel)].find(
        (b) => isVisible(b) && !b.disabled
      );
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  function sendAnswerUpdate(provider, promptId, payload) {
    chrome.runtime
      .sendMessage({ type: "ANSWER_UPDATE", provider, promptId, ...payload })
      .catch(() => {});
  }

  function signature(ctx) {
    const text = answerText(ctx);
    const imgs = answerImages(ctx);
    const srcs = imgs.map(imgSrc).sort();
    return {
      text,
      sig: JSON.stringify([text, srcs]),
      imgs,
      loaded: imagesAllLoaded(imgs),
    };
  }

  // Event-driven watcher. A MutationObserver streams the answer the
  // moment the site renders it (observers fire even in background tabs,
  // unlike timers, which Chrome throttles when the tab is hidden). A
  // heartbeat timer plus TICK messages from the service worker — message
  // delivery is never throttled — handle settle/timeout detection.
  function watchAnswer(provider, promptId, ctx, promptText) {
    const myToken = ++watcherToken;
    const startedAt = Date.now();
    const MAX_MS = 4 * 60 * 1000;       // main wait for an answer to finish
    const EXTRA_MS = 2 * 60 * 1000;     // keep watching for late images/text
    const HEARTBEAT_MS = 700;
    const CHECK_GAP_MS = 100;           // min spacing between DOM-driven checks
    const SETTLE_MS = 2800;             // quiet time before we call it done

    let lastStreamed = "";
    let lastSig = "";
    let lastChangeAt = Date.now();
    let started = false;
    let doneSentSig = null;
    let sentNotice = "";
    let noticeAt = 0;
    let lastNoticeScanAt = 0;
    let flashes = 0;
    let lastFlashSig = "";
    let finished = false;
    let checking = false;
    let recheck = false;
    let stopRequested = false;
    let pendingId = 0;
    let heartbeatId = 0;

    const echo = (t) => t.trim() === promptText.trim();

    const cleanup = () => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      clearTimeout(pendingId);
      clearTimeout(heartbeatId);
      // Only the live watcher owns the kick + background heartbeat.
      if (myToken === watcherToken) {
        activeWatchKick = null;
        activeWatchStop = null;
        chrome.runtime.sendMessage({ type: "WATCH_STOP" }).catch(() => {});
      }
    };

    async function check() {
      if (finished) return;
      if (myToken !== watcherToken) return cleanup();
      if (checking) {
        recheck = true;
        return;
      }
      checking = true;
      try {
        // The prompt bubble can render a moment after submit.
        if (!ctx.anchor) ctx.anchor = findPromptAnchor(promptText);
        observeShadows();

        const s = signature(ctx);
        let text = s.text;
        if (text && echo(text)) text = "";

        // The user pressed Stop in the panel: ship whatever rendered
        // before the site honored the stop click, then finish.
        if (stopRequested) {
          if (!doneSentSig) {
            if (text || lastStreamed || s.imgs.length) {
              await captureAndSend(provider, promptId, ctx, text || lastStreamed);
            } else {
              sendAnswerUpdate(provider, promptId, {
                text: "",
                done: true,
                error: "Stopped before an answer arrived.",
              });
            }
          }
          cleanup();
          return;
        }

        const hasContent = !!text || s.imgs.length > 0;
        if (hasContent) started = true;

        // No answer yet but the site is showing a notice (rate limit,
        // high demand, quota) — surface it right away, and if it stands
        // with no answer for 30s, fail the message instead of sitting
        // on "answering…" until the 4-minute timeout.
        if (!started && Date.now() - startedAt > 5000) {
          if (Date.now() - lastNoticeScanAt > 3000) {
            lastNoticeScanAt = Date.now();
            const notice = findNoticeText();
            if (notice && notice !== sentNotice) {
              sendAnswerUpdate(provider, promptId, {
                warning: notice,
                done: false,
              });
              sentNotice = notice;
              if (!noticeAt) noticeAt = Date.now();
            }
            if (!notice) {
              sentNotice = "";
              noticeAt = 0; // banner went away; keep waiting normally
            }
          }
          if (noticeAt && Date.now() - noticeAt > 30000) {
            sendAnswerUpdate(provider, promptId, {
              text: "",
              done: true,
              error: `The site says: “${sentNotice}”`,
            });
            cleanup();
            return;
          }
        }

        if (s.sig !== lastSig) {
          lastSig = s.sig;
          lastChangeAt = Date.now();
        }

        // Stream text while it grows.
        if (text && text !== lastStreamed && !doneSentSig) {
          sendAnswerUpdate(provider, promptId, { text, done: false });
          lastStreamed = text;
        }

        const settled =
          started &&
          Date.now() - lastChangeAt >= SETTLE_MS &&
          !siteLooksBusy() &&
          (s.imgs.length === 0 || s.loaded);

        if (settled && s.sig !== doneSentSig) {
          // Sites with no streaming indicator (DeepSeek) can freeze
          // their hidden-tab rendering mid-answer, which looks exactly
          // like "settled". Before finalizing, have the background
          // flash the tab visible for a beat so the site flushes —
          // only an answer that survives a flash unchanged is done.
          // (document.hidden here is the REAL value: the page-hook's
          // spoof lives in the MAIN world, not this isolated world.)
          const canSeeBusy =
            (siteConfig().streamingSelectors || []).length > 0;
          if (
            !canSeeBusy &&
            document.hidden &&
            flashes < 8 &&
            s.sig !== lastFlashSig
          ) {
            flashes++;
            lastFlashSig = s.sig;
            lastChangeAt = Date.now(); // re-arm the settle window
            chrome.runtime
              .sendMessage({ type: "FLASH_TAB" })
              .then(() => scheduleCheck())
              .catch(() => {});
          } else {
            await captureAndSend(provider, promptId, ctx, text || lastStreamed);
            doneSentSig = s.sig;
            if (!ctx.extendedUntil) {
              ctx.extendedUntil = Date.now() + EXTRA_MS;
            }
          }
        }

        const deadline = doneSentSig ? ctx.extendedUntil : startedAt + MAX_MS;
        if (Date.now() >= deadline) {
          if (!doneSentSig) {
            if (started) {
              await captureAndSend(
                provider,
                promptId,
                ctx,
                s.text || lastStreamed
              );
            } else {
              const notice = findNoticeText();
              sendAnswerUpdate(provider, promptId, {
                text: "",
                done: true,
                error: notice
                  ? `The site says: “${notice}”`
                  : "Couldn't read the answer from this page — use Open to see it in the tab.",
              });
            }
          }
          cleanup();
        }
      } finally {
        checking = false;
        if (recheck && !finished) {
          recheck = false;
          scheduleCheck();
        }
      }
    }

    // Coalesce mutation bursts into one check per CHECK_GAP_MS.
    const scheduleCheck = () => {
      if (finished || pendingId) return;
      pendingId = setTimeout(() => {
        pendingId = 0;
        check();
      }, CHECK_GAP_MS);
    };

    const OBS_OPTS = {
      childList: true,
      characterData: true,
      subtree: true,
    };
    const observer = new MutationObserver(scheduleCheck);
    observer.observe(document.body, OBS_OPTS);

    // A body observer never sees mutations inside shadow roots, where
    // sites like Gemini render their answers — those used to surface
    // only via the slow heartbeat, arriving late and in one chunk.
    // Attach the observer to every shadow root in and around the
    // answer nodes as they appear (re-run on each check; observing the
    // same root twice with identical options is a no-op).
    const observedRoots = new WeakSet();
    const observeRoot = (root) => {
      if (!root || observedRoots.has(root)) return;
      observedRoots.add(root);
      try {
        observer.observe(root, OBS_OPTS);
      } catch {}
    };
    const observeShadows = () => {
      try {
        rawAnswerNodes().forEach((n) => {
          let root = n.getRootNode && n.getRootNode();
          while (root instanceof ShadowRoot) {
            observeRoot(root);
            root = root.host.getRootNode();
          }
          n.querySelectorAll("*").forEach((el) => {
            if (el.shadowRoot) observeRoot(el.shadowRoot);
          });
        });
      } catch {}
    };

    // Heartbeat for what mutations can't see: settle quiet-time, the
    // deadline, and stop-button state. Throttled when hidden, which is
    // fine — background TICKs keep the cadence honest there.
    const beat = () => {
      if (finished) return;
      check();
      heartbeatId = setTimeout(beat, HEARTBEAT_MS);
    };
    heartbeatId = setTimeout(beat, HEARTBEAT_MS);

    activeWatchKick = scheduleCheck;
    activeWatchStop = () => {
      stopRequested = true;
      scheduleCheck();
    };
    chrome.runtime.sendMessage({ type: "WATCH_START" }).catch(() => {});
  }

  /* ------------------------------- handler ------------------------------ */

  async function handlePrompt(provider, promptId, text) {
    let input = null;
    for (let attempt = 0; attempt < 20 && !input; attempt++) {
      input = findInput();
      if (!input) await sleep(500);
    }
    if (!input) {
      return { ok: false, error: "Couldn't find the chat box (signed in?)" };
    }

    const ctx = {
      anchor: null, // located after submit, once the bubble renders
      baselineCount: rawAnswerNodes().length,
      baselineLastText: (() => {
        const raw = rawAnswerNodes();
        return raw.length ? (raw[raw.length - 1].innerText || "").trim() : "";
      })(),
      baselineSrcs: snapshotPageImages(),
      extendedUntil: 0,
    };

    insertText(input, text);
    await sleep(400);
    await submit(input);

    // Don't start watching until the prompt verifiably went out —
    // otherwise the watcher latches onto the PREVIOUS answer.
    const sent = await verifySent(input, text);
    if (!sent) {
      return {
        ok: false,
        error: "Typed the prompt but couldn't send it — check the tab.",
      };
    }

    const providerId = provider || siteConfig().id;
    watchAnswer(providerId, promptId, ctx, text);

    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "INJECT_PROMPT") {
      if (!frameMatches(msg)) return; // another provider's frame
      handlePrompt(msg.provider, msg.promptId, msg.text)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
    if (msg.type === "TICK") {
      if (activeWatchKick) activeWatchKick();
      // Drive the page-hook's timer pump (used when CSP blocks its
      // worker) — TICK delivery is never throttled, hidden or not.
      try {
        document.dispatchEvent(new CustomEvent("omnichat-pump"));
      } catch {}
      sendResponse({ ok: true });
    }
    if (msg.type === "STOP_GENERATION") {
      if (!frameMatches(msg)) return; // another provider's frame
      const clicked = clickStopButton();
      // Give the site a moment to honor the click and paint the final
      // (truncated) state of the message before we capture it.
      setTimeout(() => {
        if (activeWatchStop) activeWatchStop();
      }, clicked ? 600 : 0);
      sendResponse({ ok: true, clicked });
    }
    if (msg.type === "PING") {
      sendResponse({ ok: true });
    }
  });
})();
