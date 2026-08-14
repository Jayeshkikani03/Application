/**
 * Scan autofetch clock.
 *
 * Change CLOCK_SOURCE to switch behavior:
 *   - "site"   → site country timezone (Site → Country → TimeZone UtcOffset)
 *   - "system" → device / browser local time
 *
 * Or call setClockSource("system" | "site") at runtime.
 *
 * Values are 24h wall-clock: `YYYY-MM-DDTHH:mm:ss` (no Z).
 */

/** @typedef {"site" | "system"} ClockSource */

/** Flip this (or use setClockSource) when you want system time instead of site TZ. */
export const DEFAULT_CLOCK_SOURCE = /** @type {ClockSource} */ ("site");

/** @type {ClockSource} */
let clockSource = DEFAULT_CLOCK_SOURCE;

let siteUtcOffset = null;
let siteTimeZoneNo = null;

/** Parse Country/TimeZone UTC offset → minutes from UTC, or null if invalid. */
export function parseUtcOffsetMinutes(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (!raw.includes(":")) {
    const asInt = Number(raw);
    if (Number.isFinite(asInt)) return asInt;
    return null;
  }

  let sign = 1;
  let s = raw;
  if (s[0] === "+" || s[0] === "-") {
    sign = s[0] === "-" ? -1 : 1;
    s = s.slice(1).trim();
  }

  const parts = s.split(":").map((p) => p.trim());
  if (parts.length < 1 || parts.length > 3) return null;
  const hours = Number(parts[0]);
  const minutes = parts.length >= 2 ? Number(parts[1]) : 0;
  const seconds = parts.length >= 3 ? Number(parts[2]) : 0;
  if (![hours, minutes, seconds].every((n) => Number.isFinite(n))) return null;
  return sign * (hours * 60 + minutes + seconds / 60);
}

/**
 * Switch clock mode.
 * @param {ClockSource} source  "site" | "system"
 */
export function setClockSource(source) {
  clockSource = source === "system" ? "system" : "site";
}

export function getClockSource() {
  return clockSource;
}

export function setSiteClockFromSite(site) {
  siteUtcOffset = site?.utcOffset ?? site?.UtcOffset ?? null;
  siteTimeZoneNo = site?.timeZoneNo ?? site?.TimeZoneNo ?? null;
}

export function clearSiteClock() {
  siteUtcOffset = null;
  siteTimeZoneNo = null;
}

export function getSiteClockOffset() {
  return siteUtcOffset;
}

export function getSiteTimeZoneNo() {
  return siteTimeZoneNo;
}

/** Device / browser local wall clock (24h). */
export function nowSystemIso() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 19);
}

/**
 * Current time in the active site's country timezone (24h wall clock).
 * Falls back to system time if site offset is missing.
 */
export function nowSiteIso() {
  const minutes = parseUtcOffsetMinutes(siteUtcOffset);
  if (minutes == null) return nowSystemIso();
  const siteMs = Date.now() + minutes * 60000;
  return new Date(siteMs).toISOString().slice(0, 19);
}

/**
 * Single entry point for scan autofetch (and anything that needs "now").
 * Honors CLOCK_SOURCE / setClockSource:
 *   - site   → nowSiteIso()
 *   - system → nowSystemIso()
 */
export function getNowIso() {
  if (clockSource === "system") return nowSystemIso();
  return nowSiteIso();
}

/** @deprecated Prefer getNowIso() — kept for existing imports. */
export function nowScanIso() {
  return getNowIso();
}

/** True if string is already a wall-clock value without Z/offset. */
export function isWallClockDateTime(value) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  return !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s);
}
