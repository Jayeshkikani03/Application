import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { loadRuntimeAppConfig } from "./config/loadRuntimeAppConfig.js";
import { applyRuntimeApiConfig } from "./shared/api/httpClient.js";
import { setupNativePlatform } from "./nativeSetup";
import "./index.css";

async function bootstrap() {
  await setupNativePlatform();
  localStorage.removeItem("esource-lab-demo-v7");
  const cfg = await loadRuntimeAppConfig();
  applyRuntimeApiConfig(cfg);
  const { default: App } = await import("./App.jsx");
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

bootstrap().catch((err) => {
  console.error(err);
  const el = document.getElementById("root");
  if (el) {
    const msg = err && typeof err.message === "string" ? err.message : String(err);
    const configHint =
      "If this involves app.config.json, check DevTools → Network; the file must be served next to index.html (Application/public in source, copied to dist).";
    el.textContent = `Startup error: ${msg} ${configHint}`;
  }
});
