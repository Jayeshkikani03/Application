const DEFAULT_MIN_YEAR = 1900;

function currentYear() {
  return new Date().getFullYear();
}

function asPositiveInt(raw) {
  const n = parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function dobYearBounds(field) {
  const minRaw = asPositiveInt(field?.min);
  const maxRaw = asPositiveInt(field?.max);
  const min = minRaw ?? DEFAULT_MIN_YEAR;
  const max = maxRaw ?? currentYear();
  return min <= max ? { min, max } : { min: max, max: min };
}

export function dobDayOptions() {
  return Array.from({ length: 31 }, (_, i) => {
    const value = String(i + 1).padStart(2, "0");
    return { value, label: String(i + 1) };
  });
}

export function dobMonthOptions() {
  return Array.from({ length: 12 }, (_, i) => {
    const value = String(i + 1).padStart(2, "0");
    return { value, label: String(i + 1) };
  });
}

export function dobYearOptions(field) {
  const { min, max } = dobYearBounds(field);
  return Array.from({ length: max - min + 1 }, (_, i) => {
    const year = String(max - i);
    return { value: year, label: year };
  });
}

export function parseDobFieldValue(raw) {
  if (raw == null) return { year: "", month: "", day: "" };
  const s = String(raw).trim();
  if (!s) return { year: "", month: "", day: "" };

  const m = s.match(/^(\d{0,4})-(\d{0,2})-(\d{0,2})$/);
  if (m) {
    return {
      year: m[1] || "",
      month: m[2] || "",
      day: m[3] || "",
    };
  }

  return { year: "", month: "", day: "" };
}

export function buildDobFieldValue(parts) {
  const year = String(parts?.year || "").trim();
  const month = String(parts?.month || "").trim();
  const day = String(parts?.day || "").trim();
  const mm = month ? month.padStart(2, "0") : "";
  const dd = day ? day.padStart(2, "0") : "";
  return year || mm || dd ? `${year}-${mm}-${dd}` : "";
}

export function isCompleteDobFieldValue(raw) {
  const { year, month, day } = parseDobFieldValue(raw);
  return /^\d{4}$/.test(year) && /^\d{2}$/.test(month) && /^\d{2}$/.test(day);
}

export function validateDobFieldValue(field, raw, required, requiredMessage) {
  const hasRaw = raw != null && String(raw).trim() !== "";
  if (!hasRaw) return required ? requiredMessage : "";

  if (!isCompleteDobFieldValue(raw)) return "Select day, month, and year";

  const { year, month, day } = parseDobFieldValue(raw);
  const yearNum = Number(year);
  const monthNum = Number(month);
  const dayNum = Number(day);
  const { min, max } = dobYearBounds(field);

  if (yearNum < min || yearNum > max) return `Year must be between ${min} and ${max}`;
  if (monthNum < 1 || monthNum > 12) return "Month must be between 1 and 12";
  if (dayNum < 1 || dayNum > 31) return "Day must be between 1 and 31";

  return "";
}
