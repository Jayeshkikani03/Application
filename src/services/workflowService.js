import { getCurrentAuditActor } from "../shared/audit/auditActor.js";
import {
  TERMINAL_ACTIVITY_STATUSES,
  isActivityActionableStatus,
  isActivityPendingCollectionStatus,
  isActivityReadyStatus,
  isAliquotParentStatus,
  isSampleAliquotCompleteStatus,
  isSampleWorkflowStatus,
  isTerminalActivityStatus,
} from "../shared/domain/activityStatuses.js";
import { filterActivitiesBySchedule, compareActivitiesBySchedule } from "./activityScheduleSyncService";
import {
  findSubjectBarcodeForProject,
  findSubjectForBarcodeCode,
  filterPkBarcodesForProject,
  resolveAliquotBarcodesFromRun,
  resolveSubjectProjectId,
} from "./projectSubjectService";
import {
  buildExpectedAliquotBarcodes,
  getProjectAliquotsPerSeparation,
  limitAliquotBarcodesForProject,
} from "./activityConfigurationService";
import {
  UI_LABELS,
  unknownParticipantBarcodeMessage,
  wrongParticipantScanMessage,
  participantSelectedMessage,
  waitingForNextParticipantMessage,
} from "../constants/displayLabels";
import { formatDoseDisplayLabel } from "../utils/visitDisplay";
import {
  applyReviewQueryClosed,
  applyReviewQueryResolved,
  applyReviewQuerySendback,
  activityHasRaisedReviewQuery,
  createRaisedReviewQueryActivity,
  getReviewQueryStatus,
  isActiveReviewQuery,
  isReviewQueryAwaitingReviewer,
  resolveReviewQueryFieldLabel,
  REVIEW_QUERY_STATUS
} from "./reviewQueryService";
import { formatParticipantDropdownLabel, resolveSiteRandomizationNumber } from "../utils/participantDisplay";
import { getCrfDefinitionForActivity, saveActivityCrfField } from "./crfService";
import { getNowIso, isWallClockDateTime } from "../shared/time/siteClock.js";

