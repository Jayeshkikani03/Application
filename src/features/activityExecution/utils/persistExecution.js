import {
  saveDoseAdministration,
  savePkCollection,
  saveSkippedApi,
  saveSkippedBulkApi,
  updateFieldsApi,
  saveCrfApi,
  startCentrifugeApi,
  endCentrifugeApi,
  linkAliquotApi,
  skipAliquotApi,
} from "../api/activityExecutionApi.js";
import { HDR_STATUS } from "./hdrStatus.js";
import { getCrfDefinitionForActivity } from "../../../services/crfService.js";

function resolveSubjectMstNo(state, subjectId) {
  const subject = (state.subjects ?? []).find((item) => item.id === subjectId);
  return Number(subject?.subjectMstNo) || 0;
}

/**
 * Returns true if this activity is backed by a real DB record (subjectMstNo > 0).
 * Mock/demo activities have no subjectMstNo so they are never persisted to the API.
 */
function isRealDbActivity(activity, state) {
  if (!activity) return false;
  const subject = (state.subjects ?? []).find((item) => item.id === activity.subjectId);
  return Number(subject?.subjectMstNo) > 0;
}

function softFail(message, onError) {
  if (typeof onError === "function") {
    onError(message || "Failed to save execution data.");
  }
}

/** Dose persist for DB-backed subjects. Same result shape as persistPkCollectionIfNeeded. */
export function persistDoseIfNeeded(state, visitId, actualDoseTime, changeReason, onError, activityId = null) {
  const doseActivity = activityId
    ? (state.activities ?? []).find((activity) => activity.id === activityId)
    : (state.activities ?? []).find(
        (activity) =>
          activity.visitId === visitId && activity.activity === "IMP Dose Administration"
      );
  if (!isRealDbActivity(doseActivity, state)) return Promise.resolve({ skipped: true });
  const subjectMstNo = resolveSubjectMstNo(state, doseActivity.subjectId);
  const timePointNo = Number(doseActivity.activityConfigTimePointNo) || 0;
  if (!subjectMstNo || !timePointNo) return Promise.resolve({ skipped: true });

  return saveDoseAdministration({
    subjectMstNo,
    activityConfigTimePointNo: timePointNo,
    actualTime: actualDoseTime,
    scheduledTime: actualDoseTime,
    // First-time dose: remarks field only. Edit path uses update-fields + audit changeReason.
    remarks: doseActivity.remarks || null,
  }).then((record) => ({ ok: true, record })).catch((err) => {
    softFail(err?.message, onError);
    return { ok: false };
  });
}

/**
 * Persist PK collect. Returns a promise:
 * - { skipped: true } when not DB-backed (caller may apply local UI only)
 * - { ok: true, record } on API success
 * - { ok: false } on API failure (onError already called)
 */
export function persistPkCollectionIfNeeded(state, activityId, actualTime, onError, onSuccess) {
  const activity = (state.activities ?? []).find((item) => item.id === activityId);
  if (!isRealDbActivity(activity, state)) return Promise.resolve({ skipped: true });
  const subjectMstNo = resolveSubjectMstNo(state, activity.subjectId);
  const timePointNo = Number(activity.activityConfigTimePointNo) || 0;
  if (!subjectMstNo || !timePointNo) return Promise.resolve({ skipped: true });

  const updated = (state.activities ?? []).find((item) => item.id === activityId) ?? activity;

  return savePkCollection({
    subjectMstNo,
    activityConfigTimePointNo: timePointNo,
    barcodeValue: updated.barcode || null,
    actualTime,
    scheduledTime: updated.scheduledTime || null,
    windowStart: updated.windowStart || null,
    windowEnd: updated.windowEnd || null,
    status: HDR_STATUS.BloodCollected,
    deviation: Boolean(updated.deviation),
    deviationReason: updated.deviationReason || null,
    remarks: updated.remarks || null,
    expectedAliquotBarcodes: [...(updated.expectedAliquotBarcodes ?? [])],
    executionMethod: updated.executionMethod || null,
  }).then((record) => {
    if (typeof onSuccess === "function") onSuccess(record);
    return { ok: true, record };
  }).catch((err) => {
    softFail(err?.message, onError);
    return { ok: false };
  });
}

