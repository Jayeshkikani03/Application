import {
  buildDosePatchPayload,
  buildTimepointPatchPayload,
} from "./activityConfigurationPayload.js";

function normalizeTimepointActivityType(activityType) {
  const value = String(activityType ?? "").trim();
  return value || "Post-Dose Blood Collection";
}

function unwrapScalar(x, fallback = "") {
  if (x == null) return fallback;
  if (typeof x === "object" && x !== null && "value" in x) {
    const v = x.value;
    if (v == null) return fallback;
    return typeof v === "string" ? v : String(v);
  }
  if (typeof x === "boolean" || typeof x === "number") return x;
  return String(x);
}

function unwrapBool(x, fallback = true) {
  if (x == null) return fallback;
  if (typeof x === "object" && x !== null && "value" in x) {
    return x.value !== false;
  }
  return x !== false;
}

function unwrapInt(x, fallback = 0) {
  if (x == null) return fallback;
  if (typeof x === "object" && x !== null && "value" in x) {
    const n = Number(x.value);
    return Number.isFinite(n) ? n : fallback;
  }
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function unwrapNullableInt(x) {
  if (x == null) return null;
  if (typeof x === "object" && x !== null && "value" in x) {
    if (x.value == null || x.value === "") return null;
    const n = Number(x.value);
    return Number.isFinite(n) ? n : null;
  }
  if (x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function unwrapDecimal(x, fallback = 0) {
  if (x == null) return fallback;
  if (typeof x === "object" && x !== null && "value" in x) {
    const n = Number(x.value);
    return Number.isFinite(n) ? n : fallback;
  }
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function resolveTimepointOffsetMinutes(duration, durationType) {
  const value = Number(duration);
  if (!Number.isFinite(value)) return 0;
  return durationType === "Minute" ? Math.round(value) : Math.round(value * 60);
}

export function resolveDoseNo(dose) {
  if (!dose) return 0;

  const candidates = [
    dose.activityConfigDoseNo,
    dose.ActivityConfigDoseNo,
    dose.id,
  ];

  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      return num;
    }
  }

  return 0;
}

function resolveTimepointNo(timepoint) {
  return (
    Number(
      timepoint?.activityConfigTimePointNo
        ?? timepoint?.ActivityConfigTimePointNo
        ?? timepoint?.id
    ) || 0
  );
}

export function mapApiDoseToUi(dose) {
  const period = unwrapInt(dose.period ?? dose.Period, 1) || 1;
  const activityConfigDoseNo = resolveDoseNo(dose);
  const visitDesc = unwrapScalar(
    dose.studyVisitScheduleDescription ?? dose.StudyVisitScheduleDescription,
    ""
  );
  return {
    id: activityConfigDoseNo,
    activityConfigDoseNo,
    period,
    periodLabel: String(period),
    periodId: `period-${period}`,
    label: unwrapScalar(dose.label ?? dose.Label, ""),
    visitLabel: visitDesc,
    studyVisitScheduleNo: unwrapInt(dose.studyVisitScheduleNo ?? dose.StudyVisitScheduleNo, 0),
    visitNo: Number(dose.visitNo ?? dose.VisitNo) || 0,
    studyVisitScheduleDescription: visitDesc,
    order: unwrapInt(dose.order ?? dose.Order, 0),
    isActive: unwrapBool(dose.isActive ?? dose.IsActive, true),
    isPublished: (dose.isPublished ?? dose.IsPublished) === true,
    timePointCount: dose.timePointCount ?? dose.TimePointCount ?? 0,
    recordedSign: dose.recordedSign ?? dose.RecordedSign ?? null,
    recordedOnUtc: dose.recordedOnUtc ?? dose.RecordedOnUtc ?? null,
    recordedAtOffset: dose.recordedAtOffset ?? dose.RecordedAtOffset ?? null,
    createdBySource: dose.createdBySource ?? dose.CreatedBySource ?? "Manual",
    timepoints: [],
  };
}

export function mapUiDoseToApi(dose, visitOptions = [], fieldRemarks = {}) {
  const period = Number(dose.period ?? dose.periodLabel) || 1;
  const visitLabel = dose.studyVisitScheduleDescription ?? dose.visitLabel ?? "";
  const studyVisitScheduleNo = Number(dose.studyVisitScheduleNo);
  const visitNo = resolveVisitNo(
    visitOptions,
    visitLabel,
    studyVisitScheduleNo,
    dose.visitNo ?? 0
  );

  return buildDosePatchPayload(
    {
      ...dose,
      period,
      studyVisitScheduleNo,
      visitNo,
      studyVisitScheduleDescription: visitLabel,
      visitLabel,
    },
    fieldRemarks
  );
}

export function mapApiTimepointToUi(timepoint) {
  const activityConfigTimePointNo = resolveTimepointNo(timepoint);
  const activityType = normalizeTimepointActivityType(
    unwrapScalar(timepoint.activityType ?? timepoint.ActivityType, "")
  );
  const durationType = unwrapScalar(timepoint.durationType ?? timepoint.DurationType, "Hour") || "Hour";
  const duration = unwrapDecimal(timepoint.duration ?? timepoint.Duration, 0);
  const offsetMinutes = resolveTimepointOffsetMinutes(duration, durationType);
  const visitDesc = unwrapScalar(
    timepoint.studyVisitScheduleDescription ?? timepoint.StudyVisitScheduleDescription,
    ""
  );
  const normalizedVisitDesc =
    !String(visitDesc).trim() || String(visitDesc).trim() === "-" || String(visitDesc).trim() === "—"
      ? ""
      : visitDesc;

  return {
    id: activityConfigTimePointNo,
    activityConfigTimePointNo,
    order: unwrapInt(timepoint.order ?? timepoint.Order, 0),
    label: unwrapScalar(timepoint.label ?? timepoint.Label, ""),
    visitLabel: normalizedVisitDesc,
    visitNo: Number(timepoint.visitNo ?? timepoint.VisitNo) || 0,
    studyVisitScheduleNo: unwrapInt(
      timepoint.studyVisitScheduleNo ?? timepoint.StudyVisitScheduleNo,
      0
    ),
    studyVisitScheduleDescription: normalizedVisitDesc,
    duration,
    durationType,
    offset: offsetMinutes,
    offsetMinutes,
    windowPeriodMinus: unwrapNullableInt(
      timepoint.windowPeriodMinus ?? timepoint.WindowPeriodMinus
    ),
    windowPeriodPlus: unwrapNullableInt(
      timepoint.windowPeriodPlus ?? timepoint.WindowPeriodPlus
    ),
    windowPeriodDurationType:
      unwrapScalar(
        timepoint.windowPeriodDurationType ?? timepoint.WindowPeriodDurationType,
        "Hour"
      ) || "Hour",
    activityType,
    isActive: unwrapBool(timepoint.isActive ?? timepoint.IsActive, true),
  };
}

function visitOptionNo(visit) {
  if (typeof visit === "string") return 0;
  return Number(visit?.studyVisitScheduleNo ?? visit?.StudyVisitScheduleNo ?? 0) || 0;
}

function visitOptionDescription(visit) {
  if (typeof visit === "string") return visit;
  return (
    visit?.studyVisitScheduleDescription
    ?? visit?.StudyVisitScheduleDescription
    ?? visit?.visitScheduleDesc
    ?? visit?.VisitScheduleDesc
    ?? ""
  );
}

export function resolveVisitScheduleNo(visitOptions, visitLabel, fallbackNo = 0) {
  const normalizedLabel = String(visitLabel ?? "").trim().toLowerCase();

  if (normalizedLabel) {
    const match = (visitOptions ?? []).find((visit) => {
      return String(visitOptionDescription(visit)).trim().toLowerCase() === normalizedLabel;
    });

    if (match) {
      return visitOptionNo(match);
    }
  }

  const explicitNo = Number(fallbackNo) || 0;
  if (explicitNo > 0) {
    const matchByNo = (visitOptions ?? []).find((visit) => visitOptionNo(visit) === explicitNo);
    if (matchByNo) {
      return explicitNo;
    }
  }

  return normalizedLabel ? 0 : explicitNo;
}

function resolveVisitNo(visitOptions, visitLabel, studyVisitScheduleNo, fallbackNo = 0) {
  const scheduleNo = Number(studyVisitScheduleNo) || 0;
  if (scheduleNo > 0) {
    const matchByNo = (visitOptions ?? []).find((visit) => visitOptionNo(visit) === scheduleNo);
    const visitNo = Number(matchByNo?.visitNo ?? matchByNo?.VisitNo) || 0;
    if (visitNo > 0) return visitNo;
  }

  const normalizedLabel = String(visitLabel ?? "").trim().toLowerCase();
  if (normalizedLabel) {
    const matchByLabel = (visitOptions ?? []).find((visit) => {
      return String(visitOptionDescription(visit)).trim().toLowerCase() === normalizedLabel;
    });
    const visitNo = Number(matchByLabel?.visitNo ?? matchByLabel?.VisitNo) || 0;
    if (visitNo > 0) return visitNo;
  }

  return Number(fallbackNo) || 0;
}

export function mapUiTimepointToApi(timepoint, parentDose = null, visitOptions = [], index = 0, fieldRemarks = {}) {
  const activityType = normalizeTimepointActivityType(timepoint.activityType);
  const resolvedOrder = Number(timepoint.order);
  const order = Number.isFinite(resolvedOrder) && resolvedOrder >= 1 ? resolvedOrder : index + 1;
  const visitLabel =
    timepoint.studyVisitScheduleDescription
    ?? timepoint.visitLabel
    ?? parentDose?.studyVisitScheduleDescription
    ?? parentDose?.visitLabel
    ?? "";
  const studyVisitScheduleNo = resolveVisitScheduleNo(
    visitOptions,
    visitLabel,
    timepoint.studyVisitScheduleNo ?? parentDose?.studyVisitScheduleNo ?? 0
  );
  const visitNo = resolveVisitNo(
    visitOptions,
    visitLabel,
    studyVisitScheduleNo,
    timepoint.visitNo ?? parentDose?.visitNo ?? 0
  );

  return buildTimepointPatchPayload(
    {
      ...timepoint,
      order,
      studyVisitScheduleNo,
      visitNo,
      studyVisitScheduleDescription: visitLabel,
      visitLabel,
      activityType,
    },
    fieldRemarks,
    index
  );
}

export function validateTimepointsApiPayload(timepoints) {
  for (const [index, timepoint] of (timepoints ?? []).entries()) {
    const label = unwrapScalar(timepoint.label, "");
    const order = unwrapInt(timepoint.order, 0);
    const activityType = unwrapScalar(timepoint.activityType, "");
    if (!label.trim()) {
      throw new Error(`Time point ${index + 1}: name is required.`);
    }
    if (!Number.isFinite(Number(order)) || Number(order) < 1) {
      throw new Error(`Time point ${index + 1}: order must be 1 or greater.`);
    }
    if (!String(activityType ?? "").trim()) {
      throw new Error(`Time point ${index + 1}: activity type is required.`);
    }
  }
}

export function normalizeDoseListOrders(doses) {
  return [...(doses ?? [])]
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((dose, index) => ({ ...dose, order: index + 1 }));
}

export function normalizeTimepointListOrders(timepoints) {
  return [...(timepoints ?? [])]
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((timepoint, index) => ({ ...timepoint, order: index + 1 }));
}

export function getNextTimepointOrder(timepoints) {
  const normalized = normalizeTimepointListOrders(timepoints);
  return normalized.length + 1;
}

export function getNextDoseOrder(doses) {
  const activeOrders = (doses ?? [])
    .filter((dose) => dose.isActive !== false)
    .map((dose) => Number(dose.order))
    .filter((order) => Number.isFinite(order) && order > 0);

  if (!activeOrders.length) return 1;
  return Math.max(...activeOrders) + 1;
}

export function upsertDoseInList(doses, dose, editingId = null) {
  const doseKey = resolveDoseNo(dose);
  const editingKey = Number(editingId) || 0;
  const list = editingKey
    ? (doses ?? []).filter((item) => resolveDoseNo(item) !== editingKey)
    : [...(doses ?? [])];

  const period = Number(dose.period ?? dose.periodLabel) || 1;
  const withMeta = {
    ...dose,
    id: doseKey,
    activityConfigDoseNo: doseKey,
    period,
    periodLabel: String(period),
    periodId: dose.periodId ?? `period-${period}`,
  };

  const insertAt = Math.max(
    0,
    Math.min((Number(withMeta.order) || list.length + 1) - 1, list.length)
  );
  const next = [...list];
  next.splice(insertAt, 0, withMeta);
  return normalizeDoseListOrders(next);
}

export function dosesToLegacyPeriods(doses) {
  const byPeriod = new Map();

  for (const dose of doses ?? []) {
    const periodKey = Number(dose.period ?? dose.periodLabel) || 1;
    if (!byPeriod.has(periodKey)) {
      byPeriod.set(periodKey, {
        id: `period-${periodKey}`,
        code: String(periodKey).padStart(2, "0"),
        label: String(periodKey),
        doses: [],
      });
    }
    byPeriod.get(periodKey).doses.push({
      ...dose,
      id: resolveDoseNo(dose),
      activityConfigDoseNo: resolveDoseNo(dose),
      periodId: `period-${periodKey}`,
      periodLabel: String(periodKey),
      visitLabel: dose.studyVisitScheduleDescription ?? dose.visitLabel,
    });
  }

  return [...byPeriod.values()].sort(
    (left, right) => Number(left.label) - Number(right.label)
  );
}

export function visitOptionsToSelectOptions(visitOptions) {
  return (visitOptions ?? []).map((visit) => ({
    value: String(visit.studyVisitScheduleNo),
    label: visit.studyVisitScheduleDescription,
  }));
}

export function resolveVisitDescription(visitOptions, studyVisitScheduleNo) {
  const match = (visitOptions ?? []).find(
    (visit) => String(visit.studyVisitScheduleNo) === String(studyVisitScheduleNo)
  );
  return match?.studyVisitScheduleDescription ?? "";
}
