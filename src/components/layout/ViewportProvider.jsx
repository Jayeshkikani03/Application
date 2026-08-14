import { useEffect, useLayoutEffect } from "react";
import { useViewport } from "../../hooks/useViewport";
import { subscribeKeyboardInset } from "../../hooks/useKeyboardInset";

export function ViewportProvider({ children }) {
  const { viewport } = useViewport();

  // Apply before paint so scan-card collapse CSS (html[data-viewport=...]) works on first frame.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.viewport = viewport;
    root.classList.remove("viewport-mobile", "viewport-tablet", "viewport-desktop");
    root.classList.add(`viewport-${viewport}`);
  }, [viewport]);

  useEffect(() => {
    // Mobile / tablet bottom nav must track the soft keyboard.
    if (viewport === "desktop") {
      document.documentElement.style.setProperty("--keyboard-inset", "0px");
      document.documentElement.classList.remove("keyboard-open");
      return undefined;
    }
    return subscribeKeyboardInset();
  }, [viewport]);

  return children;
}
