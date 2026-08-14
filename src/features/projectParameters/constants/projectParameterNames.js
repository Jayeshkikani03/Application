/**
 * Fixed `dbo.ProjectParameter.vParameterName` keys for Application project settings.
 */

/** Wall-clock source: `site` | `system` */
export const PROJECT_PARAM_CLOCK_SOURCE = "ClockSource";
export const CLOCK_SOURCE_SITE = "site";
export const CLOCK_SOURCE_SYSTEM = "system";
export const DEFAULT_CLOCK_SOURCE = CLOCK_SOURCE_SITE;

/** When true, Activity Mapping CRF menus/routes are available. */
export const PROJECT_PARAM_SHOW_ACTIVITY_MAPPING_CRF = "ShowActivityMappingCrf";
export const DEFAULT_SHOW_ACTIVITY_MAPPING_CRF = false;

export const PROJECT_PARAMETER_AUDIT_TABLE = "ProjectParameter";

/** Known project parameter names for the Project Parameters admin page. */
export const KNOWN_PROJECT_PARAMETER_OPTIONS = [
  { value: PROJECT_PARAM_CLOCK_SOURCE, label: "ClockSource" },
  { value: PROJECT_PARAM_SHOW_ACTIVITY_MAPPING_CRF, label: "ShowActivityMappingCrf" },
];

/** Suggested values shown as placeholder / helper by parameter name. */
export function getParameterValueHint(parameterName) {
  const name = String(parameterName ?? "").trim();
  if (name === PROJECT_PARAM_CLOCK_SOURCE) return "site or system";
  if (name === PROJECT_PARAM_SHOW_ACTIVITY_MAPPING_CRF) return "true or false";
  return "e.g. true or false";
}

/** @param {unknown} raw */
export function parseClockSource(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === CLOCK_SOURCE_SYSTEM ? CLOCK_SOURCE_SYSTEM : CLOCK_SOURCE_SITE;
}

/** @param {unknown} raw */
export function parseShowActivityMappingCrf(raw) {
  if (raw == null || String(raw).trim() === "") return DEFAULT_SHOW_ACTIVITY_MAPPING_CRF;
  const v = String(raw).trim().toLowerCase();
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  return DEFAULT_SHOW_ACTIVITY_MAPPING_CRF;
}
