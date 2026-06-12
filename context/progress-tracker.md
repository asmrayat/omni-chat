# Progress Tracker

> 🤖 AI Agent: READ THIS FILE before every session. UPDATE IT after every task.

## Current Phase
Phase 17: v1.17 — split view floatbar redesign (Models dropdown, round send button)

## Status
- **Last updated**: 2026-06-12 (v1.17)
- **Active branch**: main
- **Blocking issues**: None

## In Progress
- [ ] Manual smoke test on all 5 providers (fresh broadcast + follow-up), incl. broadcast with all tabs left in background
- [ ] Verify Gemini live: streams token-by-token (was: late + one chunk) and follow-up "generate an image" captures the image, not stale text
- [ ] Verify Stop button per provider actually halts generation on each site (stopSelectors are best-effort, esp. DeepSeek)

## Completed
- [x] v1.17: Floatbar redesign per user screenshot — provider chips replaced by a "Models (n) ▾" button with an upward dropdown (logo + name + ✓ per row, toggling loads/removes the column live; closes on outside click/Esc); Broadcast button is now a round ↑ circle (red round ■ in stop mode, briefly disabled while stopping); New session and ⬅ Panel kept
- [x] v1.16: Split view resizing — draggable 6px gutters between columns (pointer capture; widths as fractions mapped to flex-grow; min 8% per column; body.resizing disables iframe pointer-events so drags don't die over frames); adding a column gives it an equal share and scales the rest, removing renormalizes. Side-panel handoff: opening split view auto-closes the side panel (window.close after OPEN_SPLIT_CHAT ack); new ⬅ Panel button in the floatbar reopens it (chrome.sidePanel.open in-gesture, OPEN_SIDE_PANEL message as fallback)
- [x] v1.15: Split view polish (user-confirmed v1.14 works): provider favicons in column headers (google s2 service, same as panel avatars); OmniChat branding (icon + name) in the floatbar; New session button reloads every column into a fresh chat (about:blank → url, since same-src reassignment can be ignored); channel chips in the floatbar — toggling an AI on inserts its column side by side immediately (in provider order, without reloading existing columns), toggling off removes it; chips persist to storage.sync enabledProviders (shared with the side panel)
- [x] v1.14: Split view rebuilt per user feedback (v1.13's multi-window tiling rejected): ⊞ now opens split/split.html in ONE tab — an iframe column per enabled provider + slim floating composer fixed bottom-center (input only, no transcript). Frame-blocking headers (X-Frame-Options/CSP) stripped via declarativeNetRequest SESSION rule scoped to that tab's sub_frames only (new "declarativeNetRequest" permission — required for the user-requested feature). content.js/page-hook now all_frames:true with guards: content.js runs only in top frames or frames directly under our extension page; INJECT_PROMPT/STOP_GENERATION carry a hosts[] filter so only the right provider frame responds. BROADCAST {splitTab:true} routes prompts into the sender tab's frames (broadcastToSplitFrame); STOP/FOCUS fall back to the split tab; TICK heartbeat is now refcounted per tab (multiple frame watchers). KNOWN RISKS to verify live: sites may detect framing (JS top!==self busting), Google login inside iframes, third-party cookie partitioning (extension host-permission carve-out should keep sessions); v1.13 window-tiling code removed
- [x] v1.12: DeepSeek still froze mid-answer in background (CSP check showed blob workers ARE allowed there, so the v1.11 shim wasn't the gap). DeepSeek has streamingSelectors: [] → watcher can't tell "site still busy" from "done", so a frozen hidden-tab render looked settled and finalized partial. Fix: settle-time FLASH_TAB — for sites with no streaming indicator, while really hidden, the watcher asks BG to activate the tab for 700ms and switch back before finalizing; only an answer that survives a flash unchanged is captured as done (max 8 flashes, each requires growth since the last). Plus: page-hook timer shim gained a pump fallback for CSP-blocked-worker sites, driven by TICK relay (content script dispatches "omnichat-pump" CustomEvent) + native 250ms self-chain
- [x] v1.11: Gemini/DeepSeek freezing mid-answer in background tabs (ChatGPT was fine) — remaining root cause was Chrome's timer throttling in hidden tabs (1s clamp, 1/min under intensive throttling): those sites schedule streaming renders through setTimeout/setInterval. page-hook now installs a worker-backed timer shim — while the tab is REALLY hidden, page timers ≤30s route through a blob Web Worker (worker timers are never throttled); falls back silently to native timers if site CSP blocks blob workers. The rAF/rIC fallbacks resolve setTimeout at call time, so they run unthrottled too (~30fps background rendering)
- [x] v1.10: DeepSeek follow-up "typed but never sent, showed previous answer" — root causes: generic `div[role=button]` send selector hit the DeepThink/Search mode toggles (findSendButton now keeps composer-row candidates and takes the right-most), and the watcher started without confirming the send (new verifySent(): composer cleared OR prompt bubble appeared, with Enter + button retries; on failure returns error instead of latching onto the old answer). Last-resort text fallback is now whitespace-insensitive so a cosmetic re-render of the old answer can't stream as new
- [x] v1.10: Gemini freezing mid-answer in background tabs — page-hook now also patches requestIdleCallback (timer fallback while hidden) and IntersectionObserver (reports observed elements as intersecting once while hidden) so visibility-gated renderers keep writing to the DOM
- [x] v1.10: Broadcast button becomes a red global "■ Stop" while any provider is generating (tracks per-provider done/error/idle); clicking stops all active providers via STOP_GENERATION; reverts to Broadcast when all finish
- [x] v1.9: Limit banners (Grok "High Demand" etc.) now surface — findNoticeText() adds a phrase scan (NOTICE_RX: high demand/rate limit/quota/upgrade plan/…) on top of the class-based selectors, runs from 5s (was 15s) every 3s while no answer; panel shows the ⚠ note + "site notice" state; if the banner stands 30s with no answer the message fails with the site's own words instead of sitting on "answering…" for 4 min
- [x] v1.9: Typewriter streaming in the panel — chunked text reveals a few chars per 28ms tick with a blinking ▍ caret (reveal speed scales with backlog so it never lags the stream); flushes instantly on done/error; rich-HTML final render unchanged
- [x] v1.8: Per-message ■ Stop button in the panel while a provider is answering — new STOP_GENERATION message (panel → BG → content script): clicks the site's stop control (new per-site `stopSelectors` config), waits 600ms for the truncated answer to paint, then captures-and-finishes the watch; button hides on done/error
- [x] v1.8: Gemini streaming latency — root causes: (1) body MutationObserver can't see shadow-root mutations → watcher now attaches the observer to every shadow root in/around answer nodes each check; (2) answerText's last-raw-node fallback was gated on !anchor → now unconditional (in-place node growth streams immediately); (3) findPromptAnchor now falls back to scanning shadow roots, anchoring on the shadow host; check gap 150ms → 100ms
- [x] v1.7: Rebranded OmniPrompt → OmniChat (manifest name/action title, panel header/title, README, context docs, code comments, window globals `__omniChatLoaded`/`__omniChatPageHook`, image download filename prefix). No message types, storage keys, or permissions changed; folder on disk still `omniprompt`
- [x] v1.7: Background tabs no longer stall ("answering…" until manually visiting the tab). Root cause was threefold: (1) sites pause token rendering in hidden tabs (rAF never fires + visibilitychange suspends their render loop) — fixed by new `page-hook.js` (MAIN world, document_start) that spoofs document.hidden/visibilityState/hasFocus, swallows page-level visibilitychange/blur, and falls back rAF→setTimeout while really hidden; (2) the watcher's setTimeout poll loop gets throttled in hidden tabs — replaced with a MutationObserver-driven watcher (observers are not throttled); (3) settle/timeout timers still throttle — service worker now sends 1s TICK messages (never throttled) while a watch is active (new WATCH_START/WATCH_STOP/TICK message types)
- [x] v1.7: Streaming is now real-time — answer updates fire on DOM mutations (coalesced to ~150ms) instead of 700ms polls; settle detection switched from 4 stable polls to 2.8s of mutation quiet (same effective window)
- [x] v1.6: Foreign-extension image capture blocked — stray images must live inside the conversation scroller (catches https/data-src injected UI the extension-URL filter missed)
- [x] v1.6: Blank Claude answers fixed — junk removal can't delete >60% of a message; content-free captured HTML falls back to streamed text (both content + panel side)
- [x] v1.6: Gemini image-only answers — answerImages gained the same anchor-fallback layering as answerNodes; Gemini selectors broadened (model-response etc.)
- [x] v1.6: Long answers collapse behind Show more/Show less with fade hint (replaces inner scrolling)
- [x] v1.5: Gemini regression fixed — anchor filtering now falls back to count-diff when it yields nothing; shadow-DOM fallback querying added
- [x] v1.5: Site notices (rate limits, "High Demand", quota banners) detected via role=alert/error/limit selectors, shown as inline warnings while waiting and in timeout errors
- [x] v1.5: Real site favicons as avatars (runtime-loaded, monogram fallback — no bundled trademark files); ↓ Save button on every captured image
- [x] v1.5: UX polish — auto-growing composer, jump-to-latest button, message fade-in, slim scrollbars; Claude thinking-block junk filters + duplicate-block dedupe
- [x] v1.4: Prompt-anchor threading — answers scoped to content AFTER the user's bubble (fixes ChatGPT capturing previous answers)
- [x] v1.4: Unified text+image watcher (image-only answers like Gemini's now complete) + extended post-done watching (Grok's 'Generating image…' → final swap recaptured)
- [x] v1.4: Image-capability warning on image prompts for Claude/DeepSeek; Claude tool-UI noise filtered (artifact/tool/sr-only nodes)
- [x] v1.4: Local history — sessions in chrome.storage.local (cap 50, unlimitedStorage), History drawer with open/delete/clear, active session restored when panel reopens
- [x] v1.3: Chat-style transcript — user bubble right, AI messages left with monogram avatars, typing indicator, inline status, Copy/Open under each bubble (replaces boxed answer cards)
- [x] v1.2.1: Image capture fixed — root cause was text-stability 'done' firing before slow image generation finished. Added: page-wide image baseline diff (catches images outside the text container), 2-min post-done image watcher that re-sends when new images finish loading, canvas fallback for blob:/CORS image URLs
- [x] v1.2: New session also clears the panel transcript
- [x] v1.2: Rich answer capture — sanitized HTML (bold/lists/code/tables), KaTeX/MathML converted to LaTeX source, AI-generated images inlined as data URLs
- [x] v1.2: Open button on every answer card (focuses that provider's tab)
- [x] v1.2: Settings panel to add/remove custom agents (optional host permissions + on-demand content-script injection, generic composer/answer detection)
- [x] v1.1: Fixed follow-up bug — per-provider storage keys (parallel broadcasts were clobbering a shared tab map)
- [x] v1.1: Enter sends, Shift+Enter for newline
- [x] v1.1: Answer retrieval — content script watches the new assistant message, streams it to the panel (stability + stop-button completion detection)
- [x] MV3 scaffold: manifest, side panel, service worker, content script
- [x] Tab-per-provider session map with closed-tab recovery
- [x] Framework-safe text insertion (React/ProseMirror/Quill paths)
- [x] Panel UI: channel chips, transcript, delivery badges, Ctrl+Enter

## Up Next
1. Verify/refresh selectors per provider against live DOMs
2. Optional: per-provider "open tab" affordance polish
3. Optional: prompt history persistence (storage.local)

## Architectural Decisions Log
| Date | Decision | Reason | Alternatives Considered |
|------|----------|--------|------------------------|
| 2026-06-11 | v1 sends only; answers read in tabs | Reading answers needs per-site scraping that breaks often | Response aggregation in panel (deferred) |
| 2026-06-11 | Tab map in storage.session | MV3 worker can be suspended anytime | In-memory map (loses state) |
| 2026-06-11 | One universal content.js with SITES config | Site fixes become config edits | Five per-site scripts |

## Session Notes
### 2026-06-11
- Initial build by Claude. All site selectors are best-effort; expect to update them as sites ship UI changes.
