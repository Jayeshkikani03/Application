import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

export async function setupNativePlatform() {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  const platform = Capacitor.getPlatform();
  document.documentElement.classList.add("platform-native", `platform-${platform}`);
  document.body.classList.add("platform-native", `platform-${platform}`);

  // Capacitor applies system-bar margins on the WebView (adjustMarginsForEdgeToEdge).
  // Avoid double spacing from CSS env(safe-area-inset-*) on Android WebView.
  if (platform === "android") {
    document.documentElement.classList.add("android-edge-insets");
  }

  // Capture pre-keyboard layout height for adjustResize detection.
  document.documentElement.dataset.layoutHeight = String(window.innerHeight);

  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color: "#ffffff" });
    await StatusBar.setStyle({ style: Style.Dark });
  } catch (error) {
    console.warn("StatusBar setup skipped:", error);
  }

  try {
    const { Keyboard } = await import("@capacitor/keyboard");
    // Ensure plugin is loaded early so show/hide events fire on first focus.
    if (typeof Keyboard.setResizeMode === "function") {
      await Keyboard.setResizeMode({ mode: "native" });
    }
  } catch (error) {
    console.warn("Keyboard setup skipped:", error);
  }
}