/** Persist activity skip (Confirm Skip / single skip). Creates hdr if needed. */
export function persistSkipIfNeeded(state, activityId, remark, onError, onSuccess) {
  const activity = (state.activities ?? []).find((item) => item.id === activityId);
  if (!isRealDbActivity(activity, state)) return;
  const subjectMstNo = resolveSubjectMstNo(state, activity.subjectId);
  const timePointNo = Number(activity.activityConfigTimePointNo) || 0;
  if (!subjectMstNo || !timePointNo) return;

  const remarkText = String(remark ?? activity.remarks ?? "").trim();
  void saveSkippedApi({
    subjectMstNo,
    activityConfigTimePointNo: timePointNo,
    remarks: remarkText || null,
    scheduledTime: activity.scheduledTime || null,
    windowStart: activity.windowStart || null,
    windowEnd: activity.windowEnd || null,
  })
    .then((record) => {
      if (typeof onSuccess === "function") onSuccess(record);
    })
    .catch((err) => softFail(err?.message, onError));
}

export function persistBulkSkipIfNeeded(state, activityIds, remark, onError, onSuccess) {
  const skips = [];
  const validActivityIds = [];
  const seenTimepoints = new Set();
  let droppedCount = 0;

  for (const activityId of activityIds) {
    const activity = (state.activities ?? []).find((item) => item.id === activityId);
    if (!isRealDbActivity(activity, state)) {
      droppedCount += 1;
      continue;
    }
    const subjectMstNo = resolveSubjectMstNo(state, activity.subjectId);
    const timePointNo = Number(activity.activityConfigTimePointNo) || 0;
    if (!subjectMstNo || !timePointNo) {
      droppedCount += 1;
      continue;
    }

    const dedupeKey = `${subjectMstNo}:${timePointNo}`;
    if (seenTimepoints.has(dedupeKey)) continue;
    seenTimepoints.add(dedupeKey);

    // Prefer the remark already applied on the activity (matches UI / DB after reload).
    const remarkText = String(activity.remarks ?? remark ?? "").trim();
    skips.push({
      subjectMstNo,
      activityConfigTimePointNo: timePointNo,
      remarks: remarkText || null,
      scheduledTime: activity.scheduledTime || null,
      windowStart: activity.windowStart || null,
      windowEnd: activity.windowEnd || null,
    });
    validActivityIds.push(activityId);
  }

  if (skips.length === 0) {
    softFail(
      "Could not save skipped timepoints to the server (missing subject or timepoint keys). Re-scan the subject and try again.",
      onError
    );
    return;
  }

  void saveSkippedBulkApi({ skips })
    .then((records) => {
      if (typeof onSuccess === "function") {
        onSuccess(records, validActivityIds, { droppedCount });
      }
    })
    .catch((err) => softFail(err?.message, onError));
}

/**
 * Patch one or more named fields on an existing execution record.
 * Use this for any edit (ActualTime, Remarks, DeviationReason, CentrifugationStart, etc.)
 * that happens after the record was already saved. Sends a minimal payload — no full-record overwrite.
 *
 * @param {object} state       - current LabContext state
 * @param {string} activityId  - local activity ID
 * @param {Record<string,string>} fields - field name → value (e.g. { ActualTime: "..." })
 * @param {string} changeReason - audit reason (stored in AuditDtl.vChangeReason, NOT as a data field)
 * @param {function} onError   - optional error callback
 * @param {function} onSuccess - optional callback(record) called with the updated record from API;
 *                               use this to sync fieldIds back into local state so the audit icon appears
 */
export function persistFieldEditIfNeeded(state, activityId, fields, changeReason, onError, onSuccess) {
  const activity = (state.activities ?? []).find((item) => item.id === activityId);
  if (!isRealDbActivity(activity, state)) return;
  const subjectMstNo = resolveSubjectMstNo(state, activity.subjectId);
  const timePointNo = Number(activity.activityConfigTimePointNo) || 0;
  if (!subjectMstNo || !timePointNo) return;

  updateFieldsApi({
    subjectMstNo,
    activityConfigTimePointNo: timePointNo,
    fields,
    changeReason: changeReason || "",
  })
    .then((record) => {
      if (typeof onSuccess === "function") onSuccess(record);
    })
    .catch((err) => softFail(err?.message, onError));
}

