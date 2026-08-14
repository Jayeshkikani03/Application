import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLab } from "../context/LabContext";
import { canCloseQuery, canResolveQuery, shouldShowSiteInHeader } from "../constants/profileCodes";
import { AuditDetailModal } from "../components/shared/AuditDetailModal";
import { QueryActionsMenu } from "../components/shared/QueryActionsMenu";
import { ReviewQueryModal } from "../components/shared/ReviewQueryModal";
import { ScrollableSelect } from "../components/shared/ScrollableSelect";
import { SoftAlertToast } from "../components/shared/SoftAlertToast";
import {
  buildAuditFallbackRow
} from "../services/activityAuditService";
import { getBarcodeProjects, resolveActiveProjectId } from "../services/barcodeGenerationService";
import { getSubjectsForProject } from "../services/projectSubjectService";
import {
  filterActivitiesWithReviewQueries,
  getReviewQueries,
  getReviewQueryDisplayRemark,
  getReviewQueryStageOptions,
  getReviewQueryStatus,
  isRaisedReviewQueryStatus,
  REVIEW_QUERY_STATUS,
  REVIEW_QUERY_STAGE_LABELS,
  stripCrfFieldLabelPrefix
} from "../services/reviewQueryService";
import { formatParticipantDropdownLabel, getSiteRandomizationNumber } from "../utils/participantDisplay";
import { resolveReviewQueryFieldValue } from "../utils/reviewQueryFieldValue";
import { formatActivityTimepointLabel } from "../utils/visitDisplay";
import { useViewport } from "../hooks/useViewport";
import { fetchExecutionHistory } from "../features/activityExecution/api/activityExecutionApi";
import {
  closeReviewQueryApi,
  fetchReviewQueryAuditApi,
  fetchReviewSites,
  fetchReviewVisits,
  mapReviewQueryAuditEventsToRows,
  resolveReviewQueryApi,
  sendbackReviewQueryApi
} from "../features/review/api/reviewApi";
import { formatAuditOffsetDisplay, formatAuditUtc } from "../shared/audit/auditDisplayUtils";
import { hydrateCrfDefinitionsForActivities } from "../services/crfService";
import { isActivityMappingCrfVisible } from "../features/visitCrfMapping/visitCrfMappingConfig.js";
import { useProjectSettings } from "../context/ProjectSettingsContext.jsx";
import {
  listVisitCrfFillRows,
  listVisitCrfExecutionQueries,
} from "../features/visitCrfMapping/api/visitCrfMappingApi.js";

function getSiteCodeFromSubjectNumber(subjectNumber) {
  const match = String(subjectNumber ?? "").match(/^(\d{4}-\d{2}-\d{3})/);
  return match?.[1] ?? "";
}

function displayOrDash(value) {
  const text = String(value ?? "").trim();
  return text || "—";
}

function QueryStageBadge({ status }) {
  if (!status) return null;
  // Sendback counts as Raised for Queries page display.
  const displayStatus = status === REVIEW_QUERY_STATUS.SENDBACK
    ? REVIEW_QUERY_STATUS.RAISED
    : status;
  const label = REVIEW_QUERY_STAGE_LABELS[displayStatus] ?? displayStatus;
  return (
    <span className={`review-query-modal__stage review-query-modal__stage--${displayStatus} queries-page__stage`}>
      {label}
    </span>
  );
}

function buildQueryRowsFromRecords(records, { subjectMstNo, subjectNumber }) {
  const rows = [];
  for (const record of records ?? []) {
    const queries = getReviewQueries(record);
    if (!queries.length) continue;
    const timepointName = record.timePointLabel || record.timepointLabel || "";
    const activityType = record.activityType || record.activity || "";
    const crfValues = record.crfValues && typeof record.crfValues === "object" ? record.crfValues : {};
    const crfId = String(activityType || "crf").trim() || "crf";
    const appVisitCrfMappingNo = Number(record.appVisitCrfMappingNo) || 0;
    for (const query of queries) {
      rows.push({
        id: `${record.activityExecutionHdrNo}-${query.fieldKey}-${query.activityExecutionQueryNo || "q"}`,
        activityExecutionHdrNo: record.activityExecutionHdrNo,
        activityConfigTimePointNo: record.activityConfigTimePointNo,
        appVisitCrfMappingNo: appVisitCrfMappingNo > 0 ? appVisitCrfMappingNo : null,
        subjectMstNo: subjectMstNo || record.subjectMstNo,
        subjectId: String(subjectMstNo || record.subjectMstNo || ""),
        subjectNumber: subjectNumber || "",
        timepoint: timepointName,
        timepointLabel: timepointName,
        activity: activityType,
        actualTime: record.actualTime,
        remarks: record.remarks,
        scanStartTime: record.centrifugationStart,
        reviewQuery: query.queryText,
        reviewQueryAt: query.recordedOnUtc,
        reviewQueryFieldKey: query.fieldKey,
        reviewQueryFieldLabel: stripCrfFieldLabelPrefix(query.fieldLabel),
        reviewQueryStatus: query.status,
        reviewQueryResponse: query.responseText,
        reviewQuerySendbackRemark: query.sendbackRemark,
        reviewQueryResolvedAt: query.resolvedAt,
        reviewQueryClosedAt: query.closedAt,
        activityExecutionQueryNo: query.activityExecutionQueryNo,
        performedBy: query.performedBy || "",
        performedOn: query.recordedOnUtc ?? null,
        performedOffset: query.recordedAtOffset || "",
        reviewQueries: [query],
        fieldIds: record.fieldIds ?? {},
        crfValues,
        crfResponses: Object.keys(crfValues).length
          ? { [crfId]: { values: { ...crfValues } } }
          : {},
        reviewStatus: record.reviewStatus || "",
        reviewedBy: record.reviewedBy || "",
        apiSeeded: true
      });
    }
  }
  return rows;
}