function getDoseNumber(doseStr) {
  if (!doseStr) return 0;
  const match = String(doseStr).match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

/** Sort key from schedule fields (order/offset), not a hardcoded protocol catalog. */
function getTimepointIndex(a) {
  if (a.activity === "IMP Dose Administration") {
    return Number.isFinite(Number(a.order)) ? Number(a.order) : 0;
  }
  if (Number.isFinite(Number(a.order))) return Number(a.order);
  if (Number.isFinite(Number(a.offset))) return Number(a.offset);
  return 999;
}

function resolveReviewQueryOnSave(state, activityId, fieldKey, responseText) {
  const activity = state.activities.find((item) => item.id === activityId);
  if (!activity || !isActiveReviewQuery(activity, fieldKey)) return state;
  const resolved = applyReviewQueryResolved(activity, fieldKey, responseText);
  if (resolved === activity) return state;
  const next = {
    ...state,
    activities: state.activities.map((item) => (item.id === activityId ? resolved : item))
  };
  return next;
}

function resolveReviewQuery(state, activityId, responseText) {
  const activity = state.activities.find((item) => item.id === activityId);
  if (!activity?.reviewQuery) {
    return refreshPhase(state, "No review query to resolve.");
  }
  const fieldKey = activity.reviewQueryFieldKey;
  if (!isActiveReviewQuery(activity, fieldKey)) {
    return refreshPhase(state, "Query can only be resolved while it is raised or sent back.");
  }
  const trimmed = String(responseText ?? "").trim();
  if (!trimmed) {
    return refreshPhase(state, "Response is required to resolve the query.");
  }
  const next = resolveReviewQueryOnSave(state, activityId, fieldKey, trimmed);
  if (next === state) {
    return refreshPhase(state, "Could not resolve review query.");
  }
  return refreshPhase(next, "Review query resolved.");
}

function normalizeReviewQueryFieldKey(fieldKey) {
  if (!fieldKey) return "";
  if (fieldKey.startsWith("crf:")) return fieldKey;
  return /^[0-9a-f-]{36}$/i.test(fieldKey) ? `crf:${fieldKey}` : fieldKey;
}

function resolveReviewQueryWithFieldValue(state, activityId, { fieldValue, responseText } = {}) {
  const activity = state.activities.find((item) => item.id === activityId);
  if (!activity?.reviewQuery) {
    return refreshPhase(state, "No review query to resolve.");
  }
  const fieldKey = normalizeReviewQueryFieldKey(activity.reviewQueryFieldKey);
  if (!isActiveReviewQuery(activity, activity.reviewQueryFieldKey)) {
    return refreshPhase(state, "Query can only be resolved while it is raised or sent back.");
  }
  const trimmedResponse = String(responseText ?? "").trim();
  if (!trimmedResponse) {
    return refreshPhase(state, "Response is required to resolve the query.");
  }

  const sample = resolveActivitySample(state.samples, activity);

  if (fieldKey === "actual") {
    const datetimeLocal = String(fieldValue ?? "").trim();
    if (!datetimeLocal) {
      return refreshPhase(state, "Actual date/time is required.");
    }
    const currentLocal = formatDateTimeLocal(activity.actualTime);
    if (currentLocal === datetimeLocal) {
      return resolveReviewQuery(state, activityId, trimmedResponse);
    }
    return setActivityActualTime(state, activityId, fromDateTimeLocal(datetimeLocal), trimmedResponse);
  }

  if (fieldKey === "scanStart") {
    if (!sample) return refreshPhase(state, "PK sample not found.");
    const datetimeLocal = String(fieldValue ?? "").trim();
    if (!datetimeLocal) {
      return refreshPhase(state, "Start date/time is required.");
    }
    const currentLocal = formatDateTimeLocal(resolveCentrifugeStartTime(activity, sample));
    if (currentLocal === datetimeLocal) {
      return resolveReviewQuery(state, activityId, trimmedResponse);
    }
    const nextStartTime = fromDateTimeLocal(datetimeLocal);
    if (usesCentrifugeWorkflowStart(sample)) {
      return editCentrifugeStart(state, sample.id, nextStartTime, trimmedResponse);
    }
    return editTimepointScanStart(state, sample.id, nextStartTime, trimmedResponse);
  }

  if (fieldKey === "remark") {
    const nextRemark = String(fieldValue ?? "").trim();
    if (!nextRemark) {
      return refreshPhase(state, "Remark is required.");
    }
    const currentRemark = String(activity.remarks ?? "").trim();
    if (currentRemark === nextRemark) {
      return resolveReviewQuery(state, activityId, trimmedResponse);
    }

    const next = {
      ...state,
      activities: state.activities.map((item) => (
        item.id === activityId ? { ...item, remarks: nextRemark } : item
      ))
    };
    const resolved = resolveReviewQueryOnSave(next, activityId, "remark", trimmedResponse);
    if (resolved === next) {
      return refreshPhase(state, "Could not resolve review query.");
    }
    return refreshPhase(resolved, "Review query resolved.");
  }

  if (fieldKey.startsWith("crf:")) {
    const fieldId = fieldKey.slice(4);
    const definition = getCrfDefinitionForActivity(activity);
    const crfId = definition?.id;
    if (!crfId) {
      return refreshPhase(state, "CRF definition not found.");
    }
    const nextValue = String(fieldValue ?? "").trim();
    if (!nextValue) {
      return refreshPhase(state, "Field value is required.");
    }
    const previousSaved = activity.crfResponses?.[crfId]?.values ?? {};
    const oldValue = String(previousSaved[fieldId] ?? "").trim();
    if (oldValue === nextValue) {
      return resolveReviewQuery(state, activityId, trimmedResponse);
    }
    const result = saveActivityCrfField(
      state,
      activityId,
      crfId,
      fieldId,
      nextValue,
      trimmedResponse
    );
    if (result.error) {
      return refreshPhase(state, result.error);
    }
    return refreshPhase(result.state, "Review query resolved.");
  }

  return resolveReviewQuery(state, activityId, trimmedResponse);
}
function nowIso() {
  return getNowIso();
}
function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
function addMinutes(iso, minutes) {
  const pad = (n) => String(n).padStart(2, "0");
  // Wall-clock stamps (no Z): treat digits as fixed clock face for arithmetic.
  if (isWallClockDateTime(iso)) {
    const wall = new Date(`${String(iso).slice(0, 19)}Z`);
    if (!Number.isNaN(wall.getTime())) {
      const shifted = new Date(wall.getTime() + minutes * 60000);
      return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
    }
  }
  const date = new Date(iso);
  const next = new Date(date.getTime() + minutes * 60000);
  const offset = next.getTimezoneOffset();
  const local = new Date(next.getTime() - offset * 60000);
  return local.toISOString().slice(0, 19);
}
const TIMEPOINT_SCAN_DURATION_MINUTES = 10;
function resolveTimepointScanEnd(startTime, endTime) {
  if (endTime) return endTime;
  if (startTime) return addMinutes(startTime, TIMEPOINT_SCAN_DURATION_MINUTES);
  return null;
}
function resolveCentrifugeStartTime(activity, sample) {
  return sample?.centrifugationStart
    ?? sample?.scanStartTime
    ?? activity?.scanStartTime
    ?? null;
}
function resolveCentrifugeEndTime(activity, sample) {
  const startTime = resolveCentrifugeStartTime(activity, sample);
  return sample?.centrifugationEnd
    ?? sample?.scanEndTime
    ?? activity?.scanEndTime
    ?? (startTime ? addMinutes(startTime, TIMEPOINT_SCAN_DURATION_MINUTES) : null);
}
function usesCentrifugeWorkflowStart(sample) {
  return isCentrifugeTimingActive(sample);
}
function isCentrifugeTimingActive(sample) {
  return !!sample?.centrifugationStart || ["Centrifuging", "Ready For Aliquot"].includes(sample?.status);
}
function resolveActivitySample(samples, activity) {
  if (!activity || !samples?.length) return null;
  return samples.find(
    (sample) => sample.activityId === activity.id
      || (activity.sampleId && sample.id === activity.sampleId)
      || (activity.barcode && sample.barcode
        && String(activity.barcode).toUpperCase() === String(sample.barcode).toUpperCase())
  ) ?? null;
}
function applyLinkedStartEndTimes(state, sample, startTime, endTime, { syncCentrifuge = isCentrifugeTimingActive(sample) } = {}) {
  const activity = sample.activityId
    ? state.activities.find((item) => item.id === sample.activityId)
    : state.activities.find(
      (item) => item.barcode?.toUpperCase() === sample.barcode?.toUpperCase()
    );
  return {
    ...state,
    samples: state.samples.map(
      (s) => s.id === sample.id
        ? {
          ...s,
          scanStartTime: startTime,
          scanEndTime: endTime,
          ...(syncCentrifuge ? { centrifugationStart: startTime, centrifugationEnd: endTime } : {})
        }
        : s
    ),
    activities: activity
      ? state.activities.map(
        (a) => a.id === activity.id ? { ...a, scanStartTime: startTime, scanEndTime: endTime } : a
      )
      : state.activities
  };
}
function resolveAliquotProjectId(state, activity, sample) {
  const subject = (state.subjects ?? []).find((item) => item.id === (activity?.subjectId ?? sample?.subjectId));
  return activity?.projectId ?? sample?.projectId ?? resolveSubjectProjectId(subject);
}

function resolveExpectedAliquotBarcodes(state, activity, sampleBarcode) {
  let barcodes = [];

  if (activity?.expectedAliquotBarcodes?.length) {
    const looksLegacy = activity.expectedAliquotBarcodes.some((code) => /^AL-PK/i.test(String(code)));
    if (!looksLegacy) {
      barcodes = [...activity.expectedAliquotBarcodes];
    }
  }

  if (!barcodes.length) {
    const fromRun = resolveAliquotBarcodesFromRun(state, activity);
    if (fromRun.length) barcodes = fromRun;
  }

  if (!barcodes.length) {
    const byActivityId = state.barcodes
      .filter((barcode) => barcode.type === "aliquot" && barcode.activityId === activity?.id)
      .map((barcode) => barcode.code);
    if (byActivityId.length) barcodes = byActivityId;
  }

  if (!barcodes.length) {
    const subjectNumber = activity?.subjectNumber ?? "";
    const timepoint = activity?.timepoint ?? "";
    if (subjectNumber && timepoint) {
      const byLabel = state.barcodes
        .filter((barcode) => {
          if (barcode.type !== "aliquot") return false;
          const label = String(barcode.label ?? "");
          return label.includes(subjectNumber) && label.includes(timepoint);
        })
        .map((barcode) => barcode.code)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (byLabel.length) barcodes = byLabel;
    }
  }

  if (!barcodes.length) {
    const projectId = resolveAliquotProjectId(state, activity);
    const configuredCount = getProjectAliquotsPerSeparation(state, projectId);
    barcodes = buildExpectedAliquotBarcodes(sampleBarcode, configuredCount);
  }

  const projectId = resolveAliquotProjectId(state, activity);
  return limitAliquotBarcodesForProject(state, projectId, barcodes);
}
function getSampleExpectedAliquotBarcodes(state, sample) {
  if (!sample) return [];
  const activity = sample.activityId
    ? state.activities.find((item) => item.id === sample.activityId)
    : state.activities.find((item) => item.barcode?.toUpperCase() === sample.barcode?.toUpperCase());
  const resolved = resolveExpectedAliquotBarcodes(state, activity, sample.barcode);
  const stored = sample.expectedAliquotBarcodes ?? [];
  const storedLooksLegacy = stored.some((code) => /^AL-PK/i.test(String(code)));
  const barcodes = storedLooksLegacy && resolved.some((code) => !/^AL-PK/i.test(String(code)))
    ? resolved
    : (stored.length ? stored : resolved);
  const projectId = resolveAliquotProjectId(state, activity, sample);
  return limitAliquotBarcodesForProject(state, projectId, barcodes);
}
function isSampleAliquotSeparationComplete(state, sample) {
  if (!sample) return false;
  if (isSampleAliquotCompleteStatus(sample.status)) return true;
  const expectedBarcodes = getSampleExpectedAliquotBarcodes(state, sample);
  const linkedCount = state.aliquots.filter(
    (aliquot) => aliquot.parentSampleId === sample.id && (aliquot.createdAt || aliquot.skippedAt)
  ).length;
  return expectedBarcodes.length > 0 && linkedCount >= expectedBarcodes.length;
}
function resolveAliquotParentSample(state, subjectId) {
  if (!subjectId) return null;
  if (state.pendingAliquotParentId) {
    const pending = state.samples.find((sample) => sample.id === state.pendingAliquotParentId);
    if (
      pending &&
      pending.subjectId === subjectId &&
      !isSampleAliquotSeparationComplete(state, pending) &&
      isAliquotParentStatus(pending.status)
    ) {
      return pending;
    }
  }
  return (
    state.samples.find(
      (sample) =>
        sample.subjectId === subjectId &&
        isAliquotParentStatus(sample.status) &&
        !isSampleAliquotSeparationComplete(state, sample)
    ) ?? null
  );
}
function clearStalePendingAliquotParent(state) {
  if (!state.pendingAliquotParentId) return state;
  const sample = state.samples.find((item) => item.id === state.pendingAliquotParentId);
  if (!sample || isSampleAliquotSeparationComplete(state, sample)) {
    return { ...state, pendingAliquotParentId: null };
  }
  return state;
}
function isActivityBefore(a, b) {
  const doseA = getDoseNumber(a.dose);
  const doseB = getDoseNumber(b.dose);
  if (doseA !== doseB) return doseA < doseB;
  return getTimepointIndex(a) < getTimepointIndex(b);
}
function findVisitDose(state, visitId) {
  const doseActivities = state.activities.filter(
    (a) => a.visitId === visitId && a.activity === "IMP Dose Administration"
  );
  return doseActivities.find((a) => a.status !== "Completed") ?? doseActivities[0];
}
function getOrderedVisitActivities(state, visitId) {
  return filterActivitiesBySchedule(
    state,
    state.activities.filter((a) => a.visitId === visitId)
  ).sort((a, b) => compareActivitiesBySchedule(state, a, b));
}
function detectWindowStatus(activity, actualTime) {
  if (activity.activity === "Pre-Dose Blood Collection") {
    return { status: "Completed", deviation: false, reason: null };
  }
  if (!activity.windowStart || !activity.windowEnd) {
    return { status: "Completed", deviation: false, reason: null };
  }
  const actual = new Date(actualTime).getTime();
  const start = new Date(activity.windowStart).getTime();
  const end = new Date(activity.windowEnd).getTime();
  if (actual < start || actual > end) {
    return {
      status: "Deviation",
      deviation: true,
      reason: actual < start ? "Collected before protocol window" : "Collected after protocol window"
    };
  }
  return { status: "Completed", deviation: false, reason: null };
}
function createDeviation(activity, reason, timestamp, source) {
  return {
    id: uid("dev"),
    activityId: activity.id,
    subjectNumber: activity.subjectNumber,
    visitLabel: activity.visitLabel,
    timepoint: activity.timepoint,
    description: reason,
    timestamp,
    resolved: false,
    source
  };
}
function getVisitDoseReferenceTime(visit) {
  return visit?.actualDoseTime ?? visit?.plannedDoseTime ?? null;
}
function nextScanPhase(state) {
  const activeVisitId = state.activeVisitId;
  if (!activeVisitId) return "Dose Setup";
  const nextActivity = getNextActivity(state, state.activeSubjectId ?? "", activeVisitId);
  if (nextActivity?.executionMethod === "pkBarcode") return "Scan Barcode";
  if (nextActivity?.activity === "IMP Dose Administration") return "Dose Setup";
  const visit = state.visits.find((v) => v.id === activeVisitId);
  if (!getVisitDoseReferenceTime(visit)) return "Dose Setup";
  const activeSamples = state.samples.filter((s) => s.visitId === activeVisitId);
  if (activeSamples.some((s) => s.status === "Awaiting Centrifugation" || s.status === "Collected")) {
    return "Centrifugation Start";
  }
  if (activeSamples.some((s) => s.status === "Centrifuging")) return "Centrifugation End";
  if (state.pendingAliquotParentId || activeSamples.some((s) => s.status === "Ready For Aliquot")) {
    return "Aliquot Creation";
  }
  return "Complete";
}
function refreshPhase(state, message) {
  const cleared = clearStalePendingAliquotParent({
    ...state,
    lastScanMessage: message ?? state.lastScanMessage,
  });
  return {
    ...cleared,
    scanPhase: nextScanPhase(cleared),
  };
}
function promoteNextReady(state, visitId) {
  const visit = state.visits.find(v => v.id === visitId);
  if (!visit) return state;

  const subjectVisitIds = new Set(state.visits.filter(v => v.subjectId === visit.subjectId).map(v => v.id));
  const ordered = filterActivitiesBySchedule(state, state.activities.filter((a) => subjectVisitIds.has(a.visitId))).sort(
    (a, b) => compareActivitiesBySchedule(state, a, b)
  );

  const next = ordered.find((a) => a.status === "Upcoming" || a.status === "Pending");
  if (!next) return state;
  return {
    ...state,
    activities: state.activities.map((a) => a.id === next.id ? { ...a, status: "Ready" } : a)
  };
}
function visitHasOpenActivities(state, visitId) {
  return getOrderedVisitActivities(state, visitId).some(
    (activity) => !isTerminalActivityStatus(activity.status)
  );
}
function updateSubjectVisitStatus(state, activity) {
  const visitActivities = state.activities.filter((a) => a.visitId === activity.visitId);
  const allTerminal = visitActivities.every(
    (a) => isTerminalActivityStatus(a.status)
  );
  const anyStarted = visitActivities.some(
    (a) => ["Ready", "Completed", "Skipped", "Deviation"].includes(a.status)
  );
  return {
    ...state,
    visits: state.visits.map(
      (v) => v.id === activity.visitId ? { ...v, status: allTerminal ? "Completed" : anyStarted ? "In Progress" : v.status } : v
    ),
    subjects: state.subjects.map(
      (s) => s.id === activity.subjectId ? { ...s, status: allTerminal ? "Completed" : anyStarted ? "In Progress" : s.status } : s
    )
  };
}
function completePkActivity(state, activity, actualTime = nowIso(), force = false, method, remarkText) {
  // Completed stays locked. Skipped may be collected again when force=true (Actual Time unskip).
  if (activity.status === "Completed") return state;
  if (activity.status === "Skipped" && !force) return state;
  if (!force && !isActivityReadyStatus(activity.status)) {
    return refreshPhase(state, `${activity.timepoint} is not ready. Complete prior steps first.`);
  }
  const windowStatus = detectWindowStatus(activity, actualTime);
  const sampleId = activity.sampleId ?? uid("smp");
  const sampleBarcode = activity.barcode ?? `PK-${sampleId}`;
  const expectedAliquotBarcodes = resolveExpectedAliquotBarcodes(state, activity, sampleBarcode);
  // Canonical store values: scan UI mode → "pkBarcode"; manual edit/entry → "manual".
  const normalizedMethod = (() => {
    const raw = String(method ?? "").trim();
    if (!raw) return activity.executionMethod;
    if (raw === "scan" || raw === "pkBarcode") return "pkBarcode";
    if (raw === "aliquotBarcode" || raw === "locationBarcode") return raw;
    return "manual";
  })();
  const sample = {
    id: sampleId,
    barcode: sampleBarcode,
    subjectId: activity.subjectId,
    subjectNumber: activity.subjectNumber,
    visitId: activity.visitId,
    activityId: activity.id,
    timepoint: activity.timepoint,
    dose: activity.dose,
    status: "Awaiting Centrifugation",
    collectedAt: actualTime,
    centrifugationStart: null,
    centrifugationEnd: null,
    expectedAliquots: expectedAliquotBarcodes.length,
    expectedAliquotBarcodes,
    storageLocation: null
  };
  const newAliquots = expectedAliquotBarcodes.filter((barcode) => !state.aliquots.some((a) => a.barcode.toUpperCase() === barcode.toUpperCase())).map((barcode) => ({
    id: uid("alq"),
    barcode,
    parentSampleId: sampleId,
    parentBarcode: sampleBarcode,
    subjectId: activity.subjectId,
    subjectNumber: activity.subjectNumber,
    createdAt: null,
    storageLocation: null
  }));
  const newAliquotBarcodes = newAliquots.filter((aliquot) => !state.barcodes.some(
    (barcode) => barcode.code.toUpperCase() === aliquot.barcode.toUpperCase()
  )).map((aliquot) => ({
    code: aliquot.barcode,
    type: "aliquot",
    aliquotId: aliquot.id,
    sampleId,
    label: `${activity.subjectNumber} ${activity.timepoint} aliquot ${aliquot.barcode}`
  }));

  let next = {
    ...state,
    activities: state.activities.map(
      (a) => a.id === activity.id ? {
        ...a,
        actualTime,
        status: windowStatus.status,
        deviation: windowStatus.deviation,
        deviationReason: windowStatus.reason,
        sampleId,
        executionMethod: normalizedMethod ?? a.executionMethod,
        remarks: remarkText != null && String(remarkText).trim()
          ? String(remarkText).trim()
          : a.remarks
      } : a
    ),
    samples: state.samples.some((s) => s.id === sampleId) ? state.samples.map((s) => s.id === sampleId ? { ...s, ...sample } : s) : [...state.samples, sample],
    aliquots: [...state.aliquots, ...newAliquots],
    barcodes: [...state.barcodes, ...newAliquotBarcodes]
  };
  if (windowStatus.deviation && windowStatus.reason) {
    next = {
      ...next,
      deviations: [...next.deviations, createDeviation(activity, windowStatus.reason, actualTime, "Auto")]
    };
  }
  next = promoteNextReady(next, activity.visitId);
  next = updateSubjectVisitStatus(next, activity);
  return refreshPhase(next, `${activity.timepoint} collected. Scan the same PK tube to start centrifugation.`);
}
function updatePkScheduleFromDose(state, visit, referenceTime, doseLabel = null) {
  // Prefer the edited dose's label (Dose 2 etc.). Fall back to visit's first dose only.
  const resolvedDoseLabel =
    doseLabel
    || String(visit.doseLabel ?? "").split(",")[0]?.trim()
    || null;
  const activities = state.activities.map((activity) => {
    if (activity.visitId !== visit.id) return activity;
    if (resolvedDoseLabel && activity.dose && activity.dose !== resolvedDoseLabel) return activity;
    if (activity.activity === "IMP Dose Administration") {
      const keepCurrentStatus = isActivityReadyStatus(activity.status);
      return {
        ...activity,
        scheduledTime: referenceTime,
        status: activity.actualTime ? "Completed" : keepCurrentStatus ? activity.status : "Upcoming"
      };
    }
    if (activity.pkOffsetMinutes === null) return activity;
    const scheduled = addMinutes(referenceTime, activity.pkOffsetMinutes);
    const hasCollectionWindow = activity.activity !== "Pre-Dose Blood Collection";
    const isTerminal = isTerminalActivityStatus(activity.status);
    const isActionable = isActivityActionableStatus(activity.status);
    return {
      ...activity,
      scheduledTime: scheduled,
      windowStart: hasCollectionWindow ? addMinutes(scheduled, -3) : null,
      windowEnd: hasCollectionWindow ? addMinutes(scheduled, 3) : null,
      status: isTerminal || isActionable ? activity.status : activity.activity === "Pre-Dose Blood Collection" ? "Ready" : "Upcoming"
    };
  });
  return {
    ...state,
    visits: state.visits.map(
      (v) => v.id === visit.id ? { ...v, status: "In Progress" } : v
    ),
    activities
  };
}
function isBloodCollectionActivity(activity) {
  return activity?.executionMethod === "pkBarcode"
    || activity?.activity === "Pre-Dose Blood Collection"
    || activity?.activity === "Post-Dose Blood Collection";
}
function isBloodCollectionCollected(state, activity) {
  if (!activity) return false;
  if (activity.actualTime) return true;
  // Skipped is terminal but not a collection — must not lock dose Actual Time
  // (otherwise skipping dose + cascade hides the dose edit icon).
  if (String(activity.status ?? "").trim() === "Skipped") return false;
  if (isTerminalActivityStatus(activity.status)) return true;
  const sample = state.samples.find(
    (item) => item.activityId === activity.id || (activity.sampleId && item.id === activity.sampleId)
  );
  if (!sample) return false;
  return isSampleWorkflowStatus(sample.status);
}
function isDoseRecordEditLocked(state, visitId, doseActivityId = null) {
  if (!visitId) return false;
  const ordered = getOrderedVisitActivities(state, visitId);
  const doseIndex = doseActivityId
    ? ordered.findIndex((activity) => activity.id === doseActivityId)
    : ordered.findIndex((activity) => activity.activity === "IMP Dose Administration");
  if (doseIndex === -1) return false;
  // Lock once any post-dose blood collection is recorded. Skipped-only rows do not lock
  // (so skipping +0.500 must not leave dose editable after +1.000 is collected).
  return ordered.slice(doseIndex + 1).some(
    (activity) => isBloodCollectionActivity(activity) && isBloodCollectionCollected(state, activity)
  );
}
function isDoseScheduleEditLocked(state, subjectId, visitId) {
  if (!visitId) return false;
  return isDoseRecordEditLocked(state, visitId);
}
function setDoseDateTime(state, visitId, doseTime, changeReason, options = {}) {
  const visit = state.visits.find((v) => v.id === visitId);
  if (!visit) return refreshPhase(state, "Visit not found.");

  // Prefer the exact dose row from the modal (Dose 2 etc.). findVisitDose alone
  // always prefers the first/non-completed dose and silently edits the wrong one.
  const doseActivity = options.activityId
    ? state.activities.find(
        (a) =>
          a.id === options.activityId
          && a.visitId === visitId
          && a.activity === "IMP Dose Administration"
      )
    : findVisitDose(state, visitId);
  if (!doseActivity) return refreshPhase(state, "Dose activity not found.");

  const isEditing = !!doseActivity.actualTime;

  if (isEditing && isDoseRecordEditLocked(state, visitId, doseActivity.id)) {
    return refreshPhase(state, "Dose time cannot be edited after the next blood collection.");
  }

  const doseLabel = doseActivity.dose || null;
  let next = updatePkScheduleFromDose(state, visit, doseTime, doseLabel);

  const firstVisitDoseLabel = String(visit.doseLabel ?? "").split(",")[0]?.trim();
  const updatesVisitDoseClock = !firstVisitDoseLabel || !doseLabel || doseLabel === firstVisitDoseLabel;

  next = {
    ...next,
    visits: next.visits.map((v) => {
      if (v.id !== visitId) return v;
      if (!updatesVisitDoseClock) {
        return { ...v, doseScheduleConfirmed: true, status: "In Progress" };
      }
      return {
        ...v,
        plannedDoseTime: doseTime,
        actualDoseTime: doseTime,
        doseScheduleConfirmed: true,
        status: "In Progress",
      };
    }),
    activities: next.activities.map((a) =>
      a.id === doseActivity.id
        ? {
            ...a,
            scheduledTime: doseTime,
            actualTime: doseTime,
            status: "Completed",
            executionMethod: "manual",
          }
        : a
    ),
  };

  if (isEditing) {
    return refreshPhase(next, "Dose time saved. Scheduled and actual times updated.");
  }

  next = promoteNextReady(next, visitId);
  return refreshPhase(next, "Dose time set. Next blood collection is ready — scan when scheduled.");
}
function completeDoseNow(state, visitId) {
  const activity = findVisitDose(state, visitId);
  if (!activity) return refreshPhase(state, "Dose activity not found.");
  return completeDoseAdministrationAt(state, activity.id, nowIso());
}
function completePkCollectionAt(state, activityId, actualTime, method, remarkText) {
  const activity = state.activities.find((a) => a.id === activityId);
  if (!activity) return refreshPhase(state, "PK activity not found.");
  return completePkActivity(state, activity, actualTime, false, method, remarkText);
}
function getPriorIncompleteActivityInVisit(state, activity) {
  const ordered = getOrderedVisitActivities(state, activity.visitId);
  const activityIndex = ordered.findIndex((a) => a.id === activity.id);
  if (activityIndex <= 0) return null;

  return ordered.slice(0, activityIndex).find(
    (a) =>
      (a.status === "Ready" || a.status === "Missed") &&
      !a.actualTime &&
      !isTerminalActivityStatus(a.status)
  ) ?? null;
}

function completeDoseAdministrationAt(state, activityId, actualTime, options = {}) {
  const activity = state.activities.find((a) => a.id === activityId);
  if (!activity || activity.activity !== "IMP Dose Administration") {
    return refreshPhase(state, "Dose administration activity not found.");
  }
  if (!options.manualEntry && !activity.actualTime) {
    const blocking = getPriorIncompleteActivityInVisit(state, activity);
    if (blocking) {
      return refreshPhase(state, `Complete ${blocking.timepoint} before ${activity.timepoint}.`);
    }
  }
  return setDoseDateTime(state, activity.visitId, actualTime, options.changeReason, {
    activityId: activity.id,
  });
}
function setActivityActualTime(state, activityId, actualTime, changeReason) {
  const activity = state.activities.find((a) => a.id === activityId);
  if (!activity) return refreshPhase(state, "Activity not found.");

  if (activity.activity === "IMP Dose Administration") {
    if (activity.actualTime && isDoseRecordEditLocked(state, activity.visitId, activity.id)) {
      return refreshPhase(state, "Dose time cannot be edited after the next blood collection.");
    }
    const next = completeDoseAdministrationAt(state, activityId, actualTime, {
      manualEntry: true,
      changeReason,
    });
    return resolveReviewQueryOnSave(next, activityId, "actual", changeReason);
  }
  if (!activity.sampleId || !state.samples.some((sample) => sample.id === activity.sampleId)) {
    if (activity.status === "Skipped" && activity.activity !== "IMP Dose Administration") {
      const isPreDose = activity.activity === "Pre-Dose Blood Collection";
      const doseRow = state.activities.find(
        (item) =>
          item.visitId === activity.visitId
          && item.activity === "IMP Dose Administration"
          && (
            !activity.dose
            || item.dose === activity.dose
            || String(item.dose ?? "") === String(activity.dose ?? "")
          )
      );
      if (
        !isPreDose
        && doseRow
        && (!doseRow.actualTime || String(doseRow.status ?? "").trim() === "Skipped")
      ) {
        return refreshPhase(
          state,
          `Set ${doseRow.timepoint || "dose"} time before collecting skipped ${activity.timepoint}.`
        );
      }
      const unskipRemark = String(changeReason ?? "").trim();
      if (!unskipRemark) {
        return refreshPhase(state, "Remark is required before collecting a skipped timepoint.");
      }
      const next = completePkActivity(state, activity, actualTime, true, "manual", unskipRemark);
      return resolveReviewQueryOnSave(next, activityId, "actual", changeReason);
    }
    const next = completePkActivity(state, activity, actualTime, true, "manual");
    return resolveReviewQueryOnSave(next, activityId, "actual", changeReason);
  }
  const windowStatus = detectWindowStatus(activity, actualTime);
  // When out-of-window, sync the entered remark into Deviation / Remark column.
  // Without deviation, changeReason stays ActualTime audit-only (do not overwrite remarks).
  const trimmedReason = String(changeReason ?? "").trim();
  const hasDeviationRecord = windowStatus.deviation && windowStatus.reason
    ? state.deviations.some((deviation) => deviation.activityId === activityId && deviation.description === windowStatus.reason)
    : false;
  const next = {
    ...state,
    activities: state.activities.map(
      (a) => {
        if (a.id !== activityId) return a;
        return {
          ...a,
          actualTime,
          status: windowStatus.status,
          deviation: windowStatus.deviation,
          deviationReason: windowStatus.reason,
          remarks: windowStatus.deviation && trimmedReason
            ? trimmedReason
            : (a.remarks ?? null),
          executionMethod: a.executionMethod
        };
      }
    ),
    samples: state.samples.map(
      (sample) => sample.id === activity.sampleId ? { ...sample, collectedAt: actualTime } : sample
    ),
    deviations: windowStatus.deviation
      ? windowStatus.deviation && windowStatus.reason && !hasDeviationRecord
        ? [...state.deviations, createDeviation(activity, windowStatus.reason, actualTime, "Manual")]
        : state.deviations
      : state.deviations.filter((deviation) => deviation.activityId !== activityId)
  };
  const resolved = resolveReviewQueryOnSave(
    updateSubjectVisitStatus(next, activity),
    activityId,
    "actual",
    changeReason
  );
  return refreshPhase(resolved, "Actual time updated.");
}
function recordTimepointScanStart(state, sampleId, scanTime = nowIso()) {
  const sample = state.samples.find((s) => s.id === sampleId);
  if (!sample || sample.scanStartTime) return state;
  const activity = sample.activityId ? state.activities.find((a) => a.id === sample.activityId) : void 0;
  const scanEndTime = addMinutes(scanTime, TIMEPOINT_SCAN_DURATION_MINUTES);
  const next = {
    ...state,
    samples: state.samples.map(
      (s) => s.id === sampleId ? { ...s, scanStartTime: scanTime, scanEndTime } : s
    ),
    activities: activity
      ? state.activities.map((a) => a.id === activity.id ? { ...a, scanStartTime: scanTime, scanEndTime } : a)
      : state.activities
  };
  return refreshPhase(next, `Start time recorded for ${sample.barcode}. End time auto-set to ${formatDisplayTime(scanEndTime)}.`);
}
function recordTimepointScanEnd(state, sampleId, scanTime = nowIso()) {
  const sample = state.samples.find((s) => s.id === sampleId);
  if (!sample || !sample.scanStartTime || sample.scanEndTime) return state;
  const activity = sample.activityId ? state.activities.find((a) => a.id === sample.activityId) : void 0;
  const next = {
    ...state,
    samples: state.samples.map(
      (s) => s.id === sampleId ? { ...s, scanEndTime: scanTime } : s
    ),
    activities: activity
      ? state.activities.map((a) => a.id === activity.id ? { ...a, scanEndTime: scanTime } : a)
      : state.activities
  };
  return refreshPhase(next, `End time recorded for ${sample.barcode}.`);
}
function applyTimepointBarcodeScanTimings(state, pkCode, scanTime = nowIso()) {
  const code = String(pkCode ?? "").trim().toUpperCase();
  const sample = state.samples.find((s) => s.barcode.toUpperCase() === code);
  if (!sample) return state;
  if (!sample.scanStartTime) return recordTimepointScanStart(state, sample.id, scanTime);
  if (!sample.scanEndTime) return recordTimepointScanEnd(state, sample.id, scanTime);
  return state;
}
function editTimepointScanStart(state, sampleId, newStartTime, changeReason) {
  const sample = state.samples.find((s) => s.id === sampleId);
  if (!sample) return refreshPhase(state, "PK sample not found.");
  const activity = sample.activityId ? state.activities.find((a) => a.id === sample.activityId) : void 0;
  const newEndTime = addMinutes(newStartTime, TIMEPOINT_SCAN_DURATION_MINUTES);
  const synced = applyLinkedStartEndTimes(state, sample, newStartTime, newEndTime);
  const next = {
    ...synced
  };
  const resolved = activity?.id
    ? resolveReviewQueryOnSave(next, activity.id, "scanStart", changeReason)
    : next;
  return refreshPhase(resolved, `Start time updated for ${sample.barcode}. End time auto-set to ${formatDisplayTime(newEndTime)}.`);
}
function editTimepointScanEnd(state, sampleId, newEndTime, changeReason) {
  const sample = state.samples.find((s) => s.id === sampleId);
  if (!sample) return refreshPhase(state, "PK sample not found.");
  const activity = sample.activityId ? state.activities.find((a) => a.id === sample.activityId) : void 0;
  const newStartTime = addMinutes(newEndTime, -TIMEPOINT_SCAN_DURATION_MINUTES);
  const synced = applyLinkedStartEndTimes(state, sample, newStartTime, newEndTime, {
    syncCentrifuge: isCentrifugeTimingActive(sample)
  });
  const next = {
    ...synced
  };
  return refreshPhase(next, `End time updated for ${sample.barcode}. Start time auto-set to ${formatDisplayTime(newStartTime)}.`);
}
function editCentrifugeEnd(state, sampleId, newEndTime, changeReason) {
  const sample = state.samples.find((s) => s.id === sampleId);
  if (!sample) return refreshPhase(state, "PK sample not found.");
  const activity = sample.activityId ? state.activities.find((a) => a.id === sample.activityId) : void 0;
  const newStartTime = addMinutes(newEndTime, -TIMEPOINT_SCAN_DURATION_MINUTES);
  const synced = applyLinkedStartEndTimes(state, sample, newStartTime, newEndTime, { syncCentrifuge: true });
  const next = {
    ...synced
  };
  return refreshPhase(next, `Centrifugation end time updated for ${sample.barcode}. Start time auto-set to ${formatDisplayTime(newStartTime)}.`);
}
function startCentrifugation(state, sampleId, actualTime = nowIso()) {
  const sample = state.samples.find((s) => s.id === sampleId);
  if (!sample) return refreshPhase(state, "PK sample not found.");
  const plannedEndTime = addMinutes(actualTime, TIMEPOINT_SCAN_DURATION_MINUTES);
  const synced = applyLinkedStartEndTimes(state, sample, actualTime, plannedEndTime, { syncCentrifuge: true });
  const next = {
    ...synced,
    samples: synced.samples.map(
      (s) => s.id === sample.id ? { ...s, status: "Centrifuging" } : s
    )
  };
  return refreshPhase(next, `Centrifugation started for ${sample.barcode}. End time auto-set to ${formatDisplayTime(plannedEndTime)}.`);
}
function editCentrifugeStart(state, sampleId, newStartTime, changeReason) {
  const sample = state.samples.find((s) => s.id === sampleId);
  if (!sample) return refreshPhase(state, "PK sample not found.");
  const activity = sample.activityId ? state.activities.find((a) => a.id === sample.activityId) : void 0;
  const plannedEndTime = addMinutes(newStartTime, TIMEPOINT_SCAN_DURATION_MINUTES);
  const synced = applyLinkedStartEndTimes(state, sample, newStartTime, plannedEndTime, { syncCentrifuge: true });
  const next = {
    ...synced
  };
  const resolved = activity?.id
    ? resolveReviewQueryOnSave(next, activity.id, "scanStart", changeReason)
    : next;
  return refreshPhase(resolved, `Centrifugation start time updated for ${sample.barcode}. End time auto-set to ${formatDisplayTime(plannedEndTime)}.`);
}
function endCentrifugation(state, sampleId, actualTime = nowIso()) {
  const sample = state.samples.find((s) => s.id === sampleId);
  if (!sample) return refreshPhase(state, "PK sample not found.");
  const centrifugationEnd = sample.centrifugationEnd ?? actualTime;
  const next = {
    ...state,
    samples: state.samples.map(
      (s) => s.id === sample.id ? { ...s, status: "Ready For Aliquot", centrifugationEnd } : s
    ),
    pendingAliquotParentId: sample.id
  };
  return refreshPhase(next, `Centrifugation complete for ${sample.barcode}. Scan the PK tube to divide aliquots.`);
}
function activateAliquotParent(state, sampleId) {
  const sample = state.samples.find((s) => s.id === sampleId);
  if (!sample) return refreshPhase(state, "PK sample not found.");
  if (isSampleAliquotSeparationComplete(state, sample)) {
    return refreshPhase(state, `${sample.barcode} is already separated.`);
  }
  return refreshPhase({ ...state, pendingAliquotParentId: sample.id }, `Active parent set to ${sample.barcode}. Scan aliquot tubes.`);
}
function hasLinkedGeneratedSubjectBarcode(state, subjectId) {
  const subject = state.subjects.find((s) => s.id === subjectId);
  if (subject?.generated) return true;
  return state.barcodes.some(
    (barcode) =>
      barcode.type === "subject" &&
      !!barcode.generatedRunId &&
      (barcode.subjectId === subjectId || barcode.pendingSubjectId === subjectId) &&
      !barcode.unlinked
  );
}
function processSubjectBarcode(state, code) {
  const subjectDef = findSubjectBarcodeForProject(state, code);
  const subject = findSubjectForBarcodeCode(state, code);
  if (!subject) {
    return {
      state: refreshPhase(state, unknownParticipantBarcodeMessage(code)),
      result: { success: false, message: unknownParticipantBarcodeMessage(code) }
    };
  }
  const activeVisit = state.activeSubjectId === subject.id && state.activeVisitId ? state.visits.find((v) => v.id === state.activeVisitId) : void 0;
  const allSubjectVisits = state.visits.filter((v) => v.subjectId === subject.id);
  const generatedVisits = allSubjectVisits.filter((v) => v.generated);
  const subjectVisits =
    (subject.linkedGeneratedBarcode || hasLinkedGeneratedSubjectBarcode(state, subject.id)) && generatedVisits.length
      ? generatedVisits
      : allSubjectVisits;
  const visit = subjectVisits.some((v) => v.id === activeVisit?.id)
    ? activeVisit
    : subjectVisits.find((v) => v.status !== "Completed") ?? subjectVisits[0];
  const next = {
    ...state,
    activeSubjectId: subject.id,
    activeVisitId: visit?.id ?? state.activeVisitId
  };
  return {
    state: refreshPhase(next, participantSelectedMessage(formatParticipantDropdownLabel(subject))),
    result: { success: true, message: `${formatParticipantDropdownLabel(subject)} selected` }
  };
}
function getPkScanTarget(state, rawCode) {
  const code = rawCode.trim().toUpperCase();
  const defs = filterPkBarcodesForProject(
    state,
    state.barcodes.filter((barcode) => barcode.code.toUpperCase() === code && barcode.type === "pk")
  );
  const activeVisitDef = defs.find((b) => {
    const activity2 = b.activityId ? state.activities.find((a) => a.id === b.activityId) : void 0;
    const sample2 = b.sampleId ? state.samples.find((s) => s.id === b.sampleId) : void 0;
    return activity2?.visitId === state.activeVisitId || sample2?.visitId === state.activeVisitId;
  });
  const activeSubjectDef = defs.find((b) => {
    const activity2 = b.activityId ? state.activities.find((a) => a.id === b.activityId) : void 0;
    const sample2 = b.sampleId ? state.samples.find((s) => s.id === b.sampleId) : void 0;
    return activity2?.subjectId === state.activeSubjectId || sample2?.subjectId === state.activeSubjectId;
  });
  const def = activeVisitDef ?? activeSubjectDef ?? defs.find((barcode) => barcode.sampleId) ?? defs[0];
  const activity = def?.activityId ? state.activities.find((item) => item.id === def.activityId) : undefined;
  const sampleFromDef = def?.sampleId ? state.samples.find((sample) => sample.id === def.sampleId) : undefined;
  const sampleFromActivity = activity?.sampleId
    ? state.samples.find((sample) => sample.id === activity.sampleId)
    : undefined;
  const sampleByBarcode = state.samples.find((sample) => sample.barcode.toUpperCase() === code);
  const sample = sampleFromDef ?? sampleFromActivity ?? sampleByBarcode;
  return sample ?? activity;
}
function resolvePkScanIntent(state, rawCode) {
  const code = rawCode.trim().toUpperCase();
  const matchingDefs = filterPkBarcodesForProject(
    state,
    state.barcodes.filter((b) => b.code.toUpperCase() === code && b.type === "pk")
  );
  const activeVisitDef = matchingDefs.find((b) => {
    const activity2 = b.activityId ? state.activities.find((a) => a.id === b.activityId) : void 0;
    const sample2 = b.sampleId ? state.samples.find((s) => s.id === b.sampleId) : void 0;
    return activity2?.visitId === state.activeVisitId || sample2?.visitId === state.activeVisitId;
  });
  const activeSubjectDef = matchingDefs.find((b) => {
    const activity2 = b.activityId ? state.activities.find((a) => a.id === b.activityId) : void 0;
    const sample2 = b.sampleId ? state.samples.find((s) => s.id === b.sampleId) : void 0;
    return activity2?.subjectId === state.activeSubjectId || sample2?.subjectId === state.activeSubjectId;
  });
  const def = activeVisitDef ?? activeSubjectDef ?? matchingDefs[0];
  if (!def) {
    return { type: "error", message: `Unknown PK barcode: ${code}` };
  }
  const activity = def.activityId ? state.activities.find((a) => a.id === def.activityId) : void 0;
  const sampleFromDef = def.sampleId ? state.samples.find((s) => s.id === def.sampleId) : void 0;
  const sampleFromActivity = activity?.sampleId ? state.samples.find((s) => s.id === activity.sampleId) : void 0;
  const sampleByBarcode = state.samples.find((s) => s.barcode.toUpperCase() === code && s.visitId === state.activeVisitId) ?? state.samples.find((s) => s.barcode.toUpperCase() === code);
  const sample = sampleFromDef ?? sampleFromActivity ?? sampleByBarcode;
  const ownerSubjectId = activity?.subjectId ?? sample?.subjectId;
  const ownerSubject = ownerSubjectId ? state.subjects.find((s) => s.id === ownerSubjectId) : void 0;
  if (ownerSubjectId && state.activeSubjectId && ownerSubjectId !== state.activeSubjectId) {
    return {
      type: "error",
      message: wrongParticipantScanMessage(code, ownerSubject ? formatParticipantDropdownLabel(ownerSubject) : UI_LABELS.anotherParticipant),
    };
  }
  if (activity && !activity.actualTime) {
    if (activity.status === "Skipped") {
      return { type: "error", message: `${activity.timepoint} is skipped. This timepoint cannot be collected now.` };
    }
    const allVisitIds = getSubjectVisitIds(state, activity.subjectId).sort((a, b) => compareSubjectVisitOrder(state, a, b));
    const nextActivity = getNextActivity(state, activity.subjectId, allVisitIds[0] || activity.visitId);
    if (nextActivity && nextActivity.id !== activity.id) {
      let isDosePending = false;
      const pendingActivities = [];
      for (const vId of allVisitIds) {
        const visitActs = getOrderedVisitActivities(state, vId);
        for (const a of visitActs) {
          if (a.id === activity.id) break;
          if (!a.actualTime && !isTerminalActivityStatus(a.status)) {
            if (a.activity === "IMP Dose Administration") {
              isDosePending = true;
            } else if (a.executionMethod === "pkBarcode") {
              pendingActivities.push(a);
            }
          }
        }
        if (visitActs.some((a) => a.id === activity.id)) break;
      }

      if (isDosePending) {
        return { type: "error", message: `Dose time is not set. Please administer dose before scanning ${activity.timepoint}.` };
      }
      if (pendingActivities.length) {
        return {
          type: "blockedByPending",
          message: `${activity.timepoint} is pending. Complete ${nextActivity.timepoint} first.`,
          activity,
          code,
          pendingActivities
        };
      }
      return { type: "error", message: `${activity.timepoint} is pending. Complete ${nextActivity.timepoint} first.` };
    }
    if (!isActivityReadyStatus(activity.status)) {
      return { type: "error", message: `${activity.timepoint} is pending. Complete the current ready activity first.` };
    }
    return { type: "collect", activity, code };
  }
  if (!sample) {
    return { type: "error", message: `${code} is not linked to a collected PK sample yet.` };
  }
  if (sample.status === "Collected" || sample.status === "Awaiting Centrifugation") {
    return { type: "startCentrifugation", sample, code };
  }
  if (sample.status === "Centrifuging") {
    return { type: "endCentrifugation", sample, code };
  }
  if (sample.status === "Ready For Aliquot") {
    return { type: "aliquot", sample, code };
  }
  if (sample.status === "Aliquoted" || sample.status === "Stored") {
    return { type: "error", message: `${sample.barcode} is already separated.` };
  }
  return { type: "error", message: `${sample.barcode} is already stored or not eligible.` };
}
function processPkBarcode(state, code) {
  const intent = resolvePkScanIntent(state, code);
  switch (intent.type) {
    case "collect": {
      const next = completePkActivity(state, intent.activity);
      return { state: next, result: { success: true, message: next.lastScanMessage ?? "PK collected", activityId: intent.activity.id } };
    }
    case "startCentrifugation": {
      const timedState = applyTimepointBarcodeScanTimings(state, intent.code);
      const next = startCentrifugation(timedState, intent.sample.id);
      return { state: next, result: { success: true, message: next.lastScanMessage ?? "Centrifugation started" } };
    }
    case "endCentrifugation": {
      const timedState = applyTimepointBarcodeScanTimings(state, intent.code);
      const next = endCentrifugation(timedState, intent.sample.id);
      return { state: next, result: { success: true, message: next.lastScanMessage ?? "Centrifugation complete" } };
    }
    case "aliquot": {
      const next = activateAliquotParent(state, intent.sample.id);
      return { state: next, result: { success: true, message: next.lastScanMessage ?? "Active aliquot parent set" } };
    }
    case "error":
      return { state: refreshPhase(state, intent.message), result: { success: false, message: intent.message } };
    case "blockedByPending":
      return { state: refreshPhase(state, intent.message), result: { success: false, message: intent.message } };
  }
}
function linkAliquotToParent(state, parentSampleId, rawCode) {
  const code = rawCode.trim().toUpperCase();
  const def = state.barcodes.find((b) => b.code.toUpperCase() === code && b.type === "aliquot");
  const parent = state.samples.find((s) => s.id === parentSampleId);
  if (!parent) {
    return refreshPhase(state, "Scan a centrifuged PK parent sample before aliquot tubes.");
  }
  const expectedAliquotBarcodes = getSampleExpectedAliquotBarcodes(state, parent);
  if (!expectedAliquotBarcodes.some((expected) => expected.toUpperCase() === code)) {
    return refreshPhase(
      state,
      `Wrong aliquot. ${code} does not belong to ${parent.barcode}. Scan one of: ${expectedAliquotBarcodes.join(", ")}.`
    );
  }
  const expectedIndex = expectedAliquotBarcodes.findIndex((expected) => expected.toUpperCase() === code);
  let aliquot = def?.aliquotId
    ? state.aliquots.find((a) => a.id === def.aliquotId)
    : state.aliquots.find((a) => a.barcode.toUpperCase() === code);
  if (!aliquot) {
    const parentAliquots = state.aliquots.filter((a) => a.parentSampleId === parent.id);
    aliquot = parentAliquots[expectedIndex] ?? parentAliquots.find((a) => !a.createdAt && !a.skippedAt);
  }
  if (!aliquot) {
    return refreshPhase(state, `Unknown aliquot barcode: ${code}`);
  }
  if (aliquot.createdAt && aliquot.parentSampleId !== parent.id) {
    return refreshPhase(state, `${aliquot.barcode} is already linked to ${aliquot.parentBarcode ?? "another PK sample"}.`);
  }
  const updatedAliquots = state.aliquots.map(
    (a) => a.id === aliquot.id ? {
      ...a,
      barcode: code,
      parentSampleId: parent.id,
      parentBarcode: parent.barcode,
      subjectId: parent.subjectId,
      subjectNumber: parent.subjectNumber,
      createdAt: a.createdAt ?? nowIso()
    } : a
  );
  const linkedCount = updatedAliquots.filter((a) => a.parentSampleId === parent.id && a.createdAt).length;
  const completedOrSkippedCount = updatedAliquots.filter((a) => a.parentSampleId === parent.id && (a.createdAt || a.skippedAt)).length;
  const expectedCount = expectedAliquotBarcodes.length;
  const parentComplete = completedOrSkippedCount >= expectedCount;
  const next = {
    ...state,
    aliquots: updatedAliquots,
    samples: state.samples.map(
      (s) => s.id === parent.id && parentComplete ? { ...s, status: "Aliquoted" } : s
    ),
    pendingAliquotParentId: parentComplete ? null : parent.id,
    pendingStorageAliquotId: null
  };
  const message = parentComplete ? `${aliquot.barcode} linked. Parent complete. Continue with the next PK or parent sample.` : `${aliquot.barcode} linked to ${parent.barcode} (${linkedCount}/${expectedCount}).`;
  return refreshPhase(next, message);
}
function skipAliquot(state, aliquotId, reason) {
  const aliquot = state.aliquots.find((a) => a.id === aliquotId);
  if (!aliquot) return refreshPhase(state, "Aliquot not found.");
  const timestamp = nowIso();
  const parent = aliquot.parentSampleId ? state.samples.find((sample) => sample.id === aliquot.parentSampleId) : void 0;

  const updatedAliquots = state.aliquots.map(
    (a) => a.id === aliquotId ? {
      ...a,
      skippedAt: timestamp,
      skippedReason: reason
    } : a
  );
  const parentComplete = parent
    ? updatedAliquots.filter((a) => a.parentSampleId === parent.id && (a.createdAt || a.skippedAt)).length
    >= getSampleExpectedAliquotBarcodes(state, parent).length
    : false;
  const next = {
    ...state,
    aliquots: updatedAliquots,
    samples: parentComplete ? state.samples.map((sample) => sample.id === parent?.id ? { ...sample, status: "Aliquoted" } : sample) : state.samples,
    pendingAliquotParentId: parentComplete && state.pendingAliquotParentId === parent?.id ? null : state.pendingAliquotParentId
  };
  return refreshPhase(next, `${aliquot.barcode} marked missed/skipped.`);
}
function editAliquotSkipRemark(state, aliquotId, text) {
  const aliquot = state.aliquots.find((a) => a.id === aliquotId);
  if (!aliquot) return refreshPhase(state, "Aliquot not found.");
  if (!aliquot.skippedAt) return refreshPhase(state, "Only skipped aliquots can have skip remarks edited.");
  const trimmed = text.trim();
  if (!trimmed) return refreshPhase(state, "Skip remark is required.");

  return refreshPhase({
    ...state,
    aliquots: state.aliquots.map(
      (item) => item.id === aliquotId ? { ...item, skippedReason: trimmed } : item
    )
  }, `${aliquot.barcode} skip remark updated.`);
}
function processAliquotBarcode(state, code) {
  const parent = state.pendingAliquotParentId ? state.samples.find((s) => s.id === state.pendingAliquotParentId) : state.samples.find((s) => s.status === "Ready For Aliquot");
  if (!parent) {
    const message = "Scan a centrifuged PK parent sample before aliquot tubes.";
    return { state: refreshPhase(state, message), result: { success: false, message } };
  }
  const next = linkAliquotToParent(state, parent.id, code);
  return { state: next, result: { success: next.lastScanMessage?.startsWith("Wrong") ? false : true, message: next.lastScanMessage ?? "Aliquot processed." } };
}
function processStorageBarcode(state, code) {
  const def = state.barcodes.find((b) => b.code.toUpperCase() === code && b.type === "storage");
  if (!def?.storageLocation) {
    return {
      state: refreshPhase(state, `Unknown storage location: ${code}`),
      result: { success: false, message: `Unknown storage location: ${code}` }
    };
  }
  const aliquotId = state.pendingStorageAliquotId;
  if (!aliquotId) {
    return {
      state: refreshPhase(state, "Scan an aliquot tube before scanning freezer location."),
      result: { success: false, message: "Scan aliquot first." }
    };
  }
  const aliquot = state.aliquots.find((a) => a.id === aliquotId);
  if (!aliquot) {
    return { state, result: { success: false, message: "Pending aliquot not found." } };
  }
  const parentId = aliquot.parentSampleId;
  const next = {
    ...state,
    aliquots: state.aliquots.map(
      (a) => a.id === aliquotId ? { ...a, storageLocation: def.storageLocation ?? code } : a
    ),
    samples: parentId ? state.samples.map((s) => s.id === parentId ? { ...s, status: "Stored", storageLocation: def.storageLocation ?? code } : s) : state.samples,
    pendingStorageAliquotId: null
  };
  return {
    state: refreshPhase(next, `${aliquot.barcode} stored at ${def.storageLocation}.`),
    result: { success: true, message: `${aliquot.barcode} stored.` }
  };
}
function processBarcodeScan(state, rawCode) {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { state, result: { success: false, message: "Empty barcode." } };
  const isSubjectBarcode = !!findSubjectBarcodeForProject(state, code);
  if (isSubjectBarcode || code.startsWith("S")) return processSubjectBarcode(state, code);
  if (code.startsWith("PK")) return processPkBarcode(state, code);
  if (code.startsWith("AL")) return processAliquotBarcode(state, code);
  if (code.startsWith("FZ-")) return processStorageBarcode(state, code);
  return {
    state: refreshPhase(state, `Barcode ${code} is not valid for this workflow.`),
    result: { success: false, message: `Invalid barcode ${code}` }
  };
}
function skipActivity(state, activityId, remark) {
  const activity = state.activities.find((a) => a.id === activityId);
  if (!activity) return state;

  const isDoseSkip = activity.activity === "IMP Dose Administration";

  // Same remark text persisted to DB for dose + cascaded timepoints (bulk skip).
  const skipRemarkText = String(remark ?? "").trim() || null;

  const activities = state.activities.map((a) => {
    if (a.id === activityId) {
      return { ...a, status: "Skipped", remarks: skipRemarkText ?? a.remarks };
    }
    if (isDoseSkip && a.visitId === activity.visitId && !["Completed", "Skipped"].includes(a.status)) {
      return { ...a, status: "Skipped", remarks: skipRemarkText ?? a.remarks };
    }
    return a;
  });

  let next = {
    ...state,
    activities
  };

  next = promoteNextReady(next, activity.visitId);
  return refreshPhase(updateSubjectVisitStatus(next, activity), "Activity skipped. Next eligible activity updated.");
}
function skipPendingActivities(state, activityIds, remark, collectActivityId, collectActualTime, method) {
  let next = state;
  activityIds.forEach((activityId) => {
    next = skipActivity(next, activityId, remark);
  });
  if (collectActivityId) {
    const collectActivity = next.activities.find((a) => a.id === collectActivityId);
    if (collectActivity) {
      // force=true: pending skips just unlocked this timepoint; status may still be catching up.
      next = completePkActivity(next, collectActivity, collectActualTime ?? nowIso(), true, method);
    }
  }
  return refreshPhase(next, collectActivityId ? "Pending timepoints skipped. Scanned PK collection completed." : "Pending timepoints skipped.");
}
function addRemark(state, activityId, text) {
  const activity = state.activities.find((a) => a.id === activityId);
  if (!activity) return state;

  const next = {
    ...state,
    activities: state.activities.map((a) => (a.id === activityId ? { ...a, remarks: text } : a))
  };
  return resolveReviewQueryOnSave(next, activityId, "remark", text);
}
function markDeviation(state, activityId, text) {
  const activity = state.activities.find((a) => a.id === activityId);
  if (!activity) return state;
  const timestamp = nowIso();
  const reason = text.trim();
  const alreadyLogged = state.deviations.some((d) => d.activityId === activityId && d.description === reason);
  let next = {
    ...state,
    activities: state.activities.map(
      (a) => a.id === activityId ? {
        ...a,
        status: "Deviation",
        deviation: true,
        deviationReason: reason,
        remarks: reason
      } : a
    ),
    deviations: alreadyLogged ? state.deviations : [...state.deviations, createDeviation(activity, reason, timestamp, "Manual")]
  };
  next = addRemark(next, activityId, reason);
  next = promoteNextReady(next, activity.visitId);
  return refreshPhase(updateSubjectVisitStatus(next, activity), "Deviation recorded. Next eligible activity updated.");
}
function resolveDeviation(state, deviationId) {
  return {
    ...state,
    deviations: state.deviations.map((d) => d.id === deviationId ? { ...d, resolved: true } : d)
  };
}
function refreshMissedActivities(state) {
  const now = Date.now();
  const newDeviations = [];
  const activities = state.activities.map((a) => {
    if (a.activity === "Pre-Dose Blood Collection" || a.status !== "Ready" || !a.windowEnd) return a;
    if (new Date(a.windowEnd).getTime() < now) {
      const already = state.deviations.some((d) => d.activityId === a.id && d.description === "Missed collection window");
      if (!already) newDeviations.push(createDeviation(a, "Missed collection window", nowIso(), "Auto"));
      return {
        ...a,
        status: "Missed",
        deviation: true,
        deviationReason: "Missed collection window"
      };
    }
    return a;
  });
  return refreshPhase({
    ...state,
    activities,
    deviations: newDeviations.length ? [...state.deviations, ...newDeviations] : state.deviations
  });
}
function getSubjectVisitIds(state, subjectId) {
  return [...new Set(state.activities.filter((a) => a.subjectId === subjectId).map((a) => a.visitId))];
}
function compareSubjectVisitOrder(state, visitIdA, visitIdB) {
  const doseA = getDoseNumber(getOrderedVisitActivities(state, visitIdA)[0]?.dose);
  const doseB = getDoseNumber(getOrderedVisitActivities(state, visitIdB)[0]?.dose);
  if (doseA !== doseB) return doseA - doseB;
  const visitA = state.visits.find((v) => v.id === visitIdA);
  const visitB = state.visits.find((v) => v.id === visitIdB);
  return String(visitA?.label ?? visitIdA).localeCompare(String(visitB?.label ?? visitIdB), undefined, { numeric: true });
}
function findNextReadyActivity(state, subjectId, visitId) {
  return getOrderedVisitActivities(state, visitId).find(
    (a) => a.subjectId === subjectId && isActivityActionableStatus(a.status)
  );
}
function getNextActivity(state, subjectId, _visitId) {
  const sortedVisitIds = getSubjectVisitIds(state, subjectId)
    .sort((a, b) => compareSubjectVisitOrder(state, a, b));

  for (const id of sortedVisitIds) {
    const visit = state.visits.find((v) => v.id === id);
    if (visit?.status === "Completed") continue;

    // Also skip if all activities are already terminal (visit may not be marked Completed yet)
    const visitActivities = getOrderedVisitActivities(state, id);
    const allTerminal = visitActivities.length > 0 && visitActivities.every(
      (a) => isTerminalActivityStatus(a.status)
    );
    if (allTerminal) continue;

    const ready = findNextReadyActivity(state, subjectId, id);
    if (ready) return ready;

    if (visitHasOpenActivities(state, id)) {
      return void 0;
    }
  }

  return void 0;
}

function getDashboardMetrics(state) {
  return {
    totalSubjects: state.subjects.length,
    inProgress: state.subjects.filter((s) => s.status === "In Progress").length,
    completedActivities: state.activities.filter((a) => a.status === "Completed").length,
    pendingCollections: state.activities.filter(
      (a) => a.executionMethod === "pkBarcode" && isActivityPendingCollectionStatus(a.status)
    ).length,
    awaitingCentrifugation: state.samples.filter((s) => s.status === "Awaiting Centrifugation").length,
    readyForAliquot: state.samples.filter((s) => s.status === "Ready For Aliquot").length,
    storedSamples: state.aliquots.filter((a) => a.storageLocation).length,
    openDeviations: state.deviations.filter((d) => !d.resolved).length,
    missedActivities: state.activities.filter((a) => a.status === "Missed").length
  };
}
function formatDisplayTime(iso) {
  if (!iso) return "\u2014";
  const s = String(iso).trim();
  if (isWallClockDateTime(s) && s.includes("T") && s.length >= 16) {
    return s.slice(11, 16);
  }
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function formatDisplayDateTime(iso) {
  if (!iso) return "-";
  const s = String(iso).trim();
  if (isWallClockDateTime(s) && s.includes("T") && s.length >= 16) {
    const d = s.slice(0, 10);
    const t = s.slice(11, 16);
    const [y, m, day] = d.split("-");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthName = months[Number(m) - 1] || m;
    return `${day}-${monthName}-${y} ${t}`;
  }
  const parts = new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).replace(",", "");
  return parts.replace(/ /, "-").replace(/ /, "-");
}
function formatDateTimeLocal(iso) {
  if (!iso) return "";
  const s = String(iso).trim();
  // Site/browser wall-clock values are already 24h local digits — do not re-shift.
  if (isWallClockDateTime(s)) {
    return s.slice(0, 16);
  }
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 6e4);
  return local.toISOString().slice(0, 16);
}
function fromDateTimeLocal(value) {
  if (!value) return "";
  if (value.length === 16) return value + ":00";
  return value.slice(0, 19);
}
function formatWindow(start, end) {
  if (!start || !end) return "\u2014";
  return `${formatDisplayTime(start)} - ${formatDisplayTime(end)}`;
}
function findVisitForSubjectDose(state, subjectId, doseLabel) {
  return state.visits.find(
    (visit) =>
      visit.subjectId === subjectId &&
      formatDoseDisplayLabel(visit.doseLabel ?? visit.dose) === doseLabel
  );
}

