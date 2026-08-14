import { Capacitor } from "@capacitor/core";

/**
 * Apply keyboard inset CSS vars used by bottom nav / scan docks.
 * When the WebView already resized (adjustResize), keep inset at 0 so
 * fixed `bottom: 0` chrome sits on the new viewport bottom (above keyboard).
 * @param {number} insetPx
 * @param {{ force?: boolean }} [options]
 */
export function applyKeyboardInset(insetPx, options = {}) {
  const root = document.documentElement;
  const reported = Math.max(0, Math.round(Number(insetPx) || 0));
  const baseline = Number(root.dataset.layoutHeight || 0);
  const shrunkBy = baseline > 0 ? Math.max(0, baseline - window.innerHeight) : 0;
  const webViewAlreadyResized = !options.force && shrunkBy >= 48;

  const use = webViewAlreadyResized ? 0 : reported < 48 ? 0 : reported;
  root.style.setProperty("--keyboard-inset", `${use}px`);
  root.classList.toggle("keyboard-open", use > 0 || webViewAlreadyResized);
  return use;
}

/**
 * Browser / WebView fallback using visualViewport + window size.
 */
export function syncKeyboardInsetFromViewport() {
  const vv = window.visualViewport;
  if (!vv) {
    return applyKeyboardInset(0);
  }

  // Prefer visualViewport gap; also compare against a baseline layout height.
  const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  const baseline = Number(document.documentElement.dataset.layoutHeight || 0);
  const shrink = baseline > 0 ? Math.max(0, baseline - window.innerHeight) : 0;
  return applyKeyboardInset(Math.max(gap, shrink));
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Subscribe to keyboard height changes.
 * Native (Capacitor): uses @capacitor/keyboard (reliable on Android APK).
 * Web: uses visualViewport / resize.
 * @returns {() => void} unsubscribe
 */
export function subscribeKeyboardInset() {
  let raf = 0;
  let nativeHandles = [];
  let cancelled = false;

  const scheduleViewportSync = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = 0;
      syncKeyboardInsetFromViewport();
    });
  };

  const captureLayoutHeight = () => {
    // Baseline before keyboard; ignore when already open.
    if (document.documentElement.classList.contains("keyboard-open")) return;
    document.documentElement.dataset.layoutHeight = String(window.innerHeight);
  };

  const onFocusIn = (event) => {
    if (!isEditableTarget(event.target)) return;
    captureLayoutHeight();
    scheduleViewportSync();
    window.setTimeout(scheduleViewportSync, 50);
    window.setTimeout(scheduleViewportSync, 300);
    window.setTimeout(scheduleViewportSync, 600);
  };

  const onFocusOut = () => {
    window.setTimeout(scheduleViewportSync, 50);
    window.setTimeout(scheduleViewportSync, 300);
  };

  captureLayoutHeight();
  scheduleViewportSync();
  window.addEventListener("resize", scheduleViewportSync);
  window.addEventListener("orientationchange", () => {
    window.setTimeout(captureLayoutHeight, 100);
    scheduleViewportSync();
  });
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  window.visualViewport?.addEventListener("resize", scheduleViewportSync);
  window.visualViewport?.addEventListener("scroll", scheduleViewportSync);

  // Capacitor Keyboard plugin — authoritative height on Android/iOS APKs.
  if (Capacitor.isNativePlatform()) {
    import("@capacitor/keyboard")
      .then(({ Keyboard }) => {
        if (cancelled) return;
        const onShow = (info) => {
          applyKeyboardInset(info?.keyboardHeight ?? 0);
        };
        const onHide = () => {
          applyKeyboardInset(0);
          captureLayoutHeight();
        };
        return Promise.all([
          Keyboard.addListener("keyboardWillShow", onShow),
          Keyboard.addListener("keyboardDidShow", onShow),
          Keyboard.addListener("keyboardWillHide", onHide),
          Keyboard.addListener("keyboardDidHide", onHide),
        ]).then((handles) => {
          if (cancelled) {
            handles.forEach((h) => h.remove());
            return;
          }
          nativeHandles = handles;
        });
      })
      .catch((err) => {
        console.warn("Keyboard plugin unavailable; using viewport fallback.", err);
      });
  }

  return () => {
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener("resize", scheduleViewportSync);
    window.removeEventListener("orientationchange", scheduleViewportSync);
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    window.visualViewport?.removeEventListener("resize", scheduleViewportSync);
    window.visualViewport?.removeEventListener("scroll", scheduleViewportSync);
    nativeHandles.forEach((h) => {
      try {
        h.remove();
      } catch {
        /* ignore */
      }
    });
    applyKeyboardInset(0);
    delete document.documentElement.dataset.layoutHeight;
  };
}
