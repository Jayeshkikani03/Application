import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from "react";
import {
  generateBarcodeBatch,
  addBarcodeProject,
  getBarcodeProjects,
  importProjectSchedule,
  mergeImportedBarcodeRun,
} from "../services/barcodeGenerationService";
import { getResolvedPeriodsForProject } from "../services/activityScheduleSyncService";
import {
  loadStartByScanSessionIntoState,
  mergeExecutionHistoryIntoState,
  applyVisitReviewStatusesToState,
} from "../features/activityExecution/utils/mapApiSessionToLabState";
import {
  persistDoseIfNeeded,
  persistPkCollectionIfNeeded,
  persistSkipIfNeeded,
  persistBulkSkipIfNeeded,
  persistFieldEditIfNeeded,
  persistActualTimeEditIfNeeded,
  persistCentrifugeStartEditIfNeeded,
  persistCentrifugeEndEditIfNeeded,
  persistCentrifugeStartIfNeeded,
  persistCentrifugeEndIfNeeded,
  persistAliquotLinkIfNeeded,
  persistAliquotSkipIfNeeded,
  persistAliquotedStatusIfNeeded,
  persistCrfIfNeeded,
} from "../features/activityExecution/utils/persistExecution";
import { hydrateCrfDefinitionsInState } from "../services/crfService";
import { resolveSubjectProjectId, belongsToProjectSubject } from "../services/projectSubjectService";
import {
  unknownParticipantBarcodeMessage,
  selectValidParticipantMessage,
} from "../constants/displayLabels";
import {
  addRemark,
  applyTimepointBarcodeScanTimings,
  completePkCollectionAt,
  completeDoseNow,
  endCentrifugation,
  linkAliquotToParent,
  processBarcodeScan,
  refreshMissedActivities,
  resolveDeviation,
  markDeviation,
  setActivityActualTime,
  setDoseDateTime,
  skipAliquot,
  editAliquotSkipRemark,
  skipActivity,
  editCentrifugeStart as editCentrifugeStartFn,
  editCentrifugeEnd as editCentrifugeEndFn,
  editTimepointScanEnd as editTimepointScanEndFn,
  editTimepointScanStart as editTimepointScanStartFn,
  skipPendingActivities,
  startCentrifugation,
  submitVisitForReview,
  reviewActivityRecord,
  reviewActivityRecords,
  raiseReviewQuery,
  reraiseReviewQuery,
  sendbackReviewQuery,
  closeReviewQuery,
  resolveReviewQuery,
  resolveReviewQueryWithFieldValue,
  nowIso,
} from "../services/workflowService";
import { saveActivityCrfField, saveActivityCrfResponse } from "../services/crfService";

/**
 * Default LabContext state before any API session is started.
 * Runtime data is loaded via GET /ActivityExecution/start-by-scan.
 */
const SUBJECT_MODE_STORAGE_KEY = "esource.subjectMode";

function readStoredSubjectMode() {
  try {
    const stored = sessionStorage.getItem(SUBJECT_MODE_STORAGE_KEY);
    if (stored === "manual" || stored === "scan") return stored;
  } catch {
    /* ignore */
  }
  return "scan";
}

function createLabInitialState() {
  return {
    subjects: [],
    visits: [],
    activities: [],
    samples: [],
    aliquots: [],
    barcodes: [],
    deviations: [],
    projects: [],
    activeSubjectId: null,
    activeVisitId: null,
    activeProjectId: null,
    pendingAliquotParentId: null,
    subjectMode: readStoredSubjectMode(),
    generatedBarcodeRuns: [],
    lastScanMessage: null,
  };
}