function normalizeVisitReviewStatus(value) {
  const status = String(value ?? "").trim().toLowerCase();
  if (status === "reviewed") return "Reviewed";
  if (status === "submitted" || status === "pending review") return "Submitted";
  return null;
}

function resolveDoseReviewDisplayStatus(state, subjectId, doseLabel) {
  const visit = findVisitForSubjectDose(state, subjectId, doseLabel);
  if (!visit) return null;

  const visitStatus = normalizeVisitReviewStatus(visit.reviewStatus);
  if (visitStatus === "Reviewed") return "reviewed";
  if (visitStatus === "Submitted") return "under-review";

  const visitActivities = getOrderedVisitActivities(state, visit.id);
  if (!visitActivities.length) return null;

  const withReviewStatus = visitActivities.filter((activity) =>
    normalizeVisitReviewStatus(activity.reviewStatus)
  );
  if (!withReviewStatus.length) return null;

  if (withReviewStatus.every((activity) => normalizeVisitReviewStatus(activity.reviewStatus) === "Reviewed")) {
    return "reviewed";
  }

  if (
    withReviewStatus.some((activity) => normalizeVisitReviewStatus(activity.reviewStatus) === "Submitted")
    || withReviewStatus.some((activity) => normalizeVisitReviewStatus(activity.reviewStatus) === "Reviewed")
  ) {
    return "under-review";
  }

  return null;
}

