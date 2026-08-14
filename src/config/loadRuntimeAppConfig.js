/**
 * Loads `public/app.config.json` → copied to `dist/app.config.json` at build time.
 * Edit that file after deploy — no env variable involvement.
 *
 * Keys:
 * - `apiPathBase` (required) — API root URL or same-origin path
 * - `isNative` (optional) — `true` = mobile login (JWT + /login page),
 *   `false` = web login (Gateway SSO cookie). When omitted, uses Capacitor.isNativePlatform().
 *
 * `<base href="./">` is a relative base — on routes deeper than one level
 * (e.g. /admin/role-matrix) the browser resolves "./" relative to the
 * current pathname, landing on "/admin/" rather than "/".  To prevent that,
 * we anchor to the origin for any relative base value so the config is always
 * fetched from the app root, regardless of which route the user refreshes on.
 *
 * For absolute bases (e.g. /sub-app/ on a subpath deploy) we keep the
 * document.baseURI approach so the correct subdirectory is used.
 */
function configJsonUrl() {
  const baseAttr = document.querySelector("base")?.getAttribute("href") ?? "/";
  // Relative base (starts with ".") — anchor to origin to avoid deep-route mis-resolution
  if (baseAttr.startsWith(".")) {
    return `${window.location.origin}/app.config.json`;
  }
  return new URL("app.config.json", document.baseURI).href;
}

/**
 * @param {unknown} value
 * @returns {string} axios `baseURL`: same-origin path or absolute API root
 */
export function normalizeApiBase(value) {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) {
    throw new Error(`app.config.json: "apiPathBase" is required (got ${JSON.stringify(value)})`);
  }
  if (/^https?:\/\//i.test(s)) {
    return s.replace(/\/$/, "");
  }
  if (s.startsWith("/")) {
    if (s === "/") return "/";
    return s.replace(/\/$/, "") || "/";
  }
  throw new Error(
    `app.config.json: "apiPathBase" must start with / (same-origin) or http:// / https:// (direct API). Got: ${JSON.stringify(value)}`
  );
}

/**
 * @param {unknown} value
 * @returns {boolean | undefined} `undefined` when the key is omitted
 */
export function parseOptionalConfigBoolean(value, fieldName) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
  }
  throw new Error(`app.config.json: "${fieldName}" must be true or false (got ${JSON.stringify(value)})`);
}

/**
 * @returns {Promise<{ apiPathBase: string, isNative?: boolean }>}
 */
export async function loadRuntimeAppConfig() {
  const url = configJsonUrl();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load runtime app config from ${url} (${res.status} ${res.statusText})`);
  }
  const cfg = await res.json();
  const apiPathBase = normalizeApiBase(cfg.apiPathBase);
  const isNative = parseOptionalConfigBoolean(cfg.isNative, "isNative");
  return { apiPathBase, isNative };
}
