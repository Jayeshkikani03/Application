import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLab } from "../context/LabContext";
import { ActivityGrid } from "../components/shared/ActivityGrid";
import { AuditDetailModal } from "../components/shared/AuditDetailModal";
import { AuditHistoryModal } from "../components/shared/AuditHistoryModal.jsx";
import { DbAuditHistoryTableBody } from "../components/shared/DbAuditHistoryTableBody.jsx";
import { ReviewDetailModal } from "../components/shared/ReviewDetailModal";
import { buildActivityFieldDbAuditTarget } from "../shared/audit/activityFieldDbAudit.js";
import { ReviewQueryModal } from "../components/shared/ReviewQueryModal";
import { PasswordConfirmModal } from "../components/shared/Modal";
import { SoftAlertToast } from "../components/shared/SoftAlertToast";
import { StatusBadge } from "../components/shared/StatusBadge";
import { useViewport } from "../hooks/useViewport";
import {
  buildAuditFallbackRow
} from "../services/activityAuditService";
import { resolveActiveProjectId } from "../services/barcodeGenerationService";
import { resolveReviewQueryFieldLabel, hasOpenReviewQuery, matchesReviewQueryField, findReviewQueryForField, getReviewQueryStatus, activityHasRaisedReviewQuery, REVIEW_QUERY_STATUS } from "../services/reviewQueryService";
import {
  getCompletedActivitiesForVisit,
  getSampleExpectedAliquotBarcodes,
  resolveActivitySample
} from "../services/workflowService";
import { formatActivityTimepointLabel, formatDoseDisplayLabel, resolveActivityDoseLabel } from "../utils/visitDisplay";
import { hasReviewQueryFieldData } from "../utils/reviewQueryFieldValue";
import {
  fetchReviewVisits,
  fetchReviewActivities,
  reviewActivitiesApi,
  raiseReviewQueryApi,
  sendbackReviewQueryApi,
  closeReviewQueryApi,
  reraiseReviewQueryApi,
  fetchReviewQueryAuditApi,
  mapReviewQueryAuditEventsToRows
} from "../features/review/api/reviewApi";
import { buildReviewGridFromHistory } from "../features/review/utils/buildReviewGridFromHistory";
import { fetchExecutionHistory, getPublishedExecutionSchedule } from "../features/activityExecution/api/activityExecutionApi";
import { validatePassword } from "../features/auth/api/authApi";
import { hydrateCrfDefinitionsForActivities, getCrfDefinitionForActivity, ensureCrfDefinitionsByNosLoaded, ensureCrfDefinitionLoaded } from "../services/crfService";
import { exportActivityCompliancePdf, expandExportDatasetFromSchedule } from "../shared/exportActivityCompliancePdf.js";