function isVisitReadyForSubmit(state, visitId) {
  const visit = state.visits.find((item) => item.id === visitId);
  if (!visit) return false;

  // Once submitted/reviewed in DB (or local state), Submit must never return.
  if (normalizeVisitReviewStatus(visit.reviewStatus)) return false;

  const activities = getOrderedVisitActivities(state, visitId);
  if (!activities.length) return false;

  if (activities.some((activity) => normalizeVisitReviewStatus(activity.reviewStatus))) {
    return false;
  }

  return activities.every((activity) => {
    if (activity.status === "Skipped") return true;
    const sample = resolveActivitySample(state.samples, activity);
    if (sample) {
      return isSampleAliquotCompleteStatus(sample.status);
    }
    return TERMINAL_ACTIVITY_STATUSES.includes(activity.status);
  });
}

function submitVisitForReview(state, visitId) {
  if (!isVisitReadyForSubmit(state, visitId)) {
    return refreshPhase(state, "All timepoints must be complete before submitting this dose for review.");
  }
  return {
    ...state,
    visits: state.visits.map((item) =>
      item.id === visitId
        ? { ...item, reviewStatus: "Submitted", submittedAt: nowIso() }
        : item
    ),
    activities: state.activities.map((activity) =>
      activity.visitId === visitId
        ? { ...activity, reviewStatus: "Submitted" }
        : activity
    ),
    lastScanMessage: "Dose submitted for review."
  };
}

