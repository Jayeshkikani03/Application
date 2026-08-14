import {
  formatTimepointDisplayLabel,
  getTimepointBaseLabel,
} from "../utils/visitDisplay";
import {
  getBarcodeProjects,
  getBarcodePeriods,
  resolveActiveProjectId,
} from "./barcodeGenerationService";

const DEFAULT_ALIQUOTS_PER_SEPARATION = 3;
const MAX_ALIQUOTS_PER_SEPARATION = 20;

function clampAliquotsPerSeparation(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_ALIQUOTS_PER_SEPARATION;
  return Math.min(Math.floor(parsed), MAX_ALIQUOTS_PER_SEPARATION);
}

function getProjectSchedule(state, projectId) {
  const project = (state.projects ?? []).find((item) => item.id === projectId);
  return project?.schedule ?? {};
}

function buildExpectedAliquotBarcodeSuffix(index) {
  let remaining = index;
  let suffix = "";
  do {
    suffix = String.fromCharCode(65 + (remaining % 26)) + suffix;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return suffix;
}

function buildExpectedAliquotBarcodes(sampleBarcode, count = DEFAULT_ALIQUOTS_PER_SEPARATION) {
  const safeCount = clampAliquotsPerSeparation(count);
  return Array.from(
    { length: safeCount },
    (_, index) => `AL-${sampleBarcode}-${buildExpectedAliquotBarcodeSuffix(index)}`
  );
}

function getProjectAliquotsPerSeparation(state, projectId) {
  const fromSchedule = getProjectSchedule(state, projectId).aliquotsPerSeparation;
  if (fromSchedule !== undefined && fromSchedule !== null && fromSchedule !== "") {
    return clampAliquotsPerSeparation(fromSchedule);
  }

  const projectCode = resolveProjectCode(state, projectId);
  const run = (state.generatedBarcodeRuns ?? []).find(
    (item) => item.projectId === projectId || item.projectCode === projectId || item.projectCode === projectCode
  );
  if (run?.lotCount != null && run.lotCount !== "") {
    return clampAliquotsPerSeparation(run.lotCount);
  }

  return DEFAULT_ALIQUOTS_PER_SEPARATION;
}

function limitAliquotBarcodesForProject(state, projectId, barcodes) {
  if (!barcodes?.length) return [];
  const limit = getProjectAliquotsPerSeparation(state, projectId);
  return barcodes.slice(0, limit);
}


function formatTimepointDuration(value) {
  if (value === "" || value === null || value === undefined) return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  const rounded = Math.round(num * 1000) / 1000;
  return String(rounded);
}

function formatTimepointDurationForInput(value) {
  if (value === "" || value === null || value === undefined) return "0";
  const num = Number(value);
  if (!Number.isFinite(num)) return "0";
  const rounded = Math.round(num * 1000) / 1000;
  return String(rounded);
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeDoseLabel(label) {
  const text = String(label ?? "").trim();
  if (!text) return "Dose 1";
  const num = text.match(/\d+/)?.[0];
  if (num) return `Dose ${num}`;
  return text;
}

function getDoseNumberFromLabel(label) {
  const num = String(label ?? "").match(/\d+/)?.[0];
  return num ? Number(num) : 1;
}

function getVisitLabelForDose(doseLabel, visitOptions = []) {
  const options = visitOptions?.length ? visitOptions : [];
  if (!options.length) return "";
  const index = getDoseNumberFromLabel(doseLabel) - 1;
  if (index < 0) return options[0];
  return options[index] ?? options[options.length - 1];
}

function normalizeTimepointLabelForDose(label, doseLabel) {
  const baseLabel = getTimepointBaseLabel(label);
  if (!baseLabel) return formatTimepointDisplayLabel("", doseLabel);
  return formatTimepointDisplayLabel(baseLabel, doseLabel);
}

function getDoseDuplicateError(periods, { label, order, excludeId = null }) {
  const normalizedLabel = normalizeDoseLabel(label);
  const targetOrder = Number(order);
  if (!Number.isFinite(targetOrder) || targetOrder < 1) {
    return "Order must be 1 or greater.";
  }

  const existingDoses = getFlatDoseRows(periods).filter((dose) => dose.id !== excludeId);
  const nameMatch = existingDoses.find(
    (dose) => normalizeDoseLabel(dose.label).toLowerCase() === normalizedLabel.toLowerCase()
  );
  if (nameMatch) {
    return `Dose name "${normalizedLabel}" already exists.`;
  }

  const orderMatch = existingDoses.find((dose) => Number(dose.order) === targetOrder);
  if (orderMatch) {
    return `Order ${targetOrder} is already assigned to "${normalizeDoseLabel(orderMatch.label)}".`;
  }

  return null;
}

function getTimepointDuplicateError(timepoints, doseLabel, { baseLabel, order, excludeId = null }) {
  const trimmedBase = String(baseLabel ?? "").trim();
  const targetOrder = Number(order);
  if (!trimmedBase) {
    return "Time point name is required.";
  }
  if (!Number.isFinite(targetOrder) || targetOrder < 1) {
    return "Order must be 1 or greater.";
  }

  const others = (timepoints ?? []).filter((timepoint) => timepoint.id !== excludeId);
  const nameMatch = others.find(
    (timepoint) => getTimepointBaseLabel(timepoint.label).toLowerCase() === trimmedBase.toLowerCase()
  );
  if (nameMatch) {
    return `Time point "${trimmedBase}" already exists for this dose.`;
  }

  const orderMatch = others.find((timepoint) => Number(timepoint.order) === targetOrder);
  if (orderMatch) {
    return `Order ${targetOrder} is already assigned to "${getTimepointBaseLabel(orderMatch.label)}".`;
  }

  return null;
}

function normalizeDose(dose, period, index, visitOptions = []) {
  const label = normalizeDoseLabel(dose.label);
  return {
    id: dose.id ?? createId(`${period.id}-dose`),
    label,
    visitLabel: dose.visitLabel?.trim() ? dose.visitLabel : getVisitLabelForDose(label, visitOptions),
    periodId: dose.periodId ?? period.id,
    periodLabel: dose.periodLabel ?? period.label,
    isActive: dose.isActive !== false,
    order: resolveDoseOrder(label, dose.order ?? getDoseNumberFromLabel(label) ?? index + 1),
    dAddedOnUTC: dose.dAddedOnUTC ?? null,
    timepoints: normalizeTimepointsForDose(
      dose.timepoints,
      label,
      dose.visitLabel?.trim() ? dose.visitLabel : getVisitLabelForDose(label, visitOptions)
    ),
  };
}

function isImpDoseActivityType(activityType) {
  return activityType === "IMP Dose Administration";
}

function isPreDoseBloodCollectionType(activityType) {
  return activityType === "Pre-Dose Blood Collection";
}

function isScheduleFieldsHiddenForActivityType(activityType) {
  return isImpDoseActivityType(activityType) || isPreDoseBloodCollectionType(activityType);
}

function normalizeProjectCode(projectCode) {
  return String(projectCode ?? "").trim().toUpperCase();
}

function resolveProjectCode(state, projectId) {
  const projects = getBarcodeProjects(state);
  const project = projects.find((item) => item.id === projectId);
  return normalizeProjectCode(project?.code ?? projectId);
}

function inferTimepointActivityType(baseLabel, doseLabel) {
  const text = String(baseLabel ?? "");
  if (/pre-dose/i.test(text)) return "Pre-Dose Blood Collection";
  if (
    doseLabel &&
    normalizeDoseLabel(text).toLowerCase() === normalizeDoseLabel(doseLabel).toLowerCase()
  ) {
    return "IMP Dose Administration";
  }
  if (/imp|dose admin/i.test(text)) return "IMP Dose Administration";
  return "Post-Dose Blood Collection";
}

function resolveActivityType(activityType, baseLabel, doseLabel) {
  const value = String(activityType ?? "").trim();
  if (value === "Centrifugation") return "Post-Dose Blood Collection";
  if (value) return value;
  return inferTimepointActivityType(baseLabel, doseLabel);
}

function resolveTimepointOffset(duration, durationType, fallbackOffset = null) {
  if (fallbackOffset !== null && fallbackOffset !== undefined && fallbackOffset !== "") {
    return Number(fallbackOffset);
  }
  const value = Number(duration);
  if (!Number.isFinite(value)) return null;
  return durationType === "Minute" ? value : value * 60;
}

function normalizeTimepointRecord(timepoint, doseLabel, doseVisitLabel, tpIndex = 0) {
  const baseLabel = getTimepointBaseLabel(timepoint.label);
  const rawDurationType = String(timepoint.durationType ?? "").trim();
  let durationType = rawDurationType || "Hour";
  let duration =
    timepoint.duration === "" || timepoint.duration === null || timepoint.duration === undefined
      ? timepoint.offset != null && durationType === "Minute"
        ? Number(timepoint.offset)
        : timepoint.offset != null
          ? Number(timepoint.offset) / 60
          : 0
      : Number(timepoint.duration);

  const preDoseLike =
    baseLabel.toLowerCase().includes("pre-dose") ||
    inferTimepointActivityType(baseLabel, doseLabel) === "Pre-Dose Blood Collection";
  if (preDoseLike && durationType === "Hour" && duration < 0 && duration > -1) {
    duration = Math.round(duration * 60);
    durationType = "Minute";
  }

  const resolvedActivityType = resolveActivityType(timepoint.activityType, baseLabel, doseLabel);
  let windowPeriodMinus =
    timepoint.windowPeriodMinus === "" || timepoint.windowPeriodMinus == null
      ? ""
      : Number(timepoint.windowPeriodMinus);
  let windowPeriodPlus =
    timepoint.windowPeriodPlus === "" || timepoint.windowPeriodPlus == null
      ? ""
      : Number(timepoint.windowPeriodPlus);
  const rawWindowDurationType = String(timepoint.windowPeriodDurationType ?? "").trim();
  let windowPeriodDurationType = rawWindowDurationType || "Hour";

  if (isImpDoseActivityType(resolvedActivityType)) {
    duration = 0;
    durationType = "Hour";
    windowPeriodMinus = "";
    windowPeriodPlus = "";
    windowPeriodDurationType = "Hour";
  }

  return {
    id: timepoint.id ?? createId("tp"),
    order: timepoint.order ?? tpIndex + 1,
    label: normalizeTimepointLabelForDose(timepoint.label, doseLabel),
    visitLabel: timepoint.visitLabel ?? doseVisitLabel ?? "",
    duration: Number.isFinite(duration) ? duration : 0,
    durationType,
    windowPeriodMinus,
    windowPeriodPlus,
    windowPeriodDurationType,
    activityType: resolvedActivityType,
    refTimepointId: "",
    offset: resolveTimepointOffset(duration, durationType, timepoint.offset),
    isActive: timepoint.isActive !== false,
    dAddedOnUTC: timepoint.dAddedOnUTC ?? null,
  };
}

function formatRefTimepointLabel(timepoints, refTimepointId) {
  if (!refTimepointId) return "—";
  const match = (timepoints ?? []).find((item) => item.id === refTimepointId);
  if (!match) return "—";
  return `${getTimepointBaseLabel(match.label)} (order ${match.order})`;
}

function createTimepointDraftDefaults(doseLabel, doseVisitLabel, options = {}) {
  const durationType = options.durationType || "Hour";
  const activityType = options.activityType || "Post-Dose Blood Collection";
  return {
    order: "",
    label: "",
    visitLabel: doseVisitLabel ?? "",
    duration: "0",
    durationType,
    windowPeriodMinus: "",
    windowPeriodPlus: "",
    windowPeriodDurationType: durationType,
    activityType,
    isActive: true,
  };
}

function buildTimepointFromDraft(draft, doseLabel, existing = null, options = {}) {
  if (options.manual) {
    return buildManualTimepointFromDraft(draft, doseLabel, existing);
  }

  const baseLabel = getTimepointBaseLabel(draft.label) || "New Timepoint";
  const durationType = draft.durationType ?? "Hour";
  const duration = draft.duration === "" ? 0 : Number(draft.duration);
  const activityType = draft.activityType ?? "Post-Dose Blood Collection";
  const record = normalizeTimepointRecord(
    {
      id: existing?.id,
      order: Number(draft.order) || 0,
      label: baseLabel,
      visitLabel: draft.visitLabel,
      duration,
      durationType,
      windowPeriodMinus: draft.windowPeriodMinus,
      windowPeriodPlus: draft.windowPeriodPlus,
      windowPeriodDurationType: draft.windowPeriodDurationType,
      activityType,
      offset: resolveTimepointOffset(duration, durationType),
      isActive: draft.isActive,
      dAddedOnUTC: existing?.dAddedOnUTC,
    },
    doseLabel,
    draft.visitLabel
  );

  return {
    ...record,
    id: existing?.id ?? createId("tp"),
    dAddedOnUTC: existing?.dAddedOnUTC ?? new Date().toISOString(),
  };
}

function buildManualTimepointFromDraft(draft, doseLabel, existing = null) {
  const baseLabel = getTimepointBaseLabel(draft.label) || draft.label.trim() || "New Timepoint";
  const durationType = draft.durationType ?? "Hour";
  const duration = draft.duration === "" ? 0 : Number(draft.duration);
  const activityType = draft.activityType ?? "Post-Dose Blood Collection";
  const windowPeriodMinus =
    draft.windowPeriodMinus === "" || draft.windowPeriodMinus == null
      ? ""
      : Number(draft.windowPeriodMinus);
  const windowPeriodPlus =
    draft.windowPeriodPlus === "" || draft.windowPeriodPlus == null
      ? ""
      : Number(draft.windowPeriodPlus);

  const timePointNo = existing?.activityConfigTimePointNo ?? existing?.id ?? 0;

  return {
    id: timePointNo,
    activityConfigTimePointNo: timePointNo,
    order: Number(draft.order) > 0 ? Number(draft.order) : 1,
    label: normalizeTimepointLabelForDose(baseLabel, doseLabel),
    visitLabel: draft.visitLabel ?? "",
    studyVisitScheduleNo: draft.studyVisitScheduleNo ?? "",
    studyVisitScheduleDescription: draft.visitLabel ?? "",
    duration: Number.isFinite(duration) ? duration : 0,
    durationType,
    windowPeriodMinus,
    windowPeriodPlus,
    windowPeriodDurationType: draft.windowPeriodDurationType ?? "Hour",
    activityType,
    refTimepointId: "",
    offset: resolveTimepointOffset(duration, durationType),
    isActive: draft.isActive !== false,
    dAddedOnUTC: existing?.dAddedOnUTC ?? new Date().toISOString(),
  };
}

function buildDefaultTimepointsForDose() {
  return [];
}

function formatDoseTimepointSummary(dose) {
  const names = (dose?.timepoints ?? [])
    .filter((timepoint) => timepoint.isActive !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((timepoint) => String(timepoint.label ?? "").trim())
    .filter(Boolean);
  return names.length ? names.join(", ") : "";
}

function normalizeTimepointsForDose(timepoints, doseLabel, doseVisitLabel) {
  return (timepoints ?? []).map((timepoint, tpIndex) =>
    normalizeTimepointRecord(timepoint, doseLabel, doseVisitLabel, tpIndex)
  );
}

function entriesToDoses(period, entries, doseLabels, visitOptions = [], projectCode = "") {
  const labels = doseLabels?.length
    ? doseLabels
    : [...new Set((entries ?? []).map((entry) => entry.doseLabel).filter(Boolean))];

  if (labels.length === 0 && (entries ?? []).length === 0) {
    return buildDefaultDosesForPeriod(period, visitOptions, projectCode);
  }

  return labels.map((rawLabel, doseIndex) => {
    const label = normalizeDoseLabel(rawLabel);
    const doseEntries = (entries ?? []).filter(
      (entry) => normalizeDoseLabel(entry.doseLabel) === label || entry.doseLabel === rawLabel
    );

    const timepoints = doseEntries.length
      ? doseEntries
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((entry, index) => ({
            id: `${period.id}-dose-${doseIndex + 1}-tp-${index + 1}`,
            label: entry.label,
            offset: entry.offset ?? null,
            order: entry.order ?? index + 1,
            isActive: true,
          }))
      : [];

    return normalizeDose(
      {
        id: `${period.id}-dose-${doseIndex + 1}`,
        label,
        visitLabel: getVisitLabelForDose(label, visitOptions),
        periodId: period.id,
        isActive: true,
        order: doseIndex + 1,
        timepoints,
      },
      period,
      doseIndex,
      visitOptions
    );
  });
}

function buildDefaultDosesForPeriod(period, visitOptions = [], projectCode = "") {
  const doseLabels = period?.doseLabels ?? [];
  if (!doseLabels.length) return [];
  return doseLabels.map((rawLabel, doseIndex) => {
    const label = normalizeDoseLabel(rawLabel);
    return normalizeDose(
      {
        id: `${period.id}-dose-${doseIndex + 1}`,
        label,
        visitLabel: getVisitLabelForDose(label, visitOptions),
        periodId: period.id,
        isActive: true,
        order: doseIndex + 1,
        timepoints: [],
      },
      period,
      doseIndex,
      visitOptions
    );
  });
}

function dosesToPeriodEntries(doses) {
  const sortedDoses = [...doses].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const entries = [];

  sortedDoses.forEach((dose) => {
    if (dose.isActive === false) return;
    const sortedTimepoints = [...(dose.timepoints ?? [])]
      .filter((timepoint) => timepoint.isActive !== false)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    sortedTimepoints.forEach((timepoint) => {
      entries.push({
        doseLabel: dose.label,
        label: timepoint.label,
        offset: timepoint.offset ?? null,
        order: entries.length + 1,
      });
    });
  });

  return {
    doseLabels: sortedDoses.map((dose) => dose.label),
    entries,
  };
}

function normalizePeriodConfig(period, visitOptions = [], projectCode = "") {
  let nextPeriod;
  if (period.doses?.length) {
    nextPeriod = {
      ...period,
      doses: period.doses.map((dose, index) => normalizeDose(dose, period, index, visitOptions)),
    };
  } else {
    const { doseLabels, entries } = dosesToPeriodEntries(
      buildDefaultDosesForPeriod(period, visitOptions, projectCode)
    );
    const sourceEntries = period.entries?.length ? period.entries : entries;
    const sourceLabels = period.doseLabels?.length ? period.doseLabels : doseLabels;

    nextPeriod = {
      ...period,
      doses: entriesToDoses(period, sourceEntries, sourceLabels, visitOptions, projectCode),
    };
  }

  return nextPeriod;
}

function getActivityConfiguration(state, projectId) {
  const visitOptions = getVisitOptions(state);
  const projectCode = resolveProjectCode(state, projectId);
  const periods = getBarcodePeriods(state, projectId)
    .map((period) => normalizePeriodConfig(period, visitOptions, projectCode));
  return {
    periods: normalizeGlobalDoseOrders(periods),
    aliquotsPerSeparation: getProjectAliquotsPerSeparation(state, projectId),
  };
}

function sortVisitLabels(labels) {
  return [...new Set(labels.filter(Boolean))].sort((left, right) => {
    const leftDay = Number(String(left).match(/Day-(\d+)/i)?.[1] ?? String(left).match(/Visit-(\d+)/i)?.[1] ?? 0);
    const rightDay = Number(String(right).match(/Day-(\d+)/i)?.[1] ?? String(right).match(/Visit-(\d+)/i)?.[1] ?? 0);
    if (leftDay !== rightDay) return leftDay - rightDay;
    return String(left).localeCompare(String(right), undefined, { numeric: true });
  });
}

function getVisitOptions(state) {
  const fromVisits = [...new Set((state.visits ?? []).map((visit) => visit.label).filter(Boolean))];
  return fromVisits.length ? sortVisitLabels(fromVisits) : [];
}

function getDoseVisitOptions(state, projectId = null) {
  const resolvedProjectId = projectId ?? resolveActiveProjectId(state);
  if (resolvedProjectId) {
    const configured = getFlatDoseRows(getActivityConfiguration(state, resolvedProjectId).periods);
    const fromConfigured = [...new Set(configured.map((dose) => dose.visitLabel).filter(Boolean))];
    if (fromConfigured.length) return sortVisitLabels(fromConfigured);
  }

  const doseVisitIds = new Set(
    (state.schema?.periods ?? [])
      .flatMap((period) => period.doses ?? [])
      .map((dose) => dose.visitId)
      .filter(Boolean)
  );
  const fromSchemaDoseVisits = (state.schema?.visits ?? [])
    .filter((visit) => doseVisitIds.has(visit.id))
    .map((visit) => visit.label)
    .filter(Boolean);
  if (fromSchemaDoseVisits.length) return sortVisitLabels(fromSchemaDoseVisits);

  return sortVisitLabels(getVisitOptions(state));
}

function getAllVisitOptions(state) {
  const fromSchema = (state.schema?.visits ?? []).map((visit) => visit.label).filter(Boolean);
  const fromRuntime = (state.visits ?? []).map((visit) => visit.label).filter(Boolean);
  const fromProjectSchedule = (state.projects ?? []).flatMap(
    (project) => (project.schedule?.visits ?? []).map((visit) => visit.label)
  ).filter(Boolean);
  const merged = [...new Set([
    ...fromSchema,
    ...fromRuntime,
    ...fromProjectSchedule,
  ])];
  return sortVisitLabels(merged);
}

function resolveDoseOrder(label, fallbackOrder) {
  const numericFallback = Number(fallbackOrder);
  if (Number.isFinite(numericFallback) && numericFallback > 0) {
    return numericFallback;
  }
  const doseNumber = getDoseNumberFromLabel(label);
  if (doseNumber > 0) return doseNumber;
  return 1;
}

function getFlatDoseRows(periods) {
  return periods
    .flatMap((period) =>
      (period.doses ?? []).map((dose) => ({
        ...dose,
        periodId: period.id,
        periodLabel: period.label,
      }))
    )
    .sort((a, b) => {
      const doseDiff = getDoseNumberFromLabel(a.label) - getDoseNumberFromLabel(b.label);
      if (doseDiff !== 0) return doseDiff;
      const periodDiff = String(a.periodLabel ?? "").localeCompare(String(b.periodLabel ?? ""), undefined, {
        numeric: true,
      });
      if (periodDiff !== 0) return periodDiff;
      return (a.order ?? 0) - (b.order ?? 0);
    });
}

function getNextGlobalDoseOrder(periods) {
  const rows = getFlatDoseRows(periods);
  if (rows.length === 0) return 1;
  return Math.max(...rows.map((dose) => dose.order ?? 0)) + 1;
}

function normalizeGlobalDoseOrders(periods) {
  const ordered = getFlatDoseRows(periods);
  const orderById = new Map(
    ordered.map((dose, index) => [dose.id, resolveDoseOrder(dose.label, index + 1)])
  );

  return periods.map((period) => ({
    ...period,
    doses: (period.doses ?? []).map((dose) => ({
      ...dose,
      order: orderById.get(dose.id) ?? resolveDoseOrder(dose.label, dose.order),
    })),
  }));
}

function ensurePeriodBucket(periods, dose) {
  const periodKey = Number(dose.period ?? dose.periodLabel) || 1;
  const periodId = dose.periodId ?? `period-${periodKey}`;
  if ((periods ?? []).some((period) => period.id === periodId)) {
    return periods ?? [];
  }

  return [
    ...(periods ?? []),
    {
      id: periodId,
      code: String(periodKey).padStart(2, "0"),
      label: String(periodKey),
      doses: [],
    },
  ].sort((left, right) => Number(left.label) - Number(right.label));
}

function insertDoseGlobally(periods, dose, editingId = null) {
  const targetPeriodId = dose.periodId ?? `period-${Number(dose.period ?? dose.periodLabel) || 1}`;
  let nextPeriods = ensurePeriodBucket(periods, { ...dose, periodId: targetPeriodId });
  let allDoses = nextPeriods.flatMap((period) =>
    (period.doses ?? []).map((item) => ({
      ...item,
      periodId: period.id,
      periodLabel: item.periodLabel ?? period.label,
    }))
  );

  if (editingId) {
    allDoses = allDoses.filter((item) => item.id !== editingId);
  }

  const insertAt = Math.max(
    0,
    Math.min((Number(dose.order) || allDoses.length + 1) - 1, allDoses.length)
  );
  allDoses.splice(insertAt, 0, {
    ...dose,
    periodId: targetPeriodId,
    order: insertAt + 1,
  });

  allDoses = allDoses.map((item, index) => ({ ...item, order: index + 1 }));

  return nextPeriods.map((period) => ({
    ...period,
    doses: allDoses
      .filter((item) => item.periodId === period.id)
      .map(({ periodId: _periodId, ...item }) => item),
  }));
}

function formatConfigDateTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function saveActivityConfiguration(state, projectId, periods, configOptions = {}) {
  const projects = state.projects ?? [];
  const visitOptions = getVisitOptions(state);
  const existingSchedule = getProjectSchedule(state, projectId);
  const normalizedPeriods = normalizeGlobalDoseOrders(
    (periods ?? []).map((period) => {
      const normalizedDoses = (period.doses ?? []).map((dose, index) =>
        normalizeDose(dose, period, index, visitOptions)
      );
      const { doseLabels, entries } = dosesToPeriodEntries(normalizedDoses);
      return {
        id: period.id,
        code: period.code,
        label: normalizePeriodLabel(period.label) || period.label,
        doseLabels,
        entries,
        doses: normalizedDoses,
      };
    })
  );

  const nextAliquotsPerSeparation = configOptions.aliquotsPerSeparation != null
    ? clampAliquotsPerSeparation(configOptions.aliquotsPerSeparation)
    : existingSchedule.aliquotsPerSeparation ?? getProjectAliquotsPerSeparation(state, projectId);

  const schedule = {
    periods: normalizedPeriods,
    aliquotsPerSeparation: nextAliquotsPerSeparation,
  };

  const defaultProject = getBarcodeProjects(state).find((project) => project.id === projectId);
  if (!defaultProject) throw new Error("Select a valid project.");

  let nextState;

  const hasStoredProject = projects.some((project) => project.id === projectId);
  if (!hasStoredProject) {
    nextState = {
      ...state,
      projects: [
        ...projects,
        {
          id: projectId,
          code: defaultProject.code,
          name: defaultProject.name,
          schedule,
        },
      ],
    };
  } else {
    nextState = {
      ...state,
      projects: projects.map((project) =>
        project.id === projectId ? { ...project, schedule } : project
      ),
    };
  }

  return nextState;
}

function normalizePeriodLabel(label) {
  const text = String(label ?? "").trim();
  if (!text) return "";
  const num = text.match(/(\d+)/)?.[1];
  return num ? String(Number(num)) : text;
}

function getPeriodMatchKey(label) {
  return normalizePeriodLabel(label).toLowerCase();
}

function createPeriod(label) {
  const normalizedLabel = normalizePeriodLabel(label) || "1";
  const displayNumber = Number(normalizedLabel) || 1;
  return {
    id: `period-${displayNumber}`,
    code: String(displayNumber).padStart(2, "0"),
    label: normalizedLabel,
    doses: [],
  };
}

function createDose({ label, visitLabel, periodId, periodLabel, isActive, order, timepoints = [], visitOptions = [], projectCode = "", dAddedOnUTC }) {
  const normalizedLabel = normalizeDoseLabel(label);
  const resolvedVisit = visitLabel?.trim() ? visitLabel : getVisitLabelForDose(normalizedLabel, visitOptions);
  const resolvedTimepoints =
    timepoints?.length > 0
      ? normalizeTimepointsForDose(timepoints, normalizedLabel, resolvedVisit)
      : buildDefaultTimepointsForDose(normalizedLabel, resolvedVisit, projectCode);
  return {
    id: createId("dose"),
    label: normalizedLabel,
    visitLabel: resolvedVisit,
    periodId,
    periodLabel: normalizePeriodLabel(periodLabel) || String(periodLabel ?? "").trim(),
    isActive: isActive !== false,
    order: resolveDoseOrder(normalizedLabel, order),
    dAddedOnUTC: dAddedOnUTC ?? new Date().toISOString(),
    timepoints: resolvedTimepoints,
  };
}

function ensurePeriodByLabel(periods, periodLabel) {
  const label = normalizePeriodLabel(periodLabel);
  if (!label) {
    throw new Error("Period is required.");
  }

  const existing = periods.find((period) => getPeriodMatchKey(period.label) === getPeriodMatchKey(label));
  if (existing) {
    return { periods, period: existing };
  }

  const created = createPeriod(label);
  return { periods: [...periods, created], period: created };
}

function createTimepoint(label, offset, doseLabel, dAddedOnUTC) {
  return buildTimepointFromDraft(
    {
      ...createTimepointDraftDefaults(doseLabel),
      label: getTimepointBaseLabel(label) || "New Timepoint",
      offset,
    },
    doseLabel
  );
}

export {
  DEFAULT_ALIQUOTS_PER_SEPARATION,
  buildDefaultTimepointsForDose,
  buildExpectedAliquotBarcodes,
  buildTimepointFromDraft,
  buildManualTimepointFromDraft,
  clampAliquotsPerSeparation,
  createDose,
  createPeriod,
  createTimepoint,
  createTimepointDraftDefaults,
  ensurePeriodByLabel,
  isImpDoseActivityType,
  isPreDoseBloodCollectionType,
  isScheduleFieldsHiddenForActivityType,
  formatConfigDateTime,
  formatDoseTimepointSummary,
  formatRefTimepointLabel,
  formatTimepointDuration,
  formatTimepointDurationForInput,
  getActivityConfiguration,
  getAllVisitOptions,
  getDoseVisitOptions,
  getProjectAliquotsPerSeparation,
  limitAliquotBarcodesForProject,
  getDoseDuplicateError,
  getFlatDoseRows,
  getNextGlobalDoseOrder,
  getDoseNumberFromLabel,
  getTimepointDuplicateError,
  getVisitLabelForDose,
  getVisitOptions,
  insertDoseGlobally,
  normalizeDoseLabel,
  normalizeGlobalDoseOrders,
  normalizeTimepointLabelForDose,
  normalizeTimepointRecord,
  resolveDoseOrder,
  saveActivityConfiguration,
};