/** Convenience wrapper: edit only ActualTime (and related centrifuge times from sample) */
export function persistActualTimeEditIfNeeded(
  state,
  activityId,
  actualTime,
  changeReason,
  onError,
  onSuccess,
  previousRemarks
) {
  const activity = (state.activities ?? []).find((item) => item.id === activityId);
  const fields = { ActualTime: actualTime };
  // IMP dose keeps Scheduled Time and Actual Time on the same clock — patch both on edit.
  if (activity?.activity === "IMP Dose Administration") {
    fields.ScheduledTime = actualTime;
  }
  if (activity && "deviation" in activity) {
    fields.Deviation = String(Boolean(activity.deviation));
    fields.DeviationReason = activity.deviationReason || "";
    // Sync Deviation / Remark only when out-of-window and remarks actually changed
    // (avoids empty Remarks audits from copying ActualTime changeReason).
    const nextRemarks = String(activity.remarks ?? "").trim();
    const prevRemarks = String(previousRemarks ?? "").trim();
    if (activity.deviation && nextRemarks && nextRemarks !== prevRemarks) {
      fields.Remarks = nextRemarks;
    }
  }
  // If the activity has a linked sample, also sync centrifuge times so backend stays consistent
  if (activity) {
    const sample = (state.samples ?? []).find(
      (s) => s.id === activity.sampleId || s.activityId === activityId
    );
    if (sample) {
      if (sample.centrifugationStart || sample.scanStartTime) {
        fields.CentrifugationStart = sample.centrifugationStart ?? sample.scanStartTime;
      }
      if (sample.centrifugationEnd || sample.scanEndTime) {
        fields.CentrifugationEnd = sample.centrifugationEnd ?? sample.scanEndTime;
      }
    }
  }
  persistFieldEditIfNeeded(state, activityId, fields, changeReason, onError, onSuccess);
}

export function persistCentrifugeStartEditIfNeeded(
  state,
  sampleId,
  newTime,
  changeReason,
  onError,
  onSuccess
) {
  const sample = (state.samples ?? []).find((item) => item.id === sampleId);
  if (!sample) return;

  const activity = (state.activities ?? []).find(
    (item) => item.id === sample.activityId || item.sampleId === sampleId
  );
  if (!activity) return;

  const endTime = sample.centrifugationEnd || sample.scanEndTime;

  const fields = {
    CentrifugationStart: newTime,
  };

  if (endTime) {
    fields.CentrifugationEnd = endTime;
  }

  persistFieldEditIfNeeded(
    state,
    activity.id,
    fields,
    changeReason,
    onError,
    onSuccess
  );
}
export function persistCentrifugeEndEditIfNeeded(state, sampleId, newTime, changeReason, onError, onSuccess) {
  const sample = (state.samples ?? []).find((item) => item.id === sampleId);
  if (!sample) return;
  const activity = (state.activities ?? []).find(
    (item) => item.id === sample.activityId || item.sampleId === sampleId
  );
  if (!activity) return;
  const fields = { CentrifugationEnd: newTime };
  persistFieldEditIfNeeded(state, activity.id, fields, changeReason, onError, onSuccess);
}

