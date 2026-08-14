import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SoftAlertToast } from "@/components/shared/SoftAlertToast";
import { AdminButton } from "@/components/shared/AdminButton";
import { CrfForm } from "@/components/shared/CrfForm";
import { ReviewQueryModal } from "@/components/shared/ReviewQueryModal";
import { AuditDetailModal } from "@/components/shared/AuditDetailModal";
import { AuditHistoryModal } from "@/components/shared/AuditHistoryModal.jsx";
import { DbAuditHistoryTableBody } from "@/components/shared/DbAuditHistoryTableBody.jsx";
import { PasswordConfirmModal } from "@/components/shared/Modal";
import {
  ensureCrfDefinitionsByNosLoaded,
  getCachedCrfDefinitionByNo,
  getCrfActiveFieldItems,
  resolveCrfSavedValues,
} from "@/services/crfService";
import { buildAuditFallbackRow } from "@/services/activityAuditService";
import { saveCrfApi } from "@/features/activityExecution/api/activityExecutionApi";
import {
  raiseReviewQueryApi,
  resolveReviewQueryApi,
  closeReviewQueryApi,
  sendbackReviewQueryApi,
  fetchReviewQueryAuditApi,
  mapReviewQueryAuditEventsToRows,
  reviewActivitiesApi,
} from "@/features/review/api/reviewApi";
import { validatePassword } from "@/features/auth/api/authApi";
import { openVisitCrf, listVisitCrfExecutionQueries } from "@/features/visitCrfMapping/api/visitCrfMappingApi.js";
import { formatAuditOffsetDisplay, formatAuditUtc } from "@/shared/audit/auditDisplayUtils";
import {
  applyReviewQueryClosed,
  applyReviewQueryResolved,
  applyReviewQuerySendback,
  activityHasRaisedReviewQuery,
  createRaisedReviewQueryActivity,
  findReviewQueryForField,
  getReviewQueries,
  getReviewQueryStatus,
  hasOpenReviewQuery,
  isActiveReviewQuery,
  matchesReviewQueryField,
  resolveReviewQueryFieldId,
  resolveReviewQueryFieldLabel,
  REVIEW_QUERY_STATUS,
} from "@/services/reviewQueryService";

const VISIT_CRF_QUERY_FIELD = "visit-crf";

function withReviewQueries(activity, reviewQueries) {
  const list = Array.isArray(reviewQueries) ? reviewQueries : [];
  if (!activity) return activity;
  return {
    ...activity,
    reviewQueries: list,
    reviewQuery: list[0]?.queryText || undefined,
    reviewQueryStatus: list[0]?.status || undefined,
    reviewQueryFieldKey: list[0]?.fieldKey || activity.reviewQueryFieldKey,
    reviewQueryFieldLabel: list[0]?.fieldLabel || undefined,
    reviewQueryAt: list[0]?.recordedOnUtc || undefined,
    activityExecutionQueryNo: list[0]?.activityExecutionQueryNo || undefined,
  };
}

