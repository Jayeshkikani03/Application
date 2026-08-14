import {
  getActivityConfiguration,
  getFlatDoseRows,
  getProjectAliquotsPerSeparation,
  isImpDoseActivityType,
  limitAliquotBarcodesForProject,
  normalizeDoseLabel,
  normalizeTimepointLabelForDose,
} from "./activityConfigurationService";
import { getActiveDosesForPeriod, resolveActiveProjectId } from "./barcodeGenerationService";
import { resolveAliquotBarcodesFromRun } from "./projectSubjectService";
import { getTimepointBaseLabel } from "../utils/visitDisplay";
import { isTerminalActivityStatus } from "../shared/domain/activityStatuses.js";

function resolveDefaultProjectId(state) {
  return resolveActiveProjectId(state);
}

function resolveTimepointActivity(timepoint) {
  if (timepoint.activityType === "IMP Dose Administration") return "IMP Dose Administration";
  if (timepoint.activityType === "Pre-Dose Blood Collection") return "Pre-Dose Blood Collection";
  if (timepoint.activityType === "Post-Dose Blood Collection") return "Post-Dose Blood Collection";
  if (timepoint.activity) return timepoint.activity;
  const label = String(timepoint.label ?? "");
  if (/pre-dose/i.test(label)) return "Pre-Dose Blood Collection";
  return "Post-Dose Blood Collection";
}

function timepointMatchVariants(label, doseLabel) {
  const base = getTimepointBaseLabel(label);
  const normalized = normalizeTimepointLabelForDose(base, doseLabel);
  const stripped = String(label ?? "")
    .replace(/\s*\([^)]+\)\s*/g, " ")
    .replace(/\s+Dose[-\s]+\d+$/i, "")
    .trim();

  return [...new Set([label, base, normalized, stripped].filter(Boolean))].map((item) =>
    item.toLowerCase().replace(/\s+/g, " ")
  );
}

function activityMatchesSpec(activity, spec) {
  if (normalizeDoseLabel(activity.dose) !== normalizeDoseLabel(spec.doseLabel)) return false;
  if (activity.activity !== spec.activity) return false;

  // IMP rows use the dose label as the schedule slot key, while execution
  // keeps the configured timepoint name — match on activity + dose only.
  if (isImpDoseActivityType(activity.activity) || isImpDoseActivityType(spec.activity)) {
    return true;
  }

  const activityVariants = timepointMatchVariants(activity.timepoint, activity.dose);
  const specVariants = timepointMatchVariants(spec.timepointLabel, spec.doseLabel);
  return activityVariants.some((value) => specVariants.includes(value));
}

function getVisitDoseLabel(visit) {
  const raw = String(visit?.doseLabel ?? visit?.dose ?? "").trim();
  if (!raw) return "";
  return normalizeDoseLabel(raw.split(",")[0].trim());
}

function visitMatchesSpecDose(visit, spec) {
  const visitDose = getVisitDoseLabel(visit);
  if (!visitDose) return true;
  return visitDose === normalizeDoseLabel(spec.doseLabel);
}

function activitySlotKey(activity) {
  return [
    activity.visitId,
    normalizeDoseLabel(activity.dose),
    activity.activity,
    getTimepointBaseLabel(activity.timepoint).toLowerCase(),
  ].join("|");
}

function scoreActivityForRetention(activity) {
  let score = 0;
  if (activity.actualTime || activity.sampleId) score += 100;
  if (isTerminalActivityStatus(activity.status)) score += 50;
  if (activity.barcode) score += 25;
  if (!String(activity.id ?? "").startsWith("cfg-act-")) score += 10;
  if (!activity.configSynced) score += 5;
  return score;
}

function pickBestActivity(candidates) {
  if (!candidates?.length) return null;
  return [...candidates].sort((a, b) => scoreActivityForRetention(b) - scoreActivityForRetention(a))[0];
}

