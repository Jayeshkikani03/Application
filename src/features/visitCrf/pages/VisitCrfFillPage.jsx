import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConfigDataTable } from "@/components/shared/ConfigDataTable";
import { SoftAlertToast } from "@/components/shared/SoftAlertToast";
import { AdminButton } from "@/components/shared/AdminButton";
import { ScrollableSelect } from "@/components/shared/ScrollableSelect";
import { useAuth } from "@/context/AuthContext";
import { shouldShowSiteInHeader } from "@/constants/profileCodes";
import { fetchReviewSites } from "@/features/review/api/reviewApi";
import { ActivityFillRowMenu } from "@/features/visitCrf/components/ActivityFillRowMenu";
import {
  listVisitCrfFillRows,
  listVisitCrfVisitOptions,
  repeatVisitCrf,
} from "@/features/visitCrfMapping/api/visitCrfMappingApi.js";
import { formatAuditOffsetDisplay, formatAuditUtc } from "@/shared/audit/auditDisplayUtils";

function getFillOpenLabel(status) {
  const s = String(status || "Pending").trim().toLowerCase();
  return s === "pending" || s === "draft" ? "Open" : "View";
}

export default function VisitCrfFillPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const projectId = user?.project?.trim() ?? "";
  const loginSite = user?.site?.trim() ?? "";
  const showSiteFilter = shouldShowSiteInHeader(user) && !loginSite;

  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sites, setSites] = useState([]);
  const [visits, setVisits] = useState([]);
  const [allRows, setAllRows] = useState([]);

  const [siteCode, setSiteCode] = useState(loginSite || "");
  const [subjectMstNo, setSubjectMstNo] = useState("");
  const [studyVisitScheduleNo, setStudyVisitScheduleNo] = useState("");

  const [activityName, setActivityName] = useState("");
  const [repeatingKey, setRepeatingKey] = useState(null);

  const showToast = (message, variant = "success") => setToast({ message, variant });

  useEffect(() => {
    if (loginSite) setSiteCode(loginSite);
  }, [loginSite]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [visitRows, siteRows] = await Promise.all([
          listVisitCrfVisitOptions(),
          showSiteFilter && projectId
            ? fetchReviewSites({ projectId })
            : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setVisits(visitRows);
        setSites(
          (Array.isArray(siteRows) ? siteRows : [])
            .map((s) => ({
              value: String(s.siteCode ?? s.SiteCode ?? s.siteNo ?? s.SiteNo ?? "").trim(),
              label: String(s.siteName ?? s.SiteName ?? s.siteCode ?? s.SiteCode ?? "").trim(),
            }))
            .filter((s) => s.value)
        );
      } catch (err) {
        if (!cancelled) {
          showToast(err?.response?.data?.message || err?.message || "Failed to load filters.", "error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, showSiteFilter]);

  const loadRows = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listVisitCrfFillRows({
        siteCode: siteCode || undefined,
        latestOnly: true,
      });
      const randomized = (Array.isArray(data) ? data : []).filter((r) =>
        String(r.siteRandomizationNo ?? "").trim()
      );
      setAllRows(randomized);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Failed to load activity mappings.";
      setError(msg);
      showToast(msg, "error");
      setAllRows([]);
    } finally {
      setLoading(false);
    }
  }, [siteCode]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (!subjectMstNo) return;
    const subNo = Number(subjectMstNo) || 0;
    const stillPresent = allRows.some((r) => r.subjectMstNo === subNo);
    if (!stillPresent) setSubjectMstNo("");
  }, [allRows, subjectMstNo]);

  useEffect(() => {
    if (!studyVisitScheduleNo) return;
    const vNo = Number(studyVisitScheduleNo) || 0;
    const subNo = Number(subjectMstNo) || 0;
    const stillPresent = allRows.some((r) => {
      if (subNo && r.subjectMstNo !== subNo) return false;
      return r.studyVisitScheduleNo === vNo;
    });
    if (!stillPresent) setStudyVisitScheduleNo("");
  }, [allRows, subjectMstNo, studyVisitScheduleNo]);

  useEffect(() => {
    if (!activityName) return;
    const actName = String(activityName).trim();
    const vNo = Number(studyVisitScheduleNo) || 0;
    const subNo = Number(subjectMstNo) || 0;
    const stillPresent = allRows.some((r) => {
      if (subNo && r.subjectMstNo !== subNo) return false;
      if (vNo && r.studyVisitScheduleNo !== vNo) return false;
      return String(r.activityName || "").trim() === actName;
    });
    if (!stillPresent) setActivityName("");
  }, [allRows, subjectMstNo, studyVisitScheduleNo, activityName]);

  const rows = useMemo(() => {
    let result = allRows;
    const subNo = Number(subjectMstNo) || 0;
    if (subNo) {
      result = result.filter((r) => r.subjectMstNo === subNo);
    }
    const visitNo = Number(studyVisitScheduleNo) || 0;
    if (visitNo) {
      result = result.filter((r) => r.studyVisitScheduleNo === visitNo);
    }
    const actName = String(activityName || "").trim();
    if (actName) {
      result = result.filter((r) => String(r.activityName || "").trim() === actName);
    }
    return [...result].sort((a, b) => {
      const timeA = a.performedOnUtc ? new Date(a.performedOnUtc).getTime() : 0;
      const timeB = b.performedOnUtc ? new Date(b.performedOnUtc).getTime() : 0;
      if (timeA !== timeB) {
        return timeB - timeA;
      }
      const subA = String(a.siteRandomizationNo || a.subjectId || "");
      const subB = String(b.siteRandomizationNo || b.subjectId || "");
      const subComp = subA.localeCompare(subB, undefined, { numeric: true });
      if (subComp !== 0) return subComp;
      return (Number(a.appVisitCrfMappingNo) || 0) - (Number(b.appVisitCrfMappingNo) || 0);
    });
  }, [allRows, subjectMstNo, studyVisitScheduleNo, activityName]);

  const siteOptions = useMemo(
    () => sites.map((s) => ({ value: s.value, label: s.label || s.value })),
    [sites]
  );

  const subjectOptions = useMemo(() => {
    const byNo = new Map();
    for (const r of allRows) {
      const no = Number(r.subjectMstNo) || 0;
      if (!no || byNo.has(no)) continue;
      const randomizationNo = String(r.siteRandomizationNo ?? "").trim();
      if (!randomizationNo) continue;
      byNo.set(no, { value: String(no), label: randomizationNo });
    }
    return [...byNo.values()].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" })
    );
  }, [allRows]);

  const visitOptions = useMemo(() => {
    let sourceRows = allRows;
    const subNo = Number(subjectMstNo) || 0;
    if (subNo) {
      sourceRows = sourceRows.filter((r) => r.subjectMstNo === subNo);
    }
    const visitNosInRows = new Set(sourceRows.map((r) => r.studyVisitScheduleNo).filter(Boolean));

    const optionsMap = new Map();
    for (const v of visits) {
      const vNo = Number(v.studyVisitScheduleNo) || 0;
      if (subNo && !visitNosInRows.has(vNo)) continue;
      optionsMap.set(vNo, {
        value: String(vNo),
        label: v.label || `Visit ${vNo}`,
      });
    }
    for (const r of sourceRows) {
      const vNo = Number(r.studyVisitScheduleNo) || 0;
      if (vNo && !optionsMap.has(vNo)) {
        optionsMap.set(vNo, {
          value: String(vNo),
          label: r.visitLabel || `Visit ${vNo}`,
        });
      }
    }
    return [...optionsMap.values()].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" })
    );
  }, [visits, allRows, subjectMstNo]);

  const activityOptions = useMemo(() => {
    let sourceRows = allRows;
    const subNo = Number(subjectMstNo) || 0;
    if (subNo) {
      sourceRows = sourceRows.filter((r) => r.subjectMstNo === subNo);
    }
    const vNo = Number(studyVisitScheduleNo) || 0;
    if (vNo) {
      sourceRows = sourceRows.filter((r) => r.studyVisitScheduleNo === vNo);
    }
    const names = new Set();
    const opts = [];
    for (const r of sourceRows) {
      const name = String(r.activityName ?? "").trim();
      if (name && !names.has(name)) {
        names.add(name);
        opts.push({ value: name, label: name });
      }
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [allRows, subjectMstNo, studyVisitScheduleNo]);

  const handleOpen = (row, { hdrNo } = {}) => {
    const targetHdr = Number(hdrNo) > 0
      ? Number(hdrNo)
      : (!row.isNewFill && row.activityExecutionHdrNo > 0 ? Number(row.activityExecutionHdrNo) : 0);
    const hdrQs = targetHdr > 0 ? `?hdr=${targetHdr}` : "";
    navigate(`/activity-fill/open/${row.subjectMstNo}/${row.appVisitCrfMappingNo}${hdrQs}`, {
      state: {
        siteRandomizationNo: row.siteRandomizationNo,
        subjectLabel: row.siteRandomizationNo || row.subjectId,
        visitLabel: row.visitLabel,
        activityName: row.activityName,
        siteNo: row.siteNo,
        crfName: row.crfName,
        isRepeat: row.isRepeat === true,
        repeatVersion: row.repeatVersion > 0 ? row.repeatVersion : undefined,
      },
    });
  };

  const handleOpenQuery = (row) => {
    const open = Number(row.openQueriesCount) || 0;
    const resolved = Number(row.resolvedQueriesCount) || 0;
    if (open <= 0 && resolved <= 0) return;
    // Open the first-saved version that has queries (not a blank later Repeat).
    const queryHdr = Number(row.queryActivityExecutionHdrNo) || Number(row.activityExecutionHdrNo) || 0;
    handleOpen(row, { hdrNo: queryHdr > 0 ? queryHdr : undefined });
  };

  const handleRepeat = async (row) => {
    const key = `${row.subjectMstNo}-${row.appVisitCrfMappingNo}-${row.activityExecutionHdrNo ?? 0}`;
    if (repeatingKey) return;
    try {
      setRepeatingKey(key);
      const opened = await repeatVisitCrf({
        subjectMstNo: row.subjectMstNo,
        appVisitCrfMappingNo: row.appVisitCrfMappingNo,
        sourceActivityExecutionHdrNo: row.activityExecutionHdrNo,
      });
      const hdrNo = Number(opened?.activityExecutionHdrNo) || 0;
      if (hdrNo <= 0) {
        throw new Error("Repeat did not create a new fill.");
      }
      navigate(`/activity-fill/open/${row.subjectMstNo}/${row.appVisitCrfMappingNo}?hdr=${hdrNo}`, {
        state: {
          siteRandomizationNo: row.siteRandomizationNo,
          subjectLabel: row.siteRandomizationNo || row.subjectId,
          visitLabel: row.visitLabel,
          activityName: row.activityName || opened?.activityName,
          siteNo: row.siteNo,
          crfName: row.crfName || opened?.crfName,
          isRepeat: true,
          repeatVersion: opened?.repeatVersion > 0 ? opened.repeatVersion : undefined,
        },
      });
    } catch (err) {
      showToast(err?.response?.data?.message || err?.message || "Failed to create repeat fill.", "error");
    } finally {
      setRepeatingKey(null);
    }
  };

  const columns = useMemo(
    () => [
      {
        key: "actions",
        label: "Action",
        align: "center",
        cellClassName: (r) => {
          if (Number(r.openQueriesCount) > 0) return "activity-fill-action-cell--raised";
          if (Number(r.resolvedQueriesCount) > 0) return "activity-fill-action-cell--resolved";
          return undefined;
        },
        searchValue: (r) => {
          const open = Number(r.openQueriesCount) || 0;
          const resolved = Number(r.resolvedQueriesCount) || 0;
          const label = getFillOpenLabel(r.status);
          if (open > 0) return `${label} query ${open} raised`;
          if (resolved > 0) return `${label} query ${resolved} resolved`;
          return `${label} no query`;
        },
        render: (r) => {
          const rowKey = `${r.subjectMstNo}-${r.appVisitCrfMappingNo}-${r.activityExecutionHdrNo ?? 0}`;
          return (
            <ActivityFillRowMenu
              openLabel={getFillOpenLabel(r.status)}
              onOpen={() => handleOpen(r)}
              canRepeat={Boolean(r.canRepeat)}
              onRepeat={() => handleRepeat(r)}
              repeating={repeatingKey === rowKey}
              queryCount={Number(r.openQueriesCount) || 0}
              resolvedQueryCount={Number(r.resolvedQueriesCount) || 0}
              onQuery={() => handleOpenQuery(r)}
            />
          );
        },
      },
      {
        key: "siteRandomizationNo",
        label: "Subject",
        searchValue: (r) => `${r.siteRandomizationNo} ${r.subjectId} ${r.siteNo}`,
        render: (r) => (
          <span className="config-data-table__strong">
            {r.siteRandomizationNo || r.subjectId || "—"}
          </span>
        ),
      },
      {
        key: "activityName",
        label: "Activity",
        searchValue: (r) => {
          const name = String(r.activityName ?? "").trim();
          const ver = Number(r.repeatVersion) || 0;
          return ver > 0 ? `${name} ${ver}` : name;
        },
        render: (r) => {
          const name = String(r.activityName || "").trim() || "—";
          const ver = Number(r.repeatVersion) || 0;
          return (
            <span className="config-data-table__strong">
              {ver > 0 ? `${name} \u00B7 ${ver}` : name}
            </span>
          );
        },
      },
      {
        key: "visitLabel",
        label: "Visit",
        searchValue: (r) => r.visitLabel ?? "",
      },
      {
        key: "status",
        label: "Status",
        align: "center",
        searchValue: (r) => r.status ?? "Pending",
        render: (r) => {
          const status = String(r.status || "Pending").trim() || "Pending";
          const completed = status.toLowerCase() === "completed";
          const draft = status.toLowerCase() === "draft";
          const openQueries = Number(r.openQueriesCount) || 0;
          return (
            <span className="activity-fill-status-cell">
              {openQueries > 0 ? (
                <button
                  type="button"
                  className="activity-fill-read-query activity-fill-read-query--open"
                  title={`${openQueries} raised quer${openQueries === 1 ? "y" : "ies"}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleOpenQuery(r);
                  }}
                >
                  Query
                </button>
              ) : null}
              <span className={`status-badge status-badge--compact ${completed ? "status--completed" : draft ? "status--draft" : "status--pending"}`}>
                {status}
              </span>
            </span>
          );
        },
      },
      {
        key: "performedBy",
        label: "Performed By",
        searchValue: (r) => r.performedBy ?? "",
        render: (r) => r.performedBy || "—",
      },
      {
        key: "performedOnUtc",
        label: "Performed On (UTC)",
        searchValue: (r) => formatAuditUtc(r.performedOnUtc),
        render: (r) => formatAuditUtc(r.performedOnUtc),
      },
      {
        key: "recordedAtOffset",
        label: "Performed On (Offset)",
        align: "center",
        searchValue: (r) => formatAuditOffsetDisplay(r.recordedAtOffset),
        render: (r) => formatAuditOffsetDisplay(r.recordedAtOffset),
      },
    ],
    [repeatingKey]
  );

  const toolbarFilters = (
    <div className="activity-fill-toolbar-filters">
      {showSiteFilter ? (
        <div className="activity-fill-toolbar-filters__field">
          <ScrollableSelect
            id="activity-fill-site"
            ariaLabel="Select site"
            value={siteCode}
            onChange={(value) => {
              setSiteCode(String(value ?? ""));
              setSubjectMstNo("");
              setStudyVisitScheduleNo("");
              setActivityName("");
            }}
            options={siteOptions}
            placeholder="All sites"
            allowEmpty
          />
        </div>
      ) : null}
      <div className="activity-fill-toolbar-filters__field">
        <ScrollableSelect
          id="activity-fill-subject"
          ariaLabel="Select subject"
          value={subjectMstNo}
          onChange={(value) => {
            setSubjectMstNo(String(value ?? ""));
            setStudyVisitScheduleNo("");
            setActivityName("");
          }}
          options={subjectOptions}
          placeholder="All subjects"
          allowEmpty
        />
      </div>
      <div className="activity-fill-toolbar-filters__field">
        <ScrollableSelect
          id="activity-fill-visit"
          ariaLabel="Select visit"
          value={studyVisitScheduleNo}
          onChange={(value) => {
            setStudyVisitScheduleNo(String(value ?? ""));
            setActivityName("");
          }}
          options={visitOptions}
          placeholder="All visits"
          allowEmpty
        />
      </div>
      <div className="activity-fill-toolbar-filters__field">
        <ScrollableSelect
          id="activity-fill-activity"
          ariaLabel="Select activity"
          value={activityName}
          onChange={(value) => setActivityName(String(value ?? ""))}
          options={activityOptions}
          placeholder="All activities"
          allowEmpty
        />
      </div>
    </div>
  );

  if (loading && allRows.length === 0 && !error) {
    return (
      <div className="admin-wrap admin-wrap--visit-crf">
        <div className="admin-card admin-spinner">
          <i className="fas fa-spinner fa-spin" style={{ marginRight: "0.5rem" }} /> Loading activity mappings...
        </div>
      </div>
    );
  }

  if (error && allRows.length === 0) {
    return (
      <div className="admin-wrap admin-wrap--visit-crf">
        <div className="admin-card admin-error-card">
          <div className="admin-error-title">Failed to Load Data</div>
          <div className="admin-error-msg">{error}</div>
          <AdminButton variant="primary" style={{ marginTop: "1rem" }} onClick={loadRows}>
            Retry
          </AdminButton>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-wrap admin-wrap--visit-crf">
      <SoftAlertToast
        title={toast?.variant === "error" ? "Error" : toast?.variant === "warning" ? "Warning" : "Success"}
        message={toast?.message}
        variant={toast?.variant ?? "success"}
        onClose={() => setToast(null)}
      />

      <div className="admin-card admin-card--config-table">
        <ConfigDataTable
          columns={columns}
          rows={rows}
          emptyMessage={loading ? "Loading..." : "No activity mappings found for the selected filters."}
          variant="visit-crf"
          getRowKey={(r) => `${r.subjectMstNo}-${r.appVisitCrfMappingNo}-${r.activityExecutionHdrNo ?? "new"}`}
          onRowClick={handleOpen}
          searchable
          searchPlaceholder="Search activity, subject, visit, or CRF..."
          paginated
          defaultPageSize={10}
          toolbarExtra={toolbarFilters}
        />
      </div>
    </div>
  );
}

