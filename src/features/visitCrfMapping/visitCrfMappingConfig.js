/**
 * Master switch for Activity Visit CRF Mapping
 * (admin mapping page + site-user fill / open CRF pages).
 *
 * Build-time flag ANDs with project parameter `ShowActivityMappingCrf`
 * (see Project Settings / ProjectParameter).
 *
 * Set to `true`  → feature may be available (subject to project setting).
 * Set to `false` → hide from navigation and disable those pages always.
 */
export const VISIT_CRF_MAPPING_ENABLED = true;

/** Runtime override from ProjectParameter `ShowActivityMappingCrf` (default false when unset). */
let runtimeShowActivityMappingCrf = false;

export function setRuntimeShowActivityMappingCrf(enabled) {
  runtimeShowActivityMappingCrf = enabled === true;
}

export function getRuntimeShowActivityMappingCrf() {
  return runtimeShowActivityMappingCrf;
}

/** True when Activity Mapping CRF menus/routes should be available. */
export function isActivityMappingCrfVisible() {
  return VISIT_CRF_MAPPING_ENABLED && runtimeShowActivityMappingCrf;
}

/** Canonical route prefixes for this feature (aliases included). */
export const VISIT_CRF_MAPPING_PATHS = [
  "/activity-mapping",
  "/activity-fill",
  "/visit-crf-mapping",
  "/visit-crf",
];

/** True when pathname belongs to Visit CRF Mapping (including /open/... child routes). */
export function isVisitCrfMappingPath(pathname) {
  const target = String(pathname || "").trim().toLowerCase();
  if (!target) return false;
  return VISIT_CRF_MAPPING_PATHS.some(
    (base) => target === base || target.startsWith(`${base}/`)
  );
}