function reviewActivityRecords(state, activityIds = []) {
  const uniqueIds = [...new Set(activityIds.filter(Boolean))];
  if (!uniqueIds.length) return state;

  const firstActivity = state.activities.find((item) => uniqueIds.includes(item.id));
  const visit = state.visits.find((item) => item.id === firstActivity?.visitId);
  if (!visit || visit.reviewStatus !== "Submitted") {
    return refreshPhase(state, "Selected records are not available for review.");
  }

  const idSet = new Set(uniqueIds);
  const hasOpenQuery = state.activities.some(
    (item) => idSet.has(item.id) && activityHasRaisedReviewQuery(item)
  );
  if (hasOpenQuery) {
    return refreshPhase(state, "Resolve raised queries before reviewing this record.");
  }

  let reviewedCount = 0;

  const nextActivities = state.activities.map((item) => {
    if (!idSet.has(item.id) || item.reviewStatus === "Reviewed") return item;
    if (!TERMINAL_ACTIVITY_STATUSES.includes(item.status)) return item;
    reviewedCount += 1;
    return { ...item, reviewStatus: "Reviewed" };
  });

  const visitActivities = nextActivities.filter((item) => item.visitId === visit.id);
  const reviewableActivities = visitActivities.filter((item) =>
    TERMINAL_ACTIVITY_STATUSES.includes(item.status)
  );
  const allReviewed = reviewableActivities.every((item) => item.reviewStatus === "Reviewed");

  return {
    ...state,
    activities: nextActivities,
    visits: state.visits.map((item) =>
      item.id === visit.id
        ? {
          ...item,
          reviewStatus: allReviewed ? "Reviewed" : "Submitted",
          reviewedAt: allReviewed ? nowIso() : item.reviewedAt ?? null
        }
        : item
    ),
    lastScanMessage: allReviewed
      ? "Dose review completed."
      : `${reviewedCount} record(s) marked as reviewed.`
  };
}