function ReviewDetailPage() {
  const navigate = useNavigate();
  const { visitTrackerNo: visitTrackerNoParam } = useParams();
  const [searchParams] = useSearchParams();
  const { isMobileOrTablet } = useViewport();
  const { user } = useAuth();
  const { state, reviewActivities, raiseReviewQuery, sendbackReviewQuery, closeReviewQuery } = useLab();
  const authProjectCode = user?.project?.trim() || "";
  const projectId = resolveActiveProjectId(state);
  const projectCodeToUse = authProjectCode || projectId;

  const selectedSite = String(searchParams.get("site") ?? "").trim();
  const selectedSubjectId = String(searchParams.get("subject") ?? "").trim();
  const participantLabel = String(searchParams.get("participant") ?? "").trim();
  const doseLabelFromQuery = String(searchParams.get("dose") ?? "").trim();

  const selectedVisitIds = useMemo(() => {
    if (!visitTrackerNoParam) return [];
    if (state.isNative) return [visitTrackerNoParam];
    const asNumber = Number(visitTrackerNoParam);
    return [Number.isFinite(asNumber) ? asNumber : visitTrackerNoParam];
  }, [visitTrackerNoParam, state.isNative]);

  const [reviewMessage, setReviewMessage] = useState(null);
  const [reviewMessageVariant, setReviewMessageVariant] = useState("success");
  const [detailActivityId, setDetailActivityId] = useState(null);
  const [selectedReviewIds, setSelectedReviewIds] = useState([]);
  const [pendingBulkReview, setPendingBulkReview] = useState(false);
  const [queryTarget, setQueryTarget] = useState(null);
  const [auditTarget, setAuditTarget] = useState(null);
  const [dbAuditTarget, setDbAuditTarget] = useState(null);
  const [apiVisits, setApiVisits] = useState([]);
  const [apiActivities, setApiActivities] = useState([]);
  const [apiHistory, setApiHistory] = useState({ records: [] });
  const [apiBusy, setApiBusy] = useState(false);
  const [exportPdfBusy, setExportPdfBusy] = useState(false);

  useEffect(() => {
    if (state.isNative) return;
    if (!selectedSite) {
      setApiVisits([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchReviewVisits({
          projectId: projectCodeToUse,
          siteCode: selectedSite
        });
        if (!cancelled) setApiVisits(list);
      } catch (err) {
        console.error("Failed to fetch review visits", err);
        if (!cancelled) setApiVisits([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSite, projectCodeToUse, state.isNative]);

  useEffect(() => {
    if (state.isNative) return;
    if (!selectedSubjectId) {
      setApiHistory({ records: [] });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const history = await fetchExecutionHistory(Number(selectedSubjectId));
        if (!cancelled) setApiHistory(history);
      } catch (err) {
        console.error("Failed to fetch execution history for review", err);
        if (!cancelled) setApiHistory({ records: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSubjectId, state.isNative]);

  useEffect(() => {
    if (state.isNative) return;
    if (!selectedVisitIds.length) {
      setApiActivities([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setApiBusy(true);
        const results = await Promise.all(
          selectedVisitIds.map(async (visitId) => {
            const list = await fetchReviewActivities(visitId);
            return list.map((item) => ({ ...item, visitTrackerNo: visitId }));
          })
        );
        if (!cancelled) setApiActivities(results.flat());
      } catch (err) {
        console.error("Failed to fetch review activities", err);
        if (!cancelled) setApiActivities([]);
      } finally {
        if (!cancelled) setApiBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedVisitIds, state.isNative]);

  useEffect(() => {
    setSelectedReviewIds([]);
  }, [selectedVisitIds, selectedSubjectId]);

  const showReviewMessage = useCallback((message, variant = "success") => {
    setReviewMessageVariant(variant);
    setReviewMessage(message);
  }, []);

  const refreshReviewQueryData = useCallback(async () => {
    if (state.isNative || !selectedSubjectId) return;
    const history = await fetchExecutionHistory(Number(selectedSubjectId));
    setApiHistory(history);
    if (!selectedVisitIds.length) return;
    const results = await Promise.all(
      selectedVisitIds.map(async (visitId) => {
        const list = await fetchReviewActivities(visitId);
        return list.map((item) => ({ ...item, visitTrackerNo: visitId }));
      })
    );
    setApiActivities(results.flat());
  }, [selectedSubjectId, selectedVisitIds, state.isNative]);

  const reviewGridData = useMemo(() => {
    if (!selectedVisitIds.length || state.isNative) {
      return { activities: [], samples: [], aliquots: [], visits: [] };
    }
    return buildReviewGridFromHistory({
      reviewActivities: apiActivities,
      history: apiHistory,
      apiVisits,
      selectedVisitIds,
    });
  }, [apiActivities, apiHistory, apiVisits, selectedVisitIds, state.isNative]);

  const visitById = useMemo(
    () => Object.fromEntries(state.visits.map((visit) => [visit.id, visit])),
    [state.visits]
  );

  const currentVisit = useMemo(() => {
    if (!selectedVisitIds.length) return null;
    const visitId = selectedVisitIds[0];
    if (!state.isNative) {
      return apiVisits.find((visit) => String(visit.visitTrackerNo) === String(visitId)) ?? null;
    }
    return visitById[visitId] ?? null;
  }, [apiVisits, selectedVisitIds, state.isNative, visitById]);

  const rawReviewActivitiesList = useMemo(() => {
    if (!selectedVisitIds.length) return [];
    if (!state.isNative) return reviewGridData.activities;
    return selectedVisitIds.flatMap((visitId) => getCompletedActivitiesForVisit(state, visitId));
  }, [selectedVisitIds, state, reviewGridData.activities, state.isNative]);

  const [reviewActivitiesList, setReviewActivitiesList] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setReviewActivitiesList(rawReviewActivitiesList);
    (async () => {
      const hydrated = await hydrateCrfDefinitionsForActivities(rawReviewActivitiesList);
      if (!cancelled) setReviewActivitiesList(hydrated);
    })();
    return () => {
      cancelled = true;
    };
  }, [rawReviewActivitiesList]);

  const handleOpenReviewDetail = useCallback(async (activityId) => {
    const fromHydrated = reviewActivitiesList.find(
      (activity) => String(activity.id) === String(activityId)
    );
    const fromNative = state.isNative
      ? state.activities.find((activity) => String(activity.id) === String(activityId))
      : null;
    const activity = fromHydrated ?? fromNative;
    if (!activity) return;

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
    if (hydrated) {
      setReviewActivitiesList((prev) => {
        const exists = prev.some((item) => String(item.id) === String(activityId));
        if (!exists) return [...prev, hydrated];
        return prev.map((item) => (String(item.id) === String(activityId) ? hydrated : item));
      });
    }

    setDetailActivityId(activityId);
  }, [reviewActivitiesList, state.activities, state.isNative]);

  const detailActivity = detailActivityId
    ? (reviewActivitiesList.find((activity) => String(activity.id) === String(detailActivityId))
      ?? (state.isNative
        ? state.activities.find((activity) => String(activity.id) === String(detailActivityId))
        : null)
      ?? null)
    : null;
  const reviewStatus = useMemo(() => {
    const activitiesWithReviewState = reviewActivitiesList.filter((activity) => {
      const review = String(activity.reviewStatus ?? "").trim();
      return review === "Submitted" || review === "Reviewed";
    });

    if (
      activitiesWithReviewState.length > 0
      && activitiesWithReviewState.every((activity) => String(activity.reviewStatus ?? "").trim() === "Reviewed")
    ) {
      return "Reviewed";
    }

    return String(currentVisit?.reviewStatus ?? "").trim() || "Pending";
  }, [reviewActivitiesList, currentVisit]);

  const doseLabel = useMemo(() => {
    const fromActivities = reviewActivitiesList
      .map((activity) => resolveActivityDoseLabel(activity))
      .find((label) => label && label !== "-");
    if (fromActivities) return fromActivities;

    const fromVisit = formatDoseDisplayLabel(
      currentVisit?.doseLabel ?? currentVisit?.visitName ?? currentVisit?.dose
    );
    if (fromVisit && fromVisit !== "-") return fromVisit;

    return doseLabelFromQuery || "—";
  }, [reviewActivitiesList, currentVisit, doseLabelFromQuery]);

  const reviewSamples = useMemo(
    () => (state.isNative ? state.samples : reviewGridData.samples),
    [reviewGridData.samples, state.isNative, state.samples]
  );

  const reviewAliquots = useMemo(
    () => (state.isNative ? state.aliquots : reviewGridData.aliquots),
    [reviewGridData.aliquots, state.isNative, state.aliquots]
  );

  const reviewVisits = useMemo(
    () => (state.isNative ? state.visits : reviewGridData.visits),
    [reviewGridData.visits, state.isNative, state.visits]
  );

  const shouldShowFieldQuery = useCallback((activity, fieldKey) => {
    if (hasOpenReviewQuery(activity, fieldKey)) return true;
    return hasReviewQueryFieldData(activity, fieldKey, {
      samples: reviewSamples,
      visits: reviewVisits,
    });
  }, [reviewSamples, reviewVisits]);

  const hasSubmittedVisitSelected = useMemo(() => {
    if (!state.isNative) {
      return selectedVisitIds.some((visitId) => {
        const visit = apiVisits.find((v) => String(v.visitTrackerNo) === String(visitId));
        return visit?.reviewStatus === "Submitted";
      });
    }
    return selectedVisitIds.some((visitId) => visitById[visitId]?.reviewStatus === "Submitted");
  }, [selectedVisitIds, visitById, apiVisits, state.isNative]);

  const isActivityReviewable = (activity) => {
    if (!state.isNative) {
      const visit = apiVisits.find(
        (v) =>
          String(v.visitTrackerNo) === String(activity.visitTrackerNo ?? activity.visitId)
          && v.reviewStatus === "Submitted"
      );
      return !!visit;
    }
    return visitById[activity.visitId]?.reviewStatus === "Submitted";
  };

  const canRaiseQueryOnActivity = (activity) =>
    isActivityReviewable(activity) && activity.reviewStatus !== "Reviewed";

  const showReviewedBadges = useMemo(() => {
    if (!state.isNative) {
      return selectedVisitIds.some((visitId) => {
        const visit = apiVisits.find((v) => String(v.visitTrackerNo) === String(visitId));
        return visit?.reviewStatus === "Submitted" || visit?.reviewStatus === "Reviewed";
      });
    }
    return selectedVisitIds.some((visitId) => {
      const status = visitById[visitId]?.reviewStatus;
      return status === "Submitted" || status === "Reviewed";
    });
  }, [selectedVisitIds, visitById, apiVisits, state.isNative]);

  const actualAuditEntries = [];
  const scanStartAuditEntries = [];
  const remarkAuditEntries = [];
  const crfAuditEntries = [];
  const queryAuditEntries = [];

  const auditActivity = auditTarget?.activityId
    ? state.activities.find((activity) => activity.id === auditTarget.activityId)
      ?? reviewActivitiesList.find((activity) => String(activity.id) === String(auditTarget.activityId))
    : null;
  const auditSample = auditActivity
    ? resolveActivitySample(state.isNative ? state.samples : reviewSamples, auditActivity)
    : null;
  const auditRows = useMemo(() => {
    if (!auditTarget) return [];
    if (auditTarget.type === "query" && Array.isArray(auditTarget.apiRows)) {
      return auditTarget.apiRows;
    }
    return [];
  }, [auditTarget]);

  const auditAllEntries = [];

  const auditFieldLabel = auditTarget?.type === "query" && auditTarget?.fieldKey
    ? resolveReviewQueryFieldLabel(auditActivity, auditTarget.fieldKey)
    : "";

  const auditFallbackRow = auditTarget
    ? buildAuditFallbackRow({
        type: auditTarget.type,
        activity: auditActivity,
        sample: auditSample,
        fieldLabel: auditFieldLabel,
        rows: auditRows
      })
    : null;

  const queryActivity = queryTarget?.activityId
    ? state.activities.find((activity) => activity.id === queryTarget.activityId)
      ?? reviewActivitiesList.find((activity) => String(activity.id) === String(queryTarget.activityId))
    : null;

  const queryFieldHasAudit = useMemo(() => {
    if (!queryActivity || !queryTarget?.fieldKey) return false;
    return matchesReviewQueryField(queryActivity, queryTarget.fieldKey);
  }, [queryActivity, queryTarget?.fieldKey]);
  const queryIsReraise = !!(
    queryActivity
    && queryTarget?.fieldKey
    && getReviewQueryStatus(queryActivity, queryTarget.fieldKey) === REVIEW_QUERY_STATUS.CLOSED
  );

  const openQueryAudit = useCallback(async (activityId, fieldKey) => {
    const activity = reviewActivitiesList.find((item) => String(item.id) === String(activityId))
      ?? state.activities.find((item) => String(item.id) === String(activityId));
    const resolvedFieldKey = fieldKey || activity?.reviewQueryFieldKey || "remark";
    if (!activity) {
      setAuditTarget({ type: "query", activityId, fieldKey: resolvedFieldKey, apiRows: [] });
      return;
    }
    if (state.isNative) {
      setAuditTarget({ type: "query", activityId, fieldKey: resolvedFieldKey, apiRows: [] });
      return;
    }

    const fieldQuery = findReviewQueryForField(activity, resolvedFieldKey);
    const subjectMstNo = Number(activity.subjectMstNo) || 0;
    const activityConfigTimePointNo = Number(activity.activityConfigTimePointNo) || 0;
    const activityExecutionQueryNo =
      Number(fieldQuery?.activityExecutionQueryNo)
      || Number(activity.activityExecutionQueryNo)
      || 0;

    if (!(activityExecutionQueryNo > 0 || (subjectMstNo > 0 && activityConfigTimePointNo > 0))) {
      setAuditTarget({ type: "query", activityId, fieldKey: resolvedFieldKey, apiRows: [] });
      return;
    }

    try {
      const events = await fetchReviewQueryAuditApi({
        subjectMstNo,
        activityConfigTimePointNo,
        activityExecutionQueryNo: activityExecutionQueryNo || undefined
      });
      const apiRows = mapReviewQueryAuditEventsToRows(events, {
        activityId: activity.id,
        fieldKey: resolvedFieldKey,
        fieldLabel: fieldQuery?.fieldLabel || activity.reviewQueryFieldLabel
      });
      setAuditTarget({ type: "query", activityId, fieldKey: resolvedFieldKey, apiRows });
    } catch (err) {
      console.error("Failed to load query audit from ActivityExecutionQueryEvent", err);
      setAuditTarget({ type: "query", activityId, fieldKey: resolvedFieldKey, apiRows: [] });
    }
  }, [reviewActivitiesList, state.activities, state.isNative]);

  const openFieldDbAudit = useCallback((activityId, fieldName, title) => {
    const activity = reviewActivitiesList.find((item) => String(item.id) === String(activityId))
      ?? state.activities.find((item) => String(item.id) === String(activityId));
    if (!activity) return;
    const target = buildActivityFieldDbAuditTarget(activity, fieldName, title);
    if (target) setDbAuditTarget(target);
  }, [reviewActivitiesList, state.activities]);

  const openCrfFieldDbAudit = useCallback((activityId, fieldId) => {
    const activity = reviewActivitiesList.find((item) => String(item.id) === String(activityId))
      ?? state.activities.find((item) => String(item.id) === String(activityId));
    if (!activity || !fieldId) return;
    const definition = getCrfDefinitionForActivity(activity);
    const field = definition?.items
      ?.map((item) => item.field)
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
  }, [reviewActivitiesList, state.activities]);

  const detailSample = detailActivity
    ? resolveActivitySample(state.isNative ? state.samples : reviewSamples, detailActivity)
    : null;
  const detailVisit = detailActivity
    ? (state.isNative
      ? state.visits.find((visit) => visit.id === detailActivity.visitId)
      : reviewVisits.find(
        (visit) =>
          visit.id === detailActivity.visitId
          || visit.id === detailActivity.visitTrackerNo
      ))
    : null;
  const detailAliquots = state.isNative ? state.aliquots : reviewAliquots;
  const detailExpectedBarcodes = useMemo(() => {
    if (!detailActivity) return [];
    if (state.isNative) {
      return detailSample ? getSampleExpectedAliquotBarcodes(state, detailSample) : [];
    }
    const fromActivity = (detailActivity.aliquots ?? [])
      .map((item) => String(item.barcode ?? "").trim())
      .filter(Boolean);
    if (fromActivity.length) return fromActivity;
    if (!detailSample) return [];
    return detailAliquots
      .filter((item) => item.parentSampleId === detailSample.id)
      .map((item) => String(item.barcode ?? "").trim())
      .filter(Boolean);
  }, [detailActivity, detailSample, detailAliquots, state, state.isNative]);

  const canShowRecords = !!selectedSite && !!selectedSubjectId && selectedVisitIds.length > 0;
  const showGrid = canShowRecords && reviewActivitiesList.length > 0;

  const reviewPasswordDetails = useMemo(() => {
    if (!pendingBulkReview) return undefined;

    const timepointLabel = [
      ...new Set(
        selectedReviewIds
          .map((id) =>
            reviewActivitiesList.find((activity) => String(activity.id) === String(id))
          )
          .filter(Boolean)
          .map((activity) => formatActivityTimepointLabel(activity))
          .filter((label) => label && label !== "-")
      ),
    ].join(", ");

    return [
      { label: "Participant", value: participantLabel || "—" },
      { label: "Dose", value: doseLabel || "—" },
      { label: "Timepoint(s)", value: timepointLabel || "—" },
      { label: "Records Selected", value: String(selectedReviewIds.length) },
    ];
  }, [
    pendingBulkReview,
    participantLabel,
    doseLabel,
    reviewActivitiesList,
    selectedReviewIds,
  ]);

  const handleBulkReview = async () => {
    if (!selectedReviewIds.length) return;
    const hasRaised = selectedReviewIds.some((id) => {
      const activity = reviewActivitiesList.find((item) => item.id === id);
      return activity && activityHasRaisedReviewQuery(activity);
    });
    if (hasRaised) {
      showReviewMessage("Resolve raised queries before reviewing this record.", "error");
      return;
    }
    if (!state.isNative) {
      try {
        setApiBusy(true);
        const res = await reviewActivitiesApi(selectedReviewIds, selectedVisitIds[0]);
        showReviewMessage(res.message || "Activities reviewed successfully.", "success");
        setSelectedReviewIds([]);
        const results = await Promise.all(
          selectedVisitIds.map(async (visitId) => {
            const list = await fetchReviewActivities(visitId);
            return list.map((item) => ({ ...item, visitTrackerNo: visitId }));
          })
        );
        setApiActivities(results.flat());
        const history = await fetchExecutionHistory(Number(selectedSubjectId));
        setApiHistory(history);
        const list = await fetchReviewVisits({ projectId: projectCodeToUse, siteCode: selectedSite });
        setApiVisits(list);
      } catch (err) {
        showReviewMessage(err?.message || "Failed to review activities.", "error");
      } finally {
        setApiBusy(false);
      }
    } else {
      const result = reviewActivities(selectedReviewIds);
      showReviewMessage(result.message, result.success ? "success" : "error");
      setSelectedReviewIds([]);
    }
  };

  const handleRequestBulkReview = () => {
    if (!selectedReviewIds.length || apiBusy) return;
    setPendingBulkReview(true);
  };

  const handleReviewPasswordConfirmed = async () => {
    setPendingBulkReview(false);
    await handleBulkReview();
  };

  const handleToggleReviewSelection = (activityId) => {
    setSelectedReviewIds((current) =>
      current.includes(activityId) ? current.filter((id) => id !== activityId) : [...current, activityId]
    );
  };

  const handleToggleReviewSelectAll = (checked, ids) => {
    if (!checked) {
      setSelectedReviewIds([]);
      return;
    }
    setSelectedReviewIds([...ids]);
  };

  const handleRaiseQuery = async (fieldKey, text) => {
    if (!queryTarget?.activityId) return false;

    const activity = reviewActivitiesList.find((item) => item.id === queryTarget.activityId);
    if (!activity) return false;

    const isReraise = getReviewQueryStatus(activity, fieldKey) === REVIEW_QUERY_STATUS.CLOSED;

    if (state.isNative) {
      const result = raiseReviewQuery(queryTarget.activityId, text, fieldKey);
      setReviewMessage(result.message);
      if (result.success) {
        setQueryTarget(null);
      }
      return result.success;
    }

    try {
      setApiBusy(true);
      const res = isReraise
        ? await reraiseReviewQueryApi({
            subjectMstNo: activity.subjectMstNo,
            activityConfigTimePointNo: activity.activityConfigTimePointNo,
            fieldKey,
            queryText: text
          })
        : await raiseReviewQueryApi({
            subjectMstNo: activity.subjectMstNo,
            activityConfigTimePointNo: activity.activityConfigTimePointNo,
            fieldKey,
            fieldLabel: resolveReviewQueryFieldLabel(activity, fieldKey),
            queryText: text
          });
      if (res.success) {
        setReviewMessage(isReraise ? "Query re-raised successfully." : "Query raised successfully.");
        setQueryTarget(null);
        await refreshReviewQueryData();
        return true;
      }
      setReviewMessage(res.message || (isReraise ? "Could not re-raise query." : "Could not raise query."));
      return false;
    } catch (err) {
      console.error(err);
      setReviewMessage(err.response?.data?.message || (isReraise ? "Could not re-raise query." : "Could not raise query."));
      return false;
    } finally {
      setApiBusy(false);
    }
  };

  const handleSendbackQuery = async (_fieldKey, text) => {
    if (!queryTarget?.activityId) return false;
    const activity = reviewActivitiesList.find((item) => item.id === queryTarget.activityId);
    if (!activity) return false;
    if (String(activity.reviewStatus || "").trim() === "Reviewed") {
      setReviewMessage("Queries cannot be sent back after the activity is reviewed.");
      return false;
    }

    if (state.isNative) {
      const result = sendbackReviewQuery(queryTarget.activityId, text);
      setReviewMessage(result.message);
      if (result.success) {
        setQueryTarget(null);
      }
      return result.success;
    } else {
      try {
        setApiBusy(true);
        const res = await sendbackReviewQueryApi({
          subjectMstNo: activity.subjectMstNo,
          activityConfigTimePointNo: activity.activityConfigTimePointNo,
          remark: text,
          fieldKey: queryTarget.fieldKey || _fieldKey
        });
        if (res.success) {
          setReviewMessage("Query sent back.");
          setQueryTarget(null);
          await refreshReviewQueryData();
          return true;
        } else {
          setReviewMessage(res.message || "Could not send back query.");
          return false;
        }
      } catch (err) {
        console.error(err);
        setReviewMessage(err.response?.data?.message || "Could not send back query.");
        return false;
      } finally {
        setApiBusy(false);
      }
    }
  };

  const handleCloseQuery = async (_fieldKey, remark) => {
    if (!queryTarget?.activityId) return false;
    const activity = reviewActivitiesList.find((item) => item.id === queryTarget.activityId);
    if (!activity) return false;

    if (state.isNative) {
      const result = closeReviewQuery(queryTarget.activityId, remark);
      setReviewMessage(result.message);
      if (result.success) {
        setQueryTarget(null);
      }
      return result.success;
    } else {
      try {
        setApiBusy(true);
        const res = await closeReviewQueryApi({
          subjectMstNo: activity.subjectMstNo,
          activityConfigTimePointNo: activity.activityConfigTimePointNo,
          fieldKey: queryTarget.fieldKey,
          remark
        });
        if (res.success) {
          setReviewMessage("Query closed.");
          setQueryTarget(null);
          await refreshReviewQueryData();
          return true;
        } else {
          setReviewMessage(res.message || "Could not close query.");
          return false;
        }
      } catch (err) {
        console.error(err);
        setReviewMessage(err.response?.data?.message || "Could not close query.");
        return false;
      } finally {
        setApiBusy(false);
      }
    }
  };

  if (isMobileOrTablet) {
    return <Navigate to="/execute" replace />;
  }

  if (!visitTrackerNoParam || !selectedSite || !selectedSubjectId) {
    const params = new URLSearchParams();
    if (selectedSite) params.set("site", selectedSite);
    const query = params.toString();
    return <Navigate to={query ? `/review?${query}` : "/review"} replace />;
  }

  const handleBack = () => {
    const params = new URLSearchParams();
    if (selectedSite) params.set("site", selectedSite);
    const query = params.toString();
    navigate(query ? `/review?${query}` : "/review", {
      state: {
        statusOverrides: {
          [String(visitTrackerNoParam)]: reviewStatus,
        },
      },
    });
  };

  const handleExportCompliancePdf = async () => {
    if (exportPdfBusy) return;
    setExportPdfBusy(true);
    try {
      let activitiesForExport = reviewActivitiesList;
      let samplesForExport = reviewSamples;
      let aliquotsForExport = reviewAliquots;
      let visitsForExport = reviewVisits;

      // Full participant report — all doses for this subject, not only the open visit.
      if (!state.isNative && selectedSubjectId) {
        const subjectVisitIds = apiVisits
          .filter((visit) => String(visit.subjectMstNo) === String(selectedSubjectId))
          .map((visit) => visit.visitTrackerNo)
          .filter((id) => id != null && id !== "");
        if (subjectVisitIds.length) {
          const results = await Promise.all(
            subjectVisitIds.map(async (visitId) => {
              const list = await fetchReviewActivities(visitId);
              return list.map((item) => ({ ...item, visitTrackerNo: visitId }));
            })
          );
          const grid = buildReviewGridFromHistory({
            reviewActivities: results.flat(),
            history: apiHistory,
            apiVisits,
            selectedVisitIds: subjectVisitIds,
          });
          activitiesForExport = grid.activities;
          samplesForExport = grid.samples;
          aliquotsForExport = grid.aliquots;
          visitsForExport = grid.visits;
        }
      } else if (state.isNative && selectedSubjectId) {
        const subjectVisitIds = state.visits
          .filter((visit) => String(visit.subjectId) === String(selectedSubjectId))
          .map((visit) => visit.id);
        activitiesForExport = subjectVisitIds.flatMap((visitId) =>
          getCompletedActivitiesForVisit(state, visitId)
        );
        samplesForExport = state.samples;
        aliquotsForExport = state.aliquots;
        visitsForExport = state.visits.filter((visit) =>
          subjectVisitIds.includes(visit.id)
        );
      }

      // Expand to full published schedule so incomplete / PRMS-locked doses still appear.
      let periods = [];
      if (!state.isNative) {
        try {
          const schedule = await getPublishedExecutionSchedule();
          periods = Array.isArray(schedule?.periods) ? schedule.periods : [];
        } catch (scheduleErr) {
          console.warn("Published schedule unavailable for review PDF export.", scheduleErr);
        }
      }
      if (!periods.length) {
        const project = (state.projects ?? []).find(
          (item) =>
            String(item.id ?? "").toLowerCase() === String(projectCodeToUse ?? "").toLowerCase()
            || String(item.code ?? "").toLowerCase() === String(projectCodeToUse ?? "").toLowerCase()
        );
        periods = Array.isArray(project?.schedule?.periods) ? project.schedule.periods : [];
      }

      const subjectStub = {
        id: selectedSubjectId,
        subjectMstNo: Number(selectedSubjectId) || activitiesForExport[0]?.subjectMstNo || null,
        subjectNumber: participantLabel || activitiesForExport[0]?.subjectNumber || "",
        projectId: projectCodeToUse || "",
      };
      const expanded = expandExportDatasetFromSchedule({
        subject: subjectStub,
        periods,
        existingActivities: activitiesForExport,
        existingVisits: visitsForExport,
      });
      activitiesForExport = expanded.activities;
      visitsForExport = expanded.visits;

      if (!activitiesForExport.length) {
        setReviewMessageVariant("error");
        setReviewMessage("No activities available to export.");
        return;
      }

      const hydrated = await hydrateCrfDefinitionsForActivities(activitiesForExport);
      const result = await exportActivityCompliancePdf({
        mode: "review",
        activities: hydrated,
        visits: visitsForExport,
        samples: samplesForExport,
        aliquots: aliquotsForExport,
        meta: {
          project: projectCodeToUse || "",
          site: selectedSite || "",
          participant: participantLabel || "",
        },
      });
      if (!result.ok) {
        setReviewMessageVariant("error");
        setReviewMessage(result.message || "Failed to export PDF.");
      } else {
        setReviewMessageVariant("success");
        setReviewMessage(result.message || "PDF exported successfully.");
      }
    } catch (err) {
      console.error("Export PDF failed", err);
      setReviewMessageVariant("error");
      setReviewMessage(err?.message || "Failed to export PDF.");
    } finally {
      setExportPdfBusy(false);
    }
  };

  return (
    <div className="admin-wrap admin-wrap--review-detail">
      <div className="admin-card admin-card--review-detail review-page-card">
        <div className="review-page-card__header review-detail-page__header">
          <button
            type="button"
            className="btn btn--ghost btn--sm review-detail-page__back"
            onClick={handleBack}
            aria-label="Back to review list"
            title="Back"
          >
            <i className="fas fa-arrow-left" aria-hidden="true" />
          </button>
          <div className="review-detail-page__meta">
            <div className="review-detail-page__meta-item">
              <span className="review-detail-page__meta-label">Participant</span>
              <strong>{participantLabel || "—"}</strong>
            </div>
            <div className="review-detail-page__meta-item">
              <span className="review-detail-page__meta-label">Dose</span>
              <strong>{doseLabel || "—"}</strong>
            </div>
            <div className="review-detail-page__meta-item">
              <span className="review-detail-page__meta-label">Status</span>
              <StatusBadge status={reviewStatus} />
            </div>
          </div>
          <div className="review-page-card__filters-actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={exportPdfBusy || !reviewActivitiesList.length || apiBusy}
              onClick={handleExportCompliancePdf}
            >
              {exportPdfBusy ? "Exporting…" : "Export PDF"}
            </button>
            {hasSubmittedVisitSelected ? (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={!selectedReviewIds.length || apiBusy}
                  onClick={handleRequestBulkReview}
                >
                  Review
                </button>
            ) : null}
          </div>
        </div>

        <SoftAlertToast
          title="Review"
          message={reviewMessage}
          variant={reviewMessageVariant}
          onClose={() => {
            setReviewMessage(null);
            setReviewMessageVariant("success");
          }}
        />

        {apiBusy && !showGrid ? (
          <p className="empty-state">Loading review records…</p>
        ) : !showGrid ? (
          <p className="empty-state">No completed timepoints for this dose yet.</p>
        ) : (
          <div className="exec-all-activities-card review-page-card__activities">
            <ActivityGrid
              activities={reviewActivitiesList}
              visits={reviewVisits}
              samples={reviewSamples}
              aliquots={reviewAliquots}
              hideFilters
              flatMobileRows
              reviewMode
              reviewSelectable
              reviewActionsEnabled={hasSubmittedVisitSelected}
              isReviewActionEnabled={isActivityReviewable}
              showReviewedBadges={showReviewedBadges}
              selectedReviewIds={selectedReviewIds}
              onToggleReviewSelection={handleToggleReviewSelection}
              onToggleReviewSelectAll={handleToggleReviewSelectAll}
              onRaiseQuery={(activityId, fieldKey) => setQueryTarget({ activityId, fieldKey })}
              shouldShowFieldQuery={shouldShowFieldQuery}
              onOpenReviewDetail={handleOpenReviewDetail}
              queriesEnabled
              actualAuditEntries={actualAuditEntries}
              onOpenActualAudit={(activityId) =>
                openFieldDbAudit(activityId, "ActualTime", "Actual Time Audit")
              }
              scanStartAuditEntries={scanStartAuditEntries}
              onOpenScanStartAudit={(activityId) =>
                openFieldDbAudit(activityId, "CentrifugationStart", "Centrifuge Start Audit")
              }
              remarkAuditEntries={remarkAuditEntries}
              onOpenRemarkAudit={(activityId) =>
                openFieldDbAudit(activityId, "Remarks", "Deviation / Remark Audit")
              }
              onOpenFieldAudit={openFieldDbAudit}
              crfAuditEntries={crfAuditEntries}
              onOpenCrfFieldAudit={openCrfFieldDbAudit}
              queryAuditEntries={queryAuditEntries}
              onOpenQueryAudit={openQueryAudit}
            />
          </div>
        )}
      </div>

      <PasswordConfirmModal
        open={pendingBulkReview}
        title="Confirm Review"
        message="Please enter your password to mark the selected records as reviewed. This action will be recorded in the audit trail."
        details={reviewPasswordDetails}
        confirmLabel="Verify & Review"
        onValidatePassword={validatePassword}
        onClose={() => setPendingBulkReview(false)}
        onConfirm={handleReviewPasswordConfirmed}
      />

      <ReviewQueryModal
        open={!!queryTarget}
        activity={queryActivity}
        defaultFieldKey={queryTarget?.fieldKey}
        reraiseMode={queryIsReraise}
        hasFieldAudit={queryFieldHasAudit}
        onOpenFieldAudit={(fieldKey) => {
          if (!queryActivity?.id) return;
          openQueryAudit(queryActivity.id, fieldKey || queryActivity.reviewQueryFieldKey || "remark");
        }}
        onClose={() => setQueryTarget(null)}
        onSubmit={handleRaiseQuery}
        onSendback={handleSendbackQuery}
        onCloseQuery={handleCloseQuery}
      />

      <ReviewDetailModal
        open={!!detailActivity}
        activity={detailActivity}
        sample={detailSample}
        visit={detailVisit}
        aliquots={detailAliquots}
        expectedBarcodes={detailExpectedBarcodes}
        crfAuditEntries={crfAuditEntries}
        allowFieldQuery={!!detailActivity && canRaiseQueryOnActivity(detailActivity)}
        onRaiseFieldQuery={
          (_fieldId, fieldKey) => {
              if (!detailActivity?.id) return;
              setQueryTarget({ activityId: detailActivity.id, fieldKey });
            }
        }
        onOpenFieldAudit={(fieldId) => {
          if (!detailActivity?.id || !fieldId) return;
          openCrfFieldDbAudit(detailActivity.id, fieldId);
        }}
        onOpenQueryAudit={
          (fieldId, fieldKey) => {
              if (!detailActivity?.id) return;
              openQueryAudit(detailActivity.id, fieldKey || `crf:${fieldId}`);
            }
        }
        onOpenAliquotSkipAudit={(aliquot) => {
          const recordId =
            Number(aliquot?.activityExecutionAliquotNo) || (Number(aliquot?.id) > 0 ? Number(aliquot.id) : null);
          if (!recordId) return;
          setDbAuditTarget({
            tableName: "ActivityExecutionAliquot",
            recordId,
            title: `Skip Remark Audit — ${aliquot?.barcode || ""}`.trim(),
            fieldName: "vSkipRemark",
          });
        }}
        onClose={() => setDetailActivityId(null)}
      />

      <AuditHistoryModal
        open={!!dbAuditTarget}
        onClose={() => setDbAuditTarget(null)}
        title={dbAuditTarget?.title ?? "Audit History"}
      >
        {dbAuditTarget ? (
          <DbAuditHistoryTableBody
            auditBatchTargets={dbAuditTarget.auditBatchTargets}
            tableName={dbAuditTarget.tableName}
            recordId={dbAuditTarget.recordId}
            fieldName={dbAuditTarget.tableName === "ActivityExecutionDtl" ? "vFieldValue" : dbAuditTarget.fieldName}
            labelByRecordId={dbAuditTarget.labelByRecordId}
            customLabel={dbAuditTarget.labelByRecordId
              ? undefined
              : (dbAuditTarget.fieldLabel
                ?? (dbAuditTarget.tableName === "ActivityExecutionDtl"
                  ? String(dbAuditTarget.title ?? "").replace(/ Audit$/, "")
                  : undefined))}
          />
        ) : null}
      </AuditHistoryModal>

      <AuditDetailModal
        open={!!auditTarget && auditTarget.type === "query"}
        onClose={() => setAuditTarget(null)}
        rows={auditRows}
        fallbackRow={auditFallbackRow}
        type="query"
        allEntries={auditAllEntries}
        activity={auditActivity}
        fieldLabel={auditFieldLabel}
      />
    </div>
  );
}

export default ReviewDetailPage;
