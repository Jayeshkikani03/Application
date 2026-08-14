import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLab } from "../context/LabContext";
import { useAuth } from "../context/AuthContext";
import { AuditHistoryModal } from "../components/shared/AuditHistoryModal.jsx";
import { DbAuditHistoryTableBody } from "../components/shared/DbAuditHistoryTableBody.jsx";
import { AuditDetailModal } from "../components/shared/AuditDetailModal";
import { ActivityGrid } from "../components/shared/ActivityGrid";
import { buildActivityFieldDbAuditTarget } from "../shared/audit/activityFieldDbAudit.js";
import { DateTime24Input, DoseModal, CrfFieldModal, RemarkModal, PasswordConfirmModal } from "../components/shared/Modal";
import { CrfModal } from "../components/shared/CrfModal";
import { ReviewQueryModal } from "../components/shared/ReviewQueryModal";
import { buildCrfInitialValues, getCrfDefinitionForActivity, resolveCrfSavedValues, activityHasCrf, isActivityReadyForCrf, getCrfNotReadyMessage, getMissingRequiredCrfSubmitMessage, hydrateCrfDefinitionsForActivities, ensureCrfDefinitionsByNosLoaded, ensureCrfDefinitionLoaded, isCrfDisabledForActivity } from "../services/crfService";
import { exportActivityCompliancePdf, expandExportDatasetFromSchedule } from "../shared/exportActivityCompliancePdf.js";
import { getActiveReviewQueryRemarkText, isActiveReviewQuery, matchesReviewQueryField } from "../services/reviewQueryService";
import {
  buildAuditFallbackRow
} from "../services/activityAuditService";
import { isTerminalActivityStatus } from "../shared/domain/activityStatuses.js";
import { BarcodeCameraModal } from "../components/shared/BarcodeCameraModal";
import { CentrifugeBatchPanel } from "../components/shared/CentrifugeBatchPanel";
import { ScanZone } from "../components/shared/ScanZone";
import { StatusBadge } from "../components/shared/StatusBadge";
import { AliquotSkipRemarkCell } from "../components/shared/AliquotSkipRemarkCell";
import { ScrollableSelect } from "../components/shared/ScrollableSelect";
import { useCountdown } from "../hooks/useLiveClock";
import { useViewport } from "../hooks/useViewport";
import { useScanNavRegistration } from "../context/ScanNavContext";
import { ExecutionHomeDashboard } from "../components/activityExecution/ExecutionHomeDashboard.jsx";
import {
  formatDateTimeLocal,
  formatDisplayDateTime,
  formatDisplayTime,
  formatWindow,
  fromDateTimeLocal,
  nowIso,
  getPkScanTarget,
  isDoseRecordEditLocked,
  getSampleExpectedAliquotBarcodes,
  isSampleAliquotSeparationComplete,
  resolveAliquotParentSample,
  resolveCentrifugeStartTime,
  resolvePkScanIntent,
  resolveActivitySample,
  usesCentrifugeWorkflowStart,
  findVisitForSubjectDose,
  isVisitReadyForSubmit,
  resolveDoseReviewDisplayStatus
} from "../services/workflowService";
import { formatActivityTimepointLabel, formatDoseDisplayLabel, formatNextActivityHeader, formatTimepointDisplayLabel, formatTimepointWithDose, getPeriodLabel, formatDoseVisitPeriodLabel, formatDoseWithVisit } from "../utils/visitDisplay";
import { isExecutionReviewLocked } from "../features/activityExecution/utils/hdrStatus.js";
import { findSubjectBarcodeForProject } from "../services/projectSubjectService";
import { startSessionByScan, getPublishedExecutionSchedule } from "../features/activityExecution/api/activityExecutionApi.js";
import { buildExecutionPageView } from "../features/activityExecution/utils/buildExecutionPageView.js";
import { compareActivitiesBySchedule } from "../services/activityScheduleSyncService";
import { fetchSubjectsList } from "../features/participants/api/participantsApi.js";
import { validatePassword } from "../features/auth/api/authApi";
import { submitVisitByDoseApi, fetchReviewVisits, resolveReviewQueryApi, fetchReviewQueryAuditApi, mapReviewQueryAuditEventsToRows } from "../features/review/api/reviewApi";
import {
  UI_LABELS,
  wrongParticipantScanMessage,
  selectParticipantBeforePkScanMessage,
  scanParticipantOrPkMessage,
  selectParticipantToLinkBarcodeMessage,
  participantAlreadyLinkedBarcodeMessage,
  unableToLinkParticipantBarcodeMessage,
} from "../constants/displayLabels";
import {
  formatParticipantDisplay,
  formatParticipantDropdownLabel,
  resolveSiteRandomizationNumber,
} from "../utils/participantDisplay";

const getDoseNumber = (doseStr) => {
  if (!doseStr) return 0;
  const match = String(doseStr).match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
};
function getPkBarcodeOwnerSubjectId(state, rawCode) {
  const target = getPkScanTarget(state, rawCode);
  return target?.subjectId ?? null;
}
function formatWrongSubjectPkScanAlert(state, code, ownerSubjectId) {
  const ownerSubject = state.subjects.find((subject) => subject.id === ownerSubjectId);
  const normalizedCode = code.trim().toUpperCase();
  const ownerLabel = ownerSubject
    ? formatParticipantDropdownLabel(ownerSubject)
    : UI_LABELS.anotherParticipant;
  return wrongParticipantScanMessage(normalizedCode, ownerLabel);
}
const getTimepointIndex = (a) => {
  if (a.activity === "IMP Dose Administration") {
    return Number.isFinite(Number(a.order)) ? Number(a.order) : 0;
  }
  if (Number.isFinite(Number(a.order))) return Number(a.order);
  if (Number.isFinite(Number(a.offset))) return Number(a.offset);
  return 999;
};
const sortActivities = (a, b) => {
  const doseA = getDoseNumber(a.dose);
  const doseB = getDoseNumber(b.dose);
  if (doseA !== doseB) return doseA - doseB;
  return getTimepointIndex(a) - getTimepointIndex(b);
};


function formatPendingSampleLabel(sample, visits) {
  const visit = visits.find((item) => item.id === sample.visitId);
  const doseStr = sample.dose ?? (visit ? (visit.doseLabel ?? visit.dose ?? "") : "");
  const timepointDisplay = formatTimepointWithDose(sample.timepointLabel ?? sample.timepoint, doseStr);
  return `${timepointDisplay} (${sample.barcode})`;
}
function hasLinkedGeneratedSubjectBarcode(state, targetSubjectId) {
  const subject = state.subjects.find((s) => s.id === targetSubjectId);
  if (subject?.generated) return true;
  return state.barcodes.some(
    (barcode) =>
      barcode.type === "subject" &&
      !!barcode.generatedRunId &&
      (barcode.subjectId === targetSubjectId || barcode.pendingSubjectId === targetSubjectId) &&
      !barcode.unlinked
  );
}
function getGeneratedSubjectForBarcode(state, barcode) {
  if (!barcode) return null;
  const pendingSubjectId = barcode.pendingSubjectId ?? barcode.subjectId;
  if (!pendingSubjectId) return null;
  const pendingSubject = state.subjects.find((item) => item.id === pendingSubjectId);
  if (!pendingSubject?.generated) return null;
  const code = barcode.code.toUpperCase();
  if (pendingSubject.barcode?.toUpperCase() === code || pendingSubject.subjectNumber?.toUpperCase() === code) {
    return pendingSubject;
  }
  return null;
}
function formatSubjectSessionLabel(subject) {
  if (!subject) return "";
  return formatParticipantDisplay(subject);
}
function getSubjectDisplayBarcode(state, subject) {
  if (!subject) return "";
  return subject.linkedGeneratedBarcode ?? state.barcodes.find(
    (barcode) =>
      barcode.type === "subject" &&
      !!barcode.generatedRunId &&
      barcode.subjectId === subject.id &&
      !barcode.unlinked
  )?.code ?? subject.barcode;
}
function getActivitySubjectMstNo(state, activity) {
  if (!activity) return 0;
  return Number(activity.subjectMstNo)
    || Number(state.subjects.find((subject) => subject.id === activity.subjectId)?.subjectMstNo)
    || 0;
}
function getActualEditDeviationReason(activity, actualInput) {
  if (!activity || !actualInput || activity.timepoint.startsWith("Pre-Dose") || !activity.windowStart || !activity.windowEnd) return "";
  const actual = new Date(fromDateTimeLocal(actualInput)).getTime();
  const start = new Date(activity.windowStart).getTime();
  const end = new Date(activity.windowEnd).getTime();
  if (actual < start) return "Collected before window period";
  if (actual > end) return "Collected after window period";
  return "";
}
function formatAuditUtc(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false
  }).replace(",", "");
}
function formatAuditOffset(iso) {
  if (!iso) return "-";
  const offset = -new Date(iso).getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}