function raiseReviewQuery(state, activityId, queryText, fieldKey) {
  const activity = state.activities.find((item) => item.id === activityId);
  if (!activity) return state;

  const visit = state.visits.find((item) => item.id === activity.visitId);
  if (!visit || visit.reviewStatus !== "Submitted") {
    return refreshPhase(state, "Queries can only be raised before the record is reviewed.");
  }
  if (activity.reviewStatus === "Reviewed") {
    return refreshPhase(state, "Queries can only be raised before the activity is reviewed.");
  }

  const trimmedFieldKey = String(fieldKey ?? "").trim();
  if (!trimmedFieldKey) {
    return refreshPhase(state, "Please select a field for the query.");
  }

  const fieldLabel = resolveReviewQueryFieldLabel(activity, trimmedFieldKey);
  if (!fieldLabel || fieldLabel === trimmedFieldKey) {
    return refreshPhase(state, "Please select a valid field for the query.");
  }

  const trimmed = String(queryText ?? "").trim();
  if (!trimmed) {
    return refreshPhase(state, "Query text is required.");
  }

  if (activity.reviewQuery && getReviewQueryStatus(activity) !== REVIEW_QUERY_STATUS.CLOSED) {
    return refreshPhase(state, "Close or resolve the existing query before raising a new one.");
  }

  const raisedAt = nowIso();

  const next = {
    ...state,
    activities: state.activities.map((item) =>
      item.id === activityId
        ? createRaisedReviewQueryActivity(item, trimmedFieldKey, fieldLabel, trimmed, raisedAt)
        : item
    ),
    lastScanMessage: "Review query raised."
  };
  return next;
}