function findExistingActivityForSpec(activities, visitId, spec) {
  const sameType = activities.filter(
    (activity) =>
      activity.visitId === visitId &&
      normalizeDoseLabel(activity.dose) === normalizeDoseLabel(spec.doseLabel) &&
      activity.activity === spec.activity
  );
  if (!sameType.length) return null;

  const labelMatch = sameType.filter((activity) => activityMatchesSpec(activity, spec));
  if (labelMatch.length) return pickBestActivity(labelMatch);

  const specBase = getTimepointBaseLabel(spec.timepointLabel).toLowerCase();
  const baseMatch = sameType.filter(
    (activity) => getTimepointBaseLabel(activity.timepoint).toLowerCase() === specBase
  );
  return pickBestActivity(baseMatch);
}

function mergeActivityFromSpec(activity, spec) {
  const isImp = spec.activity === "IMP Dose Administration";
  return {
    ...activity,
    pkOffsetMinutes: spec.pkOffsetMinutes,
    timepointOrder: Number(activity.timepointOrder) > 0
      ? Number(activity.timepointOrder)
      : Number(spec.order) % 1000 || Number(spec.order) || 0,
    timepoint: isImp
      ? normalizeDoseLabel(spec.doseLabel)
      : normalizeTimepointLabelForDose(getTimepointBaseLabel(spec.timepointLabel), spec.doseLabel),
    configSynced: true,
  };
}

function dedupeActivitySlots(activities) {
  const groups = new Map();
  for (const activity of activities ?? []) {
    const key = activitySlotKey(activity);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(activity);
  }

  const keptIds = new Set();
  for (const group of groups.values()) {
    keptIds.add(pickBestActivity(group).id);
  }

  return (activities ?? []).filter((activity) => keptIds.has(activity.id));
}

function buildActivitySpecsForPeriod(period) {
  const specs = [];

  getActiveDosesForPeriod(period).forEach((dose) => {
    [...(dose.timepoints ?? [])]
      .filter((timepoint) => timepoint.isActive !== false)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .forEach((timepoint) => {
        const activity = resolveTimepointActivity(timepoint);
        const label = String(timepoint.label ?? "").trim();
        specs.push({
          periodId: period.id,
          periodCode: period.code,
          periodLabel: period.label,
          doseLabel: dose.label,
          timepointLabel: isImpDoseActivityType(activity) ? dose.label : label,
          activity,
          order: (dose.order ?? 1) * 1000 + (timepoint.order ?? 0),
          pkOffsetMinutes: timepoint.offset ?? null,
        });
      });
  });

  return specs;
}

function findPeriodForVisit(visit, periods) {
  if (!visit) return null;

  const byCode = periods.find((period) => period.code && visit.periodCode && period.code === visit.periodCode);
  if (byCode) return byCode;

  const visitLabel = String(visit.label ?? "").trim();
  const byLabel = periods.find((period) => String(period.label ?? "") === visitLabel);
  if (byLabel) return byLabel;

  const doseLabel = normalizeDoseLabel(visit.doseLabel ?? visit.dose ?? "");
  if (!doseLabel) return null;

  const doseRow = getFlatDoseRows(periods).find(
    (dose) => normalizeDoseLabel(dose.label) === doseLabel && dose.isActive !== false
  );
  if (!doseRow) return null;

  return periods.find((period) => period.id === doseRow.periodId) ?? null;
}

function isActivityInSchedule(activity, visit, periods) {
  // Always keep activities that have recorded data — removing them would destroy audit trail
  if (activity.actualTime || activity.sampleId) return true;
  // API-published execution schedule (Activity Execution start-by-scan) must not be filtered
  // by local/demo barcode period config.
  // Activities with a real DB timepoint number are always kept visible
  if (Number(activity.activityConfigTimePointNo) > 0) return true;

  const period = findPeriodForVisit(visit, periods);
  if (!period) return true;

  const doseLabel = normalizeDoseLabel(activity.dose);
  const doseRow = getFlatDoseRows(periods).find((dose) => normalizeDoseLabel(dose.label) === doseLabel);
  if (doseRow && doseRow.isActive === false) return false;

  const specs = buildActivitySpecsForPeriod(period);
  if (!specs.length) return true; // No specs configured yet — keep all activities

  return specs.some((spec) => activityMatchesSpec(activity, spec));
}