function formatAuditPerformedBy(user) {
  if (!user || user === "-") return "-";
  return user;
}
function ActivityExecutionPage() {
  // Sections: (1) LabContext + UI session state
  //           (2) Derived view via buildExecutionPageView
  //           (3) Session start (beginGatedSession → start-by-scan API)
  //           (4) Scan workflow (handleWorkflowScan)
  //           (5) Grid / modal handlers
  const { user, activeSite } = useAuth();
  const authProject = String(user?.project || "").trim();
  const authSite = String(activeSite || user?.site || "").trim();
  const {
    state,
    setActive,
    setDoseTime,
    completePk,
    recordTimepointBarcodeScan,
    setActivityActual,
    startCentrifuge,
    startCentrifugeBatch,
    endCentrifuge,
    setAliquotParent,
    linkAliquot,
    skipAliquot,
    editAliquotSkipRemark,
    skip,
    skipPending,
    remark,
    saveCrf,
    saveCrfField,
    markDeviation,
    linkSubjectBarcode,
    setSubjectMode,
    loadExecutionSessionFromApi,
    applyVisitReviewStatuses,
    persistError,
    clearPersistError,
    editTimepointScanStart,
    editCentrifugeStart,
    submitForReview,
    resolveReviewQuery
  } = useLab();
  const { subjectMode = "scan" } = state;
  const [subjectStarted, setSubjectStarted] = useState(false);
  const [subjectScan, setSubjectScan] = useState("");
  const [subjectCameraOpen, setSubjectCameraOpen] = useState(false);
  const [lockedSubjectBarcode, setLockedSubjectBarcode] = useState("");
  const [subjectStartBusy, setSubjectStartBusy] = useState(false);
  const [apiManualSubjects, setApiManualSubjects] = useState([]);
  const [doseModalOpen, setDoseModalOpen] = useState(false);
  const [doseModalMode, setDoseModalMode] = useState("setup");
  const [doseModalContext, setDoseModalContext] = useState(null);
  const [doseModalError, setDoseModalError] = useState("");
  const [doseModalSubtitle, setDoseModalSubtitle] = useState("");
  const [doseModalSubjectLabel, setDoseModalSubjectLabel] = useState("");
  const [actualEditTargetId, setActualEditTargetId] = useState(null);
  const [crfActivityId, setCrfActivityId] = useState(null);
  const [crfModalError, setCrfModalError] = useState("");
  const [crfResolveTarget, setCrfResolveTarget] = useState(null);
  const [actualEditInput, setActualEditInput] = useState("");
  const [actualEditReason, setActualEditReason] = useState("");
  const [actualEditError, setActualEditError] = useState("");
  const [crfFieldEditTarget, setCrfFieldEditTarget] = useState(null);
  const [crfFieldEditError, setCrfFieldEditError] = useState("");
  const [scanStartEditTargetId, setScanStartEditTargetId] = useState(null);
  const [dbAuditTarget, setDbAuditTarget] = useState(null);
  const [queryAuditTarget, setQueryAuditTarget] = useState(null);
  const [pkConfirm, setPkConfirm] = useState(null);
  const [pkDeviationConfirm, setPkDeviationConfirm] = useState(null);
  const [previousTimepointOpen, setPreviousTimepointOpen] = useState(true);
  const [pkDeviationRemark, setPkDeviationRemark] = useState("");
  const [pkDeviationError, setPkDeviationError] = useState("");
  const [centrifugeConfirm, setCentrifugeConfirm] = useState(null);
  const [centrifugeBatch, setCentrifugeBatch] = useState(null);
  const [centrifugeBatchConfirm, setCentrifugeBatchConfirm] = useState(false);
  const [aliquotConfirm, setAliquotConfirm] = useState(null);
  const [lastCollectedPkBarcode, setLastCollectedPkBarcode] = useState(null);
  const [showSessionTrace, setShowSessionTrace] = useState(false);
  const [deferredCentrifugeBarcode, setDeferredCentrifugeBarcode] = useState(null);
  const [aliquotViewParentId, setAliquotViewParentId] = useState(null);
  const [aliquotViewReturnParentId, setAliquotViewReturnParentId] = useState(null);
  const [aliquotSkipTargetId, setAliquotSkipTargetId] = useState(null);
  const [aliquotSkipRemarkEditTargetId, setAliquotSkipRemarkEditTargetId] = useState(null);
  const [aliquotSkipRemarkAuditTargetId, setAliquotSkipRemarkAuditTargetId] = useState(null);
  const [scanAlert, setScanAlert] = useState(null);
  const [prmsLockedBarcodes, setPrmsLockedBarcodes] = useState([]);
  const [prmsLockedVisits, setPrmsLockedVisits] = useState([]);
  const [pendingSkipTarget, setPendingSkipTarget] = useState(null);
  const [pendingSkipRemark, setPendingSkipRemark] = useState("");
  const [pendingSkipError, setPendingSkipError] = useState("");
  const [modalTarget, setModalTarget] = useState(null);
  const [promptedDeviationId, setPromptedDeviationId] = useState(null);
  const [pendingSubjectLink, setPendingSubjectLink] = useState(null);
  const [subjectLinkTargetId, setSubjectLinkTargetId] = useState("");
  const [subjectLinkError, setSubjectLinkError] = useState("");
  const [centrifugeStartTime, setCentrifugeStartTime] = useState("");
  const [centrifugeStartTimeError, setCentrifugeStartTimeError] = useState("");
  const [expandedPendingSampleId, setExpandedPendingSampleId] = useState(null);
  const [showAllActivities, setShowAllActivities] = useState(false);
  const [activeExecTab, setActiveExecTab] = useState("next");
  const [submitMessage, setSubmitMessage] = useState(null);
  const [pendingSubmitDose, setPendingSubmitDose] = useState(null);
  const [allActivitiesDoseFilter, setAllActivitiesDoseFilter] = useState("");
  const [exportPdfBusy, setExportPdfBusy] = useState(false);
  const subjectId = state.activeSubjectId;
  const visitId = state.activeVisitId;

  const hasPendingTrace = useMemo(() => {
    if (!subjectId) return false;
    return state.samples.some(
      (s) =>
        s.subjectId === subjectId &&
        s.status !== "Aliquoted"
    );
  }, [state.samples, subjectId]);

  const pendingSamples = useMemo(() => {
    if (!subjectId) return [];
    return state.samples.filter(
      (sample) => sample.subjectId === subjectId && sample.status !== "Aliquoted"
    );
  }, [state.samples, subjectId]);

  const collectedSamples = useMemo(() => {
    if (!subjectId) return [];
    return state.samples.filter(
      (sample) => sample.subjectId === subjectId && sample.visitId === visitId
    );
  }, [state.samples, subjectId, visitId]);

  useEffect(() => {
    if (hasPendingTrace) {
      setActiveExecTab("pending");
    } else {
      setActiveExecTab("next");
    }
  }, [hasPendingTrace, subjectId, visitId]);
  const subject = state.subjects.find((s) => s.id === subjectId);
  const subjectVisits = useMemo(() => {
    const allVisits = state.visits.filter((v) => v.subjectId === subjectId);
    const generatedVisits = allVisits.filter((v) => v.generated);
    const useGenerated = subject?.linkedGeneratedBarcode || hasLinkedGeneratedSubjectBarcode(state, subjectId);
    return useGenerated && generatedVisits.length ? generatedVisits : allVisits;
  }, [state, subject?.linkedGeneratedBarcode, subjectId]);
  const selectableSubjects = useMemo(() => {
    if (apiManualSubjects.length > 0) {
      return apiManualSubjects.map((row) => {
        const siteRand = String(row.siteRandomizationNo ?? "").trim();
        return {
          id: `api-sub-${row.subjectMstNo}`,
          subjectMstNo: row.subjectMstNo,
          subjectNumber: String(row.mySubjectNo || row.subjectId || siteRand).trim(),
          randomizationNumber: siteRand,
          barcode: siteRand,
          initials: String(row.initials || "---").trim() || "---",
          siteRandomizationNo: siteRand,
          apiListed: true,
        };
      }).filter((s) => s.siteRandomizationNo);
    }
    return []; // Manual mode uses GET /Subjects only (apiManualSubjects)
  }, [apiManualSubjects, state]);
  const linkableSubjects = useMemo(
    () => selectableSubjects.filter((s) => !s.linkedGeneratedBarcode && !hasLinkedGeneratedSubjectBarcode(state, s.id)),
    [selectableSubjects, state]
  );
  const visit = state.visits.find((v) => v.id === visitId);
  const [doseInput, setDoseInput] = useState(formatDateTimeLocal(visit?.actualDoseTime ?? visit?.plannedDoseTime ?? null));
  useEffect(() => {
    setDoseInput(formatDateTimeLocal(visit?.actualDoseTime ?? visit?.plannedDoseTime ?? null));
  }, [visit?.actualDoseTime, visit?.plannedDoseTime]);
  useEffect(() => {
    if (!scanAlert) return;
    const longer =
      /PRMS|Hidden until/i.test(String(scanAlert))
        ? 10000
        : 4500;
    const id = window.setTimeout(() => setScanAlert(null), longer);
    return () => window.clearTimeout(id);
  }, [scanAlert]);

  useEffect(() => {
    if (!submitMessage) return;
    const id = window.setTimeout(() => setSubmitMessage(null), 4500);
    return () => window.clearTimeout(id);
  }, [submitMessage]);

  useEffect(() => {
    if (!persistError) return;
    setScanAlert(persistError);
    clearPersistError();
  }, [persistError, clearPersistError]);

  useEffect(() => {
    if (subjectMode !== "manual" || subjectStarted) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchSubjectsList();
        if (!cancelled) setApiManualSubjects(Array.isArray(rows) ? rows : []);
      } catch (err) {
        if (!cancelled) {
          setApiManualSubjects([]);
          setScanAlert(err?.message || "Failed to load participants.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subjectMode, subjectStarted, authProject, authSite]);

  // When header project/site changes, drop the open session so data matches login context.
  useEffect(() => {
    setActive(null, null);
    setSubjectStarted(false);
    setApiManualSubjects([]);
    setScanAlert(null);
  }, [authProject, authSite, setActive]);

  useEffect(() => {
    if (!deferredCentrifugeBarcode) return;
    const sample = state.samples.find(
      (s) => s.barcode.toUpperCase() === deferredCentrifugeBarcode && ["Collected", "Awaiting Centrifugation", "Centrifuging"].includes(s.status)
    );
    if (!sample) return;
    const target = {
      sampleId: sample.id,
      subjectId: sample.subjectId,
      barcode: sample.barcode,
      subjectNumber: sample.subjectNumber,
      timepoint: sample.timepoint,
      dose: sample.dose
    };
    if (sample.status === "Centrifuging") {
      setAliquotConfirm({ ...target, requiresEnd: true });
    } else {
      setCentrifugeConfirm(target);
    }
    setDeferredCentrifugeBarcode(null);
  }, [deferredCentrifugeBarcode, state.samples]);
  useEffect(() => {
    if (centrifugeConfirm || centrifugeBatch) {
      if (!centrifugeStartTime) {
        setCentrifugeStartTime(formatDateTimeLocal(nowIso()));
      }
      setCentrifugeStartTimeError("");
    } else {
      setCentrifugeStartTime("");
      setCentrifugeStartTimeError("");
    }
  }, [centrifugeConfirm, centrifugeBatch]);
  // --- Derived view: schedule + history → grid / next / fill progress ---
  const {
    visitActivities,
    subjectActivities,
    nextActivity: next,
    previousActivities: adjacentActivities,
    fillProgress,
  } = useMemo(
    () => buildExecutionPageView(state, { subjectId, visitId, subjectVisits }),
    [state, subjectId, visitId, subjectVisits]
  );
  void fillProgress; // schedule fill counts for debug / future session header
  const recommendedVisit = useMemo(() => {
    if (next?.visitId) {
      const nextVisit = subjectVisits.find((v) => v.id === next.visitId);
      if (nextVisit && nextVisit.status !== "Completed") return nextVisit;
    }
    return subjectVisits.find((v) => v.status !== "Completed") ?? subjectVisits[0];
  }, [next?.visitId, subjectVisits]);
  useEffect(() => {
    if (!subjectStarted || !subjectId || !recommendedVisit) return;
    const currentVisit = subjectVisits.find((v) => v.id === visitId);
    const currentVisitActivities = state.activities.filter((a) => a.visitId === visitId);
    const currentAllTerminal =
      currentVisitActivities.length > 0 &&
      currentVisitActivities.every((a) => isTerminalActivityStatus(a.status));
    const shouldAdvanceVisit =
      !currentVisit ||
      currentVisit.status === "Completed" ||
      currentAllTerminal;
    if (
      shouldAdvanceVisit &&
      recommendedVisit.status !== "Completed" &&
      recommendedVisit.id !== visitId
    ) {
      setActive(subjectId, recommendedVisit.id);
    }
  }, [
    recommendedVisit,
    setActive,
    state.activities,
    subjectId,
    subjectStarted,
    subjectVisits,
    visitId,
  ]);
  const nextVisit = next ? state.visits.find((v) => v.id === next.visitId) ?? visit : null;
  const countdown = useCountdown(next?.windowEnd ?? next?.scheduledTime ?? null);
  const countdownStatus = (() => {
    const now = Date.now();
    const start = next?.windowStart ? new Date(next.windowStart).getTime() : null;
    const end = next?.windowEnd ? new Date(next.windowEnd).getTime() : null;
    if (!end) return "default";
    if (now > end) return "overdue";
    if (start && now >= start) return "in-window";
    return "overdue";
  })();
  const hasSubject = subjectStarted && !!subject && !!visit;
  const { isMobile, isMobileOrTablet } = useViewport();
  // Keep camera + arrow chrome for both Scan and Manual so the home dock can expand/collapse.
  const homeScanNavEnabled = isMobileOrTablet && !hasSubject;
  const { cardOpen: homeScanCardOpen } = useScanNavRegistration({
    enabled: homeScanNavEnabled,
    openCamera: () => {
      if (subjectMode === "manual") {
        setSubjectMode("scan");
      }
      const code = String(subjectScan || "").trim();
      if (code) {
        void submitSubjectScan(code);
        return;
      }
      setSubjectCameraOpen(true);
    },
  });
  const sessionLeftRef = useRef(null);
  const [sessionRowHeight, setSessionRowHeight] = useState(null);
  const syncSessionRowHeight = Boolean(hasSubject && centrifugeBatch && !isMobile);
  useLayoutEffect(() => {
    if (!syncSessionRowHeight) {
      setSessionRowHeight(null);
      return;
    }
    const node = sessionLeftRef.current;
    if (!node) return;
    const updateHeight = () => {
      setSessionRowHeight(Math.ceil(node.getBoundingClientRect().height));
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    window.addEventListener("resize", updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [
    syncSessionRowHeight,
    centrifugeBatch?.samples.length,
    activeExecTab,
    pendingSamples.length,
    expandedPendingSampleId,
    subjectMode
  ]);
  const aliquotParent = useMemo(
    () => (subjectId ? resolveAliquotParentSample(state, subjectId) : void 0),
    [state, subjectId]
  );
  useEffect(() => {
    if (aliquotParent) {
      setExpandedPendingSampleId(aliquotParent.id);
    }
  }, [aliquotParent?.id]);
  const aliquotSkipTarget = aliquotSkipTargetId ? state.aliquots.find((a) => a.id === aliquotSkipTargetId) : void 0;
  const aliquotSkipRemarkEditTarget = aliquotSkipRemarkEditTargetId ? state.aliquots.find((a) => a.id === aliquotSkipRemarkEditTargetId) : void 0;
  const aliquotViewParent = aliquotViewParentId ? state.samples.find((s) => s.id === aliquotViewParentId) : void 0;
  const aliquotViewChildren = aliquotViewParent ? state.aliquots.filter((a) => a.parentSampleId === aliquotViewParent.id) : [];
  const aliquotViewVisit = aliquotViewParent
    ? state.visits.find((v) => v.id === aliquotViewParent.visitId)
    : null;
  const aliquotViewReviewLocked =
    isExecutionReviewLocked(aliquotViewParent?.reviewStatus)
    || isExecutionReviewLocked(aliquotViewVisit?.reviewStatus);
  const aliquotViewExpectedBarcodes = useMemo(
    () => (aliquotViewParent ? getSampleExpectedAliquotBarcodes(state, aliquotViewParent) : []),
    [aliquotViewParent, state]
  );
  const resumeAliquotDetailsIfSuspended = () => {
    if (!aliquotViewReturnParentId) return;
    setAliquotViewParentId(aliquotViewReturnParentId);
    setAliquotViewReturnParentId(null);
  };
  const isSampleReviewLocked = (sample) => {
    if (!sample) return false;
    if (isExecutionReviewLocked(sample.reviewStatus)) return true;
    const visit = state.visits.find((v) => v.id === sample.visitId);
    return isExecutionReviewLocked(visit?.reviewStatus);
  };
  const openAliquotSkip = (aliquotId) => {
    const aliquot = state.aliquots.find((a) => a.id === aliquotId);
    const parent = aliquot
      ? state.samples.find((s) => s.id === aliquot.parentSampleId)
      : aliquotViewParent;
    if (isSampleReviewLocked(parent)) return;
    if (aliquotViewParentId) {
      setAliquotViewReturnParentId(aliquotViewParentId);
      setAliquotViewParentId(null);
    }
    setAliquotSkipTargetId(aliquotId);
  };
  const closeAliquotSkip = () => {
    setAliquotSkipTargetId(null);
    resumeAliquotDetailsIfSuspended();
  };
  const openAliquotSkipRemarkEdit = (aliquotId) => {
    const aliquot = state.aliquots.find((a) => a.id === aliquotId);
    const parent = aliquot
      ? state.samples.find((s) => s.id === aliquot.parentSampleId)
      : aliquotViewParent;
    if (isSampleReviewLocked(parent)) return;
    if (aliquotViewParentId) {
      setAliquotViewReturnParentId(aliquotViewParentId);
      setAliquotViewParentId(null);
    }
    setAliquotSkipRemarkEditTargetId(aliquotId);
  };
  const closeAliquotSkipRemarkEdit = () => {
    setAliquotSkipRemarkEditTargetId(null);
    resumeAliquotDetailsIfSuspended();
  };
  const openAliquotSkipRemarkAudit = (aliquotId) => {
    const aliquot = state.aliquots.find(a => a.id === aliquotId);
    if (aliquot?.activityExecutionAliquotNo) {
      setDbAuditTarget({ tableName: "ActivityExecutionAliquot", recordId: aliquot.activityExecutionAliquotNo, title: "Skip Remark Audit", fieldName: "vSkipRemark" });
    }
  };
  const closeAuditDetail = () => {
    setDbAuditTarget(null);
    setQueryAuditTarget(null);
  };
  const openQueryAudit = async (activityId, fieldKey) => {
    const activity = state.activities.find((item) => item.id === activityId);
    if (!activity) return;
    const resolvedFieldKey = fieldKey || activity.reviewQueryFieldKey || "remark";
    setDbAuditTarget(null);

    const subjectMstNo = getActivitySubjectMstNo(state, activity);
    const activityConfigTimePointNo = Number(activity.activityConfigTimePointNo) || 0;
    const activityExecutionQueryNo = Number(activity.activityExecutionQueryNo) || 0;

    // Always load from dbo.ActivityExecutionQueryEvent via API (not AuditDtl / local trail).
    if (state.isNative) {
      setQueryAuditTarget({
        activityId,
        fieldKey: resolvedFieldKey,
        apiRows: null
      });
      return;
    }

    if (!(activityExecutionQueryNo > 0 || (subjectMstNo > 0 && activityConfigTimePointNo > 0))) {
      setQueryAuditTarget({
        activityId,
        fieldKey: resolvedFieldKey,
        apiRows: []
      });
      return;
    }

    try {
      const events = await fetchReviewQueryAuditApi({
        subjectMstNo,
        activityConfigTimePointNo,
        activityExecutionQueryNo: activityExecutionQueryNo || undefined
      });
      setQueryAuditTarget({
        activityId,
        fieldKey: resolvedFieldKey,
        apiRows: mapReviewQueryAuditEventsToRows(events, {
          activityId: activity.id,
          fieldKey: resolvedFieldKey,
          fieldLabel: activity.reviewQueryFieldLabel
        })
      });
    } catch (err) {
      console.error("Failed to load query audit from ActivityExecutionQueryEvent", err);
      setQueryAuditTarget({
        activityId,
        fieldKey: resolvedFieldKey,
        apiRows: []
      });
    }
  };
  const clearSubjectSession = () => {
    setActive(null, null);
    setShowSessionTrace(false);
    setSubjectStarted(false);
    setSubjectScan("");
    setLockedSubjectBarcode("");
    setExpandedPendingSampleId(null);
    setActualEditTargetId(null);
    setPkConfirm(null);
    setPkDeviationConfirm(null);
    setPkDeviationRemark("");
    setPkDeviationError("");
    setCentrifugeConfirm(null);
    setCentrifugeBatch(null);
    setCentrifugeBatchConfirm(false);
    setAliquotConfirm(null);
    setAliquotViewParentId(null);
    setAliquotViewReturnParentId(null);
    setAliquotSkipRemarkEditTargetId(null);
    setAliquotSkipRemarkAuditTargetId(null);
    setPendingSkipTarget(null);
    setModalTarget(null);
  };
  const cancelCentrifugeBatch = () => {
    setCentrifugeBatch(null);
    setCentrifugeBatchConfirm(false);
  };
  const getSampleTarget = (sample) => ({
    sampleId: sample.id,
    subjectId: sample.subjectId,
    barcode: sample.barcode,
    subjectNumber: sample.subjectNumber,
    timepoint: sample.timepoint,
    dose: sample.dose,
    collectedAt: sample.collectedAt
  });
  const beginCentrifugeAddOn = (target) => {
    setCentrifugeBatch({ samples: [target] });
    setCentrifugeConfirm(null);
  };
  const addCentrifugeBatchSample = (sample) => {
    const target = getSampleTarget(sample);
    setCentrifugeBatch((current) => {
      if (!current) return { samples: [target] };
      if (current.samples.some((item) => item.sampleId === target.sampleId)) return current;
      return { samples: [...current.samples, target] };
    });
  };
  const removeCentrifugeBatchSample = (sampleId) => {
    setCentrifugeBatch((current) => {
      if (!current) return null;
      const samples = current.samples.filter((item) => item.sampleId !== sampleId);
      if (samples.length === 0) setCentrifugeBatchConfirm(false);
      return samples.length ? { samples } : null;
    });
  };
  const confirmCentrifugeBatchStart = () => {
    if (!centrifugeBatch?.samples.length) return;
    if (subjectMode === "manual") {
      if (!centrifugeStartTime) {
        setCentrifugeStartTimeError("Start time is required.");
        return;
      }
      const startTime = fromDateTimeLocal(centrifugeStartTime);
      startCentrifugeBatch(
        centrifugeBatch.samples.map((sample) => sample.sampleId),
        startTime
      );
    } else {
      const startTime = nowIso();
      startCentrifugeBatch(
        centrifugeBatch.samples.map((sample) => sample.sampleId),
        startTime
      );
    }
    setCentrifugeBatch(null);
    setCentrifugeBatchConfirm(false);
  };
  const confirmSeparateAliquot = () => {
    if (!aliquotConfirm) return;
    const sample = state.samples.find((item) => item.id === aliquotConfirm.sampleId);
    if (sample?.subjectId && sample?.visitId) {
      setActive(sample.subjectId, sample.visitId);
    }
    if (aliquotConfirm.requiresEnd) endCentrifuge(aliquotConfirm.sampleId);
    else setAliquotParent(aliquotConfirm.sampleId);
    setActiveExecTab("pending");
    setAliquotConfirm(null);
  };
  const confirmSubjectLink = () => {
    if (!pendingSubjectLink) return;
    if (!subjectLinkTargetId) {
      setSubjectLinkError(selectParticipantToLinkBarcodeMessage());
      return;
    }
    if (!linkableSubjects.some((item) => item.id === subjectLinkTargetId)) {
      setSubjectLinkError(participantAlreadyLinkedBarcodeMessage());
      return;
    }
    try {
      const nextState = linkSubjectBarcode(pendingSubjectLink.code, subjectLinkTargetId);
      const targetVisit = getPreferredSubjectVisit(nextState, subjectLinkTargetId);
      if (targetVisit) setActive(subjectLinkTargetId, targetVisit.id);
      setSubjectStarted(true);
      setLockedSubjectBarcode(pendingSubjectLink.code);
      setPendingSubjectLink(null);
      setSubjectLinkTargetId("");
      setSubjectLinkError("");
      setSubjectScan("");
    } catch (error) {
      setSubjectLinkError(error.message || unableToLinkParticipantBarcodeMessage());
    }
  };
  const getPreferredSubjectVisit = (sourceState, targetSubjectId) => {
    const targetSubject = sourceState.subjects.find((item) => item.id === targetSubjectId);
    const allVisits = sourceState.visits.filter((v) => v.subjectId === targetSubjectId);
    const generatedVisits = allVisits.filter((v) => v.generated);
    const useGenerated = targetSubject?.linkedGeneratedBarcode || hasLinkedGeneratedSubjectBarcode(sourceState, targetSubjectId);
    const visits = useGenerated && generatedVisits.length ? generatedVisits : allVisits;
    return visits.find((v) => v.status !== "Completed") ?? visits[0];
  };
  const activateManualSubject = (targetSubjectId) => {
    setShowSessionTrace(false);
    const targetSubject = state.subjects.find((item) => item.id === targetSubjectId);
    const target = getPreferredSubjectVisit(state, targetSubjectId);
    if (target) setActive(targetSubjectId, target.id);
    setSubjectStarted(true);
    setLockedSubjectBarcode(getSubjectDisplayBarcode(state, targetSubject) || targetSubject?.barcode || "");
  };
  // --- Session start: barcode/manual → GET start-by-scan → loadExecutionSessionFromApi ---
  const syncDoseReviewStatusesFromApi = async (subjectMstNo, projectCode, baseState = null) => {
    if (!subjectMstNo || !projectCode) return baseState;
    try {
      const list = await fetchReviewVisits({ projectId: projectCode });
      return applyVisitReviewStatuses(list, subjectMstNo, baseState);
    } catch (err) {
      console.error("Failed to sync dose review statuses:", err);
      return baseState;
    }
  };

  const beginGatedSession = async (rawCode) => {
    const code = String(rawCode ?? "").trim();
    if (!code) {
      setScanAlert("Enter / scan a barcode.");
      return false;
    }
    if (subjectStartBusy) return false;
    setSubjectStartBusy(true);
    setScanAlert(null);
    try {
      const payload = await startSessionByScan(code);
      const nextState = await loadExecutionSessionFromApi(payload);
      const subjectMstNo = payload?.subject?.subjectMstNo ?? payload?.subject?.SubjectMstNo;
      const projectCode =
        payload?.schedule?.projectCode
        ?? payload?.schedule?.ProjectCode
        ?? payload?.subject?.projectCode
        ?? "";
      await syncDoseReviewStatusesFromApi(subjectMstNo, projectCode, nextState);
      setShowSessionTrace(false);
      setSubjectStarted(true);
      setLockedSubjectBarcode(payload.barcode || code);
      setSubjectScan("");
      setPendingSubjectLink(null);

      // Remember locked PK/AL barcodes for scan-time messaging only (no toast on participant start).
      const prmsGate = payload?.prmsGate ?? {};
      setPrmsLockedBarcodes(prmsGate.lockedBarcodes ?? []);
      setPrmsLockedVisits(prmsGate.lockedVisits ?? []);
      return true;
    } catch (err) {
      setPrmsLockedBarcodes([]);
      setPrmsLockedVisits([]);
      setScanAlert(err?.message || "Unable to start participant session.");
      return false;
    } finally {
      setSubjectStartBusy(false);
    }
  };
  const handleManualSubjectSelect = async (targetSubjectId) => {
    if (!targetSubjectId) return;
    const targetSubject = selectableSubjects.find((item) => item.id === targetSubjectId);
    if (!targetSubject) return;
    const code = String(
      targetSubject.siteRandomizationNo || targetSubject.randomizationNumber || targetSubject.barcode || ""
    ).trim();
    if (!code) {
      setScanAlert("Subject has no site randomization barcode.");
      return;
    }
    await beginGatedSession(code);
  };
  const isUnlinkedGeneratedSubjectBarcode = (barcode) => {
    if (!barcode) return false;
    if (getGeneratedSubjectForBarcode(state, barcode)) return false;
    const pendingSubjectId = barcode.pendingSubjectId ?? barcode.subjectId;
    const pendingSubject = pendingSubjectId ? state.subjects.find((item) => item.id === pendingSubjectId) : null;
    return !!barcode.unlinked || (!!pendingSubject?.generated && !pendingSubject.barcodeLinked);
  };
  const submitSubjectScan = async (scannedCode) => {
    const code = (scannedCode ?? subjectScan).trim();
    if (!code) {
      setSubjectCameraOpen(true);
      return;
    }
    await beginGatedSession(code);
  };

  // --- Scan workflow: subject re-scan, PK collect, centrifuge, aliquot ---
  const handleWorkflowScan = (code) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setScanAlert(null);
    if (!subjectStarted || !hasSubject) {
      void beginGatedSession(trimmed);
      return;
    }
    const subjectBarcode = findSubjectBarcodeForProject(state, trimmed);
    if (subjectBarcode) {
      if (isUnlinkedGeneratedSubjectBarcode(subjectBarcode)) {
        setPendingSubjectLink(subjectBarcode);
        setSubjectLinkTargetId("");
        setSubjectLinkError("");
        return;
      }
      // Same subject re-scan — keep session; switching subjects goes through gated start
      const locked = String(lockedSubjectBarcode || "").trim().toUpperCase();
      const scanned = String(subjectBarcode.code || trimmed).trim().toUpperCase();
      const compact = (value) => value.replace(/[^A-Z0-9]/g, "");
      if (locked && compact(scanned) !== compact(locked)) {
        void beginGatedSession(trimmed);
        return;
      }
      return;
    }
    if (trimmed.toUpperCase().startsWith("S")) {
      setScanAlert("Invalid barcode.");
      return;
    }
    if (prmsLockedBarcodes.includes(trimmed.toUpperCase())) {
      const lockedList = prmsLockedVisits.length
        ? ` (${prmsLockedVisits.join(", ")})`
        : "";
      setScanAlert(
        `This PRMS visit is not completed${lockedList}. Complete the visit in PRMS first.`
      );
      return;
    }
    if (!hasSubject) {
      setScanAlert(selectParticipantBeforePkScanMessage());
      return;
    }
    if (trimmed.toUpperCase().startsWith("AL")) {
      const aliquotCode = trimmed.toUpperCase();
      const activeAliquotParent = aliquotParent ?? (subjectId ? resolveAliquotParentSample(state, subjectId) : null);
      if (!activeAliquotParent) {
        setScanAlert("Scan a centrifugation-done PK parent before aliquot tubes.");
        return;
      }
      if (activeAliquotParent.status === "Centrifuging") {
        setScanAlert(`Complete centrifugation for ${activeAliquotParent.barcode} before scanning aliquot tubes.`);
        return;
      }
      const expectedBarcodes = getSampleExpectedAliquotBarcodes(state, activeAliquotParent);
      if (!expectedBarcodes.some((expected) => expected.toUpperCase() === aliquotCode)) {
        setScanAlert(`Wrong aliquot. ${aliquotCode} does not belong to ${activeAliquotParent.barcode}.`);
        return;
      }
      if (!state.pendingAliquotParentId || state.pendingAliquotParentId !== activeAliquotParent.id) {
        setAliquotParent(activeAliquotParent.id);
      }
      linkAliquot(activeAliquotParent.id, aliquotCode);
      return;
    }
    if (!trimmed.toUpperCase().startsWith("PK")) {
      setScanAlert(scanParticipantOrPkMessage());
      return;
    }
    const pkCode = trimmed.toUpperCase();
    const pkOwnerSubjectId = getPkBarcodeOwnerSubjectId(state, pkCode);
    if (subjectId && pkOwnerSubjectId && pkOwnerSubjectId !== subjectId) {
      setScanAlert(formatWrongSubjectPkScanAlert(state, pkCode, pkOwnerSubjectId));
      return;
    }
    const timingSample = state.samples.find((sample) => sample.barcode.toUpperCase() === pkCode);
    if (timingSample && (!timingSample.scanStartTime || !timingSample.scanEndTime)) {
      recordTimepointBarcodeScan(pkCode, nowIso());
    }
    if (centrifugeBatch) {
      const batchSample = state.samples.find(
        (sample) => sample.barcode.toUpperCase() === pkCode && ["Collected", "Awaiting Centrifugation"].includes(sample.status)
      );
      if (!batchSample) {
        setScanAlert("Scan another collected PK tube to add it, or start the current centrifuge batch.");
        return;
      }
      if (centrifugeBatch.samples.some((sample) => sample.sampleId === batchSample.id)) {
        setScanAlert(`${batchSample.barcode} is already in the current centrifuge batch.`);
        return;
      }
      addCentrifugeBatchSample(batchSample);
      setCentrifugeBatchConfirm(true);
      return;
    }
    if (lastCollectedPkBarcode === pkCode) {
      const collectedSample = state.samples.find(
        (sample) => sample.barcode.toUpperCase() === pkCode && ["Collected", "Awaiting Centrifugation", "Centrifuging"].includes(sample.status)
      );
      if (collectedSample) {
        const target = getSampleTarget(collectedSample);
        if (collectedSample.status === "Centrifuging") setAliquotConfirm({ ...target, requiresEnd: true });
        else setCentrifugeConfirm(target);
        return;
      }
      // Barcode was flagged collected but sample is missing (e.g. skip confirmed then collection cancelled).
      // Clear the flag and continue so the PK can be collected again.
      setLastCollectedPkBarcode(null);
    }
    const existingSample = state.samples.find((sample) => sample.barcode.toUpperCase() === pkCode);
    if (existingSample && isSampleAliquotSeparationComplete(state, existingSample)) {
      setScanAlert(`${existingSample.barcode} is already separated.`);
      return;
    }
    if (existingSample && ["Collected", "Awaiting Centrifugation", "Centrifuging", "Ready For Aliquot"].includes(existingSample.status)) {
      if (existingSample.subjectId && existingSample.visitId) {
        setActive(existingSample.subjectId, existingSample.visitId);
      }
      const target = getSampleTarget(existingSample);
      if (existingSample.status === "Collected" || existingSample.status === "Awaiting Centrifugation") {
        setCentrifugeConfirm(target);
      } else {
        setAliquotConfirm({ ...target, requiresEnd: existingSample.status === "Centrifuging" });
      }
      return;
    }
    const pkScanTarget = getPkScanTarget(state, trimmed);
    const scanState =
      pkScanTarget?.subjectId && pkScanTarget?.visitId
        ? { ...state, activeSubjectId: pkScanTarget.subjectId, activeVisitId: pkScanTarget.visitId }
        : state;
    const alignPkScanVisit = () => {
      if (pkScanTarget?.subjectId && pkScanTarget?.visitId) {
        setActive(pkScanTarget.subjectId, pkScanTarget.visitId);
      }
    };
    const intent = resolvePkScanIntent(scanState, trimmed);
    if (intent.type === "blockedByPending") {
      setPendingSkipTarget(intent);
      setPendingSkipRemark("");
      setPendingSkipError("");
      return;
    }
    if (intent.type === "error") {
      setScanAlert(intent.message);
      return;
    }
    if (intent.type === "collect") {
      if (subjectMode === "scan") {
        const actualInput = formatDateTimeLocal(nowIso());
        const deviationReason = getActualEditDeviationReason(intent.activity, actualInput);
        if (deviationReason) {
          alignPkScanVisit();
          setPkDeviationConfirm({
            activityId: intent.activity.id,
            subjectNumber: intent.activity.subjectNumber,
            visitId: intent.activity.visitId,
            visitLabel: intent.activity.visitLabel,
            dose: intent.activity.dose,
            timepoint: intent.activity.timepoint,
            barcode: intent.activity.barcode ?? intent.code,
            actualInput,
            method: "pkBarcode",
            deviationReason
          });
          setPkDeviationRemark("");
          setPkDeviationError("");
          return;
        }
        void completePk(intent.activity.id, nowIso(), "pkBarcode").then((ok) => {
          if (!ok) return;
          alignPkScanVisit();
          setLastCollectedPkBarcode((intent.activity.barcode ?? intent.code).toUpperCase());
          setShowSessionTrace(true);
          setActiveExecTab("pending");
        });
        return;
      }
      alignPkScanVisit();
      setPkConfirm({
        activityId: intent.activity.id,
        subjectNumber: intent.activity.subjectNumber,
        visitLabel: intent.activity.visitLabel,
        visitId: intent.activity.visitId,
        dose: intent.activity.dose,
        timepoint: intent.activity.timepoint,
        barcode: intent.activity.barcode ?? intent.code,
        actualInput: formatDateTimeLocal(nowIso()),
        method: subjectMode === "manual" ? "manual" : "pkBarcode"
      });
      return;
    }
    if (intent.type === "startCentrifugation") {
      setCentrifugeConfirm(getSampleTarget(intent.sample));
      return;
    }
    if (intent.type === "endCentrifugation" || intent.type === "aliquot") {
      if (intent.sample?.subjectId && intent.sample?.visitId) {
        setActive(intent.sample.subjectId, intent.sample.visitId);
      }
      setActiveExecTab("pending");
      setAliquotConfirm({ ...getSampleTarget(intent.sample), requiresEnd: intent.type === "endCentrifugation" });
      return;
    }
    setAliquotParent(intent.sample.id);
  };
  useEffect(() => {
    // Prefer newest auto-deviation entry that still needs a remark.
    const latestOpen = [...(state.deviations ?? [])].reverse().find((entry) => {
      const activity = state.activities.find((a) => a.id === entry.activityId);
      return (
        activity
        && activity.deviation
        && !String(activity.remarks ?? "").trim()
        && activity.status !== "Missed"
        && activity.status !== "Skipped"
      );
    });
    if (latestOpen) {
      if (latestOpen.id === promptedDeviationId) return;
      setPromptedDeviationId(latestOpen.id);
      setModalTarget({ type: "deviation", activityId: latestOpen.activityId });
      return;
    }

    // After re-login / history merge: deviations[] is empty but DB may have
    // deviation=true with no Remarks — re-prompt so remark can be saved.
    const orphan = (state.activities ?? []).find(
      (activity) =>
        activity.deviation
        && activity.actualTime
        && !String(activity.remarks ?? "").trim()
        && !["Missed", "Skipped"].includes(activity.status)
    );
    if (!orphan) return;
    const orphanKey = `activity:${orphan.id}`;
    if (promptedDeviationId === orphanKey) return;
    setPromptedDeviationId(orphanKey);
    setModalTarget({ type: "deviation", activityId: orphan.id });
  }, [promptedDeviationId, state.activities, state.deviations]);
  const modalActivity = modalTarget ? state.activities.find((a) => a.id === modalTarget.activityId) : void 0;
  const actualEditActivity = actualEditTargetId ? state.activities.find((a) => a.id === actualEditTargetId) : void 0;
  const isUnskipActualEdit =
    !!actualEditActivity
    && actualEditActivity.activity !== "IMP Dose Administration"
    && String(actualEditActivity.status ?? "").trim() === "Skipped"
    && !actualEditActivity.actualTime;
  const actualEditVisit = actualEditActivity
    ? state.visits.find((v) => v.id === actualEditActivity.visitId)
    : void 0;
  const crfActivity = crfActivityId ? state.activities.find((a) => a.id === crfActivityId) : void 0;
  const crfSample = crfActivity
    ? state.samples.find((sample) => sample.activityId === crfActivity.id || crfActivity.sampleId && sample.id === crfActivity.sampleId)
    : void 0;
  const crfVisit = crfActivity ? state.visits.find((visit) => visit.id === crfActivity.visitId) : void 0;
  const crfResolveActivity = crfResolveTarget?.activityId
    ? state.activities.find((a) => a.id === crfResolveTarget.activityId) ?? crfActivity
    : null;
  const crfResolveFieldHasAudit = !!(
    crfResolveActivity
    && crfResolveTarget?.fieldKey
    && matchesReviewQueryField(crfResolveActivity, crfResolveTarget.fieldKey)
  );
  const openCrfForActivity = async (activityId) => {
    const activity = state.activities.find((item) => item.id === activityId);
    if (!activity || isCrfDisabledForActivity(activity)) return;

    // Live-fetch pinned CRF before opening. Do not load latest-by-type when a pin exists.
    const pinnedNo = Number(activity.appActivityCrfNo) || 0;
    if (pinnedNo > 0) {
      await ensureCrfDefinitionsByNosLoaded([pinnedNo]);
    } else {
      const activityType = String(activity.activity ?? "").trim();
      if (activityType) {
        await ensureCrfDefinitionLoaded(activityType);
      }
    }

    const [hydrated] = await hydrateCrfDefinitionsForActivities([activity]);
    if (!hydrated || !activityHasCrf(hydrated)) return;

    setCrfModalError("");
    setCrfActivityId(activityId);
  };
  const openCrfFieldForActivity = (activityId, fieldId) => {
    const activity = state.activities.find((item) => item.id === activityId);
    if (!activity || !fieldId) return;
    if (!isActivityReadyForCrf(activity)) {
      setScanAlert(getCrfNotReadyMessage(activity));
      return;
    }
    setCrfFieldEditError("");
    setCrfFieldEditTarget({ activityId, fieldId });
  };
  const openCrfFieldDbAudit = (activityId, fieldId) => {
    const activity = state.activities.find((item) => item.id === activityId);
    if (!activity || !fieldId) return;
    const definition = getCrfDefinitionForActivity(activity);
    const field = (definition?.items ?? [])
      .map((item) => item.field)
      .find((item) => item?.id === fieldId);
    const dtlNo = activity.fieldIds?.[fieldId]
      || activity.fieldIds?.[field?.label]
      || activity.fieldIds?.[`crf:${fieldId}`];
    setDbAuditTarget({
      tableName: "ActivityExecutionDtl",
      recordId: dtlNo || null,
      hdrNo: activity.activityExecutionHdrNo || null,
      fieldName: fieldId,
      fieldLabel: field?.label || fieldId,
      title: "Audit Detail",
    });
  };
  const openFieldDbAudit = (activityId, fieldName, title) => {
    const activity = state.activities.find((item) => item.id === activityId);
    if (!activity) return;
    const target = buildActivityFieldDbAuditTarget(activity, fieldName, title);
    if (target) setDbAuditTarget(target);
  };
  const getActivitySample = (activity) => resolveActivitySample(state.samples, activity);
  const crfFieldEditActivity = crfFieldEditTarget?.activityId
    ? state.activities.find((activity) => activity.id === crfFieldEditTarget.activityId)
    : void 0;
  const crfFieldEditDefinition = crfFieldEditActivity
    ? getCrfDefinitionForActivity(crfFieldEditActivity)
    : void 0;
  const crfFieldEditField = crfFieldEditTarget?.fieldId
    ? (crfFieldEditDefinition?.items ?? []).find(
      (item) => item.kind === "field" && item.field?.id === crfFieldEditTarget.fieldId
    )?.field
    : void 0;
  const crfFieldEditSample = getActivitySample(crfFieldEditActivity);
  const crfFieldEditVisit = crfFieldEditActivity
    ? state.visits.find((visit) => visit.id === crfFieldEditActivity.visitId)
    : void 0;
  const crfFieldEditSavedValues = crfFieldEditDefinition
    ? resolveCrfSavedValues(crfFieldEditActivity, crfFieldEditDefinition)
    : {};
  const crfFieldEditInitialValue = crfFieldEditActivity && crfFieldEditDefinition && crfFieldEditTarget?.fieldId
    ? buildCrfInitialValues(
      crfFieldEditDefinition,
      crfFieldEditActivity,
      crfFieldEditSample,
      crfFieldEditSavedValues,
      crfFieldEditVisit
    )[crfFieldEditTarget.fieldId] ?? ""
    : "";
  const scanStartEditActivity = scanStartEditTargetId ? state.activities.find((a) => a.id === scanStartEditTargetId) : void 0;
  const scanStartEditSample = getActivitySample(scanStartEditActivity);
  useEffect(() => {
    if (!actualEditActivity) {
      setActualEditInput("");
      setActualEditReason("");
      setActualEditError("");
      return;
    }
    const defaultTime = actualEditActivity.actualTime
      ?? (actualEditActivity.activity === "IMP Dose Administration"
        ? (actualEditActivity.scheduledTime ?? actualEditVisit?.plannedDoseTime ?? nowIso())
        : (actualEditActivity.scheduledTime ?? actualEditVisit?.plannedDoseTime ?? null));
    setActualEditInput(formatDateTimeLocal(defaultTime));
    setActualEditReason("");
    setActualEditError("");
  }, [actualEditActivity?.id]);
  const actualEditDeviationReason = getActualEditDeviationReason(actualEditActivity, actualEditInput);
  const actualEditQueryRemark = getActiveReviewQueryRemarkText(actualEditActivity, "actual");
  const remarkModalQueryRemark =
    modalTarget?.type === "remark"
      ? getActiveReviewQueryRemarkText(modalActivity, "remark")
      : "";
  const queryAuditActivity = queryAuditTarget?.activityId
    ? state.activities.find((activity) => activity.id === queryAuditTarget.activityId)
    : null;
  const queryAuditRows = useMemo(() => {
    if (!queryAuditTarget?.activityId) return [];
    if (Array.isArray(queryAuditTarget.apiRows)) {
      return queryAuditTarget.apiRows;
    }
    return [];
  }, [queryAuditTarget]);
  const queryAuditFallbackRow = queryAuditTarget
    ? buildAuditFallbackRow({
        type: "query",
        activity: queryAuditActivity,
        fieldLabel: queryAuditActivity?.reviewQueryFieldLabel,
        rows: queryAuditRows
      })
    : null;
  const scanStartEditQueryRemark = getActiveReviewQueryRemarkText(scanStartEditActivity, "scanStart");
  const crfFieldEditQueryRemark = crfFieldEditTarget?.fieldId
    ? getActiveReviewQueryRemarkText(crfFieldEditActivity, `crf:${crfFieldEditTarget.fieldId}`)
    : "";
  const pkDeviationActivity = pkDeviationConfirm ? state.activities.find((a) => a.id === pkDeviationConfirm.activityId) : void 0;
  const pkDeviationReason = getActualEditDeviationReason(pkDeviationActivity, pkDeviationConfirm?.actualInput ?? "");
  const pkConfirmActivity = pkConfirm ? state.activities.find((a) => a.id === pkConfirm.activityId) : void 0;
  const pkConfirmDeviationReason = getActualEditDeviationReason(pkConfirmActivity, pkConfirm?.actualInput ?? "");
  const pkConfirmSubject = pkConfirmActivity ? state.subjects.find((s) => s.id === pkConfirmActivity.subjectId) : null;
  const pkDeviationSubject = pkDeviationActivity ? state.subjects.find((s) => s.id === pkDeviationActivity.subjectId) : null;
  
  const modalVisit = modalActivity ? state.visits.find((v) => v.id === modalActivity.visitId) : void 0;
  const modalHasDeviation = !!modalActivity?.deviation || !!modalActivity?.deviationReason || modalActivity?.status === "Deviation";
  const modalTitle = modalTarget?.type === "skip"
    ? "Skip Activity"
    : remarkModalQueryRemark
      ? "Resolve Query"
      : modalHasDeviation
        ? "Deviation Remark"
        : "Activity Remark";
  const modalDetails = modalActivity
    ? [
      { label: UI_LABELS.siteRandomizationNo, value: resolveSiteRandomizationNumber({ subjectId: modalActivity.subjectId, subjects: state.subjects, subjectNumber: modalActivity.subjectNumber }) },
      { label: "Timepoint", value: formatActivityTimepointLabel(modalActivity) },
      { label: "Dose", value: formatDoseDisplayLabel(modalActivity.dose) },
      { label: "PK Barcode", value: modalActivity.barcode ?? "Manual" },
      ...(modalHasDeviation ? [{ label: "Deviation", value: modalActivity.deviationReason ?? "Deviation recorded" }] : []),
    ]
    : undefined;
  const isDeviationRemarkRequired = !!modalTarget && modalTarget.type !== "skip" && modalHasDeviation;
  const confirmPendingSkip = () => {
    if (!pendingSkipTarget) return;
    const remarkText = pendingSkipRemark.trim();
    if (!remarkText) {
      setPendingSkipError("Remark is required before skipping pending timepoints.");
      return;
    }
    const pendingActivityIds = pendingSkipTarget.pendingActivities.map((activity) => activity.id);
    const targetActivity = pendingSkipTarget.activity;
    const targetCode = pendingSkipTarget.code;
    const targetBarcode = (targetActivity.barcode ?? targetCode).toUpperCase();
    if (targetActivity.subjectId && targetActivity.visitId) {
      setActive(targetActivity.subjectId, targetActivity.visitId);
    }

    const actualInput = formatDateTimeLocal(nowIso());
    const deviationReason = getActualEditDeviationReason(targetActivity, actualInput);

    setPendingSkipTarget(null);
    setPendingSkipRemark("");
    setPendingSkipError("");

    if (subjectMode === "scan") {
      // Scan mode: fixed scan time (no edit). Same path as a normal PK scan collect.
      if (deviationReason) {
        // Skip first; collect after user enters deviation remark (read-only time).
        skipPending(pendingActivityIds, remarkText);
        setPkDeviationConfirm({
          activityId: targetActivity.id,
          subjectNumber: targetActivity.subjectNumber,
          visitId: targetActivity.visitId,
          visitLabel: targetActivity.visitLabel,
          dose: targetActivity.dose,
          timepoint: targetActivity.timepoint,
          barcode: targetActivity.barcode ?? targetCode,
          actualInput,
          method: "pkBarcode",
          deviationReason
        });
        setPkDeviationRemark("");
        setPkDeviationError("");
        return;
      }
      // No deviation: skip + collect in one state transition (avoids stale React state).
      skipPending(pendingActivityIds, remarkText, targetActivity.id, nowIso(), "pkBarcode");
      setLastCollectedPkBarcode(targetBarcode);
      setShowSessionTrace(true);
      setActiveExecTab("pending");
      return;
    }

    // Manual mode: skip first, then Confirm PK with editable collection time.
    skipPending(pendingActivityIds, remarkText);
    setPkConfirm({
      activityId: targetActivity.id,
      subjectNumber: targetActivity.subjectNumber,
      visitLabel: targetActivity.visitLabel,
      visitId: targetActivity.visitId,
      dose: targetActivity.dose,
      timepoint: targetActivity.timepoint,
      barcode: targetActivity.barcode ?? targetCode,
      actualInput,
      method: "manual",
      deviationRemark: "",
      error: ""
    });
  };
  const isDoseNextActivity = next?.activity === "IMP Dose Administration";
  const isPreDoseNext = next?.activity === "Pre-Dose Blood Collection";
  // Bind Dose Setup to the next IMP visit (not only activeVisitId) so reload
  // after Pre Dose still shows Setup Dose for the pending dose.
  const doseSetupVisitId = isDoseNextActivity && next?.visitId ? next.visitId : visitId;
  const doseSetupVisit = doseSetupVisitId
    ? state.visits.find((v) => v.id === doseSetupVisitId) ?? visit
    : visit;
  const visitDoseActivity = doseSetupVisitId
    ? state.activities.find(
      (a) => a.visitId === doseSetupVisitId && a.activity === "IMP Dose Administration"
    )
    : undefined;
  const doseTimeSet = !!(visitDoseActivity?.actualTime ?? doseSetupVisit?.actualDoseTime);
  const showDosePlanningSection = !!doseSetupVisitId && !!visitDoseActivity;
  const canSetupOnExecutionCard = showDosePlanningSection && !doseTimeSet && isDoseNextActivity;
  const doseVisitHeader = visitDoseActivity && doseSetupVisit
    ? formatNextActivityHeader(visitDoseActivity, doseSetupVisit)
    : null;

  const openDoseModalForActivity = (activity) => {
    const activityVisit = state.visits.find((item) => item.id === activity.visitId);
    const activitySubject = state.subjects.find((item) => item.id === activity.subjectId);
    const isSetup = !activity.actualTime;
    const defaultTime = isSetup
      ? nowIso()
      : (activity.actualTime
        ?? activity.scheduledTime
        ?? activityVisit?.plannedDoseTime
        ?? nowIso());
    const mode = isSetup ? "setup" : "edit";
    setDoseModalMode(mode);
    setDoseModalContext({ visitId: activity.visitId, activityId: activity.id, mode });
    setDoseInput(formatDateTimeLocal(defaultTime));
    setDoseModalSubtitle(formatDoseVisitPeriodLabel(activityVisit, activity.dose ?? activityVisit?.doseLabel));
    setDoseModalSubjectLabel(formatSubjectSessionLabel(activitySubject));
    setDoseModalError("");
    setDoseModalOpen(true);
  };
  const openDoseModal = () => {
    if (visitDoseActivity) {
      openDoseModalForActivity(visitDoseActivity);
    }
  };
  const closeDoseModal = () => {
    setDoseModalOpen(false);
    setDoseModalContext(null);
    setDoseModalError("");
  };
  const currentDoseFilterLabel = visit ? formatDoseDisplayLabel(visit.doseLabel ?? visit.dose) : "";
  const findVisitIdForDose = (doseLabel) =>
    findVisitForSubjectDose(state, subjectId, doseLabel)?.id ?? null;
  const getDoseReviewStatus = (doseLabel) =>
    resolveDoseReviewDisplayStatus(state, subjectId, doseLabel);
  const canSubmitDose = (doseLabel) => {
    // Submitted/Reviewed doses only show Under Review / Reviewed — never Submit again.
    if (getDoseReviewStatus(doseLabel)) return false;
    const targetVisitId = findVisitIdForDose(doseLabel);
    return targetVisitId ? isVisitReadyForSubmit(state, targetVisitId) : false;
  };
  const handleSubmitDose = (doseLabel) => {
    const targetVisitId = findVisitIdForDose(doseLabel);
    if (!targetVisitId) return;
    if (!isVisitReadyForSubmit(state, targetVisitId)) {
      setScanAlert("All timepoints must be complete before submitting this dose for review.");
      return;
    }
    const missingCrfMessage = getMissingRequiredCrfSubmitMessage(state, targetVisitId);
    if (missingCrfMessage) {
      setScanAlert(missingCrfMessage);
      return;
    }
    setPendingSubmitDose(doseLabel);
  };
  const handleExportCompliancePdf = async () => {
    if (exportPdfBusy) return;
    // Full subject schedule — all periods/doses/timepoints (including PRMS-locked).
    const recordedActivities = (state.activities ?? [])
      .filter((a) => a.subjectId === subjectId)
      .sort((a, b) => compareActivitiesBySchedule(state, a, b));
    const subjectVisitsForExport = (state.visits ?? []).filter((v) => v.subjectId === subjectId);
    setExportPdfBusy(true);
    try {
      let periods = [];
      if (!state.isNative) {
        try {
          const schedule = await getPublishedExecutionSchedule();
          periods = Array.isArray(schedule?.periods) ? schedule.periods : [];
        } catch (scheduleErr) {
          console.warn("Published schedule unavailable for PDF export; using session schedule.", scheduleErr);
        }
      }
      if (!periods.length) {
        const projectCode = String(
          authProject || state.activeProjectId || subject?.projectId || ""
        ).toLowerCase();
        const project = (state.projects ?? []).find(
          (item) =>
            String(item.id ?? "").toLowerCase() === projectCode
            || String(item.code ?? "").toLowerCase() === projectCode
        );
        periods = Array.isArray(project?.schedule?.periods) ? project.schedule.periods : [];
      }

      const expanded = expandExportDatasetFromSchedule({
        subject,
        periods,
        existingActivities: recordedActivities,
        existingVisits: subjectVisitsForExport,
      });
      const exportActivities = expanded.activities;
      if (!exportActivities.length) {
        setSubmitMessage("No activities available to export.");
        return;
      }

      const hydrated = await hydrateCrfDefinitionsForActivities(exportActivities);
      const result = await exportActivityCompliancePdf({
        mode: "execution",
        activities: hydrated,
        visits: expanded.visits,
        samples: state.samples,
        aliquots: state.aliquots,
        meta: {
          project: authProject || state.activeProjectId || "",
          site: authSite || "",
          participant: subject ? formatParticipantDropdownLabel(subject) : "",
        },
      });
      if (!result.ok) {
        setSubmitMessage(result.message || "Failed to export PDF.");
      } else {
        setSubmitMessage(result.message || "PDF exported successfully.");
      }
    } catch (err) {
      console.error("Export PDF failed", err);
      setSubmitMessage(err?.message || "Failed to export PDF.");
    } finally {
      setExportPdfBusy(false);
    }
  };
  const handlePasswordConfirmed = async () => {
    if (!pendingSubmitDose) return;
    const doseLabel = pendingSubmitDose;
    const targetVisit = findVisitForSubjectDose(state, subjectId, doseLabel);
    const targetVisitId = targetVisit?.id ?? findVisitIdForDose(doseLabel);
    if (!targetVisitId) {
      setPendingSubmitDose(null);
      return;
    }
    // Update local state first so UI reflects change immediately
    const result = submitForReview(targetVisitId);
    setSubmitMessage(result.success ? result.message : result.message);
    setPendingSubmitDose(null);
    // Persist to backend if subject has a DB record
    const subjectMstNo = subject?.subjectMstNo;
    if (subjectMstNo) {
      try {
        await submitVisitByDoseApi({
          subjectMstNo,
          visitName: targetVisit?.doseLabel ?? targetVisit?.dose ?? targetVisit?.label ?? doseLabel,
          activityConfigDoseNo: targetVisit?.activityConfigDoseNo
        });
        const projectCode =
          subject?.projectId
          ?? targetVisit?.projectId
          ?? state.activeProjectId
          ?? "";
        // Pass the post-submit state so a stale context snapshot cannot wipe Submitted.
        await syncDoseReviewStatusesFromApi(subjectMstNo, projectCode, result.state);
      } catch (err) {
        console.error("Failed to persist visit submission to backend:", err);
        setSubmitMessage(err?.message || "Failed to persist dose submission to the server.");
      }
    }
  };
  const isDoseRecordLocked = (activityVisitId, doseActivityId = null) =>
    isDoseRecordEditLocked(state, activityVisitId, doseActivityId);
  const nextActivityHeader = next ? formatNextActivityHeader(next, nextVisit) : null;
  const setupDoseHeader = canSetupOnExecutionCard ? doseVisitHeader : null;
  const visitDoseSelectField = /* @__PURE__ */ jsxs("label", {
    className: "field field--inline", children: [
    /* @__PURE__ */ jsx("span", { children: "Dose" }),
    /* @__PURE__ */ jsx(ScrollableSelect, {
      ariaLabel: "Select dose",
      value: visitId ?? recommendedVisit?.id ?? "",
      onChange: (nextVisitId) => subjectId && setActive(subjectId, nextVisitId),
      allowEmpty: false,
      options: subjectVisits.map((v) => ({
        value: v.id,
        label: `${formatDoseDisplayLabel(v.doseLabel ?? v.dose)}${v.status === "Completed" ? " (Completed)" : ""}`,
      })),
    })
    ]
  });
  const canSkipNextActivity =
    !!next
    && ["Ready", "Missed"].includes(next.status)
    && !isSampleReviewLocked({ visitId: next.visitId, reviewStatus: next.reviewStatus });
  const setupDoseCardEl = canSetupOnExecutionCard ? /* @__PURE__ */ jsx("div", {
    className: "next-summary-card exec-session-card__next-card scheduled-dose-card--setup",
    children: /* @__PURE__ */ jsxs("div", {
      className: "next-summary-card__head", children: [
        /* @__PURE__ */ jsxs("div", {
        className: "next-summary-card__title", children: [
            /* @__PURE__ */ jsx("strong", { children: setupDoseHeader?.primary }),
          setupDoseHeader?.secondary ? /* @__PURE__ */ jsx("span", { children: setupDoseHeader.secondary }) : null
        ]
      }),
        /* @__PURE__ */ jsxs("div", {
          className: "next-summary-card__actions",
          children: [
            canSkipNextActivity ? /* @__PURE__ */ jsx("button", {
              type: "button",
              className: "btn btn--sm btn--ghost next-summary-card__skip",
          onClick: () => setModalTarget({ type: "skip", activityId: next.id }),
          "data-tour": "timepoint-skip",
          children: "Skip"
            }) : null,
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                className: "btn btn--primary btn--setup-dose scan-area__button",
                onClick: openDoseModal,
                children: "Setup Dose"
              }
            )
          ]
        })
      ]
    })
  }) : null;
  const nextActivityDetails = next ? /* @__PURE__ */ jsxs(Fragment, {
    children: [
    /* @__PURE__ */ jsxs("div", {
      className: "next-summary-card__head", children: [
        /* @__PURE__ */ jsxs("div", {
          className: "next-summary-card__title", children: [
            /* @__PURE__ */ jsx("strong", { children: nextActivityHeader?.primary }),
            nextActivityHeader?.secondary ? /* @__PURE__ */ jsx("span", { children: nextActivityHeader.secondary }) : null
          ]
        }),
        canSkipNextActivity ? /* @__PURE__ */ jsx("button", {
          type: "button",
          className: "btn btn--sm btn--ghost next-summary-card__skip",
          onClick: () => setModalTarget({ type: "skip", activityId: next.id }),
          children: "Skip"
        }) : null
      ]
    }),
    /* @__PURE__ */ jsxs("div", {
      className: "next-summary-card__meta-grid", "data-tour": "timepoint-status", children: [
      /* @__PURE__ */ jsxs("div", {
        children: [
        /* @__PURE__ */ jsx("small", { children: "Barcode" }),
        /* @__PURE__ */ jsx("strong", { className: "mono", children: next.barcode ?? "Manual" })
        ]
      }),
      /* @__PURE__ */ jsxs("div", {
        children: [
        /* @__PURE__ */ jsx("small", { children: "Window" }),
        /* @__PURE__ */ jsx("strong", { children: formatWindow(next.windowStart, next.windowEnd) })
        ]
      }),
      /* @__PURE__ */ jsxs("div", {
        children: [
        /* @__PURE__ */ jsx("small", { children: "Remaining" }),
        /* @__PURE__ */ jsx("strong", { className: countdownStatus === "in-window" ? "remaining--in-window" : countdownStatus === "overdue" ? "remaining--overdue" : undefined, children: countdown })
        ]
      })
      ]
    })
    ]
  }) : /* @__PURE__ */ jsx("p", { className: "empty-state empty-state--compact", children: "No pending activity." });
  const togglePendingSample = (sampleId) => {
    setExpandedPendingSampleId((current) => (current === sampleId ? null : sampleId));
  };
  const renderSampleAliquotList = (sample, { allowSkip = false } = {}) => {
    const expectedBarcodes = getSampleExpectedAliquotBarcodes(state, sample);
    const children = state.aliquots.filter((aliquot) => aliquot.parentSampleId === sample.id);
    const canSkip = allowSkip && !isSampleReviewLocked(sample);
    if (!expectedBarcodes.length) {
      return /* @__PURE__ */ jsx("p", { className: "pending-sample-item__empty", children: "Aliquots are not ready for this sample yet." });
    }
    return /* @__PURE__ */ jsx("div", {
      className: "aliquot-inline-list pending-sample-item__aliquot-list", children: expectedBarcodes.map((barcode, index) => {
        const child = children.find((aliquot) => aliquot.barcode.toUpperCase() === barcode.toUpperCase()) ?? children[index];
        return /* @__PURE__ */ jsxs("div", {
          className: "aliquot-modal-list__item", children: [
          /* @__PURE__ */ jsx("span", { className: "mono aliquot-modal-list__barcode", children: barcode }),
          /* @__PURE__ */ jsxs("div", {
            className: "aliquot-modal-list__status", children: [
            /* @__PURE__ */ jsx(StatusBadge, { status: child?.createdAt ? "Completed" : child?.skippedAt ? "Skipped" : "Upcoming" }),
              canSkip && child && !child.createdAt && !child.skippedAt && /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--sm btn--ghost", onClick: () => openAliquotSkip(child.id), children: "Missed/Skip" })
            ]
          })
          ]
        }, barcode);
      })
    });
  };
  const pkConfirmVisit = pkConfirm ? state.visits.find((v) => v.id === pkConfirm.visitId) : null;
  const pkConfirmVisitLabel = pkConfirm ? (pkConfirmVisit?.label ?? pkConfirm.visitLabel) : "";
  const pkConfirmDoseNum = pkConfirm ? getDoseNumber(pkConfirm.dose) : null;
  const pkConfirmPeriod = pkConfirm && pkConfirmVisit ? getPeriodLabel(pkConfirmVisit, pkConfirmDoseNum) : null;
  const pkConfirmSecondRow = pkConfirm
    ? [
      formatTimepointDisplayLabel(pkConfirm.timepoint, pkConfirm.dose),
      pkConfirmVisitLabel,
      pkConfirmPeriod
    ].filter(Boolean).join(" · ")
    : "";

  return /* @__PURE__ */ jsxs("div", {
    className: "page page--execution", "data-tour": "page-root", children: [
    /* @__PURE__ */ jsx(BarcodeCameraModal, {
      open: subjectCameraOpen, title: UI_LABELS.scanParticipantBarcode, onClose: () => setSubjectCameraOpen(false), onDetected: (code) => {
        setSubjectCameraOpen(false);
        submitSubjectScan(code);
      }
    }),
    /* @__PURE__ */ jsx(PasswordConfirmModal, {
      open: !!pendingSubmitDose,
      title: "Confirm Submission",
      message: "Please enter your password to submit this dose for review. This action will be recorded in the audit trail.",
      details: (() => {
        if (!pendingSubmitDose || !subject) return undefined;
        const targetVisit = findVisitForSubjectDose(state, subject.id, pendingSubmitDose);
        return [
          { label: "Participant", value: formatParticipantDisplay(subject) },
          { label: "Dose", value: formatDoseWithVisit(pendingSubmitDose, targetVisit) },
        ];
      })(),
      confirmLabel: "Verify & Submit",
      onValidatePassword: validatePassword,
      onClose: () => setPendingSubmitDose(null),
      onConfirm: handlePasswordConfirmed
    }),
      scanAlert && /* @__PURE__ */ jsxs("div", {
        className: "soft-alert-toast soft-alert-toast--warning", role: "alert", children: [
      /* @__PURE__ */ jsxs("div", {
          children: [
        /* @__PURE__ */ jsx("strong", { children: "Alert" }),
        /* @__PURE__ */ jsx("span", { children: scanAlert })
          ]
        }),
      /* @__PURE__ */ jsx("button", { type: "button", "aria-label": "Close alert", onClick: () => setScanAlert(null), children: "x" })
        ]
      }),
      submitMessage && /* @__PURE__ */ jsxs("div", {
        className: "soft-alert-toast soft-alert-toast--success", role: "status", children: [
      /* @__PURE__ */ jsxs("div", {
          children: [
        /* @__PURE__ */ jsx("strong", { children: "Submit" }),
        /* @__PURE__ */ jsx("span", { children: submitMessage })
          ]
        }),
      /* @__PURE__ */ jsx("button", { type: "button", "aria-label": "Close alert", onClick: () => setSubmitMessage(null), children: "x" })
        ]
      }),
      hasSubject && showAllActivities ? /* @__PURE__ */ jsxs("div", {
        className: "card exec-all-activities-card", "data-tour": "all-activities-panel", children: [
      /* @__PURE__ */ jsxs("div", {
          className: "exec-all-activities-card__header", children: [
        /* @__PURE__ */ jsx("button", {
            type: "button",
            className: "exec-all-activities-card__back",
            onClick: () => setShowAllActivities(false),
            "aria-label": "Back",
            title: "Back",
            children: /* @__PURE__ */ jsxs("svg", {
              width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: [
            /* @__PURE__ */ jsx("line", { x1: "19", y1: "12", x2: "5", y2: "12" }),
            /* @__PURE__ */ jsx("polyline", { points: "12 19 5 12 12 5" })
              ]
            })
          }),
        /* @__PURE__ */ jsx("h2", { className: "exec-all-activities-card__title", children: `All Activities - ${formatParticipantDropdownLabel(subject)}` }),
        /* @__PURE__ */ jsxs("div", {
          className: "exec-all-activities-card__header-actions",
          children: [
            /* @__PURE__ */ jsx("button", {
              type: "button",
              className: "btn btn--secondary btn--sm",
              disabled: exportPdfBusy || !subjectId,
              onClick: handleExportCompliancePdf,
              "data-tour": "export-pdf",
              children: exportPdfBusy ? "Exporting…" : "Export PDF"
            }),
            (() => {
              const doseLabel = allActivitiesDoseFilter || currentDoseFilterLabel;
              if (!doseLabel) return null;
              const reviewStatus = getDoseReviewStatus?.(doseLabel);
              if (reviewStatus === "reviewed") {
                return /* @__PURE__ */ jsx("span", { className: "activity-grid__submit-note activity-grid__submit-note--reviewed exec-all-activities-card__submit", children: "Reviewed" });
              }
              if (reviewStatus === "under-review") {
                return /* @__PURE__ */ jsx("span", { className: "activity-grid__submit-note activity-grid__submit-note--under-review exec-all-activities-card__submit", children: "Under Review" });
              }
              if (!canSubmitDose?.(doseLabel)) return null;
              return /* @__PURE__ */ jsx("button", {
                type: "button",
                className: "btn btn--primary btn--sm exec-all-activities-card__submit",
                onClick: () => handleSubmitDose(doseLabel),
                children: "Submit"
              });
            })()
          ]
        })
          ]
        }),
      /* @__PURE__ */ jsx(
          ActivityGrid,
          {
            activities: subjectActivities,
            flatMobileRows: true,
            visits: state.visits,
            samples: state.samples,
            aliquots: state.aliquots,
            defaultDoseFilter: currentDoseFilterLabel,
            onDoseFilterChange: setAllActivitiesDoseFilter,
            hideMobileSubmit: true,
            actionableActivityId: next?.id,
            isActualEditable: (activity) => {
              if (activity.activity === "IMP Dose Administration") {
                return !isDoseRecordLocked(activity.visitId, activity.id);
              }
              return true;
            },
            onOpenActualAudit: (id) => openFieldDbAudit(id, "ActualTime", "Actual Time Audit"),
            onOpenScanStartAudit: (id) => openFieldDbAudit(id, "CentrifugationStart", "Centrifuge Start Audit"),
            onOpenRemarkAudit: (id) => openFieldDbAudit(id, "Remarks", "Deviation / Remark Audit"),
            onOpenFieldAudit: openFieldDbAudit,
            onOpenQueryAudit: openQueryAudit,
            queriesEnabled: true,
            onEditActual: (id) => {
              const targetActivity = visitActivities.find((activity) => activity.id === id)
                ?? subjectActivities.find((activity) => activity.id === id);
              if (!targetActivity) return;
              if (targetActivity.activity === "IMP Dose Administration") {
                if (isDoseRecordLocked(targetActivity.visitId, targetActivity.id)) return;
                openDoseModalForActivity(targetActivity);
                return;
              }
              setActualEditTargetId(id);
            },

            onOpenCrf: openCrfForActivity,
            onEditCrfField: openCrfFieldForActivity,
            onOpenCrfFieldAudit: openCrfFieldDbAudit,
            onEditScanStart: (id) => setScanStartEditTargetId(id),
            onSkip: (id) => setModalTarget({ type: "skip", activityId: id }),
            onRemark: (id) => setModalTarget({ type: "remark", activityId: id }),
            onOpenAliquot: (sampleId) => setAliquotViewParentId(sampleId),
            canSubmitDose,
            onSubmitDose: handleSubmitDose,
            getDoseReviewStatus
          },
          subjectId
        )
        ]
      }) : hasSubject ? /* @__PURE__ */ jsxs(Fragment, {
        children: [
          /* @__PURE__ */ jsxs("div", {
          className: `card exec-session-card${syncSessionRowHeight ? " exec-session-card--sync-height" : ""}`,
          children: [
              /* @__PURE__ */ jsxs("header", {
            className: "exec-session-card__header", children: [
                  /* @__PURE__ */ jsx("button", {
              type: "button",
              className: "exec-session-card__back",
              onClick: () => clearSubjectSession(),
              "aria-label": UI_LABELS.changeParticipant,
              title: UI_LABELS.changeParticipant,
              children: /* @__PURE__ */ jsxs("svg", {
                width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
                        /* @__PURE__ */ jsx("line", { x1: "19", y1: "12", x2: "5", y2: "12" }),
                        /* @__PURE__ */ jsx("polyline", { points: "12 19 5 12 12 5" })
                ]
              })
            }),
                  /* @__PURE__ */ jsx("strong", {
              className: "exec-session-card__title", children: formatParticipantDisplay(subject)
            }),
                  /* @__PURE__ */ jsx("span", { className: "exec-session-card__mode-badge", children: subjectMode === "scan" ? "Scan" : "Manual" })
            ]
          }),
              /* @__PURE__ */ jsxs("div", {
            className: `exec-session-card__workspace${syncSessionRowHeight ? " exec-session-card--sync-height" : ""}`,
            style: sessionRowHeight ? { "--exec-session-sync-height": `${sessionRowHeight}px` } : void 0,
            children: [
                  /* @__PURE__ */ jsxs("div", {
              className: "exec-session-card__left", ref: sessionLeftRef, children: [
                      /* @__PURE__ */ jsx("div", {
                className: "exec-session-card__scan", children:
                          /* @__PURE__ */ jsx(
                  ScanZone,
                  {
                    placeholder: "",
                    onScan: handleWorkflowScan,
                    showManualToggle: false,
                    manualEntry: subjectMode === "manual",
                    onManualToggle: (val) => setSubjectMode(val ? "manual" : "scan"),
                    phase: "Barcode Scan",
                    instruction: "",
                    variant: "execution",
                    layout: "session",
                    showFeedback: false
                  }
                )
              }),
                centrifugeBatch && /* @__PURE__ */ jsx("div", {
                  className: "exec-session-card__batch", children:
                          /* @__PURE__ */ jsx(
                    CentrifugeBatchPanel,
                    {
                      samples: centrifugeBatch.samples,
                      centrifugeStartTime,
                      onRemove: removeCentrifugeBatchSample,
                      onCancel: cancelCentrifugeBatch,
                      onStart: () => setCentrifugeBatchConfirm(true),
                      variant: "both",
                      subjects: state.subjects,
                    }
                  )
                })
              ]
            }),
                  /* @__PURE__ */ jsxs("div", {
              className: "exec-session-card__right", children: [
                      /* @__PURE__ */ jsxs("div", {
                className: "exec-session-card__tabs", role: "tablist", "aria-label": "Execution views", "data-tour": "exec-session-tabs", children: [
                          /* @__PURE__ */ jsx("button", {
                  type: "button",
                  role: "tab",
                  "aria-selected": activeExecTab === "next",
                  className: `exec-session-card__tab ${activeExecTab === "next" ? "exec-session-card__tab--active" : ""}`,
                  onClick: () => setActiveExecTab("next"),
                  children: isDoseNextActivity ? "Dose Setup" : "Sample Collection",
                  "data-tour": "tab-sample-collection"
                }),
                          /* @__PURE__ */ jsx("button", {
                  type: "button",
                  role: "tab",
                  "aria-selected": activeExecTab === "pending",
                  className: `exec-session-card__tab ${activeExecTab === "pending" ? "exec-session-card__tab--active" : ""}`,
                  disabled: !hasPendingTrace,
                  onClick: () => setActiveExecTab("pending"),
                  children: "Centrifuge & Aliquot",
                  "data-tour": "tab-centrifuge-aliquot"
                })
                ]
              }),
                      /* @__PURE__ */ jsxs("div", {
                className: "exec-session-card__content", children: [
                  activeExecTab === "next" ? /* @__PURE__ */ jsxs("div", {
                    className: "exec-session-card__panel", children: [
                      setupDoseCardEl,
                      !isDoseNextActivity ? /* @__PURE__ */ jsx("div", {
                        className: "next-summary-card exec-session-card__next-card",
                        "data-tour": "timepoint-card",
                        children: nextActivityDetails
                      }) : null
                    ]
                  }) : null,
                  activeExecTab === "pending" ? /* @__PURE__ */ jsx("div", {
                    className: "exec-session-card__pending-list", children: [
                      pendingSamples.length ? pendingSamples.map((sample) => {
                        const isExpanded = expandedPendingSampleId === sample.id;
                        return /* @__PURE__ */ jsxs("div", {
                          className: `pending-sample-item ${isExpanded ? "pending-sample-item--expanded" : ""}`, children: [
                                    /* @__PURE__ */ jsxs("button", {
                            type: "button",
                            className: `pending-sample-row ${isExpanded ? "pending-sample-row--active" : ""}`,
                            onClick: () => togglePendingSample(sample.id),
                            "aria-expanded": isExpanded,
                            children: [
                                        /* @__PURE__ */ jsx("strong", { children: formatPendingSampleLabel(sample, state.visits) }),
                                        /* @__PURE__ */ jsxs("span", {
                              className: "pending-sample-row__meta", children: [
                                            /* @__PURE__ */ jsx(StatusBadge, { status: sample.status, kind: "sample" }),
                                            /* @__PURE__ */ jsx("svg", {
                                className: `pending-sample-row__chevron ${isExpanded ? "pending-sample-row__chevron--open" : ""}`,
                                width: "14",
                                height: "14",
                                viewBox: "0 0 24 24",
                                fill: "none",
                                stroke: "currentColor",
                                strokeWidth: "2.5",
                                strokeLinecap: "round",
                                strokeLinejoin: "round",
                                "aria-hidden": "true",
                                children: /* @__PURE__ */ jsx("polyline", { points: "6 9 12 15 18 9" })
                              })
                              ]
                            })
                            ]
                          }),
                            isExpanded ? /* @__PURE__ */ jsx("div", {
                              className: "pending-sample-item__aliquots", children:
                                renderSampleAliquotList(sample, { allowSkip: aliquotParent?.id === sample.id })
                            }) : null
                          ]
                        }, sample.id);
                      }) : /* @__PURE__ */ jsx("p", { className: "empty-state empty-state--compact", children: "No pending centrifuge or aliquot samples." })
                    ]
                  }) : null
                ]
              }),
              /* @__PURE__ */ jsx("div", {
                className: "exec-session-card__toolbar", children:
                  /* @__PURE__ */ jsxs("button", {
                    type: "button", className: "exec-session-card__all-activities", onClick: () => setShowAllActivities(true), "data-tour": "show-all-activities", children: [
                      /* @__PURE__ */ jsxs("svg", {
                        width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
                          /* @__PURE__ */ jsx("path", { d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" }),
                          /* @__PURE__ */ jsx("rect", { x: "8", y: "2", width: "8", height: "4", rx: "1", ry: "1" }),
                          /* @__PURE__ */ jsx("line", { x1: "9", y1: "12", x2: "15", y2: "12" }),
                          /* @__PURE__ */ jsx("line", { x1: "9", y1: "16", x2: "13", y2: "16" })
                        ]
                      }),
                      /* @__PURE__ */ jsx("span", { children: "Show All Activities" })
                    ]
                  })
              }),
            ]
          }),
              adjacentActivities.length > 0 ? /* @__PURE__ */ jsxs("details", {
                className: "card collapsible-card exec-previous-timepoint exec-previous-timepoint--mobile",
                style: { paddingTop: 10 },
                open: previousTimepointOpen,
                onToggle: (e) => setPreviousTimepointOpen(e.target.open),
                children: [
                  /* @__PURE__ */ jsxs("summary", {
                    className: "exec-previous-timepoint__title",
                    children: [
                      /* @__PURE__ */ jsx("span", { children: "Previous Timepoint" }),
                      /* @__PURE__ */ jsx("svg", {
                        className: "pending-sample-row__chevron",
                        style: { transform: previousTimepointOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease" },
                        width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
                        children: /* @__PURE__ */ jsx("polyline", { points: "6 9 12 15 18 9" })
                      })
                    ]
                  }),
                  /* @__PURE__ */ jsx("div", {
                    className: "exec-previous-timepoint__body",
                    children: /* @__PURE__ */ jsx(ActivityGrid, {
                      activities: adjacentActivities,
                      hideFilters: true,
                      flatMobileRows: true,
                      visits: state.visits,
                      samples: state.samples,
                      aliquots: state.aliquots,
                      defaultDoseFilter: currentDoseFilterLabel,
                      actionableActivityId: next?.id,
                      isActualEditable: (activity) => {
                        if (activity.activity === "IMP Dose Administration") {
                          return !isDoseRecordLocked(activity.visitId, activity.id);
                        }
                        return true;
                      },
                      onOpenActualAudit: (id) => openFieldDbAudit(id, "ActualTime", "Actual Time Audit"),
                      onOpenScanStartAudit: (id) => openFieldDbAudit(id, "CentrifugationStart", "Centrifuge Start Audit"),
                      onOpenRemarkAudit: (id) => openFieldDbAudit(id, "Remarks", "Deviation / Remark Audit"),
                      onOpenFieldAudit: openFieldDbAudit,
                      onOpenQueryAudit: openQueryAudit,
            queriesEnabled: true,
                      onEditActual: (id) => {
                        const targetActivity = visitActivities.find((a) => a.id === id) ?? subjectActivities.find((a) => a.id === id);
                        if (!targetActivity) return;
                        if (targetActivity.activity === "IMP Dose Administration") {
                          if (isDoseRecordLocked(targetActivity.visitId, targetActivity.id)) return;
                          openDoseModalForActivity(targetActivity);
                          return;
                        }
                        setActualEditTargetId(id);
                      },

                      onOpenCrf: openCrfForActivity,
            onEditCrfField: openCrfFieldForActivity,
                      onOpenCrfFieldAudit: openCrfFieldDbAudit,
                      onEditScanStart: (id) => setScanStartEditTargetId(id),
                      onSkip: (id) => setModalTarget({ type: "skip", activityId: id }),
                      onRemark: (id) => setModalTarget({ type: "remark", activityId: id }),
                      onOpenAliquot: (sampleId) => setAliquotViewParentId(sampleId)
                    })
                  })
                ]
              }) : null
            ]
          }),
          adjacentActivities.length > 0 ? /* @__PURE__ */ jsxs("details", {
            className: "card collapsible-card exec-previous-timepoint",
            style: { padding: 0 },
            open: previousTimepointOpen,
            onToggle: (e) => setPreviousTimepointOpen(e.target.open),
            children: [
              /* @__PURE__ */ jsxs("summary", {
                className: "exec-previous-timepoint__title",
                children: [
                  /* @__PURE__ */ jsx("span", { children: "Previous Timepoint" }),
                  /* @__PURE__ */ jsx("svg", {
                    className: "pending-sample-row__chevron",
                    style: {
                      transform: previousTimepointOpen ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.2s ease"
                    },
                    width: "14",
                    height: "14",
                    viewBox: "0 0 24 24",
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: "2.5",
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    "aria-hidden": "true",
                    children: /* @__PURE__ */ jsx("polyline", { points: "6 9 12 15 18 9" })
                  })
                ]
              }),
              /* @__PURE__ */ jsx("div", {
                className: "exec-previous-timepoint__body",
                children: /* @__PURE__ */ jsx(
                  ActivityGrid,
                  {
                    activities: adjacentActivities,
                    hideFilters: true,
                    flatMobileRows: true,
                    visits: state.visits,
                    samples: state.samples,
                    aliquots: state.aliquots,
                    defaultDoseFilter: currentDoseFilterLabel,
                    actionableActivityId: next?.id,
                    isActualEditable: (activity) => {
                      if (activity.activity === "IMP Dose Administration") {
                        return !isDoseRecordLocked(activity.visitId, activity.id);
                      }
                      return true;
                    },
                    onOpenActualAudit: (id) => openFieldDbAudit(id, "ActualTime", "Actual Time Audit"),
                    onOpenScanStartAudit: (id) => openFieldDbAudit(id, "CentrifugationStart", "Centrifuge Start Audit"),
                    onOpenRemarkAudit: (id) => openFieldDbAudit(id, "Remarks", "Deviation / Remark Audit"),
                    onOpenFieldAudit: openFieldDbAudit,
                    onOpenQueryAudit: openQueryAudit,
            queriesEnabled: true,
                    onEditActual: (id) => {
                      const targetActivity = visitActivities.find((activity) => activity.id === id)
                        ?? subjectActivities.find((activity) => activity.id === id);
                      if (!targetActivity) return;
                      if (targetActivity.activity === "IMP Dose Administration") {
                        if (isDoseRecordLocked(targetActivity.visitId, targetActivity.id)) return;
                        openDoseModalForActivity(targetActivity);
                        return;
                      }
                      setActualEditTargetId(id);
                    },

                    onOpenCrf: openCrfForActivity,
            onEditCrfField: openCrfFieldForActivity,
                    onOpenCrfFieldAudit: openCrfFieldDbAudit,
                    onEditScanStart: (id) => setScanStartEditTargetId(id),
                    onSkip: (id) => setModalTarget({ type: "skip", activityId: id }),
                    onRemark: (id) => setModalTarget({ type: "remark", activityId: id }),
                    onOpenAliquot: (sampleId) => setAliquotViewParentId(sampleId)
                  }
                )
              })
            ]
          }) : null
        ]
      })
    ]
  }) : /* @__PURE__ */ jsxs("section", {
        className: "card execution-top-card execution-home", children: [
      /* @__PURE__ */ jsx(ExecutionHomeDashboard, {}),
      /* @__PURE__ */ jsx("div", {
          className: "execution-top-card__subject", children:
        /* @__PURE__ */ jsxs("div", {
            className: `execution-top-card__subject-top execution-home-dock${homeScanNavEnabled && !homeScanCardOpen ? " execution-home-dock--nav-collapsed" : ""}`, children: [
          /* @__PURE__ */ jsxs("div", {
              className: "subject-mode", role: "radiogroup", "aria-label": UI_LABELS.participantSelectionMode, "data-tour": "subject-mode", children: [
            /* @__PURE__ */ jsxs(
                "label",
                {
                  className: `subject-mode__option ${subjectMode === "scan" ? "subject-mode__option--active" : ""}`,
                  "data-tour": "mode-scan",
                  children: [
                  /* @__PURE__ */ jsx("input", {
                    type: "radio", name: "subject-mode", checked: subjectMode === "scan", onChange: () => {
                      setSubjectMode("scan");
                      clearSubjectSession();
                    }
                  }),
                    "Scan"
                  ]
                }
              ),
            /* @__PURE__ */ jsxs(
                "label",
                {
                  className: `subject-mode__option ${subjectMode === "manual" ? "subject-mode__option--active" : ""}`,
                  "data-tour": "mode-manual",
                  children: [
                  /* @__PURE__ */ jsx("input", {
                    type: "radio", name: "subject-mode", checked: subjectMode === "manual", onChange: () => {
                      setSubjectMode("manual");
                      clearSubjectSession();
                    }
                  }),
                    "Manual"
                  ]
                }
              )
              ]
            }),
              subjectMode === "scan" ? /* @__PURE__ */ jsxs("section", {
                className: `scan-zone scan-zone--guided scan-zone--execution scan-zone--execution-compact card execution-subject-scan${homeScanNavEnabled && !homeScanCardOpen ? " scan-zone--nav-collapsed" : ""}`,
                "data-tour": "scan-zone",
                children: [
                  /* @__PURE__ */ jsx("div", {
                  className: "scan-zone__header",
                  children: /* @__PURE__ */ jsx("div", {
                    className: "scan-zone__phase-row",
                    children: /* @__PURE__ */ jsx("h2", { className: "scan-zone__phase", children: "Participant Barcode Scan" })
                  })
                }),
                  /* @__PURE__ */ jsxs("form", {
                  className: `scan-area scan-area--session scan-area--execution${isMobileOrTablet && !lockedSubjectBarcode ? " scan-area--input-only" : ""}`,
                  onSubmit: (event) => {
                    event.preventDefault();
                    submitSubjectScan();
                  },
                  children: [
              /* @__PURE__ */ jsx(
                    "input",
                    {
                      className: "scan-area__input",
                      value: lockedSubjectBarcode || subjectScan,
                      disabled: !!lockedSubjectBarcode,
                      onChange: (e) => setSubjectScan(e.target.value),
                      onKeyDown: (e) => {
                        if (e.key === "Enter" || e.code === "NumpadEnter") {
                          e.preventDefault();
                          submitSubjectScan();
                        }
                      },
                      placeholder: "Scan participant barcode, e.g. 101-01",
                      "aria-label": "Participant barcode", "data-tour": "scan-barcode-input"
                    }
                  ),
                    lockedSubjectBarcode ? /* @__PURE__ */ jsx(
                      "button",
                      {
                        type: "button",
                        className: "btn btn--secondary scan-area__button",
                        onClick: () => {
                          clearSubjectSession();
                        },
                        children: "Change"
                      }
                    ) : isMobileOrTablet ? /* @__PURE__ */ jsx("button", {
                      type: "submit",
                      className: "scan-area__submit-hidden",
                      tabIndex: -1,
                      "aria-hidden": "true",
                      disabled: subjectStartBusy,
                      children: "Scan"
                    }) : /* @__PURE__ */ jsx("button", {
                      type: "submit",
                      className: "btn btn--primary scan-area__button",
                      disabled: subjectStartBusy,
                      children: subjectStartBusy ? "Checking…" : "Scan"
                    })
                  ]
                })
                ]
              }) : /* @__PURE__ */ jsx("div", {
                className: "exec-selectors", "data-tour": "manual-subject-select", children: /* @__PURE__ */ jsx(ScrollableSelect, {
                  ariaLabel: UI_LABELS.selectParticipant,
                  value: subjectStarted ? subjectId ?? "" : "",
                  onChange: handleManualSubjectSelect,
                  placeholder: UI_LABELS.selectParticipant,
                  searchable: true,
                  options: selectableSubjects.map((s) => ({
                    value: s.id,
                    label: formatParticipantDropdownLabel(s),
                  })),
                })
              })
            ]
          })
        })
      ]
      }),
    /* @__PURE__ */ jsx(
        DoseModal,
        {
          open: doseModalOpen,
          title: doseModalMode === "setup" ? "Setup Dose Time" : "Edit Dose Time",
          subtitle: doseModalSubtitle,
          subjectLabel: doseModalSubjectLabel,
          fieldLabel: "Dose Date/Time",
          initialValue: doseInput,
          isNewSetup: doseModalMode === "setup",
          submitError: doseModalError,
          onClose: closeDoseModal,
          onSubmit: async (value, remarkText) => {
            setDoseInput(value);
            const targetVisitId = doseModalContext?.visitId ?? visitId;
            const targetActivityId = doseModalContext?.activityId;
            const mode = doseModalContext?.mode ?? doseModalMode;
            if (!targetVisitId) {
              setDoseModalError("Visit is not selected.");
              return false;
            }
            const result = await setDoseTime(
              targetVisitId,
              fromDateTimeLocal(value),
              mode === "edit" ? remarkText : undefined,
              { activityId: targetActivityId }
            );
            if (!result.success) {
              setDoseModalError(result.message || "Could not save dose time.");
              return false;
            }
            closeDoseModal();
          },
          submitLabel: doseModalMode === "setup" ? "Save Dose Time" : "Save Dose Time",
          requireEditRemark: doseModalMode === "edit",
        }
      ),
    /* @__PURE__ */ jsx(
        CrfModal,
        {
          open: !!crfActivity,
          activity: crfActivity,
          sample: crfSample,
          visit: crfVisit,
          subjects: state.subjects,
          viewOnly: crfActivity ? !isActivityReadyForCrf(crfActivity) : false,
          notReadyMessage: crfActivity && !isActivityReadyForCrf(crfActivity)
            ? getCrfNotReadyMessage(crfActivity)
            : "",
          submitError: crfModalError,
          onClearSubmitError: () => setCrfModalError(""),
          onClose: () => {
            setCrfActivityId(null);
            setCrfModalError("");
          },
          onOpenFieldAudit: (fieldId) => {
            if (crfActivity?.id) {
              openCrfFieldDbAudit(crfActivity.id, fieldId);
            }
          },
          onOpenQueryAudit: (fieldId, fieldKey) => {
                if (!crfActivity?.id || !fieldId) return;
                openQueryAudit(crfActivity.id, fieldKey || `crf:${fieldId}`);
              },
          onResolveQuery: (fieldId, fieldKey) => {
                if (!crfActivity?.id || !fieldId) return;
                setCrfResolveTarget({
                  activityId: crfActivity.id,
                  fieldId,
                  fieldKey: fieldKey || `crf:${fieldId}`
                });
              },
          onSave: (crfId, values, changeReason) => {
            if (!crfActivity?.id) return false;
            const result = saveCrf(crfActivity.id, crfId, values, changeReason);
            if (!result.success) {
              setCrfModalError(result.message);
              return false;
            }
            setCrfModalError("");
            return true;
          }
        }
      ),
    jsx(ReviewQueryModal, {
      open: !!crfResolveTarget && !!crfResolveActivity,
      activity: crfResolveActivity,
      defaultFieldKey: crfResolveTarget?.fieldKey,
      fieldEditContext: {
        samples: state.samples,
        visits: state.visits
      },
      showFieldValue: true,
      resolveMode: true,
      hasFieldAudit: crfResolveFieldHasAudit,
      onOpenFieldAudit: (fieldKey) => {
        if (!crfResolveActivity?.id) return;
        openQueryAudit(crfResolveActivity.id, fieldKey || crfResolveTarget?.fieldKey);
      },
      onClose: () => {
        setCrfResolveTarget(null);
      },
      onResolve: async (_fieldKey, { responseText, fieldValue }) => {
        if (!crfResolveTarget?.activityId || !crfResolveActivity) return "Missing activity for resolve.";
        if (state.isNative) {
          const result = resolveReviewQuery(
            crfResolveActivity.activityExecutionHdrNo ?? crfResolveTarget.activityId,
            responseText,
            fieldValue
          );
          if (!result.success) {
            return result.message || "Could not resolve query.";
          }
          setCrfResolveTarget(null);
          setCrfActivityId(null);
          setCrfModalError("");
          return true;
        }
        const subjectMstNo = getActivitySubjectMstNo(state, crfResolveActivity);
        const activityConfigTimePointNo = Number(crfResolveActivity.activityConfigTimePointNo) || 0;
        if (!subjectMstNo || !activityConfigTimePointNo) {
          return "Missing subject or timepoint for resolve.";
        }
        try {
          const res = await resolveReviewQueryApi({
            subjectMstNo,
            activityConfigTimePointNo,
            responseText,
            fieldValue,
            fieldKey: crfResolveTarget.fieldKey || `crf:${crfResolveTarget.fieldId}`
          });
          if (!res.success) {
            return res.message || "Could not resolve query.";
          }
          if (lockedSubjectBarcode) {
            await beginGatedSession(lockedSubjectBarcode);
          }
          setCrfResolveTarget(null);
          setCrfActivityId(null);
          setCrfModalError("");
          return true;
        } catch (err) {
          return err.response?.data?.message || err.message || "Could not resolve query.";
        }
      }
    }),
    crfFieldEditField && crfFieldEditDefinition && /* @__PURE__ */ jsx(
        CrfFieldModal,
        {
          open: !!crfFieldEditTarget,
          title: crfFieldEditQueryRemark
            ? "Resolve Query"
            : `${String(crfFieldEditInitialValue ?? "").trim() ? "Edit" : "Add"} ${crfFieldEditField.label}`,
          fieldLabel: crfFieldEditField.label,
          fieldType: crfFieldEditField.type ?? "text",
          unit: crfFieldEditField.unit ?? "",
          initialValue: crfFieldEditInitialValue,
          submitError: crfFieldEditError,
          onClearSubmitError: () => setCrfFieldEditError(""),
          queryRemark: crfFieldEditQueryRemark,
          onOpenQueryAudit: crfFieldEditQueryRemark && crfFieldEditActivity
            ? () => openQueryAudit(crfFieldEditActivity.id, `crf:${crfFieldEditTarget.fieldId}`)
            : undefined,
          onClose: () => {
            setCrfFieldEditTarget(null);
            setCrfFieldEditError("");
          },
          onSubmit: async (value, remarkText) => {
            if (!crfFieldEditActivity?.id || !crfFieldEditTarget?.fieldId) return false;
            const fieldKey = `crf:${crfFieldEditTarget.fieldId}`;
            const activeQuery = (isActiveReviewQuery(crfFieldEditActivity, fieldKey) || !!crfFieldEditQueryRemark);
            const valueChanged = String(value ?? "").trim() !== String(crfFieldEditInitialValue ?? "").trim();

            if (activeQuery && !state.isNative) {
              const subjectMstNo = getActivitySubjectMstNo(state, crfFieldEditActivity);
              const activityConfigTimePointNo = Number(crfFieldEditActivity.activityConfigTimePointNo) || 0;
              if (!subjectMstNo || !activityConfigTimePointNo) {
                setCrfFieldEditError("Missing subject or timepoint for resolve.");
                return false;
              }
              try {
                const res = await resolveReviewQueryApi({
                  subjectMstNo,
                  activityConfigTimePointNo,
                  responseText: remarkText,
                  fieldValue: valueChanged ? value : undefined,
                  fieldKey
                });
                if (!res.success) {
                  setCrfFieldEditError(res.message || "Could not resolve query.");
                  return false;
                }
                if (lockedSubjectBarcode) {
                  await beginGatedSession(lockedSubjectBarcode);
                }
                setCrfFieldEditTarget(null);
                setCrfFieldEditError("");
                return true;
              } catch (err) {
                setCrfFieldEditError(err.response?.data?.message || err.message || "Could not resolve query.");
                return false;
              }
            }

            const result = saveCrfField(
              crfFieldEditActivity.id,
              crfFieldEditDefinition.id,
              crfFieldEditTarget.fieldId,
              value,
              remarkText
            );
            if (!result.success) {
              setCrfFieldEditError(result.message);
              return false;
            }
            setCrfFieldEditTarget(null);
            setCrfFieldEditError("");
          }
        }
      ),
      actualEditActivity && /* @__PURE__ */ jsx("div", {
        className: "modal-backdrop", role: "presentation", children: /* @__PURE__ */ jsxs("div", {
          className: "modal", onClick: (e) => e.stopPropagation(), role: "dialog", "aria-modal": "true", children: [
      /* @__PURE__ */ jsxs("div", {
        className: "modal__title-row",
        style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" },
        children: [
          /* @__PURE__ */ jsx("h3", {
            className: "modal__title",
            style: { margin: 0 },
            children: actualEditQueryRemark
              ? "Resolve Query"
              : actualEditActivity.activity === "IMP Dose Administration"
                ? `${actualEditActivity.actualTime ? "Edit" : "Confirm"} Dose Administration`
                : isUnskipActualEdit
                  ? "Set Actual Time (was skipped)"
                  : `${actualEditActivity.actualTime ? "Edit" : "Set"} Actual Time`
          }),
          actualEditQueryRemark ? /* @__PURE__ */ jsx("button", {
            type: "button",
            className: "btn btn--sm btn--secondary activity-grid__edit-btn activity-grid__audit-btn",
            onClick: () => openQueryAudit(actualEditActivity.id, "actual"),
            "aria-label": "View query audit",
            title: "View query audit",
            children: /* @__PURE__ */ jsx("svg", {
              width: "14",
              height: "14",
              viewBox: "0 0 16 16",
              fill: "none",
              "aria-hidden": "true",
              children: /* @__PURE__ */ jsx("path", {
                d: "M4 2.5h5.2L12 5.3v8.2H4v-11zM9 2.5v3h3M5.8 8h4.4M5.8 10h4.4M5.8 12h2.4",
                stroke: "currentColor",
                strokeWidth: "1.3",
                strokeLinecap: "round",
                strokeLinejoin: "round"
              })
            })
          }) : null
        ]
      }),
      /* @__PURE__ */ jsxs("label", {
            className: "field modal__field", children: [
        /* @__PURE__ */ jsx("span", { children: "Actual Date/Time" }),
        /* @__PURE__ */ jsx(
              DateTime24Input,
              {
                value: actualEditInput,
                onChange: (value) => {
                  setActualEditInput(value);
                  setActualEditError("");
                },
                autoFocus: true
              }
            )
            ]
          }),
            actualEditDeviationReason && /* @__PURE__ */ jsxs("div", {
              className: "modal__inline-alert modal__inline-alert--warning", children: [
        /* @__PURE__ */ jsx("span", { children: "Deviation Reason" }),
        /* @__PURE__ */ jsx("strong", { children: actualEditDeviationReason })
              ]
            }),
            (actualEditActivity.actualTime || isUnskipActualEdit) && /* @__PURE__ */ jsxs("label", {
              className: "field modal__field", children: [
        /* @__PURE__ */ jsx("span", {
          children: actualEditQueryRemark
            ? "Resolve / Value Change Remark"
            : isUnskipActualEdit
              ? "Remark for collecting skipped timepoint"
              : (actualEditDeviationReason ? "Remark For Time Change / Deviation Reason" : "Remark For Time Change")
        }),
        /* @__PURE__ */ jsx("textarea", {
                className: "modal__textarea",
                value: actualEditReason,
                onChange: (event) => {
                  setActualEditReason(event.target.value);
                  setActualEditError("");
                },
                placeholder: actualEditQueryRemark
                  ? "Enter resolve / value change remark..."
                  : isUnskipActualEdit
                    ? "Enter remark for collecting this skipped timepoint..."
                    : "Enter remark for changing actual time...",
                rows: 3
              })
              ]
            }),
            actualEditError && /* @__PURE__ */ jsx("p", { className: "modal__error", children: actualEditError }),
      /* @__PURE__ */ jsxs("div", {
              className: "modal__actions", children: [
        /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--ghost", onClick: () => setActualEditTargetId(null), children: "Cancel" }),
        /* @__PURE__ */ jsx("button", {
                type: "button", className: "btn btn--primary", onClick: () => {
                  if (!actualEditInput) {
                    setActualEditError("Actual date/time is required.");
                    return;
                  }
                  const reason = actualEditReason.trim();
                  const nextActualTime = fromDateTimeLocal(actualEditInput);
                  const currentActualInput = formatDateTimeLocal(actualEditActivity.actualTime);
                  const activeQuery = (isActiveReviewQuery(actualEditActivity, "actual") || !!actualEditQueryRemark);
                  const valueChanged = !(actualEditActivity.actualTime && actualEditInput === currentActualInput);
                  if (!valueChanged && !activeQuery && !isUnskipActualEdit) {
                    setActualEditError("No value changed. Please change the actual date/time before saving.");
                    return;
                  }
                  if (activeQuery && !reason) {
                    setActualEditError("Resolve / value change remark is required before resolving query.");
                    return;
                  }
                  if (!activeQuery && (actualEditActivity.actualTime || isUnskipActualEdit) && !reason) {
                    setActualEditError(
                      isUnskipActualEdit
                        ? "Remark is required before collecting a skipped timepoint."
                        : "Remark is required before changing actual time."
                    );
                    return;
                  }

                  if (activeQuery) {
                    if (state.isNative) {
                      const result = valueChanged
                        ? resolveReviewQuery(actualEditActivity.id, reason, nextActualTime)
                        : resolveReviewQuery(actualEditActivity.id, reason);
                      if (!result.success) {
                        setActualEditError(result.message || "Could not resolve query.");
                        return;
                      }
                      setActualEditTargetId(null);
                    } else {
                      const subjectMstNo = getActivitySubjectMstNo(state, actualEditActivity);
                      const activityConfigTimePointNo = Number(actualEditActivity.activityConfigTimePointNo) || 0;
                      if (!subjectMstNo || !activityConfigTimePointNo) {
                        setActualEditError("Missing subject or timepoint for resolve.");
                        return;
                      }
                      resolveReviewQueryApi({
                        subjectMstNo,
                        activityConfigTimePointNo,
                        responseText: reason,
                        fieldValue: valueChanged ? formatDisplayDateTime(nextActualTime) : undefined,
                        fieldKey: "actual"
                      }).then(async (res) => {
                        if (res.success) {
                          if (lockedSubjectBarcode) {
                            await beginGatedSession(lockedSubjectBarcode);
                          }
                          setActualEditTargetId(null);
                        } else {
                          setActualEditError(res.message || "Could not resolve query.");
                        }
                      }).catch((err) => {
                        setActualEditError(err.response?.data?.message || err.message || "Could not resolve query.");
                      });
                    }
                  } else {
                    void setActivityActual(actualEditActivity.id, nextActualTime, reason || void 0).then((result) => {
                      if (!result?.success) {
                        setActualEditError(result?.message || "Could not save actual time.");
                        return;
                      }
                      setActualEditTargetId(null);
                    });
                  }
                }, children: "Save"
              })
              ]
            })
          ]
        })
      }),
      scanStartEditActivity && scanStartEditSample && /* @__PURE__ */ jsx(
        DoseModal,
        {
          open: true,
          title: scanStartEditQueryRemark ? "Resolve Query" : "Edit Start Time",
          fieldLabel: "Start Date/Time",
          initialValue: formatDateTimeLocal(resolveCentrifugeStartTime(scanStartEditActivity, scanStartEditSample)),
          submitLabel: "Save Start Time",
          queryRemark: scanStartEditQueryRemark,
          onOpenQueryAudit: scanStartEditQueryRemark && scanStartEditActivity
            ? () => openQueryAudit(scanStartEditActivity.id, "scanStart")
            : undefined,
          onClose: () => setScanStartEditTargetId(null),
          onSubmit: async (nextValue, reason) => {
            const activeQuery = isActiveReviewQuery(scanStartEditActivity, "scanStart");
            if (activeQuery) {
              const formattedVal = fromDateTimeLocal(nextValue);
              const currentLocal = formatDateTimeLocal(
                resolveCentrifugeStartTime(scanStartEditActivity, scanStartEditSample)
              );
              const valueChanged = String(nextValue ?? "").trim() !== String(currentLocal ?? "").trim();
              if (state.isNative) {
                if (valueChanged) {
                  resolveReviewQuery(scanStartEditActivity.id, reason, formattedVal);
                } else {
                  resolveReviewQuery(scanStartEditActivity.id, reason);
                }
              } else {
                const subjectMstNo = getActivitySubjectMstNo(state, scanStartEditActivity);
                const activityConfigTimePointNo = Number(scanStartEditActivity.activityConfigTimePointNo) || 0;
                if (!subjectMstNo || !activityConfigTimePointNo) {
                  throw new Error("Missing subject or timepoint for resolve.");
                }
                const res = await resolveReviewQueryApi({
                  subjectMstNo,
                  activityConfigTimePointNo,
                  responseText: reason,
                  fieldValue: valueChanged ? formatDisplayDateTime(formattedVal) : undefined,
                  fieldKey: "scanStart"
                });
                if (!res.success) {
                  throw new Error(res.message || "Could not resolve query.");
                }
                if (lockedSubjectBarcode) {
                  await beginGatedSession(lockedSubjectBarcode);
                }
              }
            } else {
              if (usesCentrifugeWorkflowStart(scanStartEditSample)) {
                editCentrifugeStart(scanStartEditSample.id, fromDateTimeLocal(nextValue), reason);
              } else {
                editTimepointScanStart(scanStartEditSample.id, fromDateTimeLocal(nextValue), reason);
              }
            }
            setScanStartEditTargetId(null);
          }
        }
      ),
      pendingSkipTarget && /* @__PURE__ */ jsx("div", {
        className: "modal-backdrop", role: "presentation", children: /* @__PURE__ */ jsxs("div", {
          className: "modal modal--skip-pending", onClick: (e) => e.stopPropagation(), role: "dialog", "aria-modal": "true", children: [
      /* @__PURE__ */ jsx("h3", { className: "modal__title", children: "Skip Pending Timepoint?" }),
      /* @__PURE__ */ jsxs("p", {
            className: "modal__message skip-pending__intro", children: [
              "You scanned ",
        /* @__PURE__ */ jsx("strong", { className: "mono", children: pendingSkipTarget.activity.barcode ?? pendingSkipTarget.code }),
              ". The previous PK collection timepoint",
              pendingSkipTarget.pendingActivities.length > 1 ? "s are" : " is",
              " still pending."
            ]
          }),
      /* @__PURE__ */ jsxs("div", {
            className: "confirm-detail-card skip-pending__details", children: [
        /* @__PURE__ */ jsxs("div", {
              className: "confirm-detail-card__row", children: [
          /* @__PURE__ */ jsx("span", { children: UI_LABELS.siteRandomizationNo }),
          /* @__PURE__ */ jsx("strong", { children: resolveSiteRandomizationNumber({ subjectId: pendingSkipTarget.activity.subjectId, subjects: state.subjects, subjectNumber: pendingSkipTarget.activity.subjectNumber }) })
              ]
            }),
        /* @__PURE__ */ jsxs("div", {
              className: "confirm-detail-card__row", children: [
          /* @__PURE__ */ jsx("span", { children: "Scanned PK" }),
          /* @__PURE__ */ jsx("strong", { className: "mono", children: pendingSkipTarget.activity.barcode ?? pendingSkipTarget.code })
              ]
            }),
        /* @__PURE__ */ jsxs("div", {
              className: "confirm-detail-card__row", children: [
          /* @__PURE__ */ jsx("span", { children: "Target" }),
          /* @__PURE__ */ jsx("strong", { children: formatActivityTimepointLabel(pendingSkipTarget.activity) })
              ]
            })
            ]
          }),
      /* @__PURE__ */ jsxs("div", {
            className: "skip-pending__panel", children: [
        /* @__PURE__ */ jsxs("div", {
              className: "skip-pending__panel-head", children: [
          /* @__PURE__ */ jsx("strong", { children: "Do you want to skip these pending blood collections?" }),
          /* @__PURE__ */ jsxs("span", {
                children: [
                  pendingSkipTarget.pendingActivities.length,
                  " pending timepoint",
                  pendingSkipTarget.pendingActivities.length > 1 ? "s" : ""
                ]
              })
              ]
            }),
        /* @__PURE__ */ jsx("div", {
              className: "skip-pending__inline-list", children: pendingSkipTarget.pendingActivities.map((activity, index) => /* @__PURE__ */ jsxs("span", {
                children: [
          /* @__PURE__ */ jsx("strong", { children: formatActivityTimepointLabel(activity) }),
                  index < pendingSkipTarget.pendingActivities.length - 1 ? ", " : ""
                ]
              }, activity.id))
            })
            ]
          }),
      /* @__PURE__ */ jsxs("label", {
            className: "field modal__field skip-pending__remark", children: [
        /* @__PURE__ */ jsx("span", { children: "Skip Remark" }),
        /* @__PURE__ */ jsx(
              "textarea",
              {
                className: "modal__textarea",
                value: pendingSkipRemark,
                onChange: (event) => {
                  setPendingSkipRemark(event.target.value);
                  setPendingSkipError("");
                },
                placeholder: "Enter reason for skipping pending timepoint(s)...",
                rows: 3,
                autoFocus: true
              }
            )
            ]
          }),
            pendingSkipError && /* @__PURE__ */ jsx("p", { className: "modal__error", children: pendingSkipError }),
      /* @__PURE__ */ jsxs("div", {
              className: "modal__actions skip-pending__actions", children: [
        /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--ghost", onClick: () => setPendingSkipTarget(null), children: "Cancel" }),
        /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--danger", onClick: confirmPendingSkip, children: "Confirm Skip" })
              ]
            })
          ]
        })
      }),
    /* @__PURE__ */ jsx(
        RemarkModal,
        {
          open: !!modalTarget,
          title: modalTitle,
          details: modalTarget?.type === "skip" ? modalDetails : undefined,
          placeholder: modalTarget?.type === "skip" ? "Enter reason for skipping this activity..." : modalTarget?.type === "deviation" ? "Enter deviation explanation..." : "Enter remark...",
          initialValue: modalActivity?.remarks ?? "",
          submitLabel: modalTarget?.type === "skip" ? "Skip With Remark" : "Save Remark",
          required: modalTarget?.type === "skip" || isDeviationRemarkRequired || !!remarkModalQueryRemark,
          lockClose: modalTarget?.type === "deviation",
          queryRemark: remarkModalQueryRemark,
          valueLabel: modalHasDeviation ? "Deviation Remark" : "Remark",
          onOpenQueryAudit: remarkModalQueryRemark && modalActivity
            ? () => openQueryAudit(modalActivity.id, "remark")
            : undefined,
          onClose: () => setModalTarget(null),
          onSubmit: async (text, responseRemark) => {
            if (!modalTarget) return;
            if (modalTarget.type === "skip") {
              skip(modalTarget.activityId, text);
            } else if (modalTarget.type === "deviation") {
              markDeviation(modalTarget.activityId, text);
            } else {
              const activeQuery = isActiveReviewQuery(modalActivity, "remark");
              if (activeQuery) {
                const responseText = String(responseRemark ?? "").trim() || text;
                if (state.isNative) {
                  const result = resolveReviewQuery(modalActivity.id, responseText, text);
                  if (!result.success) {
                    throw new Error(result.message || "Could not resolve query.");
                  }
                } else {
                  const subjectMstNo = getActivitySubjectMstNo(state, modalActivity);
                  const activityConfigTimePointNo = Number(modalActivity.activityConfigTimePointNo) || 0;
                  if (!subjectMstNo || !activityConfigTimePointNo) {
                    throw new Error("Missing subject or timepoint for resolve.");
                  }
                  const res = await resolveReviewQueryApi({
                    subjectMstNo,
                    activityConfigTimePointNo,
                    responseText,
                    fieldValue: text,
                    fieldKey: "remark"
                  });
                  if (!res.success) {
                    throw new Error(res.message || "Could not resolve query.");
                  }
                  if (lockedSubjectBarcode) {
                    await beginGatedSession(lockedSubjectBarcode);
                  }
                }
              } else {
                remark(modalTarget.activityId, text);
              }
            }
          }
        }
      ),
      pendingSubjectLink && /* @__PURE__ */ jsx("div", {
        className: "modal-backdrop", role: "presentation", children: /* @__PURE__ */ jsxs("div", {
          className: "modal", onClick: (e) => e.stopPropagation(), role: "dialog", "aria-modal": "true", children: [
      /* @__PURE__ */ jsx("h3", { className: "modal__title", children: UI_LABELS.linkParticipantBarcode }),
      /* @__PURE__ */ jsxs("p", {
            className: "modal__message", children: [
              "Barcode ",
        /* @__PURE__ */ jsx("strong", { className: "mono", children: pendingSubjectLink.code }),
              " is not linked to any participant. Select the participant you want to link."
            ]
          }),
      /* @__PURE__ */ jsxs("label", {
            className: "field modal__field", children: [
        /* @__PURE__ */ jsx("span", { children: UI_LABELS.participant }),
        /* @__PURE__ */ jsx(ScrollableSelect, {
              value: subjectLinkTargetId,
              onChange: (nextValue) => {
                setSubjectLinkTargetId(nextValue);
                setSubjectLinkError("");
              },
              placeholder: UI_LABELS.selectParticipant,
              searchable: true,
              options: linkableSubjects.map((item) => ({
                value: item.id,
                label: formatParticipantDropdownLabel(item),
              })),
            })
            ]
          }),
            subjectLinkError && /* @__PURE__ */ jsx("p", { className: "modal__error", children: subjectLinkError }),
      /* @__PURE__ */ jsxs("div", {
              className: "modal__actions", children: [
        /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--ghost", onClick: () => setPendingSubjectLink(null), children: "Cancel" }),
        /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--primary", onClick: confirmSubjectLink, children: "Link Barcode" })
              ]
            })
          ]
        })
      }),
      pkConfirm && /* @__PURE__ */ jsx("div", {
        className: "modal-backdrop", role: "presentation", children: /* @__PURE__ */ jsxs("div", {
          className: "modal", onClick: (e) => e.stopPropagation(), role: "dialog", "aria-modal": "true", children: [
      /* @__PURE__ */ jsx("h3", { className: "modal__title", children: "Confirm PK Collection" }),
      /* @__PURE__ */ jsxs("div", {
            className: "modal__message",
            style: { display: "flex", flexDirection: "column", gap: "6px" },
            children: [
              /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsx("strong", { children: pkConfirmSubject ? formatParticipantDisplay(pkConfirmSubject) : resolveSiteRandomizationNumber({ subjectNumber: pkConfirm.subjectNumber }) }) }),
              /* @__PURE__ */ jsx("div", { style: { fontSize: "13.5px", color: "var(--text-secondary)" }, children: pkConfirmSecondRow }),
              /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsx("span", { className: "mono", children: pkConfirm.barcode }) })
            ]
          }),
      /* @__PURE__ */ jsxs("label", {
            className: "field modal__field", children: [
        /* @__PURE__ */ jsx("span", { children: "Actual Collection Date/Time" }),
        /* @__PURE__ */ jsx(
              DateTime24Input,
              {
                value: pkConfirm.actualInput,
                onChange: (value) => setPkConfirm({ ...pkConfirm, actualInput: value, error: "" }),
                autoFocus: true
              }
            )
            ]
          }),
            pkConfirmDeviationReason && /* @__PURE__ */ jsxs("div", {
              className: "modal__inline-alert modal__inline-alert--warning", children: [
        /* @__PURE__ */ jsx("span", { children: "Deviation Reason" }),
        /* @__PURE__ */ jsx("strong", { children: pkConfirmDeviationReason })
              ]
            }),
            pkConfirmDeviationReason && /* @__PURE__ */ jsxs("label", {
              className: "field modal__field", children: [
        /* @__PURE__ */ jsx("span", { children: "Deviation Remark" }),
        /* @__PURE__ */ jsx("textarea", {
                className: "modal__textarea",
                value: pkConfirm.deviationRemark ?? "",
                onChange: (event) => setPkConfirm({ ...pkConfirm, deviationRemark: event.target.value, error: "" }),
                placeholder: "Enter deviation explanation...",
                rows: 3
              })
              ]
            }),
            pkConfirm.error && /* @__PURE__ */ jsx("p", { className: "modal__error", children: pkConfirm.error }),
      /* @__PURE__ */ jsxs("div", {
              className: "modal__actions", children: [
        /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--ghost", onClick: () => setPkConfirm(null), children: "Cancel" }),
        /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  className: "btn btn--primary",
                  onClick: () => {
                    if (!pkConfirm.actualInput) return;
                    const deviationRemark = (pkConfirm.deviationRemark ?? "").trim();
                    if (pkConfirmDeviationReason && !deviationRemark) {
                      setPkConfirm({ ...pkConfirm, error: "Deviation remark is required before completing collection." });
                      return;
                    }
                    const barcode = pkConfirm.barcode.toUpperCase();
                    const activityId = pkConfirm.activityId;
                    const actual = fromDateTimeLocal(pkConfirm.actualInput);
                    const method = pkConfirm.method;
                    void completePk(activityId, actual, method, deviationRemark).then((ok) => {
                      if (!ok) return;
                      setLastCollectedPkBarcode(barcode);
                      setShowSessionTrace(true);
                      setPkConfirm(null);
                      setActiveExecTab("pending");
                    });
                  },
                  children: "Complete Collection"
                }
              )
              ]
            })
          ]
        })
      }),
      pkDeviationConfirm && /* @__PURE__ */ jsx("div", {
        className: "modal-backdrop", role: "presentation", children: /* @__PURE__ */ jsxs("div", {
          className: "modal modal--deviation-collection", onClick: (e) => e.stopPropagation(), role: "dialog", "aria-modal": "true", children: [
      /* @__PURE__ */ jsx("h3", { className: "modal__title", children: "Confirm Deviation Collection" }),
      /* @__PURE__ */ jsxs("div", {
            className: "confirm-detail-card", children: [
        /* @__PURE__ */ jsxs("div", {
              className: "confirm-detail-card__row", children: [
          /* @__PURE__ */ jsx("span", { children: UI_LABELS.siteRandomizationNo }),
          /* @__PURE__ */ jsx("strong", { children: pkDeviationSubject ? formatParticipantDisplay(pkDeviationSubject) : resolveSiteRandomizationNumber({ subjectNumber: pkDeviationConfirm.subjectNumber }) })
              ]
            }),
        /* @__PURE__ */ jsxs("div", {
              className: "confirm-detail-card__row", children: [
          /* @__PURE__ */ jsx("span", { children: "Timepoint" }),
          /* @__PURE__ */ jsx("strong", { children: formatTimepointDisplayLabel(pkDeviationConfirm.timepoint, pkDeviationConfirm.dose) })
              ]
            }),
        /* @__PURE__ */ jsxs("div", {
              className: "confirm-detail-card__row", children: [
          /* @__PURE__ */ jsx("span", { children: "Dose" }),
          /* @__PURE__ */ jsx("strong", {
                children: formatDoseWithVisit(
                  pkDeviationConfirm.dose,
                  state.visits.find((v) => v.id === pkDeviationConfirm.visitId)
                    ?? { doseLabel: pkDeviationConfirm.dose, label: pkDeviationConfirm.visitLabel, studyVisitLabel: pkDeviationConfirm.visitLabel }
                )
              })
              ]
            }),
        /* @__PURE__ */ jsxs("div", {
              className: "confirm-detail-card__row", children: [
          /* @__PURE__ */ jsx("span", { children: "PK Barcode" }),
          /* @__PURE__ */ jsx("strong", { className: "mono", children: pkDeviationConfirm.barcode })
              ]
            })
            ]
          }),
      /* @__PURE__ */ jsxs("div", {
            className: "confirm-detail-card", children: [
        /* @__PURE__ */ jsxs("div", {
              className: "confirm-detail-card__row", children: [
          /* @__PURE__ */ jsx("span", { children: "Actual Time" }),
          /* @__PURE__ */ jsx("strong", { children: formatDisplayTime(fromDateTimeLocal(pkDeviationConfirm.actualInput)) })
              ]
            })
            ]
          }),
            pkDeviationReason && /* @__PURE__ */ jsxs("div", {
              className: "modal__inline-alert modal__inline-alert--warning", children: [
        /* @__PURE__ */ jsx("span", { children: "Deviation Reason" }),
        /* @__PURE__ */ jsx("strong", { children: pkDeviationReason })
              ]
            }),
      /* @__PURE__ */ jsxs("label", {
              className: "field modal__field", children: [
        /* @__PURE__ */ jsx("span", { children: "Deviation Remark" }),
        /* @__PURE__ */ jsx("textarea", {
                className: "modal__textarea",
                value: pkDeviationRemark,
                onChange: (event) => {
                  setPkDeviationRemark(event.target.value);
                  setPkDeviationError("");
                },
                placeholder: "Enter deviation explanation...",
                rows: 3
              })
              ]
            }),
            pkDeviationError && /* @__PURE__ */ jsx("p", { className: "modal__error", children: pkDeviationError }),
      /* @__PURE__ */ jsxs("div", {
              className: "modal__actions", children: [
        /* @__PURE__ */ jsx("button", {
                type: "button", className: "btn btn--ghost", onClick: () => {
                  setPkDeviationConfirm(null);
                  setPkDeviationRemark("");
                  setPkDeviationError("");
                }, children: "Cancel"
              }),
        /* @__PURE__ */ jsx("button", {
                type: "button", className: "btn btn--primary",                 onClick: () => {
                  if (!pkDeviationConfirm.actualInput) {
                    setPkDeviationError("Actual collection date/time is required.");
                    return;
                  }
                  const remarkText = pkDeviationRemark.trim();
                  if (pkDeviationReason && !remarkText) {
                    setPkDeviationError("Deviation remark is required before completing collection.");
                    return;
                  }
                  const barcode = pkDeviationConfirm.barcode.toUpperCase();
                  const activityId = pkDeviationConfirm.activityId;
                  const actual = fromDateTimeLocal(pkDeviationConfirm.actualInput);
                  const method = pkDeviationConfirm.method;
                  void completePk(activityId, actual, method, remarkText).then((ok) => {
                    if (!ok) return;
                    setLastCollectedPkBarcode(barcode);
                    setShowSessionTrace(true);
                    setPkDeviationConfirm(null);
                    setPkDeviationRemark("");
                    setPkDeviationError("");
                    setActiveExecTab("pending");
                  });
                }, children: "Save & Complete Collection"
              })
              ]
            })
          ]
        })
      }),
      centrifugeBatchConfirm && centrifugeBatch && /* @__PURE__ */ jsx("div", {
        className: "modal-backdrop", role: "presentation", children: /* @__PURE__ */ jsxs("div", {
          className: "modal modal--centrifuge-batch", onClick: (e) => e.stopPropagation(), role: "dialog", "aria-modal": "true", children: [
      /* @__PURE__ */ jsx("h3", { className: "modal__title", children: "Start Centrifugation Batch" }),
      /* @__PURE__ */ jsxs("p", {
            className: "modal__message", children: [
              "Do you want to start centrifugation for ",
              centrifugeBatch.samples.length,
              " selected PK tube",
              centrifugeBatch.samples.length === 1 ? "" : "s",
              "?"
            ]
          }),
      /* @__PURE__ */ jsx("div", {
            className: "confirm-detail-card", children: centrifugeBatch.samples.map((sample) => /* @__PURE__ */ jsxs("div", {
              className: "confirm-detail-card__row", children: [
        /* @__PURE__ */ jsxs("span", {
                children: [
                  formatTimepointDisplayLabel(sample.timepoint, sample.dose),
                  centrifugeStartTime && ` (${formatDisplayTime(fromDateTimeLocal(centrifugeStartTime))})`
                ]
              }),
        /* @__PURE__ */ jsx("strong", { className: "mono", children: sample.barcode })
              ]
            }, sample.sampleId))
          }),
            subjectMode === "manual" && /* @__PURE__ */ jsxs("label", {
              className: "field modal__field", style: { width: "100%", marginTop: "12px" }, children: [
        /* @__PURE__ */ jsx("span", { children: "Centrifugation Start Time" }),
        /* @__PURE__ */ jsx(DateTime24Input, {
                value: centrifugeStartTime,
                onChange: (val) => {
                  setCentrifugeStartTime(val);
                  setCentrifugeStartTimeError("");
                }
              })
              ]
            }),
            subjectMode === "manual" && centrifugeStartTimeError && /* @__PURE__ */ jsx("p", { className: "modal__error", children: centrifugeStartTimeError }),
      /* @__PURE__ */ jsxs("div", {
              className: "modal__actions modal__actions--center", children: [
        /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--ghost", onClick: () => setCentrifugeBatchConfirm(false), children: "Cancel" }),
        /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--secondary", onClick: () => setCentrifugeBatchConfirm(false), children: "Add On" }),
        /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--primary", autoFocus: true, onClick: confirmCentrifugeBatchStart, children: "Start" })
              ]
            })
          ]
        })
      }),
      centrifugeConfirm && /* @__PURE__ */ jsx("div", {
        className: "modal-backdrop", role: "presentation", children: /* @__PURE__ */ jsxs("div", {
          className: "modal", onClick: (e) => e.stopPropagation(), role: "dialog", "aria-modal": "true", children: [
      /* @__PURE__ */ jsx("h3", { className: "modal__title", children: "Start Centrifugation" }),
      /* @__PURE__ */ jsx("p", { className: "modal__message", children: "Do you want to start centrifuge for this PK sample?" }),
      /* @__PURE__ */ jsxs("div", {
            className: "confirm-detail-card", children: [
        /* @__PURE__ */ jsxs("div", {
              className: "confirm-detail-card__row", children: [
          /* @__PURE__ */ jsx("span", { children: UI_LABELS.siteRandomizationNo }),
          /* @__PURE__ */ jsx("strong", { children: resolveSiteRandomizationNumber({ subjectId: state.samples.find((sample) => sample.id === centrifugeConfirm.sampleId)?.subjectId, subjects: state.subjects, subjectNumber: centrifugeConfirm.subjectNumber }) })
              ]
            }),
        /* @__PURE__ */ jsxs("div", {
              className: "confirm-detail-card__row", children: [
          /* @__PURE__ */ jsx("span", { children: "Timepoint" }),
          /* @__PURE__ */ jsx("strong", { children: formatTimepointDisplayLabel(centrifugeConfirm.timepoint, centrifugeConfirm.dose) })
              ]
            }),
        /* @__PURE__ */ jsxs("div", {
              className: "confirm-detail-card__row", children: [
          /* @__PURE__ */ jsx("span", { children: "PK Barcode" }),
          /* @__PURE__ */ jsx("strong", { className: "mono", children: centrifugeConfirm.barcode })
              ]
            })
            ]
          }),
            subjectMode === "manual" && /* @__PURE__ */ jsxs("label", {
              className: "field modal__field", style: { width: "100%", marginTop: "12px" }, children: [
        /* @__PURE__ */ jsx("span", { children: "Centrifugation Start Time" }),
        /* @__PURE__ */ jsx(DateTime24Input, {
                value: centrifugeStartTime,
                onChange: (val) => {
                  setCentrifugeStartTime(val);
                  setCentrifugeStartTimeError("");
                }
              })
              ]
            }),
            subjectMode === "manual" && centrifugeStartTimeError && /* @__PURE__ */ jsx("p", { className: "modal__error", children: centrifugeStartTimeError }),
      /* @__PURE__ */ jsxs("div", {
              className: "modal__actions modal__actions--center", children: [
        /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--ghost", onClick: () => setCentrifugeConfirm(null), children: "Cancel" }),
        /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--secondary", onClick: () => beginCentrifugeAddOn(centrifugeConfirm), children: "Add On" }),
        /* @__PURE__ */ jsx("button", {
                type: "button", className: "btn btn--primary", autoFocus: true, onClick: () => {
                  if (subjectMode === "manual") {
                    if (!centrifugeStartTime) {
                      setCentrifugeStartTimeError("Start time is required.");
                      return;
                    }
                    startCentrifuge(centrifugeConfirm.sampleId, fromDateTimeLocal(centrifugeStartTime));
                  } else {
                    startCentrifuge(centrifugeConfirm.sampleId);
                  }
                  setCentrifugeConfirm(null);
                }, children: "Start"
              })
              ]
            })
          ]
        })
      }),
      aliquotConfirm && /* @__PURE__ */ jsx("div", {
        className: "modal-backdrop", role: "presentation", children: /* @__PURE__ */ jsxs("div", {
          className: "modal", onClick: (e) => e.stopPropagation(), role: "dialog", "aria-modal": "true", children: [
      /* @__PURE__ */ jsx("h3", { className: "modal__title", children: "Separate Aliquot" }),
      /* @__PURE__ */ jsx("p", { className: "modal__message", children: "Do you want to separate aliquot for this PK sample?" }),
      /* @__PURE__ */ jsxs("div", {
            className: "confirm-detail-card", children: [
        /* @__PURE__ */ jsxs("div", {
              className: "confirm-detail-card__row", children: [
          /* @__PURE__ */ jsx("span", { children: UI_LABELS.siteRandomizationNo }),
          /* @__PURE__ */ jsx("strong", { children: resolveSiteRandomizationNumber({ subjectId: state.samples.find((sample) => sample.id === aliquotConfirm.sampleId)?.subjectId, subjects: state.subjects, subjectNumber: aliquotConfirm.subjectNumber }) })
              ]
            }),
        /* @__PURE__ */ jsxs("div", {
              className: "confirm-detail-card__row", children: [
          /* @__PURE__ */ jsx("span", { children: "Timepoint" }),
          /* @__PURE__ */ jsx("strong", { children: formatTimepointDisplayLabel(aliquotConfirm.timepoint, aliquotConfirm.dose) })
              ]
            }),
        /* @__PURE__ */ jsxs("div", {
              className: "confirm-detail-card__row", children: [
          /* @__PURE__ */ jsx("span", { children: "PK Barcode" }),
          /* @__PURE__ */ jsx("strong", { className: "mono", children: aliquotConfirm.barcode })
              ]
            })
            ]
          }),
      /* @__PURE__ */ jsxs("div", {
            className: "modal__actions modal__actions--center", children: [
        /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--ghost", onClick: () => setAliquotConfirm(null), children: "Cancel" }),
        /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--primary", autoFocus: true, onClick: confirmSeparateAliquot, children: "Separate Aliquot" })
            ]
          })
          ]
        })
      }),
    /* @__PURE__ */ jsx(
        RemarkModal,
        {
          open: !!aliquotSkipTarget,
          title: `Skip Aliquot \u2014 ${aliquotSkipTarget?.barcode ?? ""}`,
          placeholder: "Enter reason, e.g. tube not found or insufficient plasma...",
          submitLabel: "Confirm Skip",
          required: true,
          onClose: closeAliquotSkip,
          onSubmit: (text) => {
            if (!aliquotSkipTarget) return;
            skipAliquot(aliquotSkipTarget.id, text);
            closeAliquotSkip();
          }
        }
      ),
      /* @__PURE__ */ jsx(
        RemarkModal,
        {
          open: !!aliquotSkipRemarkEditTarget,
          title: `Edit Skip Remark \u2014 ${aliquotSkipRemarkEditTarget?.barcode ?? ""}`,
          placeholder: "Enter reason, e.g. tube not found or insufficient plasma...",
          initialValue: aliquotSkipRemarkEditTarget?.skippedReason ?? "",
          submitLabel: "Save Remark",
          required: true,
          onClose: closeAliquotSkipRemarkEdit,
          onSubmit: (text) => {
            if (!aliquotSkipRemarkEditTarget) return;
            editAliquotSkipRemark(aliquotSkipRemarkEditTarget.id, text);
            closeAliquotSkipRemarkEdit();
          }
        }
      ),
      aliquotViewParent && /* @__PURE__ */ jsx("div", {
        className: "modal-backdrop", role: "presentation", children: /* @__PURE__ */ jsxs("div", {
          className: "modal modal--wide", onClick: (e) => e.stopPropagation(), role: "dialog", "aria-modal": "true", children: [
      /* @__PURE__ */ jsx("h3", { className: "modal__title", children: "Aliquot Details" }),
      /* @__PURE__ */ jsxs("div", {
            className: "confirm-detail-card", children: [
        /* @__PURE__ */ jsxs("div", {
              className: "confirm-detail-card__row", children: [
          /* @__PURE__ */ jsx("span", { children: UI_LABELS.siteRandomizationNo }),
          /* @__PURE__ */ jsx("strong", { children: resolveSiteRandomizationNumber({ subjectId: aliquotViewParent.subjectId, subjects: state.subjects, subjectNumber: aliquotViewParent.subjectNumber }) })
              ]
            }),
        /* @__PURE__ */ jsxs("div", {
              className: "confirm-detail-card__row", children: [
          /* @__PURE__ */ jsx("span", { children: "Timepoint" }),
          /* @__PURE__ */ jsx("strong", { children: formatTimepointDisplayLabel(aliquotViewParent.timepoint, aliquotViewParent.dose) })
              ]
            }),
        /* @__PURE__ */ jsxs("div", {
              className: "confirm-detail-card__row", children: [
          /* @__PURE__ */ jsx("span", { children: "Parent PK" }),
          /* @__PURE__ */ jsx("strong", { className: "mono", children: aliquotViewParent.barcode })
              ]
            })
            ]
          }),
      /* @__PURE__ */ jsx("div", {
            className: "review-detail-modal__aliquot-grid", children: aliquotViewExpectedBarcodes.map((barcode, index) => {
              const child = aliquotViewChildren.find((a) => a.barcode.toUpperCase() === barcode.toUpperCase()) ?? aliquotViewChildren[index];
              const status = String(child?.status ?? "").toLowerCase();
              const tone = child?.skippedAt || status === "skipped" || status === "missed"
                ? "skipped"
                : child?.createdAt || status === "linked" || status === "stored" || status === "completed" || status === "scanned"
                  ? "scanned"
                  : "missing";
              const toneLabel = tone === "scanned" ? "Scanned" : tone === "skipped" ? "Skipped" : "Missing";
              const canSkip = !aliquotViewReviewLocked
                && (aliquotViewParent.status === "Ready For Aliquot" || aliquotViewParent.status === "Aliquoted" || aliquotViewParent.status === "Stored")
                && child
                && !child.createdAt
                && !child.skippedAt;
              return /* @__PURE__ */ jsxs("div", {
                className: `review-detail-modal__aliquot-box review-detail-modal__aliquot-box--${tone}`,
                title: child?.skippedReason || toneLabel,
                children: [
                  /* @__PURE__ */ jsxs("div", {
                    className: "review-detail-modal__aliquot-head",
                    children: [
                      /* @__PURE__ */ jsx("span", { className: "mono review-detail-modal__aliquot-code", children: barcode }),
                      /* @__PURE__ */ jsx("span", { className: "review-detail-modal__aliquot-tone", children: toneLabel })
                    ]
                  }),
                  child?.skippedAt && child.skippedReason && /* @__PURE__ */ jsx(
                    AliquotSkipRemarkCell,
                    {
                      reason: child.skippedReason,
                      onEdit: aliquotViewReviewLocked ? undefined : () => openAliquotSkipRemarkEdit(child.id),
                      onOpenAudit: () => openAliquotSkipRemarkAudit(child.id),
                      hasAudit: !!child.activityExecutionAliquotNo
                    }
                  ),
                  canSkip && /* @__PURE__ */ jsx("button", {
                    type: "button",
                    className: "btn btn--sm btn--ghost",
                    onClick: () => openAliquotSkip(child.id),
                    children: "Missed/Skip"
                  })
                ]
              }, barcode);
            })
          }),
      /* @__PURE__ */ jsx("div", { className: "modal__actions modal__actions--center", children: /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--secondary", onClick: () => setAliquotViewParentId(null), children: "Close" }) })
          ]
        })
      }),
      /* @__PURE__ */ jsx(AuditHistoryModal, {
        open: !!dbAuditTarget,
        onClose: closeAuditDetail,
        title: dbAuditTarget?.title ?? "Audit History",
        children: dbAuditTarget && /* @__PURE__ */ jsx(DbAuditHistoryTableBody, {
          auditBatchTargets: dbAuditTarget.auditBatchTargets,
          tableName: dbAuditTarget.tableName,
          recordId: dbAuditTarget.recordId,
          fieldName: dbAuditTarget.tableName === "ActivityExecutionDtl" ? "vFieldValue" : dbAuditTarget.fieldName,
          labelByRecordId: dbAuditTarget.labelByRecordId,
          customLabel: dbAuditTarget.labelByRecordId
            ? undefined
            : (dbAuditTarget.fieldLabel
              ?? (dbAuditTarget.tableName === "ActivityExecutionDtl"
                ? String(dbAuditTarget.title ?? "").replace(/ Audit$/, "")
                : undefined))
        })
      }),
      /* @__PURE__ */ jsx(AuditDetailModal, {
        open: !!queryAuditTarget,
        onClose: () => setQueryAuditTarget(null),
        type: "query",
        activity: queryAuditActivity,
        fieldLabel: queryAuditActivity?.reviewQueryFieldLabel ?? "",
        rows: queryAuditRows,
        allEntries: queryAuditRows,
        fallbackRow: null
      })
    ]
  });

}
export {
  ActivityExecutionPage as default
};