export function persistCentrifugeStartIfNeeded(state, sampleId, actualTime, onError, onSuccess) {
  const sample = (state.samples ?? []).find((item) => item.id === sampleId);
  if (!sample) return;
  const activity = (state.activities ?? []).find(
    (item) => item.id === sample.activityId || item.sampleId === sampleId
  );
  if (!isRealDbActivity(activity, state)) return;
  const subjectMstNo = resolveSubjectMstNo(state, activity.subjectId || sample.subjectId);
  const timePointNo = Number(activity.activityConfigTimePointNo) || 0;
  if (!subjectMstNo || !timePointNo) return;

  const startTime = actualTime || sample.centrifugationStart || sample.scanStartTime || new Date().toISOString();
  const endTime = sample.centrifugationEnd || sample.scanEndTime || null;

  // Prefer update-fields when end is already known locally (start auto-sets +10 end),
  // so both Dtl rows exist and audit fieldIds sync immediately.
  if (endTime) {
    persistFieldEditIfNeeded(
      state,
      activity.id,
      {
        CentrifugationStart: startTime,
        CentrifugationEnd: endTime,
        Status: HDR_STATUS.Centrifugation,
      },
      "",
      onError,
      (record) => {
        if (typeof onSuccess === "function") onSuccess(record, activity.id);
      }
    );
    return;
  }

  void startCentrifugeApi({
    subjectMstNo,
    activityConfigTimePointNo: timePointNo,
    actualTime: startTime,
  })
    .then((record) => {
      if (typeof onSuccess === "function") onSuccess(record, activity.id);
    })
    .catch((err) => softFail(err?.message, onError));
}

export function persistCentrifugeEndIfNeeded(state, sampleId, onError, onSuccess) {
  const sample = (state.samples ?? []).find((item) => item.id === sampleId);
  if (!sample) return;
  const activity = (state.activities ?? []).find(
    (item) => item.id === sample.activityId || item.sampleId === sampleId
  );
  if (!isRealDbActivity(activity, state)) return;
  const subjectMstNo = resolveSubjectMstNo(state, activity.subjectId || sample.subjectId);
  const timePointNo = Number(activity.activityConfigTimePointNo) || 0;
  if (!subjectMstNo || !timePointNo) return;

  void endCentrifugeApi({
    subjectMstNo,
    activityConfigTimePointNo: timePointNo,
    actualTime: sample.centrifugationEnd || new Date().toISOString(),
  })
    .then((record) => {
      if (typeof onSuccess === "function") onSuccess(record, activity.id);
    })
    .catch((err) => softFail(err?.message, onError));
}

function persistHdrStatusIfNeeded(state, activity, status, onError) {
  if (!isRealDbActivity(activity, state)) return;
  const subjectMstNo = resolveSubjectMstNo(state, activity.subjectId);
  const timePointNo = Number(activity.activityConfigTimePointNo) || 0;
  if (!subjectMstNo || !timePointNo) return;

  void updateFieldsApi({
    subjectMstNo,
    activityConfigTimePointNo: timePointNo,
    fields: { Status: status },
    changeReason: "",
  }).catch((err) => softFail(err?.message, onError));
}

export function persistAliquotLinkIfNeeded(state, parentSampleId, code, onError) {
  const sample = (state.samples ?? []).find((item) => item.id === parentSampleId);
  if (!sample) return;
  const activity = (state.activities ?? []).find(
    (item) => item.id === sample.activityId || item.sampleId === parentSampleId
  );
  if (!isRealDbActivity(activity, state)) return;
  const subjectMstNo = resolveSubjectMstNo(state, activity.subjectId || sample.subjectId);
  const timePointNo = Number(activity.activityConfigTimePointNo) || 0;
  if (!subjectMstNo || !timePointNo) return;

  const aliquot = (state.aliquots ?? []).find(
    (item) => String(item.barcode ?? "").toUpperCase() === String(code ?? "").trim().toUpperCase()
  );

  void linkAliquotApi({
    subjectMstNo,
    activityConfigTimePointNo: timePointNo,
    barcodeValue: String(code ?? "").trim(),
    storageLocation: aliquot?.storageLocation || null,
  })
    .then(() => {
      const parent = (state.samples ?? []).find((item) => item.id === parentSampleId);
      const updatedSample = (state.samples ?? []).find((item) => item.id === parentSampleId);
      // After link, workflow may have set parent to Aliquoted — sync hdr status.
      const sampleAfter = updatedSample || parent;
      if (sampleAfter?.status === "Aliquoted" || sampleAfter?.status === "Stored") {
        persistHdrStatusIfNeeded(state, activity, HDR_STATUS.Aliquoted, onError);
      }
    })
    .catch((err) => softFail(err?.message, onError));
}