function reraiseReviewQuery(state, activityId, queryText) {
  const activity = state.activities.find((item) => item.id === activityId);
  if (!activity) return refreshPhase(state, "Activity not found.");

  if (getReviewQueryStatus(activity) !== REVIEW_QUERY_STATUS.CLOSED) {
    return refreshPhase(state, "Only closed queries can be re-raised.");
  }

  const fieldKey = activity.reviewQueryFieldKey;
  if (!fieldKey) {
    return refreshPhase(state, "Query field not found.");
  }

  const fieldLabel = activity.reviewQueryFieldLabel ?? resolveReviewQueryFieldLabel(activity, fieldKey);
  const trimmed = String(queryText ?? "").trim();
  if (!trimmed) {
    return refreshPhase(state, "Query text is required.");
  }

  const raisedAt = nowIso();
  const next = {
    ...state,
    activities: state.activities.map((item) =>
      item.id === activityId
        ? createRaisedReviewQueryActivity(item, fieldKey, fieldLabel, trimmed, raisedAt)
        : item
    ),
    lastScanMessage: "Review query re-raised."
  };
  return next;
}

function sendbackReviewQuery(state, activityId, remark) {
  const activity = state.activities.find((item) => item.id === activityId);
  if (!activity) return refreshPhase(state, "Activity not found.");
  if (activity.reviewStatus === "Reviewed") {
    return refreshPhase(state, "Queries cannot be sent back after the activity is reviewed.");
  }
  if (!isReviewQueryAwaitingReviewer(activity)) {
    return refreshPhase(state, "Query can only be sent back after it is resolved.");
  }

  const trimmed = String(remark ?? "").trim();
  if (!trimmed) {
    return refreshPhase(state, "Sendback remark is required.");
  }

  const fieldKey = activity.reviewQueryFieldKey;
  const next = {
    ...state,
    activities: state.activities.map((item) =>
      item.id === activityId ? applyReviewQuerySendback(item, trimmed) : item
    )
  };
  return refreshPhase(
    next,
    "Review query sent back."
  );
}