function getScheduleSortOrder(activity, visit, periods) {
  const explicitOrder = Number(activity?.timepointOrder);
  if (Number.isFinite(explicitOrder) && explicitOrder > 0) {
    return explicitOrder;
  }

  const period = findPeriodForVisit(visit, periods);
  if (!period) return activity.pkOffsetMinutes ?? 9999;

  const specs = buildActivitySpecsForPeriod(period);
  const match = specs.find((spec) => activityMatchesSpec(activity, spec));
  return match?.order ?? activity.pkOffsetMinutes ?? 9999;
}

function filterActivitiesBySchedule(state, activities, projectId = resolveDefaultProjectId(state)) {
  const periods = getActivityConfiguration(state, projectId).periods;
  const visitsById = new Map((state.visits ?? []).map((visit) => [visit.id, visit]));

  const filtered = (activities ?? []).filter((activity) => {
    // Never hide activities with actual data recorded — they must remain visible for review
    if (activity.actualTime || activity.sampleId) return true;
    // Activities with a real DB timepoint number are always kept visible
    if (Number(activity.activityConfigTimePointNo) > 0) return true;
    if (isTerminalActivityStatus(activity.status)) return true;
    const visit = visitsById.get(activity.visitId);
    return isActivityInSchedule(activity, visit, periods);
  });

  return dedupeActivitySlots(filtered);
}

function compareActivitiesBySchedule(state, a, b, projectId = resolveDefaultProjectId(state)) {
  const periods = getActivityConfiguration(state, projectId).periods;
  const visitsById = new Map((state.visits ?? []).map((visit) => [visit.id, visit]));
  const visitA = visitsById.get(a.visitId);
  const visitB = visitsById.get(b.visitId);

  const doseDiff =
    (parseInt(String(a.dose ?? "").match(/\d+/)?.[0] ?? "0", 10) || 0) -
    (parseInt(String(b.dose ?? "").match(/\d+/)?.[0] ?? "0", 10) || 0);
  if (doseDiff !== 0) return doseDiff;

  return getScheduleSortOrder(a, visitA, periods) - getScheduleSortOrder(b, visitB, periods);
}

function buildActivityId(visit, spec) {
  const key = `${spec.activity}-${spec.doseLabel}-${spec.timepointLabel}`
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase();
  return `cfg-act-${visit.id}-${key}`;
}

function createActivityFromSpec(spec, visit, subjectId, subjectNumber, aliquotsPerSeparation) {
  const isImp = spec.activity === "IMP Dose Administration";
  return {
    id: buildActivityId(visit, spec),
    subjectId,
    visitId: visit.id,
    projectId: visit.projectId ?? null,
    subjectNumber,
    visitLabel: visit.label,
    dose: spec.doseLabel,
    timepoint: spec.timepointLabel,
    activity: spec.activity,
    executionMethod: isImp ? "manual" : "pkBarcode",
    scheduledTime: null,
    windowStart: null,
    windowEnd: null,
    actualTime: null,
    status: spec.activity === "Pre-Dose Blood Collection" ? "Ready" : "Upcoming",
    deviation: false,
    deviationReason: null,
    remarks: null,
    barcode: null,
    sampleId: null,
    pkOffsetMinutes: isImp ? null : spec.pkOffsetMinutes,
    timepointOrder: Number(spec.order) % 1000 || Number(spec.order) || 0,
    expectedAliquots: isImp ? 0 : aliquotsPerSeparation,
    expectedAliquotBarcodes: [],
    configSynced: true,
  };
}

function applyAliquotConfigToActivities(state, projectId) {
  const aliquotsPerSeparation = getProjectAliquotsPerSeparation(state, projectId);
  const activities = (state.activities ?? []).map((activity) => {
    const subject = (state.subjects ?? []).find((item) => item.id === activity.subjectId);
    const activityProjectId = activity.projectId ?? subject?.projectId;
    if (activityProjectId !== projectId) return activity;
    if (activity.executionMethod !== "pkBarcode") return activity;
    if (activity.sampleId || activity.actualTime) return activity;

    const fromRun = resolveAliquotBarcodesFromRun(state, activity);
    if (fromRun.length) {
      const limited = limitAliquotBarcodesForProject(state, projectId, fromRun);
      return {
        ...activity,
        expectedAliquots: limited.length,
        expectedAliquotBarcodes: limited,
      };
    }

    return {
      ...activity,
      expectedAliquots: aliquotsPerSeparation,
      expectedAliquotBarcodes: [],
    };
  });

  return { ...state, activities };
}