export default function ActivityMappingCrfPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { subjectMstNo: subjectParam, appVisitCrfMappingNo: mappingParam } = useParams();
  const [searchParams] = useSearchParams();
  const hdrParam = searchParams.get("hdr");

  const subjectMstNo = Number(subjectParam) || 0;
  const appVisitCrfMappingNo = Number(mappingParam) || 0;
  const activityExecutionHdrNo = Number(hdrParam) || 0;
  const navState = location.state && typeof location.state === "object" ? location.state : {};

  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [crfActivity, setCrfActivity] = useState(null);
  const [queryOpen, setQueryOpen] = useState(false);
  const [queryFieldKey, setQueryFieldKey] = useState(VISIT_CRF_QUERY_FIELD);
  const [queryBusy, setQueryBusy] = useState(false);
  const [resolveTarget, setResolveTarget] = useState(null);
  const [auditTarget, setAuditTarget] = useState(null);
  const [dbAuditTarget, setDbAuditTarget] = useState(null);
  const [pendingReview, setPendingReview] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const loadGenRef = useRef(0);
  const pendingResolveFieldKeyRef = useRef(
    String(
      (location.state && typeof location.state === "object" && location.state.resolveFieldKey)
        || ""
    ).trim()
  );

  const showToast = (message, variant = "success") => setToast({ message, variant });

  const fromReview =
    navState.fromReview === true
    || String(location.pathname || "").toLowerCase().startsWith("/review/crf");

  const goBack = useCallback(() => {
    const returnTo = String(navState.returnTo || "").trim();
    if (returnTo.startsWith("/")) {
      navigate(returnTo);
      return;
    }
    if (fromReview) {
      navigate("/review?tab=activity-crf");
      return;
    }
    navigate("/visit-crf");
  }, [navigate, navState.returnTo, fromReview]);

  const load = useCallback(async () => {
    if (subjectMstNo <= 0 || appVisitCrfMappingNo <= 0) {
      setError("Invalid activity mapping link.");
      setLoading(false);
      return;
    }

    const gen = ++loadGenRef.current;
    try {
      setLoading(true);
      setError(null);
      setSubmitError("");

      const opened = await openVisitCrf({
        subjectMstNo,
        appVisitCrfMappingNo,
        activityExecutionHdrNo: activityExecutionHdrNo > 0 ? activityExecutionHdrNo : null,
      });
      if (gen !== loadGenRef.current) return;

      await ensureCrfDefinitionsByNosLoaded([opened.appActivityCrfNo]);
      if (gen !== loadGenRef.current) return;

      const definition = getCachedCrfDefinitionByNo(opened.appActivityCrfNo);
      if (!definition || getCrfActiveFieldItems(definition).length === 0) {
        throw new Error("CRF definition could not be loaded or has no active fields.");
      }

      const ctx = opened.subjectContext || {};
      // Subject display = site randomization number (app-wide convention).
      const subjectLabel = String(
        ctx.siteRandomizationNo
          || navState.siteRandomizationNo
          || ctx.randomizationNo
          || navState.subjectLabel
          || ""
      ).trim();
      const visitLabel = String(navState.visitLabel || "").trim() || "—";
      const activityName = String(
        navState.activityName || opened.activityName || opened.crfName || opened.crfTemplateId || ""
      ).trim();
      const siteCode = String(ctx.siteNo || navState.siteNo || "").trim();
      const projectCode = String(ctx.projectCode || "").trim();

      let reviewQueries = Array.isArray(opened.reviewQueries) ? opened.reviewQueries : [];
      const openedHdr = Number(opened.activityExecutionHdrNo) || 0;
      // Fallback: dedicated queries endpoint (survives older Open payloads / stale hosts).
      if (reviewQueries.length === 0 && openedHdr > 0) {
        try {
          const fetched = await listVisitCrfExecutionQueries(openedHdr);
          if (Array.isArray(fetched) && fetched.length > 0) {
            reviewQueries = fetched;
          }
        } catch {
          // Keep empty; raise/highlight still works after local raise.
        }
      }
      setCrfActivity(withReviewQueries({
        id: `activity-mapping-${opened.appVisitCrfMappingNo}-${opened.subjectMstNo}-${opened.activityExecutionHdrNo}`,
        subjectId: String(opened.subjectMstNo),
        subjectMstNo: opened.subjectMstNo,
        subjectNumber: subjectLabel,
        siteRandomizationNo: String(ctx.siteRandomizationNo || subjectLabel).trim(),
        visitLabel,
        siteNo: siteCode,
        siteName: siteCode,
        projectCode,
        projectName: projectCode,
        country: String(ctx.country || "").trim(),
        region: String(ctx.region || "").trim(),
        screeningNo: String(ctx.screeningNo || "").trim(),
        randomizationNo: String(ctx.siteRandomizationNo || ctx.randomizationNo || "").trim(),
        isScreeningFailure: ctx.isScreeningFailure === true,
        patientStatus: String(ctx.patientStatus || "").trim(),
        userName: String(ctx.userName || "").trim(),
        labelFromCrfValues: { ...(opened.labelFromCrfValues || {}) },
        dose: null,
        activity: activityName,
        status: opened.status,
        reviewStatus: String(opened.reviewStatus || "").trim(),
        performedBy: String(opened.performedBy || "").trim(),
        performedOn: opened.performedOn || null,
        performedOffset: String(opened.performedOffset || "").trim(),
        reviewedBy: String(opened.reviewedBy || "").trim(),
        reviewedOn: opened.reviewedOn || null,
        reviewedOffset: String(opened.reviewedOffset || "").trim(),
        isRepeat: opened.isRepeat === true || navState.isRepeat === true,
        repeatVersion: Number(opened.repeatVersion) || 1,
        versions: Array.isArray(opened.versions) ? opened.versions : [],
        appActivityCrfNo: opened.appActivityCrfNo,
        activityExecutionHdrNo: opened.activityExecutionHdrNo,
        appVisitCrfMappingNo: opened.appVisitCrfMappingNo,
        studyVisitScheduleNo: Number(navState.studyVisitScheduleNo) || 0,
        activityConfigTimePointNo: 0,
        reviewQueryFieldKey: VISIT_CRF_QUERY_FIELD,
        fieldIds: { ...(opened.fieldIds || {}) },
        // Omit auditedFieldIds so CrfForm shows the audit icon for every saved field (Dtl).
        auditedFieldIds: undefined,
        crfDefinition: definition,
        crfResponses: {
          [definition.id]: { values: { ...opened.crfValues } },
        },
        crfValues: { ...opened.crfValues },
      }, reviewQueries));

      // Pin hdr in the URL only when an execution already exists (Open no longer creates rows).
      if (openedHdr > 0 && openedHdr !== activityExecutionHdrNo) {
        navigate(
          { pathname: location.pathname, search: `?hdr=${openedHdr}` },
          { replace: true, state: location.state }
        );
      }
    } catch (err) {
      if (gen !== loadGenRef.current) return;
      setError(err?.response?.data?.message || err?.message || "Unable to open CRF.");
      setCrfActivity(null);
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [
    subjectMstNo,
    appVisitCrfMappingNo,
    activityExecutionHdrNo,
    navState.siteRandomizationNo,
    navState.subjectLabel,
    navState.visitLabel,
    navState.activityName,
    navState.siteNo,
    navState.studyVisitScheduleNo,
    navState.isRepeat,
    navigate,
    location.pathname,
  ]);

  useEffect(() => {
    load();
    return () => {
      loadGenRef.current += 1;
    };
  }, [load]);

  // From Queries page Resolve: auto-open the field resolve modal once CRF is loaded.
  useEffect(() => {
    const resolveFieldKey = pendingResolveFieldKeyRef.current;
    if (!resolveFieldKey || !crfActivity || loading) return;
    if (!isActiveReviewQuery(crfActivity, resolveFieldKey)) return;
    pendingResolveFieldKeyRef.current = "";
    setResolveTarget({
      fieldId: resolveReviewQueryFieldId(resolveFieldKey),
      fieldKey: resolveFieldKey,
    });
  }, [crfActivity, loading]);

  const definition = crfActivity?.crfDefinition ?? null;
  const savedValues = useMemo(
    () => (crfActivity && definition ? resolveCrfSavedValues(crfActivity, definition) : {}),
    [crfActivity, definition]
  );
  const formId = definition ? `activity-mapping-crf-${definition.id}` : "activity-mapping-crf";

  const versionOptions = useMemo(() => {
    const list = Array.isArray(crfActivity?.versions) ? crfActivity.versions : [];
    return list
      .filter((v) => Number(v.activityExecutionHdrNo) > 0)
      .map((v) => {
        const ver = Number(v.repeatVersion) || 1;
        const status = String(v.status || "Pending").trim() || "Pending";
        const openQueries = Number(v.openQueriesCount) || 0;
        const queryMark = openQueries > 0
          ? ` \u00B7 Query${openQueries > 1 ? ` (${openQueries})` : ""}`
          : "";
        return {
          value: String(v.activityExecutionHdrNo),
          label: `${ver} \u00B7 ${status}${queryMark}`,
          openQueriesCount: openQueries,
          repeatVersion: ver,
        };
      });
  }, [crfActivity?.versions]);

  const currentVersionLabel = useMemo(() => {
    const ver = Number(crfActivity?.repeatVersion) || 0;
    if (ver <= 0) return "—";
    const status = String(crfActivity?.status || "").trim();
    const currentHdr = Number(crfActivity?.activityExecutionHdrNo) || 0;
    const fromVersions = (Array.isArray(crfActivity?.versions) ? crfActivity.versions : [])
      .find((v) => Number(v.activityExecutionHdrNo) === currentHdr);
    const openQueries = Number(fromVersions?.openQueriesCount) || 0;
    const queryMark = openQueries > 0
      ? ` \u00B7 Query${openQueries > 1 ? ` (${openQueries})` : ""}`
      : "";
    const base = status ? `${ver} \u00B7 ${status}` : String(ver);
    return `${base}${queryMark}`;
  }, [crfActivity?.activityExecutionHdrNo, crfActivity?.repeatVersion, crfActivity?.status, crfActivity?.versions]);

  const priorVersionQueryCount = useMemo(() => {
    const currentHdr = Number(crfActivity?.activityExecutionHdrNo) || 0;
    return (Array.isArray(crfActivity?.versions) ? crfActivity.versions : [])
      .filter((v) => Number(v.activityExecutionHdrNo) !== currentHdr)
      .reduce((sum, v) => sum + (Number(v.openQueriesCount) || 0), 0);
  }, [crfActivity?.activityExecutionHdrNo, crfActivity?.versions]);

  const priorQueryHdrNo = useMemo(() => {
    const currentHdr = Number(crfActivity?.activityExecutionHdrNo) || 0;
    const withOpen = (Array.isArray(crfActivity?.versions) ? crfActivity.versions : [])
      .filter((v) => Number(v.activityExecutionHdrNo) !== currentHdr && Number(v.openQueriesCount) > 0)
      .sort((a, b) => (Number(a.repeatVersion) || 0) - (Number(b.repeatVersion) || 0));
    return Number(withOpen[0]?.activityExecutionHdrNo) || 0;
  }, [crfActivity?.activityExecutionHdrNo, crfActivity?.versions]);

  const handleVersionChange = useCallback(
    (value) => {
      const nextHdr = Number(value) || 0;
      const currentHdr = Number(crfActivity?.activityExecutionHdrNo) || activityExecutionHdrNo || 0;
      if (nextHdr <= 0 || nextHdr === currentHdr) return;
      const basePath = fromReview
        ? `/review/crf/${subjectMstNo}/${appVisitCrfMappingNo}`
        : `/activity-fill/open/${subjectMstNo}/${appVisitCrfMappingNo}`;
      navigate(`${basePath}?hdr=${nextHdr}`, {
        state: {
          ...navState,
          isRepeat: crfActivity?.isRepeat === true || navState.isRepeat === true,
        },
      });
    },
    [
      activityExecutionHdrNo,
      appVisitCrfMappingNo,
      crfActivity?.activityExecutionHdrNo,
      crfActivity?.isRepeat,
      fromReview,
      navState,
      navigate,
      subjectMstNo,
    ]
  );

  const isCompleted =
    String(crfActivity?.status || "").trim().toLowerCase() === "completed";
  const hdrNo = Number(crfActivity?.activityExecutionHdrNo) || 0;

  const hasActiveQueryToRespond = useMemo(
    () => getReviewQueries(crfActivity).some((query) => {
      const status = String(query?.status || "").trim().toLowerCase();
      return status === REVIEW_QUERY_STATUS.RAISED || status === REVIEW_QUERY_STATUS.SENDBACK;
    }),
    [crfActivity]
  );

  // Site can re-open Completed CRF when raised/sendback queries need a response.
  const isQueryResponseMode = Boolean(
    !fromReview && isCompleted && hdrNo > 0 && hasActiveQueryToRespond
  );

  // Review opens filled executions read-only. Completed stays locked unless query response
  // (new data for IsRepeat mappings goes through Repeat â†’ blank hdr).
  const isCompletedLocked = Boolean(
    crfActivity
    && (
      fromReview
      || (
        isCompleted
        && !isQueryResponseMode
      )
    )
  );

  // Show per-field query icons on Review for every Completed filled CRF (not yet reviewed).
  const isAlreadyReviewed =
    String(crfActivity?.reviewStatus || "").trim().toLowerCase() === "reviewed"
    || Boolean(String(crfActivity?.reviewedBy || "").trim());
  const hasRaisedQuery = useMemo(
    () => activityHasRaisedReviewQuery(crfActivity),
    [crfActivity]
  );
  const canRaiseQuery = Boolean(fromReview && isCompleted && hdrNo > 0 && !isAlreadyReviewed);
  const canOpenFieldQuery = Boolean(fromReview && isCompleted && hdrNo > 0);
  const canRespondToQuery = isQueryResponseMode;
  const canReviewActivity = Boolean(
    fromReview && isCompleted && hdrNo > 0 && !isAlreadyReviewed && !hasRaisedQuery
  );
  const canSendbackQuery = Boolean(canOpenFieldQuery && !isAlreadyReviewed);

  const reviewPasswordDetails = useMemo(() => {
    if (!pendingReview || !crfActivity) return undefined;
    return [
      { label: "Subject", value: crfActivity.subjectNumber || "—" },
      { label: "Visit", value: crfActivity.visitLabel || "—" },
      { label: "Activity", value: crfActivity.activity || "—" },
      { label: "Status", value: crfActivity.status || "—" },
    ];
  }, [pendingReview, crfActivity]);

  const handleReviewPasswordConfirmed = useCallback(async () => {
    if (!canReviewActivity || reviewing) return;
    setPendingReview(false);
    try {
      setReviewing(true);
      const res = await reviewActivitiesApi([hdrNo]);
      showToast(res?.message || "Activity reviewed successfully.", "success");
      await load();
    } catch (err) {
      showToast(err?.response?.data?.message || err?.message || "Failed to review activity.", "error");
    } finally {
      setReviewing(false);
    }
  }, [canReviewActivity, reviewing, hdrNo, load]);

  // Site: show field-wise query icons on the first saved (Completed) fill whenever
  // non-closed queries exist — not only while actively responding to raised/sendback.
  const hasVisibleFieldQueries = useMemo(
    () => getReviewQueries(crfActivity).some((query) => {
      const status = String(query?.status || "").trim().toLowerCase();
      return Boolean(status) && status !== REVIEW_QUERY_STATUS.CLOSED;
    }),
    [crfActivity]
  );
  const canShowFieldQueries = Boolean(
    canOpenFieldQuery
    || canRespondToQuery
    || (!fromReview && isCompleted && hdrNo > 0 && hasVisibleFieldQueries)
  );

  const isFieldEditable = useCallback((fieldId) => {
    if (!crfActivity) return false;
    if (fromReview) return false;
    if (!isCompleted) return true;
    if (!isQueryResponseMode) return false;
    return isActiveReviewQuery(crfActivity, `crf:${fieldId}`);
  }, [crfActivity, fromReview, isCompleted, isQueryResponseMode]);

  const queryActivity = crfActivity
    ? {
        ...crfActivity,
        subjectMstNo: crfActivity.subjectMstNo || Number(crfActivity.subjectId) || 0,
        activityConfigTimePointNo: 0,
        reviewQueryFieldKey: queryFieldKey || VISIT_CRF_QUERY_FIELD,
      }
    : null;

  const resolveActivity = crfActivity && resolveTarget
    ? {
        ...crfActivity,
        subjectMstNo: crfActivity.subjectMstNo || Number(crfActivity.subjectId) || 0,
        activityConfigTimePointNo: 0,
        reviewQueryFieldKey: resolveTarget.fieldKey,
      }
    : null;

  const queryHasAudit = Boolean(
    queryActivity && matchesReviewQueryField(queryActivity, queryFieldKey)
  );
  const resolveHasAudit = Boolean(
    resolveActivity && matchesReviewQueryField(resolveActivity, resolveTarget?.fieldKey)
  );

  const openFieldQuery = (fieldId, fieldKey) => {
    const key = String(fieldKey || (fieldId ? `crf:${fieldId}` : "") || VISIT_CRF_QUERY_FIELD).trim();
    // Site fill: raised/sendback opens Resolve so the user can respond.
    if (!fromReview && crfActivity && isActiveReviewQuery(crfActivity, key)) {
      openResolveQuery(fieldId, key);
      return;
    }
    setQueryFieldKey(key);
    setQueryOpen(true);
  };

  const refreshReviewQueries = useCallback(async () => {
    if (subjectMstNo <= 0 || appVisitCrfMappingNo <= 0) return;
    const hdr = Number(crfActivity?.activityExecutionHdrNo) || activityExecutionHdrNo || 0;
    if (hdr <= 0) return;
    try {
      let nextQueries = [];
      try {
        nextQueries = await listVisitCrfExecutionQueries(hdr);
      } catch {
        nextQueries = [];
      }
      if (!Array.isArray(nextQueries) || nextQueries.length === 0) {
        const opened = await openVisitCrf({
          subjectMstNo,
          appVisitCrfMappingNo,
          activityExecutionHdrNo: hdr,
        });
        nextQueries = Array.isArray(opened?.reviewQueries) ? opened.reviewQueries : [];
      }
      setCrfActivity((prev) => {
        if (!prev) return prev;
        const mergedQueries = nextQueries.length > 0 ? nextQueries : (prev.reviewQueries || []);
        return withReviewQueries({
          ...prev,
          fieldIds: prev.fieldIds || {},
          status: prev.status,
          activityExecutionHdrNo: prev.activityExecutionHdrNo,
        }, mergedQueries);
      });
    } catch {
      // Keep local query state if refresh fails.
    }
  }, [
    subjectMstNo,
    appVisitCrfMappingNo,
    activityExecutionHdrNo,
    crfActivity?.activityExecutionHdrNo,
  ]);

  const openQueryAudit = useCallback(async (fieldId, fieldKey) => {
    const key = String(fieldKey || (fieldId ? `crf:${fieldId}` : "") || queryFieldKey).trim();
    if (!crfActivity) {
      setAuditTarget({ type: "query", fieldKey: key, apiRows: [] });
      return;
    }
    const fieldQuery = findReviewQueryForField(crfActivity, key);
    const queryNo =
      Number(fieldQuery?.activityExecutionQueryNo)
      || Number(crfActivity.activityExecutionQueryNo)
      || 0;
    const subjectNo = Number(crfActivity.subjectMstNo || crfActivity.subjectId) || 0;

    if (queryNo <= 0) {
      setAuditTarget({ type: "query", fieldKey: key, apiRows: [] });
      return;
    }

    try {
      const events = await fetchReviewQueryAuditApi({
        subjectMstNo: subjectNo,
        activityConfigTimePointNo: 0,
        activityExecutionQueryNo: queryNo,
      });
      const apiRows = mapReviewQueryAuditEventsToRows(events, {
        activityId: crfActivity.id,
        fieldKey: key,
        fieldLabel: fieldQuery?.fieldLabel || resolveReviewQueryFieldLabel(crfActivity, key),
      });
      setAuditTarget({ type: "query", fieldKey: key, apiRows });
    } catch (err) {
      console.error("Failed to load Visit CRF query audit", err);
      setAuditTarget({ type: "query", fieldKey: key, apiRows: [] });
    }
  }, [crfActivity, queryFieldKey]);

  const handleRaiseQuery = async (fieldKey, text) => {
    if (!crfActivity) return false;
    const key = String(fieldKey || queryFieldKey || VISIT_CRF_QUERY_FIELD).trim();
    const hasOpen = hasOpenReviewQuery(crfActivity, key);
    if (!canRaiseQuery || hasOpen) return false;

    setQueryBusy(true);
    try {
      const fieldLabel =
        resolveReviewQueryFieldLabel(crfActivity, key)
        || crfActivity.activity
        || "Visit CRF";
      const res = await raiseReviewQueryApi({
        subjectMstNo: crfActivity.subjectMstNo || Number(crfActivity.subjectId) || 0,
        activityExecutionHdrNo: hdrNo,
        fieldKey: key,
        fieldLabel,
        queryText: text,
      });
      if (res.success) {
        const apiQueries = res.data?.queries || res.data?.Queries || [];
        setCrfActivity((prev) => {
          if (!prev) return prev;
          if (Array.isArray(apiQueries) && apiQueries.length > 0) {
            const normalized = apiQueries.map((q) => ({
              activityExecutionQueryNo: Number(q.activityExecutionQueryNo ?? q.ActivityExecutionQueryNo) || null,
              fieldKey: String(q.fieldKey ?? q.FieldKey ?? "").trim(),
              fieldLabel: String(q.fieldLabel ?? q.FieldLabel ?? "").trim(),
              queryText: String(q.queryText ?? q.QueryText ?? "").trim(),
              status: String(q.status ?? q.Status ?? "raised").trim() || "raised",
              responseText: String(q.responseText ?? q.ResponseText ?? "").trim(),
              sendbackRemark: String(q.sendbackRemark ?? q.SendbackRemark ?? "").trim(),
              recordedOnUtc: q.recordedOnUtc ?? q.RecordedOnUtc ?? null,
              resolvedAt: q.resolvedAt ?? q.ResolvedAt ?? null,
              closedAt: q.closedAt ?? q.ClosedAt ?? null,
              performedBy: String(q.performedBy ?? q.PerformedBy ?? "").trim(),
              recordedAtOffset: String(q.recordedAtOffset ?? q.RecordedAtOffset ?? "").trim(),
            })).filter((q) => q.fieldKey || q.queryText);
            if (normalized.length > 0) {
              return withReviewQueries(prev, normalized);
            }
          }
          return createRaisedReviewQueryActivity(prev, key, fieldLabel, text, new Date().toISOString());
        });
        showToast("Query raised successfully.", "success");
        setQueryOpen(false);
        await refreshReviewQueries();
        return true;
      }
      showToast(res.message || "Could not raise query.", "error");
      return false;
    } catch (err) {
      showToast(
        err?.response?.data?.message || err?.message || "Could not raise query.",
        "error"
      );
      return false;
    } finally {
      setQueryBusy(false);
    }
  };

  const handleSendbackQuery = async (fieldKey, text) => {
    if (!crfActivity || isAlreadyReviewed) return false;
    const key = String(fieldKey || queryFieldKey || VISIT_CRF_QUERY_FIELD).trim();
    if (getReviewQueryStatus(crfActivity, key) !== REVIEW_QUERY_STATUS.RESOLVED) return false;

    setQueryBusy(true);
    try {
      const res = await sendbackReviewQueryApi({
        subjectMstNo: crfActivity.subjectMstNo || Number(crfActivity.subjectId) || 0,
        activityConfigTimePointNo: 0,
        activityExecutionHdrNo: hdrNo,
        fieldKey: key,
        remark: text,
      });
      if (res.success) {
        setCrfActivity((prev) => (prev ? applyReviewQuerySendback(prev, text, key) : prev));
        showToast("Query sent back.", "success");
        setQueryOpen(false);
        await refreshReviewQueries();
        return true;
      }
      showToast(res.message || "Could not send back query.", "error");
      return false;
    } catch (err) {
      showToast(
        err?.response?.data?.message || err?.message || "Could not send back query.",
        "error"
      );
      return false;
    } finally {
      setQueryBusy(false);
    }
  };

  const handleCloseQuery = async (fieldKey, remark) => {
    if (!crfActivity) return false;
    const key = String(fieldKey || queryFieldKey || VISIT_CRF_QUERY_FIELD).trim();
    const status = getReviewQueryStatus(crfActivity, key);
    const closable = [
      REVIEW_QUERY_STATUS.RAISED,
      REVIEW_QUERY_STATUS.RESOLVED,
      REVIEW_QUERY_STATUS.SENDBACK,
    ].includes(status);
    if (!closable) return false;

    setQueryBusy(true);
    try {
      const res = await closeReviewQueryApi({
        subjectMstNo: crfActivity.subjectMstNo || Number(crfActivity.subjectId) || 0,
        activityConfigTimePointNo: 0,
        activityExecutionHdrNo: hdrNo,
        fieldKey: key,
        remark,
      });
      if (res.success) {
        setCrfActivity((prev) => (prev ? applyReviewQueryClosed(prev, key) : prev));
        showToast("Query closed.", "success");
        setQueryOpen(false);
        await refreshReviewQueries();
        return true;
      }
      showToast(res.message || "Could not close query.", "error");
      return false;
    } catch (err) {
      showToast(
        err?.response?.data?.message || err?.message || "Could not close query.",
        "error"
      );
      return false;
    } finally {
      setQueryBusy(false);
    }
  };

  const openFieldValueAudit = useCallback((fieldId) => {
    if (!crfActivity || !fieldId) return;
    const definition = crfActivity.crfDefinition;
    const field = definition?.items
      ?.map((item) => item.field)
      .find((item) => item?.id === fieldId);
    const ids = crfActivity.fieldIds ?? {};
    // Prefer stable field id only — label keys can collide across fields.
    const dtlNo = Number(ids[fieldId] || ids[`crf:${fieldId}`]) || 0;
    if (dtlNo <= 0) {
      showToast("No saved audit history for this field yet.", "warning");
      return;
    }
    setDbAuditTarget({
      tableName: "ActivityExecutionDtl",
      recordId: String(dtlNo),
      hdrNo: crfActivity.activityExecutionHdrNo || null,
      fieldName: fieldId,
      fieldLabel: field?.label || fieldId,
      title: `${field?.label || fieldId} Audit`,
    });
  }, [crfActivity, showToast]);

  const openResolveQuery = (fieldId, fieldKey) => {
    const key = String(fieldKey || (fieldId ? `crf:${fieldId}` : "") || "").trim();
    if (!key || !crfActivity) return;
    if (!isActiveReviewQuery(crfActivity, key)) return;
    setResolveTarget({ fieldId: fieldId || resolveReviewQueryFieldId(key), fieldKey: key });
  };

  const handleResolveQuery = async (_fieldKey, { responseText, fieldValue }) => {
    if (!crfActivity || !resolveTarget) return "Missing query target.";
    const key = String(resolveTarget.fieldKey || _fieldKey || "").trim();
    if (!isActiveReviewQuery(crfActivity, key)) {
      return "No raised query found to resolve.";
    }

    setQueryBusy(true);
    try {
      const res = await resolveReviewQueryApi({
        subjectMstNo: crfActivity.subjectMstNo || Number(crfActivity.subjectId) || 0,
        activityConfigTimePointNo: 0,
        activityExecutionHdrNo: hdrNo,
        fieldKey: key,
        responseText,
        fieldValue,
      });
      if (!res.success) {
        return res.message || "Could not resolve query.";
      }

      const fieldId = resolveTarget.fieldId || resolveReviewQueryFieldId(key);
      setCrfActivity((prev) => {
        if (!prev) return prev;
        const nextValues = { ...(prev.crfValues || {}) };
        if (fieldId) nextValues[fieldId] = fieldValue ?? nextValues[fieldId];
        const next = applyReviewQueryResolved(prev, key, responseText);
        return {
          ...next,
          crfValues: nextValues,
          crfResponses: prev.crfDefinition
            ? {
                ...(prev.crfResponses || {}),
                [prev.crfDefinition.id]: { values: { ...nextValues } },
              }
            : prev.crfResponses,
        };
      });
      showToast("Query response saved.", "success");
      setResolveTarget(null);
      await refreshReviewQueries();
      return true;
    } catch (err) {
      return err?.response?.data?.message || err?.message || "Could not resolve query.";
    } finally {
      setQueryBusy(false);
    }
  };

  const handleSave = async (values, changeReasonOrMap, options = {}) => {
    if (!crfActivity || !definition) return false;
    if (fromReview) {
      setSubmitError("This CRF is opened from Review and cannot be changed.");
      return false;
    }
    if (isCompletedLocked) {
      setSubmitError("This CRF is completed and cannot be changed.");
      return false;
    }
    const asDraft = options?.asDraft === true && !isQueryResponseMode;
    const changeReasonsByFieldId =
      changeReasonOrMap && typeof changeReasonOrMap === "object" && !Array.isArray(changeReasonOrMap)
        ? Object.fromEntries(
            Object.entries(changeReasonOrMap)
              .map(([k, v]) => [String(k), String(v ?? "").trim()])
              .filter(([k, v]) => k && v)
          )
        : {};
    const responseText = typeof changeReasonOrMap === "string"
      ? String(changeReasonOrMap || "").trim()
      : (Object.values(changeReasonsByFieldId)[0] || "");
    const prevSaved = savedValues || {};
    const changedFieldIds = Object.keys(values || {}).filter((fieldId) => {
      const prevVal = String(prevSaved[fieldId] ?? "").trim();
      const nextVal = String(values?.[fieldId] ?? "").trim();
      return prevVal !== "" && prevVal !== nextVal;
    });
    if (changedFieldIds.length > 0) {
      const missingReason = changedFieldIds.some((fieldId) => !String(changeReasonsByFieldId[fieldId] || "").trim());
      if (missingReason && !responseText) {
        setSubmitError("Enter a reason for each changed field before saving.");
        showToast("Enter a reason for each changed field before saving.", "warning");
        return false;
      }
    }
    let changedQueries = [];
    if (isQueryResponseMode && !asDraft) {
      if (!responseText && Object.keys(changeReasonsByFieldId).length === 0) {
        setSubmitError("Update the queried field and enter a response remark before saving.");
        showToast("Update the queried field and enter a response remark before saving.", "warning");
        return false;
      }
      const activeQueries = getReviewQueries(crfActivity).filter((query) => {
        const status = String(query?.status || "").trim().toLowerCase();
        return status === REVIEW_QUERY_STATUS.RAISED || status === REVIEW_QUERY_STATUS.SENDBACK;
      });
      changedQueries = activeQueries.filter((query) => {
        const key = String(query.fieldKey || "").trim();
        const fieldId = resolveReviewQueryFieldId(key);
        if (!fieldId) return false;
        const prevVal = String(savedValues?.[fieldId] ?? "").trim();
        const nextVal = String(values?.[fieldId] ?? "").trim();
        return prevVal !== nextVal;
      });
      if (changedQueries.length === 0) {
        setSubmitError("Change at least one queried field, or open the query icon to respond.");
        showToast("Change at least one queried field, or open the query icon to respond.", "warning");
        return false;
      }
    }
    setSaving(true);
    setSubmitError("");
    try {
      const existingHdrNo = Number(crfActivity.activityExecutionHdrNo) || 0;
      const saved = await saveCrfApi({
        subjectMstNo: Number(crfActivity.subjectId) || 0,
        activityConfigTimePointNo: 0,
        appVisitCrfMappingNo: crfActivity.appVisitCrfMappingNo,
        activityExecutionHdrNo: existingHdrNo > 0 ? existingHdrNo : null,
        appActivityCrfNo: crfActivity.appActivityCrfNo,
        values: values ?? {},
        // Prefer per-field reasons for audit; avoid a shared global reason that
        // would stamp every changed field with the same remark.
        changeReason:
          Object.keys(changeReasonsByFieldId).length > 0 ? "" : responseText,
        changeReasonsByFieldId:
          Object.keys(changeReasonsByFieldId).length > 0 ? changeReasonsByFieldId : undefined,
        status: asDraft ? "Draft" : "Completed",
      });
      const savedHdrNo = Number(saved?.activityExecutionHdrNo) || existingHdrNo;
      const savedFieldIds = saved?.fieldIds && typeof saved.fieldIds === "object"
        ? { ...saved.fieldIds }
        : {};
      const nextFieldIds = { ...(crfActivity.fieldIds || {}), ...savedFieldIds };

      // Respond to raised/sendback queries after saving field changes.
      let nextActivity = {
        ...crfActivity,
        status: asDraft ? "Draft" : "Completed",
        activityExecutionHdrNo: savedHdrNo || crfActivity.activityExecutionHdrNo,
        fieldIds: nextFieldIds,
        auditedFieldIds: undefined,
        crfValues: { ...(values ?? {}) },
        crfResponses: {
          [definition.id]: { values: { ...(values ?? {}) } },
        },
      };

      if (isQueryResponseMode && !asDraft) {
        for (const query of changedQueries) {
          const key = String(query.fieldKey || "").trim();
          if (!key) continue;
          const fieldId = resolveReviewQueryFieldId(key);
          const nextVal = String(values?.[fieldId] ?? "").trim();
          const queryResponseText =
            String(changeReasonsByFieldId[fieldId] || "").trim() || responseText;
          const res = await resolveReviewQueryApi({
            subjectMstNo: crfActivity.subjectMstNo || Number(crfActivity.subjectId) || 0,
            activityConfigTimePointNo: 0,
            activityExecutionHdrNo: savedHdrNo || hdrNo,
            fieldKey: key,
            responseText: queryResponseText,
            fieldValue: nextVal,
          });
          if (!res.success) {
            throw new Error(res.message || `Could not resolve query on ${query.fieldLabel || key}.`);
          }
          nextActivity = applyReviewQueryResolved(nextActivity, key, queryResponseText);
        }
      }

      setCrfActivity(nextActivity);
      // Pin newly created execution so later Draft/Save updates the same row.
      if (savedHdrNo > 0 && savedHdrNo !== activityExecutionHdrNo) {
        navigate(
          { pathname: location.pathname, search: `?hdr=${savedHdrNo}` },
          { replace: true, state: location.state }
        );
      }
      showToast(
        isQueryResponseMode
          ? "Query response saved."
          : asDraft
            ? "Draft saved."
            : "CRF saved successfully.",
        "success"
      );
      if (!asDraft && !isQueryResponseMode) {
        setTimeout(() => navigate("/visit-crf"), 400);
      } else if (isQueryResponseMode) {
        await refreshReviewQueries();
      }
      return true;
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Save failed.";
      setSubmitError(msg);
      showToast(msg, "error");
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-wrap admin-wrap--visit-crf admin-wrap--activity-crf-page">
        <div className="admin-card admin-spinner">
          <i className="fas fa-spinner fa-spin" style={{ marginRight: "0.5rem" }} /> Opening CRF...
        </div>
      </div>
    );
  }

  if (error || !crfActivity || !definition) {
    return (
      <div className="admin-wrap admin-wrap--visit-crf admin-wrap--activity-crf-page">
        <div className="admin-card admin-error-card">
          <div className="admin-error-title">Unable to Open CRF</div>
          <div className="admin-error-msg">{error || "CRF not available."}</div>
          <div className="admin-button-row" style={{ marginTop: "1rem" }}>
            <AdminButton variant="primary" onClick={load}>Retry</AdminButton>
            <AdminButton variant="secondary" onClick={goBack}>Back</AdminButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-wrap admin-wrap--visit-crf admin-wrap--activity-crf-page">
      <SoftAlertToast
        title={toast?.variant === "error" ? "Error" : toast?.variant === "warning" ? "Warning" : "Success"}
        message={toast?.message}
        variant={toast?.variant ?? "success"}
        onClose={() => setToast(null)}
      />

      <div className="admin-card activity-crf-page">
        <div className="activity-crf-page__toolbar">
          <div className="activity-crf-page__toolbar-main">
            <div className="review-detail-modal__context" role="group" aria-label="CRF context">
              <div className="review-detail-modal__context-cell">
                <span>Subject</span>
                <strong>{crfActivity.subjectNumber || "—"}</strong>
              </div>
              <div className="review-detail-modal__context-cell">
                <span>Visit</span>
                <strong>{crfActivity.visitLabel || "—"}</strong>
              </div>
              <div className="review-detail-modal__context-cell">
                <span>Activity</span>
                <strong>{crfActivity.activity || "—"}</strong>
              </div>
              <div className="review-detail-modal__context-cell">
                <span>Status</span>
                <strong>{isAlreadyReviewed ? "Reviewed" : (crfActivity.status || "—")}</strong>
              </div>
              <div className="review-detail-modal__context-cell activity-crf-page__version-cell">
                <span>Repeat</span>
                <div className="activity-crf-page__version-value">
                  {versionOptions.length > 1 ? (
                    <select
                      id="activity-crf-version"
                      className="activity-crf-page__version-select"
                      aria-label="Select CRF repeat"
                      value={String(hdrNo || crfActivity.activityExecutionHdrNo || "")}
                      onChange={(e) => handleVersionChange(e.target.value)}
                    >
                      {versionOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      id="activity-crf-version"
                      className="activity-crf-page__version-select activity-crf-page__version-select--single"
                      aria-label="Select CRF repeat"
                      disabled
                      value={String(hdrNo || crfActivity.activityExecutionHdrNo || "")}
                    >
                      <option value={String(hdrNo || crfActivity.activityExecutionHdrNo || "")}>
                        {currentVersionLabel}
                      </option>
                    </select>
                  )}
                  {priorVersionQueryCount > 0 && priorQueryHdrNo > 0 ? (
                    <button
                      type="button"
                      className="activity-crf-page__version-query-mark"
                      title={`${priorVersionQueryCount} open quer${priorVersionQueryCount === 1 ? "y" : "ies"} on a previous repeat — open that save to respond`}
                      onClick={() => handleVersionChange(String(priorQueryHdrNo))}
                    >
                      Query
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            {fromReview ? (
              <div className="review-detail-modal__audit" aria-label="Perform stamps">
                <div className="review-detail-modal__audit-row">
                  <div className="review-detail-modal__audit-item">
                    <span>Performed By</span>
                    <strong>{crfActivity.performedBy || "—"}</strong>
                  </div>
                  <div className="review-detail-modal__audit-item">
                    <span>Performed On (UTC)</span>
                    <strong>{formatAuditUtc(crfActivity.performedOn) || "—"}</strong>
                  </div>
                  <div className="review-detail-modal__audit-item">
                    <span>Performed On (Offset)</span>
                    <strong>{formatAuditOffsetDisplay(crfActivity.performedOffset) || "—"}</strong>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="activity-crf-page__body">
          <CrfForm
            formId={formId}
            definition={definition}
            activity={crfActivity}
            sample={null}
            visit={{ label: crfActivity.visitLabel }}
            savedValues={savedValues}
            submitError={submitError}
            onClearSubmitError={() => setSubmitError("")}
            viewOnly={isCompletedLocked}
            isFieldEditable={isQueryResponseMode ? isFieldEditable : undefined}
            onSave={isCompletedLocked ? undefined : handleSave}
            allowFieldQuery={canRaiseQuery}
            onRaiseFieldQuery={canShowFieldQueries ? openFieldQuery : undefined}
            hideClosedQueries={!fromReview}
            onOpenFieldAudit={hdrNo > 0 ? openFieldValueAudit : undefined}
            onOpenQueryAudit={openQueryAudit}
          />
        </div>

        <div className="activity-crf-page__actions">
          <AdminButton type="button" variant="secondary" onClick={goBack} disabled={saving || queryBusy || reviewing}>
            {isCompletedLocked ? "Back" : "Cancel"}
          </AdminButton>
          {canReviewActivity ? (
            <AdminButton
              type="button"
              variant="primary"
              disabled={reviewing || queryBusy}
              onClick={() => setPendingReview(true)}
            >
              {reviewing ? "Reviewing..." : "Review"}
            </AdminButton>
          ) : null}
          {!isCompletedLocked ? (
            <>
              {!isQueryResponseMode ? (
                <AdminButton
                  type="submit"
                  form={formId}
                  variant="secondary"
                  disabled={saving}
                  data-save-mode="draft"
                  onClick={() => {
                    const form = document.getElementById(formId);
                    form?.setAttribute("data-pending-save-mode", "draft");
                  }}
                >
                  {saving ? "Saving..." : "Draft"}
                </AdminButton>
              ) : null}
              <AdminButton
                type="submit"
                form={formId}
                variant="primary"
                disabled={saving || queryBusy}
                data-save-mode="save"
                onClick={() => {
                  const form = document.getElementById(formId);
                  form?.setAttribute("data-pending-save-mode", "save");
                }}
              >
                {saving ? "Saving..." : isQueryResponseMode ? "Save Response" : "Save"}
              </AdminButton>
            </>
          ) : null}
        </div>
      </div>

      <PasswordConfirmModal
        open={pendingReview}
        title="Confirm Review"
        message="Please enter your password to mark this CRF as reviewed. This action will be recorded in the audit trail."
        details={reviewPasswordDetails}
        confirmLabel="Verify & Review"
        onValidatePassword={validatePassword}
        onClose={() => setPendingReview(false)}
        onConfirm={handleReviewPasswordConfirmed}
      />

      <ReviewQueryModal
        open={queryOpen && !!queryActivity}
        activity={queryActivity}
        defaultFieldKey={queryFieldKey}
        hasFieldAudit={queryHasAudit}
        onOpenFieldAudit={(fieldKey) => {
          openQueryAudit(null, fieldKey || queryFieldKey);
        }}
        onClose={() => setQueryOpen(false)}
        onSubmit={canRaiseQuery ? handleRaiseQuery : undefined}
        onSendback={canSendbackQuery ? handleSendbackQuery : undefined}
        onCloseQuery={canOpenFieldQuery ? handleCloseQuery : undefined}
      />

      <ReviewQueryModal
        open={!!resolveTarget && !!resolveActivity}
        activity={resolveActivity}
        defaultFieldKey={resolveTarget?.fieldKey}
        showFieldValue
        resolveMode
        hasFieldAudit={resolveHasAudit}
        onOpenFieldAudit={(fieldKey) => {
          openQueryAudit(null, fieldKey || resolveTarget?.fieldKey);
        }}
        onClose={() => setResolveTarget(null)}
        onResolve={handleResolveQuery}
      />

      <AuditDetailModal
        open={!!auditTarget}
        onClose={() => setAuditTarget(null)}
        rows={Array.isArray(auditTarget?.apiRows) ? auditTarget.apiRows : []}
        fallbackRow={auditTarget
          ? buildAuditFallbackRow({
              type: "query",
              activity: crfActivity,
              fieldLabel: resolveReviewQueryFieldLabel(crfActivity, auditTarget.fieldKey),
              rows: Array.isArray(auditTarget.apiRows) ? auditTarget.apiRows : [],
            })
          : null}
        type="query"
        allEntries={[]}
        activity={crfActivity}
        fieldLabel={
          auditTarget?.fieldKey
            ? resolveReviewQueryFieldLabel(crfActivity, auditTarget.fieldKey)
            : ""
        }
      />

      <AuditHistoryModal
        open={!!dbAuditTarget}
        onClose={() => setDbAuditTarget(null)}
        title={dbAuditTarget?.title ?? "Audit History"}
      >
        {dbAuditTarget ? (
          <DbAuditHistoryTableBody
            tableName={dbAuditTarget.tableName}
            recordId={dbAuditTarget.recordId}
            fieldName={dbAuditTarget.tableName === "ActivityExecutionDtl" ? "vFieldValue" : dbAuditTarget.fieldName}
            customLabel={dbAuditTarget.fieldLabel}
          />
        ) : null}
      </AuditHistoryModal>
    </div>
  );
}
