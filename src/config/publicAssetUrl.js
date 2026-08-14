/**
 * Resolve a public/ asset URL that works on every route.
 *
 * With `<base href="./">`, relative paths like `./stslogo.png` resolve against
 * the current pathname (e.g. /admin/role-matrix → /admin/stslogo.png). Anchor
 * relative bases to the origin; keep absolute subdirectory bases intact.
 */
export function getPublicAssetUrl(filename) {
  const clean = String(filename || "").replace(/^\/+/, "");
  if (!clean) return "";

  const baseAttr = document.querySelector("base")?.getAttribute("href") ?? "/";
  if (baseAttr.startsWith(".")) {
    return `${window.location.origin}/${clean}`;
  }

  const base = baseAttr.endsWith("/") ? baseAttr : `${baseAttr}/`;
  if (base.startsWith("/")) {
    return `${base}${clean}`;
  }

  try {
    return new URL(clean, new URL(base, document.baseURI).href).href;
  } catch {
    return `/${clean}`;
  }
}