function applyAliquotConfigToSamples(state, projectId) {
  const activitiesById = new Map((state.activities ?? []).map((item) => [item.id, item]));
  const samples = (state.samples ?? []).map((sample) => {
    const subject = (state.subjects ?? []).find((item) => item.id === sample.subjectId);
    const activity = sample.activityId ? activitiesById.get(sample.activityId) : null;
    const sampleProjectId = activity?.projectId ?? subject?.projectId ?? sample.projectId;
    if (sampleProjectId !== projectId) return sample;
    if (["Aliquoted", "Stored"].includes(sample.status)) return sample;

    const sourceBarcodes = sample.expectedAliquotBarcodes?.length
      ? sample.expectedAliquotBarcodes
      : (activity?.expectedAliquotBarcodes ?? []);
    const limited = limitAliquotBarcodesForProject(state, projectId, sourceBarcodes);
    if (
      limited.length === (sample.expectedAliquotBarcodes?.length ?? 0)
      && sample.expectedAliquots === limited.length
      && sample.expectedAliquotBarcodes?.every((code, index) => code === limited[index])
    ) {
      return sample;
    }

    return {
      ...sample,
      expectedAliquots: limited.length,
      expectedAliquotBarcodes: limited,
    };
  });

  return { ...state, samples };
}

function syncRuntimeStateFromActivityConfig(state, projectId = resolveDefaultProjectId(state)) {
  const { periods, aliquotsPerSeparation } = getActivityConfiguration(state, projectId);
  const visitsById = new Map((state.visits ?? []).map((visit) => [visit.id, visit]));
  let activities = [...(state.activities ?? [])];

  activities = activities.filter((activity) => {
    // Always preserve activities with recorded data to protect the audit trail
    if (activity.actualTime || activity.sampleId) return true;
    if (isTerminalActivityStatus(activity.status)) return true;
    const visit = visitsById.get(activity.visitId);
    return isActivityInSchedule(activity, visit, periods);
  });

  (state.visits ?? []).forEach((visit) => {
    const period = findPeriodForVisit(visit, periods);
    if (!period) return;

    const subjectNumber =
      state.subjects?.find((subject) => subject.id === visit.subjectId)?.subjectNumber ??
      visit.subjectNumber ??
      "";

    buildActivitySpecsForPeriod(period).forEach((spec) => {
      if (!visitMatchesSpecDose(visit, spec)) return;

      const existing = findExistingActivityForSpec(activities, visit.id, spec);
      if (existing) {
        activities = activities.map((activity) =>
          activity.id === existing.id ? mergeActivityFromSpec(activity, spec) : activity
        );
        return;
      }

      activities.push(createActivityFromSpec(spec, visit, visit.subjectId, subjectNumber, aliquotsPerSeparation));
    });
  });

  activities = dedupeActivitySlots(activities);

  const visits = (state.visits ?? []).map((visit) => {
    const period = findPeriodForVisit(visit, periods);
    if (!period) return visit;
    const visitDose = getVisitDoseLabel(visit);
    const activeDoseLabels = getActiveDosesForPeriod(period)
      .map((dose) => dose.label)
      .filter((label) => !visitDose || normalizeDoseLabel(label) === visitDose);
    return {
      ...visit,
      doseLabel: activeDoseLabels.length ? activeDoseLabels.join(", ") : visit.doseLabel,
    };
  });

  return applyAliquotConfigToSamples(
    applyAliquotConfigToActivities(
      {
        ...state,
        visits,
        activities,
      },
      projectId
    ),
    projectId
  );
}

function getResolvedPeriodsForProject(state, projectId = resolveDefaultProjectId(state)) {
  return getActivityConfiguration(state, projectId).periods;
}

export {
  buildActivitySpecsForPeriod,
  compareActivitiesBySchedule,
  dedupeActivitySlots,
  filterActivitiesBySchedule,
  findPeriodForVisit,
  getResolvedPeriodsForProject,
  isActivityInSchedule,
  syncRuntimeStateFromActivityConfig,
};
