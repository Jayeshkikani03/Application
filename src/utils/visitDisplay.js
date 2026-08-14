/** Trim only — never rewrite DB / schedule labels. */
function asSavedLabel(val, fallback = "") {
  const text = String(val ?? "").trim();
  return text || fallback;
}

/** Prefer explicit "Dose N" / "D-N" over the first digit in compound labels. */
function extractDoseNumber(val) {
  const s = String(val ?? "").trim();
  if (!s) return "";
  const doseMatch = s.match(/\bDose[-\s]*(\d+)\b/i) || s.match(/\bD-(\d+)\b/i);
  if (doseMatch) return doseMatch[1];
  const paren = s.match(/\(([^)]+)\)/);
  if (paren) {
    const inner = extractDoseNumber(paren[1]);
    if (inner) return inner;
  }
  return s.match(/\d+/)?.[0] ?? "";
}

function formatDoseDisplayLabel(val) {
  return asSavedLabel(val, "-");
}

/** Prefer persisted doseLabel; only parse Dose N from a compound timepoint when needed. */
function resolveActivityDoseLabel(activity) {
  if (!activity) return "-";
  const explicit = asSavedLabel(activity.doseLabel) || asSavedLabel(activity.dose);
  if (explicit) return formatDoseDisplayLabel(explicit);
  const fromTimepoint = extractDoseNumber(activity.timepointLabel ?? activity.timepoint);
  if (fromTimepoint) return `Dose ${fromTimepoint}`;
  return "-";
}

function stripDoseSuffixFromTimepoint(timepoint) {
  return String(timepoint ?? "").replace(/\s+Dose[-\s]+\d+$/i, "").trim();
}

function getTimepointBaseLabel(timepoint) {
  const text = String(timepoint ?? "").trim();
  if (!text) return "";
  if (/\(.+\)/.test(text)) {
    return text.replace(/\s*\([^)]+\)\s*$/, "").trim();
  }
  return stripDoseSuffixFromTimepoint(text);
}

/** Timepoint name exactly as stored (schedule / DB). Falls back to dose only when callers pass it. */
function formatTimepointDisplayLabel(timepoint, dose) {
  return asSavedLabel(timepoint) || asSavedLabel(dose, "-");
}

/** Activity timepoint label from DB — never use dose as a stand-in. */
function formatActivityTimepointLabel(activity) {
  if (!activity) return "-";
  return (
    asSavedLabel(activity.timepointLabel)
    || asSavedLabel(activity.timepoint)
    || "-"
  );
}

function getDoseNumber(visit, doseOverride) {
  const source = doseOverride ?? visit?.doseLabel ?? visit?.dose ?? "";
  return String(source).match(/\d+/)?.[0] ?? "";
}

/** Study visit description exactly as saved (vStudyVisitScheduleDescription). */
function getStudyVisitLabel(visit) {
  if (!visit) return "";
  return asSavedLabel(visit.studyVisitLabel) || asSavedLabel(visit.label);
}

function getPeriodLabel(visit) {
  if (!visit) return "";
  return asSavedLabel(visit.periodLabel) || asSavedLabel(visit.periodCode);
}

/**
 * Dose label + study visit label, both as saved in DB.
 * e.g. "Dose 2 - VISIT6(DAY29)"
 */
function formatDoseWithVisit(doseLabelOrVisit, visitMaybe) {
  const visit = visitMaybe && typeof visitMaybe === "object"
    ? visitMaybe
    : (doseLabelOrVisit && typeof doseLabelOrVisit === "object" ? doseLabelOrVisit : null);
  const rawDose = visitMaybe != null && (typeof doseLabelOrVisit === "string" || doseLabelOrVisit == null)
    ? doseLabelOrVisit
    : (visit?.doseLabel ?? visit?.dose ?? doseLabelOrVisit);
  const dose = asSavedLabel(rawDose, "-");
  const visitName = getStudyVisitLabel(visit);
  if (!visitName) return dose;
  if (visitName.toLowerCase() === dose.toLowerCase()) return dose;
  return `${dose} - ${visitName}`;
}

function formatDoseVisitPeriodLabel(visit, doseOverride) {
  if (!visit) return "-";
  const dose = asSavedLabel(doseOverride ?? visit.doseLabel ?? visit.dose, "-");
  const visitName = getStudyVisitLabel(visit);
  const period = getPeriodLabel(visit);
  const parts = [dose];
  if (visitName && visitName.toLowerCase() !== dose.toLowerCase()) parts.push(visitName);
  if (period && !parts.some((part) => part.toLowerCase() === period.toLowerCase())) parts.push(period);
  return parts.join(" - ");
}

function formatTimepointWithDose(timepoint, dose) {
  return formatTimepointDisplayLabel(timepoint, dose);
}

function formatNextActivityHeader(activity, visit) {
  const dose = activity?.dose ?? visit?.doseLabel ?? visit?.dose;
  const primary =
    asSavedLabel(activity?.timepointLabel)
    || asSavedLabel(activity?.timepoint)
    || asSavedLabel(dose, "-");
  return { primary, secondary: "" };
}

export {
  extractDoseNumber,
  formatActivityTimepointLabel,
  formatDoseDisplayLabel,
  formatDoseVisitPeriodLabel,
  formatDoseWithVisit,
  formatNextActivityHeader,
  formatTimepointDisplayLabel,
  formatTimepointWithDose,
  getTimepointBaseLabel,
  resolveActivityDoseLabel,
  stripDoseSuffixFromTimepoint,
  getPeriodLabel,
  getDoseNumber,
};