function closeReviewQuery(state, activityId, remark) {
  const activity = state.activities.find((item) => item.id === activityId);
  if (!activity?.reviewQuery) {
    return refreshPhase(state, "No review query to close.");
  }
  const trimmed = String(remark ?? "").trim();
  if (!trimmed) {
    return refreshPhase(state, "Close remark is required.");
  }
  const status = getReviewQueryStatus(activity);
  if (status === REVIEW_QUERY_STATUS.CLOSED) {
    return refreshPhase(state, "Query is already closed.");
  }
  const closable = [
    REVIEW_QUERY_STATUS.RAISED,
    REVIEW_QUERY_STATUS.RESOLVED,
    REVIEW_QUERY_STATUS.SENDBACK
  ].includes(status);
  if (!closable) {
    return refreshPhase(state, "Query cannot be closed.");
  }

  const fieldKey = activity.reviewQueryFieldKey;
  const next = {
    ...state,
    activities: state.activities.map((item) =>
      item.id === activityId ? applyReviewQueryClosed(item) : item
    )
  };
  return refreshPhase(
    next,
    "Review query closed."
  );
}

function reviewActivityRecord(state, activityId) {
  const activity = state.activities.find((item) => item.id === activityId);
  if (!activity) return state;
  if (activity.reviewStatus === "Reviewed") return state;

  const visit = state.visits.find((item) => item.id === activity.visitId);
  if (!visit || visit.reviewStatus !== "Submitted") {
    return refreshPhase(state, "This record is not available for review.");
  }

  if (activityHasRaisedReviewQuery(activity)) {
    return refreshPhase(state, "Resolve raised queries before reviewing this record.");
  }

  const nextActivities = state.activities.map((item) =>
    item.id === activityId ? { ...item, reviewStatus: "Reviewed" } : item
  );
  const visitActivities = nextActivities.filter((item) => item.visitId === activity.visitId);
  const reviewableActivities = visitActivities.filter((item) =>
    TERMINAL_ACTIVITY_STATUSES.includes(item.status)
  );
  const allReviewed = reviewableActivities.every((item) => item.reviewStatus === "Reviewed");

  return {
    ...state,
    activities: nextActivities,
    visits: state.visits.map((item) =>
      item.id === activity.visitId
        ? {
          ...item,
          reviewStatus: allReviewed ? "Reviewed" : "Submitted",
          reviewedAt: allReviewed ? nowIso() : item.reviewedAt ?? null
        }
        : item
    ),
    lastScanMessage: allReviewed ? "Dose review completed." : "Activity marked as reviewed."
  };
}

function getSubjectVisitsForReview(state, subjectId) {
  return state.visits
    .filter((visit) => visit.subjectId === subjectId)
    .sort(
      (a, b) =>
        getDoseNumber(a.doseLabel ?? a.dose) - getDoseNumber(b.doseLabel ?? b.dose)
    );
}

function getCompletedActivitiesForVisit(state, visitId) {
  return getOrderedVisitActivities(state, visitId).filter((activity) =>
    TERMINAL_ACTIVITY_STATUSES.includes(activity.status)
  );
}

function getSubmittedVisitsForSubject(state, subjectId) {
  return state.visits
    .filter(
      (visit) =>
        visit.subjectId === subjectId &&
        (visit.reviewStatus === "Submitted" || visit.reviewStatus === "Reviewed")
    )
    .sort(
      (a, b) =>
        getDoseNumber(a.doseLabel ?? a.dose) - getDoseNumber(b.doseLabel ?? b.dose)
    );
}

function getExpectedScanInstruction(state) {
  switch (state.scanPhase) {
    case "Dose Setup": {
      const nextActivity = state.activeSubjectId && state.activeVisitId ? getNextActivity(state, state.activeSubjectId, state.activeVisitId) : void 0;
      if (nextActivity?.activity === "IMP Dose Administration") {
        return "Confirm dose administration before continuing to post-dose PK tubes.";
      }
      if (nextActivity?.activity === "Pre-Dose Blood Collection") {
        return "Setup dose date/time for PK windows, or scan the pre-dose PK tube when ready.";
      }
      return "Define dose date/time before scanning PK tubes.";
    }
    case "PK Collection":
    case "Scan Barcode":
      return "";
    case "Centrifugation Start":
      return "Scan the same PK tube barcode to start centrifugation.";
    case "Centrifugation End":
      return "Scan the same PK tube barcode again to end centrifugation.";
    case "Aliquot Creation":
      return "Scan aliquot tube barcodes to link child tubes to the active parent.";
    case "Storage":
      return "Scan aliquot tube, then scan freezer location barcode.";
    default:
      return waitingForNextParticipantMessage();
  }
}
export {
  activateAliquotParent,
  addRemark,
  completeDoseAdministrationAt,
  completeDoseNow,
  applyTimepointBarcodeScanTimings,
  completePkCollectionAt,
  editCentrifugeStart,
  editCentrifugeEnd,
  editTimepointScanEnd,
  editTimepointScanStart,
  endCentrifugation,
  formatDateTimeLocal,
  formatDisplayDateTime,
  formatDisplayTime,
  formatWindow,
  fromDateTimeLocal,
  getDashboardMetrics,
  getExpectedScanInstruction,
  getNextActivity,
  getPkScanTarget,
  getSubmittedVisitsForSubject,
  getSubjectVisitsForReview,
  getCompletedActivitiesForVisit,
  isVisitReadyForSubmit,
  findVisitForSubjectDose,
  resolveDoseReviewDisplayStatus,
  isDoseRecordEditLocked,
  isDoseScheduleEditLocked,
  nowIso,
  resolveTimepointScanEnd,
  resolveCentrifugeStartTime,
  resolveCentrifugeEndTime,
  resolveActivitySample,
  usesCentrifugeWorkflowStart,
  getSampleExpectedAliquotBarcodes,
  isSampleAliquotSeparationComplete,
  resolveAliquotParentSample,
  linkAliquotToParent,
  markDeviation,
  processBarcodeScan,
  recordTimepointScanEnd,
  recordTimepointScanStart,
  refreshMissedActivities,
  resolveDeviation,
  resolveExpectedAliquotBarcodes,
  resolvePkScanIntent,
  reviewActivityRecord,
  reviewActivityRecords,
  raiseReviewQuery,
  reraiseReviewQuery,
  sendbackReviewQuery,
  closeReviewQuery,
  resolveReviewQuery,
  resolveReviewQueryOnSave,
  resolveReviewQueryWithFieldValue,
  setActivityActualTime,
  setDoseDateTime,
  skipActivity,
  skipAliquot,
  editAliquotSkipRemark,
  skipPendingActivities,
  startCentrifugation,
  submitVisitForReview
};