function linkGeneratedSubjectBarcode(state, barcodeCode, targetSubjectId) {
  const code = String(barcodeCode ?? "").trim().toUpperCase();
  const barcode = state.barcodes.find((item) => item.type === "subject" && item.code.toUpperCase() === code);
  const subject = state.subjects.find((item) => item.id === targetSubjectId && !item.generated);
  const existingPendingSubject = barcode?.subjectId ? state.subjects.find((item) => item.id === barcode.subjectId) : null;
  const pendingSubjectId = barcode?.pendingSubjectId ?? (existingPendingSubject?.generated ? barcode?.subjectId : null);
  const isUnlinked = barcode?.unlinked || (!!existingPendingSubject?.generated && !existingPendingSubject.barcodeLinked);

  if (!barcode) throw new Error(unknownParticipantBarcodeMessage(code));
  if (!isUnlinked) throw new Error(`${barcode.code} is already linked.`);
  if (!subject) throw new Error(selectValidParticipantMessage());
  if (!pendingSubjectId) throw new Error(`${barcode.code} is not ready for linking.`);

  const updateOwner = (item) =>
    item.subjectId === pendingSubjectId
      ? { ...item, subjectId: subject.id, subjectNumber: subject.subjectNumber }
      : item;

  return {
    ...state,
    subjects: state.subjects.map((item) =>
      item.id === pendingSubjectId
        ? { ...item, barcodeLinked: true, linkedSubjectId: subject.id, subjectNumber: subject.subjectNumber }
        : item.id === subject.id
          ? { ...item, barcode: barcode.code, linkedGeneratedBarcode: barcode.code }
        : item
    ),
    visits: state.visits.map((visit) =>
      visit.subjectId === pendingSubjectId ? { ...visit, subjectId: subject.id } : visit
    ),
    activities: state.activities.map(updateOwner),
    samples: state.samples.map(updateOwner),
    aliquots: state.aliquots.map(updateOwner),
    barcodes: state.barcodes.map((item) => {
      if (item.type === "subject" && item.code.toUpperCase() === code) {
        return { ...item, subjectId: subject.id, unlinked: false, linkedAt: new Date().toISOString() };
      }
      return item.subjectId === pendingSubjectId ? { ...item, subjectId: subject.id } : item;
    })
  };
}
function reducer(state, action) {
  switch (action.type) {
    case "SCAN":
      return processBarcodeScan(state, action.code).state;
    case "SET_DOSE_TIME":
      return setDoseDateTime(state, action.visitId, action.actualDoseTime, action.changeReason, {
        confirmSchedule: action.confirmSchedule,
        activityId: action.activityId,
      });
    case "DOSE_NOW":
      return completeDoseNow(state, action.visitId);
    case "COMPLETE_PK":
      return completePkCollectionAt(state, action.activityId, action.actualTime, action.method);
    case "SET_ACTIVITY_ACTUAL":
      return setActivityActualTime(state, action.activityId, action.actualTime, action.changeReason);
    case "START_CENTRIFUGE":
      return startCentrifugation(state, action.sampleId, action.actualTime);
    case "END_CENTRIFUGE":
      return endCentrifugation(state, action.sampleId);
    case "SET_ALIQUOT_PARENT":
      return { ...state, pendingAliquotParentId: action.sampleId };
    case "LINK_ALIQUOT":
      return linkAliquotToParent(state, action.parentSampleId, action.code);
    case "SKIP_ALIQUOT":
      return skipAliquot(state, action.aliquotId, action.reason);
    case "EDIT_ALIQUOT_SKIP_REMARK":
      return editAliquotSkipRemark(state, action.aliquotId, action.text);
    case "SKIP":
      return skipActivity(state, action.activityId, action.remark);
    case "SKIP_PENDING":
      return skipPendingActivities(state, action.activityIds, action.remark, action.collectActivityId, action.collectActualTime, action.method);
    case "REMARK":
      return addRemark(state, action.activityId, action.text);
    case "SAVE_CRF": {
      const result = saveActivityCrfResponse(
        state,
        action.activityId,
        action.crfId,
        action.values,
        action.changeReason
      );
      return result.error ? state : result.state;
    }
    case "MARK_DEVIATION":
      return markDeviation(state, action.activityId, action.text);
    case "RESOLVE_DEVIATION":
      return resolveDeviation(state, action.deviationId);
    case "SET_SUBJECT_MODE": {
      const subjectMode = action.subjectMode === "manual" ? "manual" : "scan";
      try {
        sessionStorage.setItem(SUBJECT_MODE_STORAGE_KEY, subjectMode);
      } catch {
        /* ignore */
      }
      return { ...state, subjectMode };
    }
    case "SET_ACTIVE_PROJECT": {
      const nextSubject = (state.subjects ?? []).find((subject) => subject.id === state.activeSubjectId);
      const keepSubject =
        nextSubject && resolveSubjectProjectId(nextSubject) === action.projectId;
      const pending = state.pendingAliquotParentId
        ? state.samples.find((sample) => sample.id === state.pendingAliquotParentId)
        : undefined;
      const keepPending =
        !!pending && belongsToProjectSubject(state, pending.subjectId, action.projectId);
      return {
        ...state,
        activeProjectId: action.projectId,
        activeSubjectId: keepSubject ? state.activeSubjectId : null,
        activeVisitId: keepSubject ? state.activeVisitId : null,
        pendingAliquotParentId: keepPending ? state.pendingAliquotParentId : null,
      };
    }
    case "SET_ACTIVE": {
      const pending = state.pendingAliquotParentId ? state.samples.find((s) => s.id === state.pendingAliquotParentId) : void 0;
      const keepPending = !!pending && pending.subjectId === action.subjectId;
      return {
        ...state,
        activeSubjectId: action.subjectId,
        activeVisitId: action.visitId,
        pendingAliquotParentId: keepPending ? state.pendingAliquotParentId : null
      };
    }
    case "RESET":
      return createLabInitialState();
    case "TICK":
      return refreshMissedActivities(state);
    case "SUBMIT_FOR_REVIEW":
      return submitVisitForReview(state, action.visitId);
    case "REVIEW_ACTIVITY":
      return reviewActivityRecord(state, action.activityId);
    case "REVIEW_ACTIVITIES":
      return reviewActivityRecords(state, action.activityIds);
    case "RAISE_REVIEW_QUERY":
      return raiseReviewQuery(state, action.activityId, action.queryText, action.fieldKey);
    case "SEND_BACK_REVIEW_QUERY":
      return sendbackReviewQuery(state, action.activityId, action.remark);
    case "CLOSE_REVIEW_QUERY":
      return closeReviewQuery(state, action.activityId, action.remark);
    case "UPDATE_ACTIVITY_DB_IDS":
      return {
        ...state,
        activities: state.activities.map((a) => {
          if (a.id !== action.activityId) return a;
          const record = action.record ?? {};
          const crfValues = record.crfValues ?? {};
          const crfId =
            String(a.crfDefinition?.id ?? a.activity ?? "").trim() ||
            Object.keys(a.crfResponses ?? {})[0] ||
            null;
          const next = {
            ...a,
            activityExecutionHdrNo: record.activityExecutionHdrNo || a.activityExecutionHdrNo,
            fieldIds: { ...(a.fieldIds ?? {}), ...(record.fieldIds ?? {}) },
            appActivityCrfNo: record.appActivityCrfNo || a.appActivityCrfNo || null,
            crfVersion: record.crfVersion || a.crfVersion || null,
            crfName: record.crfName || a.crfName || null
          };
          if (crfId && Object.keys(crfValues).length > 0) {
            next.crfResponses = {
              ...(a.crfResponses ?? {}),
              [crfId]: {
                values: { ...(a.crfResponses?.[crfId]?.values ?? {}), ...crfValues },
                savedAt: new Date().toISOString()
              }
            };
          }
          return next;
        })
      };
    case "UPDATE_ALIQUOT_DB_ID":
      return {
        ...state,
        aliquots: state.aliquots.map((a) =>
          a.id === action.aliquotId ? {
            ...a,
            activityExecutionAliquotNo: action.record.activityExecutionAliquotNo || a.activityExecutionAliquotNo
          } : a
        )
      };
    case "APPLY_GENERATED_STATE":
      // Preserve UI-only prefs that workflow payloads may omit (e.g. Scan/Manual).
      return {
        ...action.state,
        subjectMode: action.state?.subjectMode ?? state.subjectMode ?? "scan",
      };
    default:
      return state;
  }
}
const LabContext = createContext(null);
function LabProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, void 0, () => createLabInitialState());
  useEffect(() => {
    const id = setInterval(() => dispatch({ type: "TICK" }), 15e3);
    return () => clearInterval(id);
  }, []);
  const [persistError, setPersistError] = useState(null);
  const reportPersistError = useCallback((message) => {
    setPersistError(message || "Failed to save execution data.");
  }, []);
  const clearPersistError = useCallback(() => setPersistError(null), []);

  const scan = useCallback((code) => dispatch({ type: "SCAN", code }), []);
  const setDoseTime = useCallback(
    async (visitId, actualDoseTime, changeReason, options) => {
      const activityId = options?.activityId;
      const before = activityId
        ? state.activities.find((activity) => activity.id === activityId)
        : state.activities.find(
            (activity) => activity.visitId === visitId && activity.activity === "IMP Dose Administration"
          );
      const nextState = setDoseDateTime(state, visitId, actualDoseTime, changeReason, {
        confirmSchedule: options?.confirmSchedule,
        activityId,
      });
      const savedDose = activityId
        ? nextState.activities.find((activity) => activity.id === activityId)
        : nextState.activities.find(
            (activity) => activity.visitId === visitId && activity.activity === "IMP Dose Administration"
          );
      // Success only when the targeted dose row actually got the new time (not a no-op / wrong row).
      const success =
        !!savedDose?.actualTime
        && savedDose.actualTime === actualDoseTime
        && before?.actualTime !== actualDoseTime;

      if (!success) {
        return {
          success: false,
          message: nextState.lastScanMessage ?? "Could not save dose time.",
        };
      }

      const applyLocal = (record) => {
        dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
        if (record && savedDose.id) {
          dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId: savedDose.id, record });
        }
      };

      if (before?.actualTime) {
        // Dose edit: keep optimistic UI + rollback on failure (edit path uses field patch).
        applyLocal();
        const previousState = state;
        await new Promise((resolve) => {
          persistFieldEditIfNeeded(
            nextState,
            savedDose.id,
            {
              ActualTime: actualDoseTime,
              ScheduledTime: actualDoseTime,
            },
            changeReason || "",
            (message) => {
              dispatch({ type: "APPLY_GENERATED_STATE", state: previousState });
              reportPersistError(message);
              resolve();
            },
            (record) => {
              if (record && savedDose.id) {
                dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId: savedDose.id, record });
              }
              resolve();
            }
          );
        });
        return { success: true, message: nextState.lastScanMessage ?? null };
      }

      const result = await persistDoseIfNeeded(
        nextState,
        visitId,
        actualDoseTime,
        changeReason,
        reportPersistError,
        savedDose.id
      );
      if (result?.ok === false) {
        return {
          success: false,
          message: "Could not save dose time.",
        };
      }
      applyLocal(result?.record);
      return { success: true, message: nextState.lastScanMessage ?? null };
    },
    [state, reportPersistError]
  );
  const doseNow = useCallback(async (visitId) => {
    const nextState = completeDoseNow(state, visitId);
    const savedDose = nextState.activities.find(
      (activity) => activity.visitId === visitId && activity.activity === "IMP Dose Administration"
    );
    if (!savedDose?.actualTime) return false;
    const result = await persistDoseIfNeeded(
      nextState,
      visitId,
      savedDose.actualTime,
      undefined,
      reportPersistError
    );
    if (result?.ok === false) return false;
    dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
    return true;
  }, [state, reportPersistError]);
  const completePk = useCallback(
    async (activityId, actualTime, method, remarkText) => {
      const nextState = completePkCollectionAt(state, activityId, actualTime, method, remarkText);

      const previousActiveVisitId = state.activeVisitId;
      const promotedNext = nextState.activities.find(a => a.status === "Ready" || a.status === "Upcoming");
      let finalState = nextState;
      if (promotedNext && promotedNext.visitId !== previousActiveVisitId && promotedNext.subjectId === state.activeSubjectId) {
        finalState = { ...nextState, activeVisitId: promotedNext.visitId };
      }

      // Persist first — only update UI after API accepts (avoids PRMS error flash).
      const result = await persistPkCollectionIfNeeded(
        nextState,
        activityId,
        actualTime,
        reportPersistError
      );
      if (result?.ok === false) return false;

      dispatch({ type: "APPLY_GENERATED_STATE", state: finalState });
      if (result?.record) {
        dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId, record: result.record });
      }
      return true;
    },
    [state, reportPersistError]
  );
  const recordTimepointBarcodeScan = useCallback(
    (pkCode, scanTime) => {
      const beforeSample = (state.samples ?? []).find(
        (sample) => String(sample.barcode ?? "").toUpperCase() === String(pkCode ?? "").trim().toUpperCase()
      );
      const nextState = applyTimepointBarcodeScanTimings(state, pkCode, scanTime);
      if (nextState !== state) {
        const previousActiveVisitId = state.activeVisitId;
        const promotedNext = nextState.activities.find(a => a.status === "Ready" || a.status === "Upcoming");
        let finalState = nextState;
        if (promotedNext && promotedNext.visitId !== previousActiveVisitId && promotedNext.subjectId === state.activeSubjectId) {
          finalState = { ...nextState, activeVisitId: promotedNext.visitId };
        }
        dispatch({ type: "APPLY_GENERATED_STATE", state: finalState });

        const sampleId = beforeSample?.id;
        const updated = sampleId
          ? finalState.samples.find((sample) => sample.id === sampleId)
          : null;
        const activity = updated
          ? finalState.activities.find(
              (item) => item.id === updated.activityId || item.sampleId === sampleId
            )
          : null;
        const onSuccess = (record, activityId) => {
          if (record && (activityId || activity?.id)) {
            dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId: activityId || activity.id, record });
          }
        };
        if (sampleId && updated && !beforeSample?.scanStartTime && updated.scanStartTime) {
          persistCentrifugeStartIfNeeded(finalState, sampleId, updated.scanStartTime, reportPersistError, onSuccess);
        } else if (sampleId && updated && beforeSample?.scanStartTime && !beforeSample?.scanEndTime && updated.scanEndTime) {
          persistCentrifugeEndIfNeeded(finalState, sampleId, reportPersistError, onSuccess);
        }
        return finalState;
      }
      return nextState;
    },
    [state, reportPersistError]
  );
  const setActivityActual = useCallback(
    async (activityId, actualTime, changeReason) => {
      const previousState = state;
      const before = state.activities.find((activity) => activity.id === activityId);
      const nextState = setActivityActualTime(state, activityId, actualTime, changeReason);
      const updated = nextState.activities.find((activity) => activity.id === activityId);
      const success =
        !!updated?.actualTime
        && updated.actualTime === actualTime
        && (!before?.actualTime || updated.actualTime !== before.actualTime);
      if (!success) {
        return {
          success: false,
          message: nextState.lastScanMessage ?? "Could not save actual time.",
        };
      }

      const isEdit = !!before?.actualTime;
      const isDose = updated.activity === "IMP Dose Administration";
      const applyLocal = (record) => {
        dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
        if (record) {
          dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId, record });
        }
      };

      if (isEdit) {
        applyLocal();
        await new Promise((resolve) => {
          persistActualTimeEditIfNeeded(
            nextState,
            activityId,
            updated.actualTime,
            changeReason,
            (message) => {
              dispatch({ type: "APPLY_GENERATED_STATE", state: previousState });
              reportPersistError(message);
              resolve();
            },
            (record) => {
              if (record) {
                dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId, record });
              }
              resolve();
            },
            before?.remarks
          );
        });
        return { success: true, message: nextState.lastScanMessage ?? null };
      }

      if (isDose) {
        const result = await persistDoseIfNeeded(
          nextState,
          updated.visitId,
          updated.actualTime,
          changeReason,
          reportPersistError,
          activityId
        );
        if (result?.ok === false) {
          return { success: false, message: nextState.lastScanMessage ?? "Could not save actual time." };
        }
        applyLocal(result?.record);
        return { success: true, message: nextState.lastScanMessage ?? null };
      }

      // First PK collect — persist first so PRMS failures never flash table data.
      const result = await persistPkCollectionIfNeeded(
        nextState,
        activityId,
        updated.actualTime,
        reportPersistError
      );
      if (result?.ok === false) {
        return { success: false, message: nextState.lastScanMessage ?? "Could not save actual time." };
      }
      applyLocal(result?.record);
      return { success: true, message: nextState.lastScanMessage ?? null };
    },
    [state, reportPersistError]
  );
  const startCentrifuge = useCallback((sampleId, actualTime) => {
    const nextState = startCentrifugation(state, sampleId, actualTime);
    dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
    const activity = nextState.activities.find(
      (item) => item.sampleId === sampleId || nextState.samples.find((s) => s.id === sampleId)?.activityId === item.id
    );
    const onSuccess = (record, activityId) => {
      if (record) {
        dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId: activityId || activity?.id, record });
      }
    };
    persistCentrifugeStartIfNeeded(nextState, sampleId, actualTime, reportPersistError, onSuccess);
  }, [state, reportPersistError]);
  /** Apply centrifuge start to many PK samples with one shared time (Add On batch). */
  const startCentrifugeBatch = useCallback((sampleIds, actualTime) => {
    const ids = (sampleIds ?? []).filter(Boolean);
    if (!ids.length) return;
    const startTime = actualTime || nowIso();
    let nextState = state;
    for (const sampleId of ids) {
      nextState = startCentrifugation(nextState, sampleId, startTime);
    }
    dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
    for (const sampleId of ids) {
      const onSuccess = (record, activityId) => {
        if (record && activityId) {
          dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId, record });
        }
      };
      persistCentrifugeStartIfNeeded(nextState, sampleId, startTime, reportPersistError, onSuccess);
    }
  }, [state, reportPersistError]);
  const editCentrifugeStart = useCallback(
    (sampleId, newStartTime, changeReason) => {
      const nextState = editCentrifugeStartFn(state, sampleId, newStartTime, changeReason);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      const updated = nextState.samples.find((s) => s.id === sampleId);
      const activity = nextState.activities.find(
        (item) => item.id === updated?.activityId || item.sampleId === sampleId
      );
      if (updated?.centrifugationStart) {
        const onSuccess = (record) => {
          if (record && activity?.id) {
            dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId: activity.id, record });
          }
        };
        persistCentrifugeStartEditIfNeeded(nextState, sampleId, updated.centrifugationStart, changeReason, reportPersistError, onSuccess);
      }
    },
    [state, reportPersistError]
  );
  const editCentrifugeEnd = useCallback(
    (sampleId, newEndTime, changeReason) => {
      const nextState = editCentrifugeEndFn(state, sampleId, newEndTime, changeReason);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      const updated = nextState.samples.find((s) => s.id === sampleId);
      const activity = nextState.activities.find(
        (item) => item.id === updated?.activityId || item.sampleId === sampleId
      );
      if (updated?.centrifugationEnd) {
        const onSuccess = (record) => {
          if (record && activity?.id) {
            dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId: activity.id, record });
          }
        };
        persistCentrifugeEndEditIfNeeded(nextState, sampleId, updated.centrifugationEnd, changeReason, reportPersistError, onSuccess);
      }
    },
    [state, reportPersistError]
  );
  const editTimepointScanStart = useCallback(
    (sampleId, newStartTime, changeReason) => {
      const nextState = editTimepointScanStartFn(state, sampleId, newStartTime, changeReason);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      const updated = nextState.samples.find((s) => s.id === sampleId);
      const activity = nextState.activities.find(
        (item) => item.id === updated?.activityId || item.sampleId === sampleId
      );
      if (updated?.scanStartTime) {
        const onSuccess = (record) => {
          if (record && activity?.id) {
            dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId: activity.id, record });
          }
        };
        persistCentrifugeStartEditIfNeeded(nextState, sampleId, updated.scanStartTime, changeReason, reportPersistError, onSuccess);
      }
    },
    [state, reportPersistError]
  );
  const editTimepointScanEnd = useCallback(
    (sampleId, newEndTime, changeReason) => {
      const nextState = editTimepointScanEndFn(state, sampleId, newEndTime, changeReason);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      const updated = nextState.samples.find((s) => s.id === sampleId);
      const activity = nextState.activities.find(
        (item) => item.id === updated?.activityId || item.sampleId === sampleId
      );
      if (updated?.scanEndTime) {
        const onSuccess = (record) => {
          if (record && activity?.id) {
            dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId: activity.id, record });
          }
        };
        persistCentrifugeEndEditIfNeeded(nextState, sampleId, updated.scanEndTime, changeReason, reportPersistError, onSuccess);
      }
    },
    [state, reportPersistError]
  );
  const endCentrifuge = useCallback((sampleId) => {
    const nextState = endCentrifugation(state, sampleId);
    dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
    const onSuccess = (record, activityId) => {
      if (record && activityId) {
        dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId, record });
      }
    };
    persistCentrifugeEndIfNeeded(nextState, sampleId, reportPersistError, onSuccess);
  }, [state, reportPersistError]);
  const setAliquotParent = useCallback((sampleId) => dispatch({ type: "SET_ALIQUOT_PARENT", sampleId }), []);
  const linkAliquot = useCallback(
    (parentSampleId, code) => {
      const nextState = linkAliquotToParent(state, parentSampleId, code);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      const linked = (nextState.aliquots ?? []).find(
        (item) => String(item.barcode ?? "").toUpperCase() === String(code ?? "").trim().toUpperCase()
          && item.createdAt
      );
      if (linked) {
        persistAliquotLinkIfNeeded(nextState, parentSampleId, code, reportPersistError);
        persistAliquotedStatusIfNeeded(nextState, parentSampleId, reportPersistError);
      }
    },
    [state, reportPersistError]
  );
  const skipAliquotAction = useCallback(
    (aliquotId, reason) => {
      const nextState = skipAliquot(state, aliquotId, reason);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      const p = persistAliquotSkipIfNeeded(nextState, aliquotId, reason, reportPersistError);
      if (p) {
        p.then((apiRecord) => {
          if (apiRecord && apiRecord.activityExecutionAliquotNo) {
            dispatch({ type: "UPDATE_ALIQUOT_DB_ID", aliquotId, record: apiRecord });
          }
        });
      }
      const parentId = nextState.aliquots?.find((a) => a.id === aliquotId)?.parentSampleId;
      if (parentId) persistAliquotedStatusIfNeeded(nextState, parentId, reportPersistError);
    },
    [state, reportPersistError]
  );
  const editAliquotSkipRemarkAction = useCallback(
    (aliquotId, text) => {
      const nextState = editAliquotSkipRemark(state, aliquotId, text);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      persistAliquotSkipIfNeeded(nextState, aliquotId, text, reportPersistError);
    },
    [state, reportPersistError]
  );
  const skip = useCallback(
    (activityId, remark2) => {
      const nextState = skipActivity(state, activityId, remark2);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      // Collect all newly-skipped activities (target + cascade from dose skip)
      const newlySkipped = (nextState.activities ?? []).filter((activity) => {
        const before = state.activities.find((a) => a.id === activity.id);
        return before && before.status !== "Skipped" && activity.status === "Skipped";
      });
      if (newlySkipped.length === 0) return;
      if (newlySkipped.length === 1) {
        // Single skip – individual API call
        const onSuccess = (record) => {
          if (record) {
            dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId: newlySkipped[0].id, record });
          }
        };
        persistSkipIfNeeded(nextState, newlySkipped[0].id, newlySkipped[0].remarks ?? remark2, reportPersistError, onSuccess);
      } else {
        // Dose skip cascade – bulk API call
        const allIds = newlySkipped.map((a) => a.id);
        const onSuccess = (records, validIds) => {
          if (Array.isArray(records) && Array.isArray(validIds)) {
            for (let i = 0; i < records.length; i++) {
              if (records[i] && validIds[i]) {
                dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId: validIds[i], record: records[i] });
              }
            }
          }
        };
        persistBulkSkipIfNeeded(nextState, allIds, remark2, reportPersistError, onSuccess);
      }
    },
    [state, reportPersistError]
  );
  const skipPending = useCallback(
    (activityIds, remark2, collectActivityId, collectActualTime, method) => {
      const previousState = state;
      const nextState = skipPendingActivities(
        state,
        activityIds,
        remark2,
        collectActivityId,
        collectActualTime,
        method
      );
      
      const previousActiveVisitId = state.activeVisitId;
      // Only look at current subject's activities when promoting next visit
      const currentSubjectId = state.activeSubjectId;
      const promotedNext = nextState.activities.find(
        (a) => a.subjectId === currentSubjectId && (a.status === "Ready") && a.visitId !== previousActiveVisitId
      );
      let finalState = nextState;
      if (promotedNext && promotedNext.visitId !== previousActiveVisitId && promotedNext.subjectId === currentSubjectId) {
        finalState = { ...nextState, activeVisitId: promotedNext.visitId };
      }
      
      dispatch({ type: "APPLY_GENERATED_STATE", state: finalState });

      const rollbackSkip = (message) => {
        dispatch({ type: "APPLY_GENERATED_STATE", state: previousState });
        reportPersistError(message || "Failed to save skipped timepoints. Changes were reverted.");
      };

      // Persist every newly-skipped row (includes dose-skip cascade), same as skip().
      const newlySkipped = (nextState.activities ?? []).filter((activity) => {
        const before = state.activities.find((a) => a.id === activity.id);
        return before && before.status !== "Skipped" && activity.status === "Skipped";
      });
      if (newlySkipped.length === 1) {
        const onSuccess = (record) => {
          if (record) {
            dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId: newlySkipped[0].id, record });
          }
        };
        persistSkipIfNeeded(
          finalState,
          newlySkipped[0].id,
          newlySkipped[0].remarks ?? remark2,
          rollbackSkip,
          onSuccess
        );
      } else if (newlySkipped.length > 1) {
        const allIds = newlySkipped.map((a) => a.id);
        const onSuccess = (records, validIds, meta) => {
          if (Array.isArray(records) && Array.isArray(validIds)) {
            for (let i = 0; i < records.length; i++) {
              if (records[i] && validIds[i]) {
                dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId: validIds[i], record: records[i] });
              }
            }
          }
          if (meta?.droppedCount > 0) {
            reportPersistError(
              `${meta.droppedCount} skipped timepoint(s) could not be saved (missing subject/timepoint keys). Re-scan and confirm Skip Pending again.`
            );
          }
        };
        persistBulkSkipIfNeeded(finalState, allIds, remark2, rollbackSkip, onSuccess);
      }
      if (collectActivityId) {
        const collected = nextState.activities.find((a) => a.id === collectActivityId);
        if (collected?.actualTime) {
          persistPkCollectionIfNeeded(
            nextState,
            collectActivityId,
            collected.actualTime,
            rollbackSkip,
            (record) => {
              if (record) {
                dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId: collectActivityId, record });
              }
            }
          );
        }
      }
    },
    [state, reportPersistError]
  );
  const remark = useCallback(
    (activityId, text) => {
      const nextState = addRemark(state, activityId, text);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      const updated = nextState.activities.find((a) => a.id === activityId);
      const onSuccess = (record) => {
        if (record) {
          dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId, record });
        }
      };
      // Remarks value is the field; leave changeReason empty so audit Old/New come from vFieldValue.
      if (updated?.status === "Skipped") {
        persistSkipIfNeeded(nextState, activityId, text, reportPersistError, onSuccess);
      } else if (updated?.actualTime) {
        persistFieldEditIfNeeded(nextState, activityId, { Remarks: text }, "", reportPersistError, onSuccess);
      }
    },
    [state, reportPersistError]
  );
  const saveCrf = useCallback(
    (activityId, crfId, values, changeReason) => {
      const result = saveActivityCrfResponse(state, activityId, crfId, values, changeReason);
      if (result.error) {
        return { success: false, message: result.error };
      }
      dispatch({ type: "APPLY_GENERATED_STATE", state: result.state });
      const onSuccess = (record) => {
        if (record) {
          dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId, record });
        }
      };
      // Only filled / intentionally cleared fields — never POST empty never-filled optionals.
      persistCrfIfNeeded(
        result.state,
        activityId,
        crfId,
        result.persistValues ?? {},
        changeReason,
        reportPersistError,
        onSuccess
      );
      return { success: true, message: "" };
    },
    [state, reportPersistError]
  );
  const saveCrfField = useCallback(
    (activityId, crfId, fieldId, value, changeReason) => {
      const result = saveActivityCrfField(state, activityId, crfId, fieldId, value, changeReason);
      if (result.error) {
        return { success: false, message: result.error };
      }
      dispatch({ type: "APPLY_GENERATED_STATE", state: result.state });
      const onSuccess = (record) => {
        if (record) {
          dispatch({ type: "UPDATE_ACTIVITY_DB_IDS", activityId, record });
        }
      };
      // Mobile single-field: send only the edited field so siblings are not blanked.
      persistCrfIfNeeded(
        result.state,
        activityId,
        crfId,
        result.persistValues ?? { [fieldId]: value },
        changeReason,
        reportPersistError,
        onSuccess
      );
      return { success: true, message: "" };
    },
    [state, reportPersistError]
  );
  const markDev = useCallback(
    (activityId, text) => dispatch({ type: "MARK_DEVIATION", activityId, text }),
    []
  );
  const resolveDev = useCallback(
    (deviationId) => dispatch({ type: "RESOLVE_DEVIATION", deviationId }),
    []
  );
  const setActive = useCallback(
    (subjectId, visitId) => dispatch({ type: "SET_ACTIVE", subjectId, visitId }),
    []
  );
  const generateBarcodes = useCallback(
    (params) => {
      let workingState = state;
      let projectId = params.projectId;
      const projectCode = String(params.projectCode ?? "").trim();
      const stateProjects = getBarcodeProjects(workingState);
      const projectInState =
        stateProjects.find((item) => item.id === projectId) ??
        (projectCode
          ? stateProjects.find((item) => String(item.code ?? "").trim().toUpperCase() === projectCode.toUpperCase())
          : null);

      if (!projectInState && projectCode) {
        try {
          workingState = addBarcodeProject(workingState, {
            code: projectCode,
            name: `Project ${projectCode}`,
          });
        } catch {
          // Project may already exist in working state after a concurrent registration.
        }
        projectId =
          getBarcodeProjects(workingState).find(
            (item) => String(item.code ?? "").trim().toUpperCase() === projectCode.toUpperCase()
          )?.id ?? projectId;
      } else if (projectInState) {
        projectId = projectInState.id;
      }

      const nextState = generateBarcodeBatch(workingState, {
        ...params,
        projectId,
        projectCode,
        resolvedPeriods:
          params.resolvedPeriods?.length > 0
            ? params.resolvedPeriods
            : getResolvedPeriodsForProject(workingState, projectId),
      });
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      return nextState;
    },
    [state]
  );
  const addProject = useCallback(
    (params) => {
      const nextState = addBarcodeProject(state, params);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      return nextState;
    },
    [state]
  );
  const importSchedule = useCallback(
    (projectId, schedule) => {
      const nextState = importProjectSchedule(state, projectId, schedule);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      return nextState;
    },
    [state]
  );
  const importBarcodes = useCallback(
    (importPayload, options = {}) => {
      const nextState = mergeImportedBarcodeRun(state, importPayload, options);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      return nextState;
    },
    [state]
  );
  const loadExecutionSessionFromApi = useCallback(
    async (apiPayload) => {
      let nextState = loadStartByScanSessionIntoState(state, apiPayload);
      const subjectId = nextState.activeSubjectId;
      // Apply history pins before CRF hydrate so by-nos loads the saved version (not latest).
      if (apiPayload?.history && subjectId) {
        nextState = mergeExecutionHistoryIntoState(nextState, apiPayload.history, subjectId);
      }
      nextState = await hydrateCrfDefinitionsInState(nextState);
      const subjectMstNo =
        apiPayload?.subject?.subjectMstNo
        ?? apiPayload?.subject?.SubjectMstNo
        ?? nextState.subjects.find((item) => item.id === subjectId)?.subjectMstNo;
      const visitReviews = apiPayload?.visitReviews ?? apiPayload?.VisitReviews ?? [];
      if (subjectMstNo && visitReviews.length) {
        nextState = applyVisitReviewStatusesToState(nextState, visitReviews, subjectMstNo);
      }
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      return nextState;
    },
    [state]
  );
  const mergeExecutionHistory = useCallback(
    async (history, subjectId) => {
      let nextState = mergeExecutionHistoryIntoState(state, history, subjectId);
      nextState = await hydrateCrfDefinitionsInState(nextState);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      return nextState;
    },
    [state]
  );
  const applyVisitReviewStatuses = useCallback(
    (apiVisits, subjectMstNo, baseState = null) => {
      const nextState = applyVisitReviewStatusesToState(baseState ?? state, apiVisits, subjectMstNo);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      return nextState;
    },
    [state]
  );
  const linkSubjectBarcode = useCallback(
    (barcodeCode, targetSubjectId) => {
      const nextState = linkGeneratedSubjectBarcode(state, barcodeCode, targetSubjectId);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      return nextState;
    },
    [state]
  );
  const setSubjectMode = useCallback(
    (subjectMode) => dispatch({ type: "SET_SUBJECT_MODE", subjectMode }),
    []
  );
  const setActiveProject = useCallback(
    (projectId) => dispatch({ type: "SET_ACTIVE_PROJECT", projectId }),
    []
  );
  const resetDemo = useCallback(() => dispatch({ type: "RESET" }), []);
  const submitForReview = useCallback(
    (visitId) => {
      const nextState = submitVisitForReview(state, visitId);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      const visit = nextState.visits.find((item) => item.id === visitId);
      return {
        success: visit?.reviewStatus === "Submitted",
        message: nextState.lastScanMessage ?? "Could not submit dose for review.",
        state: nextState,
      };
    },
    [state]
  );
  const reviewActivity = useCallback(
    (activityId) => {
      const nextState = reviewActivityRecord(state, activityId);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      const activity = nextState.activities.find((item) => item.id === activityId);
      return {
        success: activity?.reviewStatus === "Reviewed",
        message: nextState.lastScanMessage ?? "Could not review activity."
      };
    },
    [state]
  );
  const reviewActivities = useCallback(
    (activityIds) => {
      const nextState = reviewActivityRecords(state, activityIds);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      return {
        success: nextState.lastScanMessage?.includes("reviewed") ?? false,
        message: nextState.lastScanMessage ?? "Could not review selected records."
      };
    },
    [state]
  );
  const raiseReviewQueryAction = useCallback(
    (activityId, queryText, fieldKey) => {
      const nextState = raiseReviewQuery(state, activityId, queryText, fieldKey);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      const activity = nextState.activities.find((item) => item.id === activityId);
      return {
        success: activity?.reviewQueryStatus === "raised",
        message: nextState.lastScanMessage ?? "Could not raise review query."
      };
    },
    [state]
  );
  const reraiseReviewQueryAction = useCallback(
    (activityId, queryText) => {
      const nextState = reraiseReviewQuery(state, activityId, queryText);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      const activity = nextState.activities.find((item) => item.id === activityId);
      return {
        success: activity?.reviewQueryStatus === "raised",
        message: nextState.lastScanMessage ?? "Could not re-raise review query."
      };
    },
    [state]
  );
  const sendbackReviewQueryAction = useCallback(
    (activityId, remark) => {
      const nextState = sendbackReviewQuery(state, activityId, remark);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      const activity = nextState.activities.find((item) => item.id === activityId);
      return {
        success: activity?.reviewQueryStatus === "sendback",
        message: nextState.lastScanMessage ?? "Could not send query back."
      };
    },
    [state]
  );
  const closeReviewQueryAction = useCallback(
    (activityId, remark) => {
      const nextState = closeReviewQuery(state, activityId, remark);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      const activity = nextState.activities.find((item) => item.id === activityId);
      return {
        success: activity?.reviewQueryStatus === "closed",
        message: nextState.lastScanMessage ?? "Could not close review query."
      };
    },
    [state]
  );
  const resolveReviewQueryAction = useCallback(
    (activityId, responseText, fieldValue) => {
      const nextState = fieldValue !== undefined
        ? resolveReviewQueryWithFieldValue(state, activityId, {
            fieldValue,
            responseText
          })
        : resolveReviewQuery(state, activityId, responseText);
      dispatch({ type: "APPLY_GENERATED_STATE", state: nextState });
      const activity = nextState.activities.find((item) => item.id === activityId);
      return {
        success: activity?.reviewQueryStatus === "resolved",
        message: nextState.lastScanMessage ?? "Could not resolve review query."
      };
    },
    [state]
  );
  const value = useMemo(
    () => ({
      state,
      scan,
      setDoseTime,
      doseNow,
      completePk,
      recordTimepointBarcodeScan,
      setActivityActual,
      startCentrifuge,
      startCentrifugeBatch,
      editCentrifugeStart,
      editCentrifugeEnd,
      editTimepointScanStart,
      editTimepointScanEnd,
      endCentrifuge,
      setAliquotParent,
      linkAliquot,
      skipAliquot: skipAliquotAction,
      editAliquotSkipRemark: editAliquotSkipRemarkAction,
      skip,
      skipPending,
      remark,
      saveCrf,
      saveCrfField,
      markDeviation: markDev,
      resolveDeviation: resolveDev,
      setActive,
      generateBarcodes,
      addProject,
      importSchedule,
      importBarcodes,
      loadExecutionSessionFromApi,
      mergeExecutionHistory,
      applyVisitReviewStatuses,
      linkSubjectBarcode,
      setSubjectMode,
      setActiveProject,
      resetDemo,
      submitForReview,
      reviewActivity,
      reviewActivities,
      raiseReviewQuery: raiseReviewQueryAction,
      reraiseReviewQuery: reraiseReviewQueryAction,
      sendbackReviewQuery: sendbackReviewQueryAction,
      closeReviewQuery: closeReviewQueryAction,
      resolveReviewQuery: resolveReviewQueryAction,
      persistError,
      clearPersistError,
    }),
    [state, scan, setDoseTime, doseNow, completePk, recordTimepointBarcodeScan, setActivityActual, startCentrifuge, startCentrifugeBatch, editCentrifugeStart, editCentrifugeEnd, editTimepointScanStart, editTimepointScanEnd, endCentrifuge, setAliquotParent, linkAliquot, skipAliquotAction, editAliquotSkipRemarkAction, skip, skipPending, remark, saveCrf, saveCrfField, markDev, resolveDev, setActive, generateBarcodes, addProject, importSchedule, importBarcodes, loadExecutionSessionFromApi, mergeExecutionHistory, applyVisitReviewStatuses, linkSubjectBarcode, setSubjectMode, setActiveProject, resetDemo, submitForReview, reviewActivity, reviewActivities, raiseReviewQueryAction, reraiseReviewQueryAction, sendbackReviewQueryAction, closeReviewQueryAction, resolveReviewQueryAction, persistError, clearPersistError]
  );
  return <LabContext.Provider value={value}>{children}</LabContext.Provider>;
}
function useLab() {
  const ctx = useContext(LabContext);
  if (!ctx) throw new Error("useLab must be used within LabProvider");
  return ctx;
}
export {
  LabProvider,
  useLab
};
