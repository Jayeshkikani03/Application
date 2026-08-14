import { resolveAuditFieldLabel } from "./auditFieldLabels.js";

export function mapAuditApiRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((row, index) => ({
    id: String(row?.id ?? row?.Id ?? `audit-${index}`),
    recordId: String(row?.recordId ?? row?.RecordId ?? ""),
    field: String(row?.field ?? row?.Field ?? ""),
    fieldLabel: String(row?.fieldLabel ?? row?.FieldLabel ?? ""),
    tableName: String(row?.tableName ?? row?.TableName ?? ""),
    oldValue: row?.oldValue ?? row?.OldValue ?? "",
    newValue: row?.newValue ?? row?.NewValue ?? "",
    reason: (() => {
      const r = String(row?.reason ?? row?.Reason ?? "").trim();
      return !r || r === "-" || r === "—" ? "" : r;
    })(),
    performedBy: String(row?.performedBy ?? row?.PerformedBy ?? "").trim() || "—",
    at: row?.at ?? row?.At ?? "",
    recordedAtOffset:
      row?.recordedAtOffset ?? row?.RecordedAtOffset ?? row?.vRecordedAtOffSet ?? "",
    event: String(row?.event ?? row?.Event ?? ""),
  }));
}

function isActiveStatusAuditField(row) {
  const field = String(row?.field ?? "").trim();
  return /^IsActive$/i.test(field) || /^bIsActive$/i.test(field);
}

export function formatAuditTableCellValue(value, row) {
  const activeStatus = row && isActiveStatusAuditField(row);
  // Null/blank: leave cell empty (do not show "—" placeholder).
  if (value == null || value === "") return "";
  if (typeof value === "boolean") {
    if (activeStatus) return value ? "Active" : "Inactive";
    return value ? "Yes" : "No";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "-" || trimmed === "—") return "";
    if (activeStatus) {
      if (/^(true|1|yes)$/i.test(trimmed)) return "Active";
      if (/^(false|0|no)$/i.test(trimmed)) return "Inactive";
    }
    if (/^(true|false)$/i.test(trimmed)) return /^true$/i.test(trimmed) ? "Yes" : "No";
    // Normalize raw ISO datetimes (e.g. from query resolve) to audit display format.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
      const parsed = new Date(trimmed.length === 16 ? `${trimmed}:00` : trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        }).replace(",", "").replace(/ /, "-").replace(/ /, "-");
      }
    }
    return value;
  }
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Backend UTC datetime → DD-MMM-YYYY HH:MM (no local timezone conversion). */
export function formatAuditUtc(iso) {
  if (!iso) return "—";
  const raw = String(iso).trim();
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/
  );
  if (match) {
    const day = match[3];
    const month = MONTH_SHORT[Number(match[2]) - 1] || match[2];
    const year = match[1];
    return `${day}-${month}-${year} ${match[4]}:${match[5]}`;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mmm = MONTH_SHORT[date.getUTCMonth()];
  const yyyy = date.getUTCFullYear();
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${dd}-${mmm}-${yyyy} ${hh}:${mm}`;
}

function normalizeOffsetStringForDisplay(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^([+-])(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return trimmed;
  const hours = String(match[2]).padStart(2, "0");
  const minutes = String(match[3]).padStart(2, "0");
  return `${match[1]}${hours}:${minutes}`;
}

/** Prefer stored offset; show ±HH:MM only (no seconds, no browser-local fallback). */
export function formatAuditOffsetDisplay(recordedAtOffset) {
  const raw = String(recordedAtOffset ?? "").trim();
  if (!raw || raw === "—") return "—";
  return normalizeOffsetStringForDisplay(raw) || "—";
}

export function toAuditDisplayRow(row) {
  return {
    ...row,
    label: resolveAuditFieldLabel(row),
    oldValue: formatAuditTableCellValue(row.oldValue, row),
    newValue: formatAuditTableCellValue(row.newValue, row),
  };
}