function isVisitCrfQueryRow(row) {
  return Number(row?.appVisitCrfMappingNo) > 0;
}

function QueriesPage() {
  const navigate = useNavigate();
  const { user, sites: authSites, activeSite } = useAuth();
  const { showActivityMappingCrf } = useProjectSettings();
  const showActivityCrfTab = isActivityMappingCrfVisible() && showActivityMappingCrf;
  const { state, sendbackReviewQuery, closeReviewQuery, resolveReviewQuery } = useLab();
  const authProjectCode = user?.project?.trim() || "";
  const isSiteUser = useMemo(() => shouldShowSiteInHeader(user), [user]);
  const allowResolveAction = useMemo(() => canResolveQuery(user), [user]);
  const allowCloseAction = useMemo(() => canCloseQuery(user), [user]);
  const loginSite = useMemo(
    () => String(activeSite || user?.site || "").trim(),
    [activeSite, user?.site]
  );
  const projectId = authProjectCode || resolveActiveProjectId(state);
  const project = useMemo(() => {
    if (authProjectCode) {
      return { id: authProjectCode, code: authProjectCode, name: authProjectCode };
    }
    return getBarcodeProjects(state).find((item) => item.id === projectId) ?? null;
  }, [authProjectCode, state, projectId]);
  const projectCodeToUse = authProjectCode || projectId;
  const projectSubjects = useMemo(() => getSubjectsForProject(state, projectId), [state, projectId]);
  const subjectById = useMemo(
    () => Object.fromEntries(projectSubjects.map((subject) => [subject.id, subject])),
    [projectSubjects]
  );
  const { isMobileOrTablet } = useViewport();
  const [selectedSite, setSelectedSite] = useState("");
  // Timepoint card filters (independent of Activity CRF).
  const [timepointSubjectId, setTimepointSubjectId] = useState("");
  const [timepointStage, setTimepointStage] = useState(REVIEW_QUERY_STATUS.RAISED);
  // Activity CRF card filters.
  const [crfSubjectId, setCrfSubjectId] = useState("");
  const [crfStage, setCrfStage] = useState(REVIEW_QUERY_STATUS.RAISED);
  const [activeTab, setActiveTab] = useState("timepoint");
  const [pageMessage, setPageMessage] = useState(null);
  const [queryTarget, setQueryTarget] = useState(null);
  const [auditTarget, setAuditTarget] = useState(null);
  const [apiSites, setApiSites] = useState([]);
  const [apiVisits, setApiVisits] = useState([]);
  const [apiQueryRows, setApiQueryRows] = useState([]);
  const [apiBusy, setApiBusy] = useState(false);
  const [visitCrfQueryRows, setVisitCrfQueryRows] = useState([]);
  const [visitCrfBusy, setVisitCrfBusy] = useState(false);
  const [auditApiRows, setAuditApiRows] = useState([]);

  useEffect(() => {
    if (state.isNative) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchReviewSites({ projectId: projectCodeToUse });
        if (!cancelled) setApiSites(list);
      } catch (err) {
        console.error("Failed to fetch query sites", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectCodeToUse, state.isNative]);

  const siteOptions = useMemo(() => {
    if (isSiteUser && loginSite) return [loginSite];
    if (!state.isNative) {
      return [...new Set(apiSites.map((s) => String(s.siteCode ?? s.siteNo ?? "").trim()))]
        .filter(Boolean)
        .sort();
    }
    if (authProjectCode) {
      const fromAuth = (authSites ?? [])
        .map((site) => String(site.siteCode ?? "").trim())
        .filter(Boolean);
      if (fromAuth.length) return [...new Set(fromAuth)].sort();
      if (activeSite) return [activeSite];
      return [];
    }
    const sites = new Set(
      projectSubjects.map((subject) => getSiteCodeFromSubjectNumber(subject.subjectNumber)).filter(Boolean)
    );
    if (project?.code) sites.add(`${project.code}-101`);
    return [...sites].sort();
  }, [
    activeSite,
    authProjectCode,
    authSites,
    isSiteUser,
    loginSite,
    project?.code,
    projectSubjects,
    apiSites,
    state.isNative
  ]);

  useEffect(() => {
    // Always keep one site selected when options exist (same as Review list).
    const lockedSite =
      (isSiteUser && loginSite)
      || (loginSite && siteOptions.includes(loginSite) ? loginSite : "")
      || "";
    if (lockedSite) {
      if (selectedSite !== lockedSite) {
        setSelectedSite(lockedSite);
        setTimepointSubjectId("");
        setCrfSubjectId("");
      }
      return;
    }

    if (selectedSite && siteOptions.includes(selectedSite)) return;

    const nextSite =
      (activeSite && siteOptions.includes(activeSite) ? activeSite : "")
      || siteOptions[0]
      || "";
    if (!nextSite) return;
    setSelectedSite(nextSite);
    setTimepointSubjectId("");
    setCrfSubjectId("");
  }, [activeSite, isSiteUser, loginSite, selectedSite, siteOptions]);

  useEffect(() => {
    if (state.isNative) return;
    if (!selectedSite) {
      setApiVisits([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setApiBusy(true);
        const list = await fetchReviewVisits({
          projectId: projectCodeToUse,
          siteCode: selectedSite
        });
        if (!cancelled) setApiVisits(list);
      } catch (err) {
        console.error("Failed to fetch query visits", err);
        if (!cancelled) setApiVisits([]);
      } finally {
        if (!cancelled) setApiBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSite, projectCodeToUse, state.isNative]);

  const siteParticipants = useMemo(() => {
    if (!state.isNative) {
      const bySubject = new Map();
      for (const visit of apiVisits) {
        const subjectMstNo = String(visit.subjectMstNo ?? "").trim();
        if (!subjectMstNo) continue;
        if (!bySubject.has(subjectMstNo)) {
          bySubject.set(subjectMstNo, {
            id: subjectMstNo,
            subjectMstNo: Number(visit.subjectMstNo) || 0,
            subjectNumber: String(visit.subjectNumber ?? "").trim()
          });
        }
      }
      return [...bySubject.values()].sort((a, b) =>
        String(a.subjectNumber).localeCompare(String(b.subjectNumber))
      );
    }
    if (!selectedSite) return projectSubjects;
    return projectSubjects.filter(
      (subject) => getSiteCodeFromSubjectNumber(subject.subjectNumber) === selectedSite
    );
  }, [apiVisits, projectSubjects, selectedSite, state.isNative]);

  useEffect(() => {
    if (timepointSubjectId && !siteParticipants.some((subject) => String(subject.id) === String(timepointSubjectId))) {
      setTimepointSubjectId("");
    }
    if (crfSubjectId && !siteParticipants.some((subject) => String(subject.id) === String(crfSubjectId))) {
      setCrfSubjectId("");
    }
  }, [crfSubjectId, siteParticipants, timepointSubjectId]);

  const refreshApiQueryRows = useCallback(async () => {
    if (state.isNative || !selectedSite) {
      setApiQueryRows([]);
      return;
    }
    const subjects = timepointSubjectId
      ? siteParticipants.filter((subject) => String(subject.id) === String(timepointSubjectId))
      : siteParticipants;
    if (!subjects.length) {
      setApiQueryRows([]);
      return;
    }

    setApiBusy(true);
    try {
      const histories = await Promise.all(
        subjects.map(async (subject) => {
          const subjectMstNo = Number(subject.subjectMstNo || subject.id) || 0;
          if (!subjectMstNo) return null;
          try {
            const history = await fetchExecutionHistory(subjectMstNo);
            return {
              history,
              subjectMstNo,
              subjectNumber: subject.subjectNumber || ""
            };
          } catch (err) {
            console.error(`Failed to fetch history for subject ${subjectMstNo}`, err);
            return null;
          }
        })
      );

      const rows = histories
        .filter(Boolean)
        .flatMap(({ history, subjectMstNo, subjectNumber }) =>
          buildQueryRowsFromRecords(history?.records, {
            subjectMstNo,
            subjectNumber
          })
        )
        .filter((row) => !isVisitCrfQueryRow(row))
        .sort(
          (a, b) => new Date(b.reviewQueryAt ?? 0).getTime() - new Date(a.reviewQueryAt ?? 0).getTime()
        );
      const hydrated = await hydrateCrfDefinitionsForActivities(rows);
      setApiQueryRows(hydrated);
    } finally {
      setApiBusy(false);
    }
  }, [selectedSite, timepointSubjectId, siteParticipants, state.isNative]);

  useEffect(() => {
    refreshApiQueryRows();
  }, [refreshApiQueryRows]);

  const refreshVisitCrfQueryRows = useCallback(async () => {
    if (!showActivityCrfTab || state.isNative || !selectedSite) {
      setVisitCrfQueryRows([]);
      return;
    }
    setVisitCrfBusy(true);
    try {
      const fills = await listVisitCrfFillRows({
        siteCode: selectedSite,
        subjectMstNo: crfSubjectId ? Number(crfSubjectId) || 0 : undefined,
      });
      const withHdr = (Array.isArray(fills) ? fills : []).filter(
        (row) => Number(row.activityExecutionHdrNo) > 0
      );
      const bundles = await Promise.all(
        withHdr.map(async (row) => {
          const hdrNo = Number(row.activityExecutionHdrNo) || 0;
          try {
            const queries = await listVisitCrfExecutionQueries(hdrNo);
            return { row, queries };
          } catch (err) {
            console.error(`Failed to load queries for visit CRF hdr ${hdrNo}`, err);
            return { row, queries: [] };
          }
        })
      );
      const rows = [];
      for (const { row, queries } of bundles) {
        const hdrNo = Number(row.activityExecutionHdrNo) || 0;
        const subjectMstNo = Number(row.subjectMstNo) || 0;
        const subjectNumber = String(row.siteRandomizationNo || row.subjectId || "").trim();
        const visitLabel = String(row.visitLabel || "").trim();
        const activityName = String(row.activityName || "").trim();
        for (const query of queries) {
          if (!query?.fieldKey && !query?.queryText) continue;
          rows.push({
            id: `visit-crf-${hdrNo}-${query.fieldKey}-${query.activityExecutionQueryNo || "q"}`,
            activityExecutionHdrNo: hdrNo,
            activityConfigTimePointNo: 0,
            appVisitCrfMappingNo: Number(row.appVisitCrfMappingNo) || 0,
            subjectMstNo,
            subjectId: String(subjectMstNo || ""),
            subjectNumber,
            timepoint: visitLabel,
            timepointLabel: visitLabel,
            activity: activityName,
            crfName: row.crfName || row.crfTemplateId || "",
            reviewQuery: query.queryText,
            reviewQueryAt: query.recordedOnUtc,
            reviewQueryFieldKey: query.fieldKey,
            reviewQueryFieldLabel: stripCrfFieldLabelPrefix(query.fieldLabel),
            reviewQueryStatus: query.status,
            reviewQueryResponse: query.responseText,
            reviewQuerySendbackRemark: query.sendbackRemark,
            reviewQueryResolvedAt: query.resolvedAt,
            reviewQueryClosedAt: query.closedAt,
            activityExecutionQueryNo: query.activityExecutionQueryNo,
            performedBy: query.performedBy || "",
            performedOn: query.recordedOnUtc ?? null,
            performedOffset: query.recordedAtOffset || "",
            reviewQueries: [query],
            fieldIds: {},
            crfValues: {},
            appActivityCrfNo: Number(row.appActivityCrfNo) || 0,
            reviewStatus: row.reviewStatus || "",
            reviewedBy: row.reviewedBy || "",
            apiSeeded: true,
          });
        }
      }
      rows.sort(
        (a, b) => new Date(b.reviewQueryAt ?? 0).getTime() - new Date(a.reviewQueryAt ?? 0).getTime()
      );
      setVisitCrfQueryRows(rows);
    } catch (err) {
      console.error("Failed to load visit CRF queries", err);
      setVisitCrfQueryRows([]);
    } finally {
      setVisitCrfBusy(false);
    }
  }, [crfSubjectId, selectedSite, state.isNative, showActivityCrfTab]);

  useEffect(() => {
    refreshVisitCrfQueryRows();
  }, [refreshVisitCrfQueryRows]);

  const nativeQueryActivities = useMemo(() => {
    if (!state.isNative) return [];
    const filteredSubjectIds = (
      timepointSubjectId
        ? siteParticipants.filter((subject) => String(subject.id) === String(timepointSubjectId))
        : siteParticipants
    ).map((subject) => subject.id);

    const rows = filterActivitiesWithReviewQueries(state.activities, {
      subjectIds: filteredSubjectIds,
      stage: timepointStage || undefined
    });

    return rows
      .flatMap((activity) => {
        const queries = getReviewQueries(activity);
        if (!queries.length) return [activity];
        return queries.map((query) => ({
          ...activity,
          id: `${activity.id}-${query.fieldKey}-${query.activityExecutionQueryNo || "q"}`,
          activityExecutionHdrNo: activity.activityExecutionHdrNo ?? activity.id,
          reviewQuery: query.queryText,
          reviewQueryAt: query.recordedOnUtc,
          reviewQueryFieldKey: query.fieldKey,
          reviewQueryFieldLabel: stripCrfFieldLabelPrefix(query.fieldLabel),
          reviewQueryStatus: query.status,
          reviewQueryResponse: query.responseText,
          reviewQuerySendbackRemark: query.sendbackRemark,
          reviewQueryResolvedAt: query.resolvedAt,
          reviewQueryClosedAt: query.closedAt,
          activityExecutionQueryNo: query.activityExecutionQueryNo,
          performedBy: query.performedBy || activity.performedBy || "",
          performedOn: query.recordedOnUtc ?? activity.reviewQueryAt ?? null,
          performedOffset: query.recordedAtOffset || activity.performedOffset || "",
          reviewQueries: [query]
        }));
      })
      .sort(
        (a, b) => new Date(b.reviewQueryAt ?? 0).getTime() - new Date(a.reviewQueryAt ?? 0).getTime()
      );
  }, [timepointStage, timepointSubjectId, siteParticipants, state.activities, state.isNative]);

  const timepointQueryActivities = useMemo(() => {
    if (state.isNative) return nativeQueryActivities;
    if (!timepointStage) return apiQueryRows;
    return apiQueryRows.filter((row) => {
      const status = getReviewQueryStatus(row);
      if (timepointStage === REVIEW_QUERY_STATUS.RAISED) {
        return isRaisedReviewQueryStatus(status);
      }
      return status === timepointStage;
    });
  }, [apiQueryRows, nativeQueryActivities, timepointStage, state.isNative]);

  const crfQueryActivities = useMemo(() => {
    if (!showActivityCrfTab || state.isNative) return [];
    if (!crfStage) return visitCrfQueryRows;
    return visitCrfQueryRows.filter((row) => {
      const status = getReviewQueryStatus(row);
      if (crfStage === REVIEW_QUERY_STATUS.RAISED) {
        return isRaisedReviewQueryStatus(status);
      }
      return status === crfStage;
    });
  }, [crfStage, state.isNative, visitCrfQueryRows, showActivityCrfTab]);

  const allQueryActivities = useMemo(
    () => [...timepointQueryActivities, ...crfQueryActivities],
    [crfQueryActivities, timepointQueryActivities]
  );

  const queryActivity = useMemo(() => {
    if (!queryTarget?.activityId) return null;
    if (queryTarget.hydratedActivity) return queryTarget.hydratedActivity;
    return allQueryActivities.find((activity) => activity.id === queryTarget.activityId) ?? null;
  }, [allQueryActivities, queryTarget]);

  const beginQueryAction = useCallback((activity, action) => {
    const fieldKey = String(activity?.reviewQueryFieldKey || "").trim();
    if (!activity?.id || !fieldKey) {
      setPageMessage("Query field is missing.");
      return;
    }

    // Activity CRF resolve: open the CRF form (site-user query response flow).
    // The Queries-page modal cannot reliably edit visit-CRF field values.
    if (action === "resolve" && isVisitCrfQueryRow(activity)) {
      const subjectMstNo = Number(activity.subjectMstNo) || 0;
      const appVisitCrfMappingNo = Number(activity.appVisitCrfMappingNo) || 0;
      const hdrNo = Number(activity.activityExecutionHdrNo) || 0;
      if (subjectMstNo <= 0 || appVisitCrfMappingNo <= 0) {
        setPageMessage("Activity CRF link is incomplete for this query.");
        return;
      }
      const search = hdrNo > 0 ? `?hdr=${hdrNo}` : "";
      navigate(`/visit-crf/open/${subjectMstNo}/${appVisitCrfMappingNo}${search}`, {
        state: {
          returnTo: "/queries",
          resolveFieldKey: fieldKey,
          activityName: activity.activity || activity.crfName || "",
          visitLabel: activity.timepointLabel || activity.timepoint || "",
          siteRandomizationNo: activity.subjectNumber || "",
          siteNo: selectedSite || "",
        },
      });
      return;
    }

    setQueryTarget({
      activityId: activity.id,
      fieldKey,
      action,
    });
  }, [navigate, selectedSite]);

  const auditActivity = useMemo(() => {
    if (!auditTarget?.activityId) return null;
    return allQueryActivities.find((activity) => activity.id === auditTarget.activityId) ?? null;
  }, [auditTarget?.activityId, allQueryActivities]);

  const auditRows = useMemo(() => {
    if (auditApiRows.length) return auditApiRows;
    return [];
  }, [auditApiRows]);

  const auditFallbackRow = auditTarget
    ? buildAuditFallbackRow({
      type: "query",
      activity: auditActivity,
      fieldLabel: auditActivity?.reviewQueryFieldLabel,
      rows: auditRows
    })
    : null;

  const queryFieldHasAudit = useMemo(() => {
    if (!queryActivity || !queryTarget?.fieldKey) return false;
    if (auditApiRows.length) return true;
    return !!(queryActivity.reviewQueryFieldKey === queryTarget.fieldKey && queryActivity.reviewQuery);
  }, [auditApiRows.length, queryActivity, queryTarget?.fieldKey]);

  const queryFieldValue = useMemo(() => {
    if (!queryActivity || !queryTarget?.fieldKey) return "";
    return resolveReviewQueryFieldValue(queryActivity, queryTarget.fieldKey, {
      samples: state.samples,
      visits: state.visits
    });
  }, [queryActivity, queryTarget?.fieldKey, state.samples, state.visits]);

  const openQueryAudit = async (activity) => {
    if (!activity) return;
    setAuditTarget({
      activityId: activity.id,
      fieldKey: activity.reviewQueryFieldKey
    });
    setAuditApiRows([]);
    if (state.isNative) return;

    const subjectMstNo = Number(activity.subjectMstNo) || 0;
    const activityConfigTimePointNo = Number(activity.activityConfigTimePointNo) || 0;
    const activityExecutionQueryNo = Number(activity.activityExecutionQueryNo) || 0;
    const activityExecutionHdrNo = Number(activity.activityExecutionHdrNo) || 0;
    if (!(
      activityExecutionQueryNo > 0
      || (subjectMstNo > 0 && activityConfigTimePointNo > 0)
      || (subjectMstNo > 0 && activityExecutionHdrNo > 0)
    )) {
      return;
    }
    try {
      const events = await fetchReviewQueryAuditApi({
        subjectMstNo,
        activityConfigTimePointNo,
        activityExecutionQueryNo: activityExecutionQueryNo || undefined
      });
      setAuditApiRows(mapReviewQueryAuditEventsToRows(events, {
        activityId: activity.id,
        fieldKey: activity.reviewQueryFieldKey,
        fieldLabel: activity.reviewQueryFieldLabel
      }));
    } catch (err) {
      console.error("Failed to load query audit", err);
      setAuditApiRows([]);
    }
  };

  const refreshAllQueryRows = useCallback(async () => {
    await Promise.all([refreshApiQueryRows(), refreshVisitCrfQueryRows()]);
  }, [refreshApiQueryRows, refreshVisitCrfQueryRows]);

  const handleSendbackQuery = async (_fieldKey, text) => {
    if (!queryTarget?.activityId || !queryActivity) return false;
    if (!allowCloseAction) {
      setPageMessage("Your role is not allowed to send back queries.");
      return false;
    }
    if (String(queryActivity.reviewStatus || "").trim() === "Reviewed") {
      setPageMessage("Queries cannot be sent back after the timepoint or CRF has been reviewed.");
      return false;
    }
    if (state.isNative) {
      const result = sendbackReviewQuery(queryActivity.activityExecutionHdrNo ?? queryTarget.activityId, text);
      setPageMessage(result.message);
      if (result.success) setQueryTarget(null);
      return result.success;
    }
    try {
      const res = await sendbackReviewQueryApi({
        subjectMstNo: queryActivity.subjectMstNo,
        activityConfigTimePointNo: queryActivity.activityConfigTimePointNo,
        activityExecutionHdrNo: queryActivity.activityExecutionHdrNo,
        remark: text,
        fieldKey: queryTarget.fieldKey || queryActivity.reviewQueryFieldKey
      });
      if (res.success) {
        setPageMessage("Query sent back.");
        setQueryTarget(null);
        await refreshAllQueryRows();
        return true;
      }
      setPageMessage(res.message || "Could not send back query.");
      return false;
    } catch (err) {
      setPageMessage(err.response?.data?.message || "Could not send back query.");
      return false;
    }
  };

  const handleCloseQuery = async (_fieldKey, remark) => {
    if (!queryTarget?.activityId || !queryActivity) return false;
    if (!allowCloseAction) {
      setPageMessage("Your role is not allowed to close queries.");
      return false;
    }
    if (state.isNative) {
      const result = closeReviewQuery(
        queryActivity.activityExecutionHdrNo ?? queryTarget.activityId,
        remark
      );
      setPageMessage(result.message);
      if (result.success) setQueryTarget(null);
      return result.success;
    }
    try {
      const res = await closeReviewQueryApi({
        subjectMstNo: queryActivity.subjectMstNo,
        activityConfigTimePointNo: queryActivity.activityConfigTimePointNo,
        activityExecutionHdrNo: queryActivity.activityExecutionHdrNo,
        fieldKey: queryTarget.fieldKey || queryActivity.reviewQueryFieldKey,
        remark
      });
      if (res.success) {
        setPageMessage("Query closed.");
        setQueryTarget(null);
        await refreshAllQueryRows();
        return true;
      }
      setPageMessage(res.message || "Could not close query.");
      return false;
    } catch (err) {
      setPageMessage(err.response?.data?.message || "Could not close query.");
      return false;
    }
  };

  const handleResolveQuery = async (_fieldKey, { responseText, fieldValue }) => {
    if (!queryTarget?.activityId || !queryActivity) return "Missing query target.";
    if (!allowResolveAction) {
      const message = "Your role is not allowed to resolve queries.";
      setPageMessage(message);
      return message;
    }
    if (state.isNative) {
      const result = resolveReviewQuery(
        queryActivity.activityExecutionHdrNo ?? queryTarget.activityId,
        responseText,
        fieldValue
      );
      setPageMessage(result.message);
      if (result.success) setQueryTarget(null);
      return result.success ? true : (result.message || "Could not resolve query.");
    }
    try {
      const res = await resolveReviewQueryApi({
        subjectMstNo: queryActivity.subjectMstNo,
        activityConfigTimePointNo: Number(queryActivity.activityConfigTimePointNo) || 0,
        activityExecutionHdrNo: Number(queryActivity.activityExecutionHdrNo) || 0,
        responseText,
        fieldValue,
        fieldKey: queryTarget.fieldKey || queryActivity.reviewQueryFieldKey
      });
      if (res.success) {
        setPageMessage("Query resolved.");
        setQueryTarget(null);
        await refreshAllQueryRows();
        return true;
      }
      const message = res.message || "Could not resolve query.";
      setPageMessage(message);
      return message;
    } catch (err) {
      const message = err.response?.data?.message || err?.message || "Could not resolve query.";
      setPageMessage(message);
      return message;
    }
  };

  const participantLabel = (activity) => {
    if (!state.isNative) {
      return activity.subjectNumber || String(activity.subjectMstNo || "");
    }
    const subject = subjectById[activity.subjectId];
    return subject ? formatParticipantDropdownLabel(subject) : (activity.subjectNumber || "—");
  };

  const participantOptions = siteParticipants.map((subject) => ({
    value: String(subject.id),
    label: state.isNative
      ? formatParticipantDropdownLabel(subject)
      : (subject.subjectNumber || getSiteRandomizationNumber(subject) || String(subject.id))
  }));

  const stageOptions = getReviewQueryStageOptions().filter((option) => option.value !== "");

  const handleSiteChange = (value) => {
    const next = String(value ?? "").trim();
    if (!next || !siteOptions.includes(next)) return;
    setSelectedSite(next);
    setTimepointSubjectId("");
    setCrfSubjectId("");
  };

  const renderQueryList = (activities, { busy }) => {
    if (!selectedSite) {
      return <p className="empty-state">Select a site to view queries.</p>;
    }
    if (busy && !activities.length) {
      return <p className="empty-state">Loading queries…</p>;
    }
    if (!activities.length) {
      return <p className="empty-state">No queries found for the selected filters.</p>;
    }
    if (isMobileOrTablet) {
      return (
        <div className="queries-page-card-list">
          {activities.map((activity) => {
            const status = getReviewQueryStatus(activity);
            const remark = getReviewQueryDisplayRemark(activity);
            return (
              <article
                key={activity.id}
                className={`query-card${status ? ` query-card--${status}` : ""}`}
              >
                <span className="query-card__accent" aria-hidden="true" />
                <div className="query-card__body">
                  <div className="query-card__top">
                    <div className="query-card__identity">
                      <h3 className="query-card__participant">{participantLabel(activity)}</h3>
                      <QueryStageBadge status={status} />
                    </div>
                    <div className="query-card__actions">
                      <QueryActionsMenu
                        activity={activity}
                        allowReraise={false}
                        allowResolve={allowResolveAction}
                        allowClose={allowCloseAction}
                        allowSendback={
                          allowCloseAction
                          && String(activity.reviewStatus || "").trim() !== "Reviewed"
                        }
                        onResolve={() => beginQueryAction(activity, "resolve")}
                        onSendback={() => beginQueryAction(activity, "sendback")}
                        onClose={() => beginQueryAction(activity, "close")}
                        onAudit={() => openQueryAudit(activity)}
                      />
                    </div>
                  </div>

                  <div className="query-card__meta">
                    <div className="query-card__meta-item">
                      <span className="query-card__meta-label">Timepoint</span>
                      <span className="query-card__meta-value">
                        {formatActivityTimepointLabel(activity) || activity.timepointLabel || "—"}
                      </span>
                    </div>
                    <div className="query-card__meta-item">
                      <span className="query-card__meta-label">Field</span>
                      <span className="query-card__meta-value">
                        {stripCrfFieldLabelPrefix(activity.reviewQueryFieldLabel) || activity.reviewQueryFieldKey || "—"}
                      </span>
                    </div>
                    <div className="query-card__meta-item query-card__meta-item--full">
                      <span className="query-card__meta-label">Remark</span>
                      <span className="query-card__meta-value">{remark || "—"}</span>
                    </div>
                    <div className="query-card__meta-item">
                      <span className="query-card__meta-label">Performed By</span>
                      <span className="query-card__meta-value">
                        {displayOrDash(activity.performedBy)}
                      </span>
                    </div>
                    <div className="query-card__meta-item query-card__meta-item--tablet">
                      <span className="query-card__meta-label">Performed On (UTC)</span>
                      <span className="query-card__meta-value">
                        {formatAuditUtc(activity.performedOn ?? activity.reviewQueryAt)}
                      </span>
                    </div>
                    <div className="query-card__meta-item query-card__meta-item--tablet">
                      <span className="query-card__meta-label">Performed On (Offset)</span>
                      <span className="query-card__meta-value">
                        {formatAuditOffsetDisplay(activity.performedOffset)}
                      </span>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      );
    }

    return (
      <div className="admin-table-wrapper admin-table-wrapper--scroll queries-page-table-wrap" data-tour="page-table">
        <table className="admin-table queries-page-table">
          <thead className="admin-thead">
            <tr>
              <th className="admin-th">Participant</th>
              <th className="admin-th">Timepoint</th>
              <th className="admin-th">Field</th>
              <th className="admin-th">Stage</th>
              <th className="admin-th">Remark</th>
              <th className="admin-th">Performed By</th>
              <th className="admin-th">Performed On (UTC)</th>
              <th className="admin-th">Performed On (Offset)</th>
            </tr>
          </thead>
          <tbody>
            {activities.map((activity) => {
              const status = getReviewQueryStatus(activity);
              const remark = getReviewQueryDisplayRemark(activity);
              return (
                <tr key={activity.id} className="admin-tr">
                  <td className="admin-td queries-page-table__participant">
                    <div className="queries-page-table__participant-cell">
                      <QueryActionsMenu
                        activity={activity}
                        allowReraise={false}
                        allowResolve={allowResolveAction}
                        allowClose={allowCloseAction}
                        allowSendback={
                          allowCloseAction
                          && String(activity.reviewStatus || "").trim() !== "Reviewed"
                        }
                        onResolve={() => beginQueryAction(activity, "resolve")}
                        onSendback={() => beginQueryAction(activity, "sendback")}
                        onClose={() => beginQueryAction(activity, "close")}
                        onAudit={() => openQueryAudit(activity)}
                      />
                      <span>{participantLabel(activity)}</span>
                    </div>
                  </td>
                  <td className="admin-td">
                    {formatActivityTimepointLabel(activity) || activity.timepointLabel || "—"}
                  </td>
                  <td className="admin-td">{stripCrfFieldLabelPrefix(activity.reviewQueryFieldLabel) || activity.reviewQueryFieldKey || "—"}</td>
                  <td className="admin-td">
                    <QueryStageBadge status={status} />
                  </td>
                  <td className="admin-td queries-page-table__remark">
                    {remark || "—"}
                  </td>
                  <td className="admin-td">{displayOrDash(activity.performedBy)}</td>
                  <td className="admin-td">{formatAuditUtc(activity.performedOn ?? activity.reviewQueryAt)}</td>
                  <td className="admin-td">{formatAuditOffsetDisplay(activity.performedOffset)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="admin-wrap admin-wrap--queries">
      <SoftAlertToast
        title="Queries"
        message={pageMessage}
        variant="success"
        onClose={() => setPageMessage(null)}
      />

      <div className="admin-card admin-card--queries-table queries-page-card review-page-tabs">
        {showActivityCrfTab ? (
          <div className="review-page-tabs__nav" role="tablist" aria-label="Query sections">
            <button
              type="button"
              role="tab"
              id="queries-tab-timepoint"
              aria-selected={activeTab === "timepoint"}
              aria-controls="queries-panel-timepoint"
              className={`review-page-tabs__tab${activeTab === "timepoint" ? " review-page-tabs__tab--active" : ""}`}
              onClick={() => setActiveTab("timepoint")}
            >
              <span>Query Timepoint</span>
              <span className="review-detail-section-card__count">{timepointQueryActivities.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="queries-tab-activity-crf"
              aria-selected={activeTab === "activity-crf"}
              aria-controls="queries-panel-activity-crf"
              className={`review-page-tabs__tab${activeTab === "activity-crf" ? " review-page-tabs__tab--active" : ""}`}
              onClick={() => setActiveTab("activity-crf")}
            >
              <span>Query Activity CRF</span>
              <span className="review-detail-section-card__count">{crfQueryActivities.length}</span>
            </button>
          </div>
        ) : (
          <div className="review-page-tabs__heading">
            <h3 className="review-detail-section-card__title">Query Timepoint</h3>
            <span className="review-detail-section-card__count">{timepointQueryActivities.length}</span>
          </div>
        )}

        {activeTab === "timepoint" || !showActivityCrfTab ? (
          <div
            className="review-page-tabs__panel"
            role="tabpanel"
            id="queries-panel-timepoint"
            aria-labelledby={showActivityCrfTab ? "queries-tab-timepoint" : undefined}
          >
            <div className="queries-page-card__filters-bar" data-tour="page-search">
              <div className="queries-page-card__filters" role="group" aria-label="Timepoint query filters">
                {!isSiteUser && (
                  <label className="field field--inline queries-page-card__filter-field queries-page-card__filter-field--site">
                    <span>Site</span>
                    <ScrollableSelect
                      ariaLabel="Select site for Timepoint queries"
                      value={selectedSite}
                      onChange={handleSiteChange}
                      allowEmpty={false}
                      placeholder="Select site"
                      disabled={siteOptions.length === 0}
                      options={siteOptions.map((site) => ({ value: site, label: site }))}
                    />
                  </label>
                )}
                <label className="field field--inline queries-page-card__filter-field queries-page-card__filter-field--participant">
                  <span>Participant</span>
                  <ScrollableSelect
                    ariaLabel="Filter Timepoint participant"
                    value={timepointSubjectId}
                    onChange={setTimepointSubjectId}
                    allowEmpty
                    placeholder={selectedSite ? "All participants" : "Select site first"}
                    options={participantOptions}
                    disabled={!selectedSite}
                  />
                </label>
                <label className="field field--inline queries-page-card__filter-field queries-page-card__filter-field--stage">
                  <span>Stage</span>
                  <ScrollableSelect
                    ariaLabel="Filter Timepoint query stage"
                    value={timepointStage}
                    onChange={setTimepointStage}
                    allowEmpty
                    placeholder="All stages"
                    options={stageOptions}
                  />
                </label>
              </div>
            </div>
            {renderQueryList(timepointQueryActivities, { busy: apiBusy })}
          </div>
        ) : null}

        {showActivityCrfTab && activeTab === "activity-crf" ? (
          <div
            className="review-page-tabs__panel"
            role="tabpanel"
            id="queries-panel-activity-crf"
            aria-labelledby="queries-tab-activity-crf"
          >
            <div className="queries-page-card__filters-bar">
              <div className="queries-page-card__filters" role="group" aria-label="Activity CRF query filters">
                {!isSiteUser && (
                  <label className="field field--inline queries-page-card__filter-field queries-page-card__filter-field--site">
                    <span>Site</span>
                    <ScrollableSelect
                      ariaLabel="Select site for Activity CRF queries"
                      value={selectedSite}
                      onChange={handleSiteChange}
                      allowEmpty={false}
                      placeholder="Select site"
                      disabled={siteOptions.length === 0}
                      options={siteOptions.map((site) => ({ value: site, label: site }))}
                    />
                  </label>
                )}
                <label className="field field--inline queries-page-card__filter-field queries-page-card__filter-field--participant">
                  <span>Participant</span>
                  <ScrollableSelect
                    ariaLabel="Filter Activity CRF participant"
                    value={crfSubjectId}
                    onChange={setCrfSubjectId}
                    allowEmpty
                    placeholder={selectedSite ? "All participants" : "Select site first"}
                    options={participantOptions}
                    disabled={!selectedSite}
                  />
                </label>
                <label className="field field--inline queries-page-card__filter-field queries-page-card__filter-field--stage">
                  <span>Stage</span>
                  <ScrollableSelect
                    ariaLabel="Filter Activity CRF query stage"
                    value={crfStage}
                    onChange={setCrfStage}
                    allowEmpty
                    placeholder="All stages"
                    options={stageOptions}
                  />
                </label>
              </div>
            </div>
            {!selectedSite ? (
              <p className="empty-state">Select a site to view Activity CRF queries.</p>
            ) : (
              renderQueryList(crfQueryActivities, { busy: visitCrfBusy })
            )}
          </div>
        ) : null}
      </div>

      <ReviewQueryModal
        open={!!queryTarget}
        activity={queryActivity}
        defaultFieldKey={queryTarget?.fieldKey}
        fieldValue={queryFieldValue}
        fieldEditContext={{
          samples: state.samples,
          visits: state.visits
        }}
        showFieldValue={queryTarget?.action === "resolve"}
        resolveMode={queryTarget?.action === "resolve"}
        closeMode={queryTarget?.action === "close"}
        hasFieldAudit={queryFieldHasAudit}
        onOpenFieldAudit={(fieldKey) => {
          if (!queryActivity) return;
          openQueryAudit({ ...queryActivity, reviewQueryFieldKey: fieldKey || queryActivity.reviewQueryFieldKey });
        }}
        onClose={() => setQueryTarget(null)}
        onResolve={handleResolveQuery}
        onSendback={handleSendbackQuery}
        onCloseQuery={handleCloseQuery}
      />

      <AuditDetailModal
        open={!!auditTarget}
        onClose={() => {
          setAuditTarget(null);
          setAuditApiRows([]);
        }}
        rows={auditRows}
        fallbackRow={auditFallbackRow}
        type="query"
        allEntries={[]}
        activity={auditActivity}
        fieldLabel={auditActivity?.reviewQueryFieldLabel}
      />
    </div>
  );
}

export default QueriesPage;