export function persistAliquotSkipIfNeeded(state, aliquotId, reason, onError) {
  const aliquot = (state.aliquots ?? []).find((item) => item.id === aliquotId);
  if (!aliquot) return;
  const sample = (state.samples ?? []).find((item) => item.id === aliquot.parentSampleId);
  const activity = (state.activities ?? []).find(
    (item) =>
      item.id === sample?.activityId ||
      item.sampleId === aliquot.parentSampleId ||
      item.id === aliquot.activityId
  );
  if (!isRealDbActivity(activity, state) && !sample) return;
  const subjectId = activity?.subjectId || sample?.subjectId || aliquot.subjectId;
  const subjectMstNo = resolveSubjectMstNo(state, subjectId);
  const timePointNo = Number(activity?.activityConfigTimePointNo) || 0;
  const barcode = String(aliquot.barcode ?? "").trim();
  if (!subjectMstNo || !timePointNo || !barcode) return;

  return skipAliquotApi({
    subjectMstNo,
    activityConfigTimePointNo: timePointNo,
    barcodeValue: barcode,
    skipRemark: String(reason ?? aliquot.skippedReason ?? "").trim(),
  })
    .then((apiResponse) => {
      const parent = (state.samples ?? []).find((item) => item.id === aliquot.parentSampleId);
      if (parent?.status === "Aliquoted" || parent?.status === "Stored") {
        persistHdrStatusIfNeeded(state, activity, HDR_STATUS.Aliquoted, onError);
      }
      return apiResponse;
    })
    .catch((err) => softFail(err?.message, onError));
}

/** After local aliquot link/skip, if parent is Aliquoted, patch hdr status. */
export function persistAliquotedStatusIfNeeded(state, parentSampleId, onError) {
  const sample = (state.samples ?? []).find((item) => item.id === parentSampleId);
  if (!sample || (sample.status !== "Aliquoted" && sample.status !== "Stored")) return;
  const activity = (state.activities ?? []).find(
    (item) => item.id === sample.activityId || item.sampleId === parentSampleId
  );
  persistHdrStatusIfNeeded(state, activity, HDR_STATUS.Aliquoted, onError);
}

/** Persist CRF answers for a DB-backed activity (POST /ActivityExecution/save-crf). */
export function persistCrfIfNeeded(state, activityId, crfId, values, changeReasonOrMap, onError, onSuccess) {
  const activity = (state.activities ?? []).find((item) => item.id === activityId);
  if (!isRealDbActivity(activity, state)) return;
  const subjectMstNo = resolveSubjectMstNo(state, activity.subjectId);
  const timePointNo = Number(activity.activityConfigTimePointNo) || 0;
  const definition = getCrfDefinitionForActivity(activity);
  const appActivityCrfNo =
    Number(activity.appActivityCrfNo) ||
    Number(definition?.appActivityCrfNo) ||
    0;
  if (!subjectMstNo || !timePointNo || !appActivityCrfNo) {
    softFail(
      !appActivityCrfNo
        ? "CRF definition is not linked in Application DB (AppActivityCrf)."
        : "Unable to save CRF (missing subject or time point).",
      onError
    );
    return;
  }

  const changeReasonsByFieldId =
    changeReasonOrMap && typeof changeReasonOrMap === "object" && !Array.isArray(changeReasonOrMap)
      ? Object.fromEntries(
          Object.entries(changeReasonOrMap)
            .map(([k, v]) => [String(k), String(v ?? "").trim()])
            .filter(([k, v]) => k && v)
        )
      : null;
  const changeReason =
    typeof changeReasonOrMap === "string"
      ? String(changeReasonOrMap || "").trim()
      : "";

  void saveCrfApi({
    subjectMstNo,
    activityConfigTimePointNo: timePointNo,
    activityExecutionHdrNo: Number(activity.activityExecutionHdrNo) || null,
    appActivityCrfNo,
    values: values ?? {},
    changeReason:
      changeReasonsByFieldId && Object.keys(changeReasonsByFieldId).length > 0
        ? ""
        : changeReason,
    changeReasonsByFieldId:
      changeReasonsByFieldId && Object.keys(changeReasonsByFieldId).length > 0
        ? changeReasonsByFieldId
        : undefined,
  })
    .then((record) => {
      if (typeof onSuccess === "function") onSuccess(record);
    })
    .catch((err) => softFail(err?.message, onError));
}
