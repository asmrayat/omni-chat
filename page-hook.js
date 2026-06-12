// OmniChat — page-world hook (MAIN world, document_start)
// AI chat sites pause or batch their streamed-token rendering while
// their tab is hidden: requestAnimationFrame never fires in background
// tabs, and the apps listen for visibilitychange/blur to suspend their
// render loops. That left answers invisible to the DOM (and to our
// watcher) until the user manually visited the tab. This hook makes
// the page believe its tab is always visible and focused, and keeps
// rAF callbacks firing on a timer while the tab is really hidden, so
// answers keep streaming into the DOM in the background.

(() => {
  if (window.__omniChatPageHook) return;
  window.__omniChatPageHook = true;

  // Real visibility, read through the original prototype getter —
  // needed below to decide when rAF must fall back to a timer.
  const realHiddenDesc = Object.getOwnPropertyDescriptor(
    Document.prototype,
    "hidden"
  );
  const reallyHidden = () => {
    try {
      return !!realHiddenDesc.get.call(document);
    } catch {
      return false;
    }
  };

  /* The page always sees a visible, focused tab. */
  try {
    Object.defineProperty(document, "hidden", { get: () => false });
    Object.defineProperty(document, "visibilityState", {
      get: () => "visible",
    });
    Object.defineProperty(document, "webkitHidden", { get: () => false });
    Object.defineProperty(document, "webkitVisibilityState", {
      get: () => "visible",
    });
  } catch {}
  try {
    document.hasFocus = () => true;
  } catch {}

  /* Swallow the page-level events the app would use to notice it went
     to the background. Element-targeted focus/blur passes through. */
  const pageLevel = (e) => e.target === document || e.target === window;
  ["visibilitychange", "webkitvisibilitychange", "freeze"].forEach((t) => {
    const swallow = (e) => {
      if (pageLevel(e)) e.stopImmediatePropagation();
    };
    document.addEventListener(t, swallow, true);
    window.addEventListener(t, swallow, true);
  });
  window.addEventListener(
    "blur",
    (e) => {
      if (pageLevel(e)) e.stopImmediatePropagation();
    },
    true
  );

  /* ---------------------- unthrottled page timers ----------------------
     Chrome clamps setTimeout/setInterval in hidden tabs — 1s minimum,
     and only once per MINUTE under intensive throttling. Sites that
     schedule their streaming renders through timers (Gemini, DeepSeek)
     freeze mid-answer in the background, no matter what visibility says.
     Web Worker timers are never throttled, so while the tab is really
     hidden, short page timers are routed through one. If the page's CSP
     forbids blob workers we silently keep native timers. */
  (() => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeClearTimeout = window.clearTimeout.bind(window);
    const nativeSetInterval = window.setInterval.bind(window);
    const nativeClearInterval = window.clearInterval.bind(window);

    const pending = new Map(); // id -> {cb, args, interval, delay, dueAt}
    let nextId = 2 ** 31; // far above the native timer-id range

    const run = (id) => {
      const t = pending.get(id);
      if (!t) return;
      if (t.interval) {
        t.dueAt = Date.now() + t.delay;
        if (worker) worker.postMessage({ id, delay: t.delay });
      } else {
        pending.delete(id);
      }
      try {
        t.cb(...t.args);
      } catch {}
    };

    let worker = null;
    try {
      const blob = new Blob(
        [
          "self.onmessage=e=>{setTimeout(()=>postMessage(e.data.id),e.data.delay)}",
        ],
        { type: "application/javascript" }
      );
      const url = URL.createObjectURL(blob);
      worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = (e) => run(e.data);
    } catch {
      worker = null;
    }

    // No worker (page CSP forbids it): a pump executes due timers in
    // bursts so chained short timers still advance. It is driven by
    // the extension's TICK relay (message delivery is never throttled)
    // plus a native self-chain as the floor (~1s clamp when hidden).
    let chained = false;
    const chainPump = (delay) => {
      if (chained) return;
      chained = true;
      nativeSetTimeout(() => {
        chained = false;
        pump();
      }, Math.min(Math.max(delay, 1), 250));
    };
    function pump() {
      for (let round = 0; round < 20; round++) {
        const now = Date.now();
        let ran = false;
        for (const [id, t] of [...pending]) {
          if (t.dueAt - now <= 48) {
            run(id);
            ran = true;
          }
        }
        if (!ran) break;
      }
      if (pending.size) chainPump(250);
    }
    if (!worker) {
      document.addEventListener("omnichat-pump", () => pump());
    }

    // Long timers don't affect streaming and would only pile up in the
    // pending map — leave anything over 30s (and non-function callbacks)
    // to the native implementation.
    window.setTimeout = function (cb, delay = 0, ...args) {
      if (!reallyHidden() || typeof cb !== "function" || delay > 30000) {
        return nativeSetTimeout(cb, delay, ...args);
      }
      const id = nextId++;
      const d = Math.max(0, +delay || 0);
      pending.set(id, { cb, args, interval: false, delay: d, dueAt: Date.now() + d });
      if (worker) worker.postMessage({ id, delay: d });
      else chainPump(d);
      return id;
    };
    window.clearTimeout = function (id) {
      if (pending.delete(id)) return;
      nativeClearTimeout(id);
    };
    window.setInterval = function (cb, delay = 0, ...args) {
      if (!reallyHidden() || typeof cb !== "function" || delay > 30000) {
        return nativeSetInterval(cb, delay, ...args);
      }
      const id = nextId++;
      const d = Math.max(1, +delay || 1);
      pending.set(id, { cb, args, interval: true, delay: d, dueAt: Date.now() + d });
      if (worker) worker.postMessage({ id, delay: d });
      else chainPump(d);
      return id;
    };
    window.clearInterval = function (id) {
      if (pending.delete(id)) return;
      nativeClearInterval(id);
    };
  })();

  /* rAF never fires in hidden tabs — fall back to a timer so the
     site's render loop keeps appending tokens (~30fps is plenty). */
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const timerHandles = new Map(); // our handle -> timeout id
  let nextHandle = 2 ** 31; // far above native handle range

  window.requestAnimationFrame = (cb) => {
    if (!reallyHidden()) return nativeRaf(cb);
    const handle = nextHandle++;
    timerHandles.set(
      handle,
      setTimeout(() => {
        timerHandles.delete(handle);
        try {
          cb(performance.now());
        } catch {}
      }, 33)
    );
    return handle;
  };
  window.cancelAnimationFrame = (handle) => {
    if (timerHandles.has(handle)) {
      clearTimeout(timerHandles.get(handle));
      timerHandles.delete(handle);
      return;
    }
    nativeCancel(handle);
  };

  /* requestIdleCallback also goes quiet in hidden tabs — apps that
     schedule their render flushes through it (Gemini) freeze mid-answer
     until the tab is focused. */
  if (window.requestIdleCallback) {
    const nativeRic = window.requestIdleCallback.bind(window);
    const nativeCancelRic = window.cancelIdleCallback
      ? window.cancelIdleCallback.bind(window)
      : null;
    const ricTimers = new Map();

    window.requestIdleCallback = (cb, opts) => {
      if (!reallyHidden()) return nativeRic(cb, opts);
      const handle = nextHandle++;
      const delay =
        opts && typeof opts.timeout === "number"
          ? Math.min(opts.timeout, 100)
          : 50;
      ricTimers.set(
        handle,
        setTimeout(() => {
          ricTimers.delete(handle);
          try {
            cb({ didTimeout: true, timeRemaining: () => 50 });
          } catch {}
        }, delay)
      );
      return handle;
    };
    window.cancelIdleCallback = (handle) => {
      if (ricTimers.has(handle)) {
        clearTimeout(ricTimers.get(handle));
        ricTimers.delete(handle);
        return;
      }
      if (nativeCancelRic) nativeCancelRic(handle);
    };
  }

  /* IntersectionObserver needs rendering frames, which hidden tabs don't
     get — content gated behind "render when visible" never materializes
     in the DOM. While really hidden, report each newly observed element
     as intersecting once so lazy renderers proceed. */
  const NativeIO = window.IntersectionObserver;
  if (NativeIO) {
    window.IntersectionObserver = class extends NativeIO {
      constructor(callback, options) {
        super(callback, options);
        this.__cb = callback;
      }
      observe(el) {
        super.observe(el);
        if (!reallyHidden()) return;
        setTimeout(() => {
          try {
            const rect = el.getBoundingClientRect();
            this.__cb(
              [
                {
                  target: el,
                  isIntersecting: true,
                  intersectionRatio: 1,
                  boundingClientRect: rect,
                  intersectionRect: rect,
                  rootBounds: null,
                  time: performance.now(),
                },
              ],
              this
            );
          } catch {}
        }, 0);
      }
    };
  }
})();
