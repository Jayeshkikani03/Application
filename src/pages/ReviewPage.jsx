import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLab } from "../context/LabContext";
import { ScrollableSelect } from "../components/shared/ScrollableSelect";
import { StatusBadge } from "../components/shared/StatusBadge";
import { SoftAlertToast } from "../components/shared/SoftAlertToast";
import { AdminButton } from "../components/shared/AdminButton";
import { PasswordConfirmModal } from "../components/shared/Modal";
import { useViewport } from "../hooks/useViewport";
import { getBarcodeProjects, resolveActiveProjectId } from "../services/barcodeGenerationService";
import { getSubjectsForProject } from "../services/projectSubjectService";
import { formatDoseDisplayLabel, getPeriodLabel } from "../utils/visitDisplay";
import { getSiteRandomizationNumber } from "../utils/participantDisplay";
import { fetchReviewSites, fetchReviewVisits, reviewActivitiesApi } from "../features/review/api/reviewApi";
import { validatePassword } from "../features/auth/api/authApi";
import { isSiteUserProfile } from "../constants/profileCodes";
import { getSubjectVisitsForReview } from "../services/workflowService";
import {
  DEFAULT_REVIEW_STATUS_FILTER,
  VISIBLE_REVIEW_STATUSES,
} from "../features/review/constants/reviewStatusFilters.js";
import { isActivityMappingCrfVisible } from "../features/visitCrfMapping/visitCrfMappingConfig.js";
import { useProjectSettings } from "../context/ProjectSettingsContext.jsx";
import { listVisitCrfFillRows } from "../features/visitCrfMapping/api/visitCrfMappingApi.js";
import { formatAuditOffsetDisplay, formatAuditUtc } from "../shared/audit/auditDisplayUtils";

function getSiteCodeFromSubjectNumber(subjectNumber) {
  const match = String(subjectNumber ?? "").match(/^(\d{4}-\d{2}-\d{3})/);
  return match?.[1] ?? "";
}

function hasRandomizationNumber(value) {
  return Boolean(String(value ?? "").trim());
}

function normalizeReviewStatus(value) {
  const status = String(value ?? "").trim();
  if (!status) return "Pending";
  if (/^pending(\s+review)?$/i.test(status)) return "In Progress";
  return status;
}

function formatTimepointsReviewed(reviewed, total) {
  const done = Number(reviewed) || 0;
  const all = Number(total) || 0;
  if (all <= 0 && done <= 0) return "—";
  // Show configured dose timepoint total as the denominator.
  return `${done} / ${all > 0 ? all : done}`;
}

function formatPeriodLabel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^period\s+\d+/i.test(raw)) return raw.replace(/^period\s+/i, "Period ");
  const num = raw.match(/\d+/)?.[0];
  return num ? `Period ${num}` : raw;
}

function displayOrDash(value) {
  const text = String(value ?? "").trim();
  return text || "—";
}

function visitCrfRowKey(row) {
  return `${row.appVisitCrfMappingNo}-${row.activityExecutionHdrNo || "row"}-${row.subjectMstNo}`;
}

function isVisitCrfReviewable(row) {
  const hdrNo = Number(row?.activityExecutionHdrNo) || 0;
  if (hdrNo <= 0) return false;
  const status = String(row?.status || "").trim().toLowerCase();
  if (status !== "completed") return false;
  const reviewStatus = String(row?.reviewStatus || "").trim().toLowerCase();
  if (reviewStatus === "reviewed") return false;
  if (String(row?.reviewedBy || "").trim()) return false;
  // Raised queries (openQueriesCount includes raised/sendback) block review.
  if ((Number(row?.openQueriesCount) || 0) > 0) return false;
  return true;
}

function ReviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isMobileOrTablet } = useViewport();
  const { user, sites: authSites, activeSite } = useAuth();
  const { showActivityMappingCrf } = useProjectSettings();
  const showActivityCrfTab = isActivityMappingCrfVisible() && showActivityMappingCrf;
  const { state } = useLab();
  const authProjectCode = user?.project?.trim() || "";
  const isSiteUser = useMemo(() => isSiteUserProfile(user?.profileCode), [user?.profileCode]);
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
  const projectSubjects = useMemo(() => getSubjectsForProject(state, projectId), [state, projectId]);
  const projectCodeToUse = authProjectCode || projectId;

  const siteFromQuery = String(searchParams.get("site") ?? "").trim();
  const tabFromQuery = String(searchParams.get("tab") ?? "").trim().toLowerCase();
  const initialReviewTab = tabFromQuery === "activity-crf" ? "activity-crf" : "timepoint";

  // Visit summary card filters (independent of Activity CRF card).
  const [visitFilterParticipant, setVisitFilterParticipant] = useState("");
  const [visitFilterPeriod, setVisitFilterPeriod] = useState("");
  const [visitFilterStatus, setVisitFilterStatus] = useState(DEFAULT_REVIEW_STATUS_FILTER);
  // Activity CRF card filters (independent of visit summary card).
  const [crfFilterParticipant, setCrfFilterParticipant] = useState("");
  const [crfFilterStatus, setCrfFilterStatus] = useState("");
  const [apiSites, setApiSites] = useState([]);
  const [apiVisits, setApiVisits] = useState([]);
  const [apiBusy, setApiBusy] = useState(false);
  const [visitCrfRows, setVisitCrfRows] = useState([]);
  const [visitCrfBusy, setVisitCrfBusy] = useState(false);
  const [selectedCrfHdrNos, setSelectedCrfHdrNos] = useState([]);
  const [pendingCrfReview, setPendingCrfReview] = useState(false);
  const [crfReviewBusy, setCrfReviewBusy] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    // Always restore default visit status filter when returning to the list.
    setVisitFilterStatus(DEFAULT_REVIEW_STATUS_FILTER);
  }, [location.key]);

  useEffect(() => {
    if (!location.state?.statusOverrides) return;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: {} });
  }, [location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    if (state.isNative) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchReviewSites({ projectId: projectCodeToUse });
        if (!cancelled) setApiSites(list);
      } catch (err) {
        console.error("Failed to fetch review sites", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectCodeToUse, state.isNative]);

  const siteOptions = useMemo(() => {
    // Login / header site is fixed for every profile (same as Participants).
    if (loginSite) return [loginSite];
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
    loginSite,
    project?.code,
    projectSubjects,
    apiSites,
    state.isNative,
  ]);

  const siteLocked = Boolean(loginSite) || isSiteUser || siteOptions.length <= 1;
  const singleSite = siteOptions.length === 1 ? siteOptions[0] : "";
  const firstSite = siteOptions[0] || "";
  // URL is the only mutable source of truth for site (avoids selectedSite ↔ URL loops).
  // Always resolve to one site when options exist so the list can load on open.
  const selectedSite =
    loginSite
    || (siteFromQuery && siteOptions.includes(siteFromQuery) ? siteFromQuery : "")
    || singleSite
    || firstSite;

  // Keep URL aligned: login/single site, or first available site when list opens with none selected.
  useEffect(() => {
    const forcedSite = loginSite || singleSite || (!siteFromQuery ? firstSite : "");
    if (!forcedSite) return;
    if (siteFromQuery === forcedSite) return;
    // If query site is invalid for current options, replace with a valid one.
    if (siteFromQuery && siteOptions.includes(siteFromQuery) && !loginSite && !singleSite) {
      return;
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("site", forcedSite);
        return next;
      },
      { replace: true }
    );
  }, [loginSite, singleSite, firstSite, siteFromQuery, siteOptions, setSearchParams]);

  useEffect(() => {
    if (state.isNative) return;
    if (!selectedSite) {
      setApiVisits([]);
      setApiBusy(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setApiBusy(true);
        const list = await fetchReviewVisits({
          projectId: projectCodeToUse,
          siteCode: selectedSite,
        });
        if (!cancelled) setApiVisits(list);
      } catch (err) {
        console.error("Failed to fetch review visits", err);
        if (!cancelled) setApiVisits([]);
      } finally {
        if (!cancelled) setApiBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSite, projectCodeToUse, state.isNative]);

  useEffect(() => {
    if (!showActivityCrfTab || state.isNative) {
      setVisitCrfRows([]);
      setSelectedCrfHdrNos([]);
      return;
    }
    if (!selectedSite) {
      setVisitCrfRows([]);
      setSelectedCrfHdrNos([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setVisitCrfBusy(true);
        const rows = await listVisitCrfFillRows({ siteCode: selectedSite });
        if (cancelled) return;
        const allowed = (Array.isArray(rows) ? rows : []).filter((r) => {
          const status = String(r.status || "").trim().toLowerCase();
          return status === "draft" || status === "completed";
        });
        setVisitCrfRows(allowed);
        setSelectedCrfHdrNos([]);
      } catch (err) {
        console.error("Failed to load visit CRF rows for review list", err);
        if (!cancelled) {
          setVisitCrfRows([]);
          setSelectedCrfHdrNos([]);
        }
      } finally {
        if (!cancelled) setVisitCrfBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSite, state.isNative, showActivityCrfTab]);

  const reloadVisitCrfRows = useCallback(async () => {
    if (!showActivityCrfTab || state.isNative || !selectedSite) {
      setVisitCrfRows([]);
      return;
    }
    try {
      setVisitCrfBusy(true);
      const rows = await listVisitCrfFillRows({ siteCode: selectedSite });
      const allowed = (Array.isArray(rows) ? rows : []).filter((r) => {
        const status = String(r.status || "").trim().toLowerCase();
        return status === "draft" || status === "completed";
      });
      setVisitCrfRows(allowed);
      setSelectedCrfHdrNos([]);
    } catch (err) {
      console.error("Failed to reload visit CRF rows for review list", err);
      setToast({ message: err?.message || "Failed to reload Activity CRF records.", variant: "error" });
    } finally {
      setVisitCrfBusy(false);
    }
  }, [selectedSite, state.isNative, showActivityCrfTab]);

  const summaryRows = useMemo(() => {
    if (!selectedSite) return [];

    if (!state.isNative) {
      return apiVisits
        .filter((visit) => hasRandomizationNumber(visit.subjectNumber))
        .filter((visit) => VISIBLE_REVIEW_STATUSES.has(normalizeReviewStatus(visit.reviewStatus)))
        .map((visit) => ({
          id: String(visit.visitTrackerNo),
          visitTrackerNo: visit.visitTrackerNo,
          subjectMstNo: String(visit.subjectMstNo),
          participant: String(visit.subjectNumber ?? "").trim(),
          visit: displayOrDash(visit.visitLabel || visit.periodLabel || formatPeriodLabel(visit.period)),
          dose: formatDoseDisplayLabel(visit.doseLabel ?? visit.visitName),
          period: formatPeriodLabel(visit.periodLabel || visit.period),
          reviewStatus: normalizeReviewStatus(visit.reviewStatus),
          timepointsReviewed: formatTimepointsReviewed(visit.timepointsReviewed, visit.timepointsTotal),
          openQueriesCount: Number(visit.openQueriesCount) || 0,
        }));
    }

    const subjectsAtSite = projectSubjects.filter((subject) => {
      if (getSiteCodeFromSubjectNumber(subject.subjectNumber) !== selectedSite) return false;
      return hasRandomizationNumber(getSiteRandomizationNumber(subject));
    });

    return subjectsAtSite.flatMap((subject) => {
      const visits = getSubjectVisitsForReview(state, subject.id);
      return visits
        .filter((visit) => VISIBLE_REVIEW_STATUSES.has(normalizeReviewStatus(visit.reviewStatus)))
        .map((visit) => ({
          id: String(visit.id),
          visitTrackerNo: visit.id,
          subjectMstNo: String(subject.id),
          participant: getSiteRandomizationNumber(subject),
          visit: displayOrDash(visit.visitLabel || getPeriodLabel(visit) || formatPeriodLabel(visit.period)),
          dose: formatDoseDisplayLabel(visit.doseLabel ?? visit.dose),
          period: formatPeriodLabel(getPeriodLabel(visit) ?? visit.period),
          reviewStatus: normalizeReviewStatus(visit.reviewStatus),
          timepointsReviewed: formatTimepointsReviewed(visit.timepointsReviewed, visit.timepointsTotal),
          openQueriesCount: Number(visit.openQueriesCount) || 0,
        }));
    });
  }, [apiVisits, projectSubjects, selectedSite, state, state.isNative]);

  const visitParticipantFilterOptions = useMemo(() => {
    const values = [...new Set(summaryRows.map((row) => row.participant).filter(Boolean))].sort();
    return values.map((value) => ({ value, label: value }));
  }, [summaryRows]);

  const visitPeriodFilterOptions = useMemo(() => {
    const values = [...new Set(summaryRows.map((row) => row.period).filter(Boolean))].sort((a, b) => {
      const aNum = Number(String(a).match(/\d+/)?.[0] ?? 0);
      const bNum = Number(String(b).match(/\d+/)?.[0] ?? 0);
      return aNum - bNum || String(a).localeCompare(String(b));
    });
    return values.map((value) => ({ value, label: value }));
  }, [summaryRows]);

  const visitStatusFilterOptions = useMemo(() => {
    const values = [...new Set(summaryRows.map((row) => row.reviewStatus).filter(Boolean))].sort();
    return values.map((value) => ({ value, label: value }));
  }, [summaryRows]);

  const crfParticipantFilterOptions = useMemo(() => {
    const values = [
      ...new Set(
        visitCrfRows
          .map((row) => String(row.siteRandomizationNo || row.subjectId || "").trim())
          .filter(Boolean)
      ),
    ].sort();
    return values.map((value) => ({ value, label: value }));
  }, [visitCrfRows]);

  const crfStatusFilterOptions = useMemo(() => {
    const values = [
      ...new Set(
        visitCrfRows.map((row) => {
          const reviewStatus = String(row.reviewStatus || "").trim();
          if (reviewStatus.toLowerCase() === "reviewed") return "Reviewed";
          return String(row.status || "").trim();
        }).filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b));
    return values.map((value) => ({ value, label: value }));
  }, [visitCrfRows]);

  const filteredRows = useMemo(() => {
    return summaryRows.filter((row) => {
      if (visitFilterParticipant && row.participant !== visitFilterParticipant) return false;
      if (visitFilterPeriod && row.period !== visitFilterPeriod) return false;
      if (visitFilterStatus && row.reviewStatus !== visitFilterStatus) return false;
      return true;
    });
  }, [summaryRows, visitFilterParticipant, visitFilterPeriod, visitFilterStatus]);

  const filteredVisitCrfRows = useMemo(() => {
    if (!showActivityCrfTab) return [];
    return visitCrfRows.filter((row) => {
      const participant = String(row.siteRandomizationNo || row.subjectId || "").trim();
      const reviewStatus = String(row.reviewStatus || "").trim();
      const displayStatus =
        reviewStatus.toLowerCase() === "reviewed"
          ? "Reviewed"
          : String(row.status || "").trim();
      if (crfFilterParticipant && participant !== crfFilterParticipant) return false;
      if (crfFilterStatus && displayStatus !== crfFilterStatus) return false;
      return true;
    });
  }, [visitCrfRows, crfFilterParticipant, crfFilterStatus, showActivityCrfTab]);

  const selectableCrfHdrNos = useMemo(
    () => filteredVisitCrfRows.filter(isVisitCrfReviewable).map((row) => Number(row.activityExecutionHdrNo)),
    [filteredVisitCrfRows]
  );

  useEffect(() => {
    setSelectedCrfHdrNos((current) =>
      current.filter((id) => selectableCrfHdrNos.includes(id))
    );
  }, [selectableCrfHdrNos]);

  const allSelectableCrfChecked =
    selectableCrfHdrNos.length > 0
    && selectableCrfHdrNos.every((id) => selectedCrfHdrNos.includes(id));

  const crfReviewPasswordDetails = useMemo(() => {
    if (!pendingCrfReview) return undefined;
    return [
      { label: "Site", value: selectedSite || "—" },
      { label: "Records Selected", value: String(selectedCrfHdrNos.length) },
    ];
  }, [pendingCrfReview, selectedSite, selectedCrfHdrNos.length]);

  const handleToggleCrfSelection = useCallback((hdrNo) => {
    const id = Number(hdrNo) || 0;
    if (id <= 0) return;
    setSelectedCrfHdrNos((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  }, []);

  const handleToggleCrfSelectAll = useCallback((checked) => {
    if (!checked) {
      setSelectedCrfHdrNos([]);
      return;
    }
    setSelectedCrfHdrNos([...selectableCrfHdrNos]);
  }, [selectableCrfHdrNos]);

  const handleRequestCrfBulkReview = useCallback(() => {
    if (!selectedCrfHdrNos.length || crfReviewBusy || visitCrfBusy) return;
    setPendingCrfReview(true);
  }, [selectedCrfHdrNos.length, crfReviewBusy, visitCrfBusy]);

  const handleCrfReviewPasswordConfirmed = useCallback(async () => {
    if (!selectedCrfHdrNos.length) return;
    setPendingCrfReview(false);
    try {
      setCrfReviewBusy(true);
      const res = await reviewActivitiesApi(selectedCrfHdrNos);
      setToast({
        message: res?.message || `${selectedCrfHdrNos.length} CRF record(s) reviewed successfully.`,
        variant: "success",
      });
      await reloadVisitCrfRows();
    } catch (err) {
      setToast({
        message: err?.response?.data?.message || err?.message || "Failed to review CRF records.",
        variant: "error",
      });
    } finally {
      setCrfReviewBusy(false);
    }
  }, [selectedCrfHdrNos, reloadVisitCrfRows]);

  const openVisitCrf = (row) => {
    const subjectMstNo = Number(row.subjectMstNo) || 0;
    const appVisitCrfMappingNo = Number(row.appVisitCrfMappingNo) || 0;
    const hdrNo = Number(row.activityExecutionHdrNo) || 0;
    if (subjectMstNo <= 0 || appVisitCrfMappingNo <= 0) {
      setToast({ message: "Invalid CRF record.", variant: "error" });
      return;
    }
    if (hdrNo <= 0) {
      setToast({ message: "No filled CRF found to open for this record.", variant: "error" });
      return;
    }

    const returnParams = new URLSearchParams(location.search || "");
    returnParams.set("tab", "activity-crf");
    if (selectedSite) returnParams.set("site", selectedSite);
    const returnTo = `${location.pathname}?${returnParams.toString()}`;
    navigate(`/review/crf/${subjectMstNo}/${appVisitCrfMappingNo}?hdr=${hdrNo}`, {
      state: {
        siteRandomizationNo: row.siteRandomizationNo,
        subjectLabel: row.siteRandomizationNo || row.subjectId,
        visitLabel: row.visitLabel,
        activityName: row.activityName,
        siteNo: row.siteNo,
        crfName: row.crfName,
        isRepeat: row.isRepeat === true,
        studyVisitScheduleNo: row.studyVisitScheduleNo,
        fromReview: true,
        returnTo,
      },
    });
  };

  const handleSiteChange = (nextSite) => {
    if (siteLocked) return;
    const normalized = String(nextSite ?? "").trim();
    // Always keep one site selected on the list page.
    if (!normalized || normalized === siteFromQuery) return;
    if (!siteOptions.includes(normalized)) return;

    setVisitFilterParticipant("");
    setVisitFilterPeriod("");
    setVisitFilterStatus(DEFAULT_REVIEW_STATUS_FILTER);
    setCrfFilterParticipant("");
    setCrfFilterStatus("");
    setSelectedCrfHdrNos([]);
    if (!state.isNative) setApiVisits([]);
    setVisitCrfRows([]);

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("site", normalized);
        return next;
      },
      { replace: true }
    );
  };

  const openReviewDetail = (row) => {
    const params = new URLSearchParams({
      site: selectedSite,
      subject: row.subjectMstNo,
      participant: row.participant,
      dose: row.dose,
    });
    navigate(`/review/${encodeURIComponent(row.visitTrackerNo)}?${params.toString()}`);
  };

  const [activeTab, setActiveTab] = useState(initialReviewTab);

  useEffect(() => {
    const nextTab = tabFromQuery === "activity-crf" ? "activity-crf" : "timepoint";
    setActiveTab((prev) => (prev === nextTab ? prev : nextTab));
  }, [tabFromQuery]);

  const handleReviewTabChange = useCallback((nextTab) => {
    const normalized = nextTab === "activity-crf" ? "activity-crf" : "timepoint";
    setActiveTab(normalized);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (normalized === "activity-crf") next.set("tab", "activity-crf");
        else next.delete("tab");
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  if (isMobileOrTablet) {
    return <Navigate to="/execute" replace />;
  }

  return (
    <div className="admin-wrap admin-wrap--review">
      <SoftAlertToast
        title={toast?.variant === "error" ? "Error" : "Success"}
        message={toast?.message}
        variant={toast?.variant ?? "success"}
        onClose={() => setToast(null)}
      />

      <div className="admin-card admin-card--review-table review-page-card review-page-tabs">
        {showActivityCrfTab ? (
          <div className="review-page-tabs__nav" role="tablist" aria-label="Review sections">
            <button
              type="button"
              role="tab"
              id="review-tab-timepoint"
              aria-selected={activeTab === "timepoint"}
              aria-controls="review-panel-timepoint"
              className={`review-page-tabs__tab${activeTab === "timepoint" ? " review-page-tabs__tab--active" : ""}`}
              onClick={() => handleReviewTabChange("timepoint")}
            >
              <span>Review Timepoint</span>
              <span className="review-detail-section-card__count">{filteredRows.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="review-tab-activity-crf"
              aria-selected={activeTab === "activity-crf"}
              aria-controls="review-panel-activity-crf"
              className={`review-page-tabs__tab${activeTab === "activity-crf" ? " review-page-tabs__tab--active" : ""}`}
              onClick={() => handleReviewTabChange("activity-crf")}
            >
              <span>Review Activity CRF</span>
              <span className="review-detail-section-card__count">{filteredVisitCrfRows.length}</span>
            </button>
          </div>
        ) : (
          <div className="review-page-tabs__heading">
            <h3 className="review-detail-section-card__title">Review Timepoint</h3>
            <span className="review-detail-section-card__count">{filteredRows.length}</span>
          </div>
        )}

        {activeTab === "timepoint" || !showActivityCrfTab ? (
          <div
            className="review-page-tabs__panel"
            role="tabpanel"
            id="review-panel-timepoint"
            aria-labelledby={showActivityCrfTab ? "review-tab-timepoint" : undefined}
          >
            <div className="review-page-card__filters" role="group" aria-label="Timepoint filters">
              <label className="field field--inline review-page-card__filter-field">
                <span>Site</span>
                <ScrollableSelect
                  ariaLabel="Select site for Timepoint"
                  value={selectedSite}
                  onChange={handleSiteChange}
                  allowEmpty={false}
                  placeholder="Select site"
                  disabled={siteLocked || siteOptions.length === 0}
                  options={siteOptions.map((site) => ({ value: site, label: site }))}
                />
              </label>

              {selectedSite ? (
                <>
                  <label className="field field--inline review-page-card__filter-field">
                    <span>Participant</span>
                    <ScrollableSelect
                      ariaLabel="Filter Timepoint participant"
                      value={visitFilterParticipant}
                      onChange={setVisitFilterParticipant}
                      allowEmpty
                      placeholder="All participants"
                      options={visitParticipantFilterOptions}
                    />
                  </label>
                  <label className="field field--inline review-page-card__filter-field">
                    <span>Period</span>
                    <ScrollableSelect
                      ariaLabel="Filter Timepoint period"
                      value={visitFilterPeriod}
                      onChange={setVisitFilterPeriod}
                      allowEmpty
                      placeholder="All periods"
                      options={visitPeriodFilterOptions}
                    />
                  </label>
                  <label className="field field--inline review-page-card__filter-field">
                    <span>Status</span>
                    <ScrollableSelect
                      ariaLabel="Filter Timepoint status"
                      value={visitFilterStatus}
                      onChange={setVisitFilterStatus}
                      allowEmpty
                      placeholder="All statuses"
                      options={visitStatusFilterOptions}
                    />
                  </label>
                </>
              ) : null}
            </div>

            {!selectedSite ? (
              <p className="empty-state">Select a site to view review records.</p>
            ) : apiBusy ? (
              <p className="empty-state">Loading review records…</p>
            ) : filteredRows.length === 0 ? (
              <p className="empty-state">No review records found for the selected filters.</p>
            ) : (
              <div className="admin-table-wrapper admin-table-wrapper--scroll review-summary-table-wrap">
                <table className="admin-table review-summary-table">
                  <thead className="admin-thead">
                    <tr>
                      <th className="admin-th">Participant</th>
                      <th className="admin-th">Visit</th>
                      <th className="admin-th">Dose</th>
                      <th className="admin-th">Status</th>
                      <th className="admin-th">Timepoint Reviewed</th>
                      <th className="admin-th">Query Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => (
                      <tr
                        key={row.id}
                        className="admin-tr review-summary-table__row"
                        onClick={() => openReviewDetail(row)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openReviewDetail(row);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                      >
                        <td className="admin-td">{row.participant}</td>
                        <td className="admin-td">{row.visit}</td>
                        <td className="admin-td">{row.dose}</td>
                        <td className="admin-td">
                          <StatusBadge status={row.reviewStatus} />
                        </td>
                        <td className="admin-td">{row.timepointsReviewed}</td>
                        <td className="admin-td">{row.openQueriesCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        {showActivityCrfTab && activeTab === "activity-crf" ? (
          <div
            className="review-page-tabs__panel"
            role="tabpanel"
            id="review-panel-activity-crf"
            aria-labelledby="review-tab-activity-crf"
          >
            <div className="review-page-card__filters" role="group" aria-label="Activity CRF filters">
              <label className="field field--inline review-page-card__filter-field">
                <span>Site</span>
                <ScrollableSelect
                  ariaLabel="Select site for Activity CRF"
                  value={selectedSite}
                  onChange={handleSiteChange}
                  allowEmpty={false}
                  placeholder="Select site"
                  disabled={siteLocked || siteOptions.length === 0}
                  options={siteOptions.map((site) => ({ value: site, label: site }))}
                />
              </label>
              {selectedSite ? (
                <>
                  <label className="field field--inline review-page-card__filter-field">
                    <span>Participant</span>
                    <ScrollableSelect
                      ariaLabel="Filter Activity CRF participant"
                      value={crfFilterParticipant}
                      onChange={setCrfFilterParticipant}
                      allowEmpty
                      placeholder="All participants"
                      options={crfParticipantFilterOptions}
                    />
                  </label>
                  <label className="field field--inline review-page-card__filter-field">
                    <span>Status</span>
                    <ScrollableSelect
                      ariaLabel="Filter Activity CRF status"
                      value={crfFilterStatus}
                      onChange={setCrfFilterStatus}
                      allowEmpty
                      placeholder="All statuses"
                      options={crfStatusFilterOptions}
                    />
                  </label>
                </>
              ) : null}
              <div className="review-page-card__filters-actions">
                <AdminButton
                  variant="primary"
                  disabled={!selectedCrfHdrNos.length || crfReviewBusy || visitCrfBusy}
                  onClick={handleRequestCrfBulkReview}
                >
                  {crfReviewBusy ? "Reviewing..." : "Review"}
                </AdminButton>
              </div>
            </div>
            {!selectedSite ? (
              <p className="empty-state">Select a site to view Activity CRF records.</p>
            ) : visitCrfBusy ? (
              <p className="empty-state">Loading CRF records…</p>
            ) : filteredVisitCrfRows.length === 0 ? (
              <p className="empty-state">No draft or completed CRF records for the selected filters.</p>
            ) : (
              <div className="admin-table-wrapper admin-table-wrapper--scroll review-summary-table-wrap">
                <table className="admin-table review-summary-table">
                  <thead className="admin-thead">
                    <tr>
                      <th className="admin-th admin-th--check">
                        <input
                          type="checkbox"
                          aria-label="Select all reviewable Activity CRFs"
                          checked={allSelectableCrfChecked}
                          disabled={!selectableCrfHdrNos.length || crfReviewBusy}
                          onChange={(event) => handleToggleCrfSelectAll(event.target.checked)}
                        />
                      </th>
                      <th className="admin-th">Participant</th>
                      <th className="admin-th">Visit</th>
                      <th className="admin-th">Activity</th>
                      <th className="admin-th">Status</th>
                      <th className="admin-th">Reviewed By</th>
                      <th className="admin-th">Reviewed On (UTC)</th>
                      <th className="admin-th">Reviewed On Offset</th>
                      <th className="admin-th">Query</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVisitCrfRows.map((row) => {
                      const status = String(row.status || "").trim() || "Pending";
                      const reviewStatus = String(row.reviewStatus || "").trim();
                      const displayStatus =
                        reviewStatus.toLowerCase() === "reviewed" ? "Reviewed" : status;
                      const openQueries = Number(row.openQueriesCount) || 0;
                      const version = Number(row.repeatVersion) || 0;
                      const activityLabel = String(row.activityName || "").trim() || "—";
                      const activityWithRepeat = version > 0
                        ? `${activityLabel} · ${version}`
                        : activityLabel;
                      const hdrNo = Number(row.activityExecutionHdrNo) || 0;
                      const reviewable = isVisitCrfReviewable(row);
                      const selected = reviewable && selectedCrfHdrNos.includes(hdrNo);
                      return (
                        <tr
                          key={visitCrfRowKey(row)}
                          className="admin-tr review-summary-table__row"
                          onClick={() => openVisitCrf(row)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openVisitCrf(row);
                            }
                          }}
                          tabIndex={0}
                          role="button"
                        >
                          <td
                            className="admin-td admin-td--check"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              aria-label={`Select ${row.activityName || "Activity CRF"}`}
                              checked={selected}
                              disabled={!reviewable || crfReviewBusy}
                              onChange={() => handleToggleCrfSelection(hdrNo)}
                            />
                          </td>
                          <td className="admin-td">{row.siteRandomizationNo || row.subjectId || "—"}</td>
                          <td className="admin-td">{row.visitLabel || "—"}</td>
                          <td className="admin-td">{activityWithRepeat}</td>
                          <td className="admin-td">
                            <StatusBadge status={displayStatus} />
                          </td>
                          <td className="admin-td">{displayOrDash(row.reviewedBy)}</td>
                          <td className="admin-td">{formatAuditUtc(row.reviewedOn) || "—"}</td>
                          <td className="admin-td">{formatAuditOffsetDisplay(row.reviewedOffset) || "—"}</td>
                          <td className="admin-td">
                            {openQueries > 0 ? (
                              <span
                                className="activity-fill-query-pill activity-fill-query-pill--open"
                                title={`${openQueries} open quer${openQueries === 1 ? "y" : "ies"}`}
                              >
                                <i className="fas fa-question-circle" aria-hidden />
                                <span>{openQueries}</span>
                              </span>
                            ) : (
                              <span className="activity-fill-query-pill activity-fill-query-pill--none" title="No open queries">
                                0
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <PasswordConfirmModal
        open={pendingCrfReview}
        title="Confirm Review"
        message="Please enter your password to mark the selected Activity CRF records as reviewed. This action will be recorded in the audit trail."
        details={crfReviewPasswordDetails}
        confirmLabel="Verify & Review"
        onValidatePassword={validatePassword}
        onClose={() => setPendingCrfReview(false)}
        onConfirm={handleCrfReviewPasswordConfirmed}
      />
    </div>
  );
}

export default ReviewPage;
