import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AdminButton } from "@/components/shared/AdminButton";
import { ScrollableSelect } from "@/components/shared/ScrollableSelect";
import { useAuth } from "@/context/AuthContext.jsx";
import { formatDate } from "@/shared/format.js";
import { getProjectSites } from "@/shared/api/projectMasterApi.js";
import { fetchSubjectsList, importSubjectsFromPrms } from "../api/participantsApi.js";

export default function ParticipantsPage() {
  const navigate = useNavigate();
  const { user, activeSite } = useAuth();
  const authProject = String(user?.project || "").trim();
  const authSite = String(activeSite || user?.site || "").trim();
  const [subjects, setSubjects] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [prmsImporting, setPrmsImporting] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const initialSitePrmsKeyRef = useRef("");

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [subjectRows, siteRows] = await Promise.all([fetchSubjectsList(), getProjectSites()]);
      setSubjects(Array.isArray(subjectRows) ? subjectRows : []);
      setSites(Array.isArray(siteRows) ? siteRows : []);
    } catch (err) {
      setLoadError(err?.message || "Failed to load participants");
      setSubjects([]);
      setSites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, authProject, authSite]);

  /** Silent PRMS refresh for the selected site — errors are not shown in the UI. */
  const runPrmsImport = useCallback(
    async (siteCodeForImport) => {
      const siteCode = String(siteCodeForImport || "").trim();
      if (!siteCode) return;

      setPrmsImporting(true);
      try {
        const projectCode = String(user?.project || "").trim();
        await importSubjectsFromPrms({ siteCode, projectCode: projectCode || undefined });
        await reload();
      } catch {
        // Login-time import is primary; page refresh failures stay silent.
      } finally {
        setPrmsImporting(false);
      }
    },
    [reload, user?.project],
  );

  const handleSiteFilterChange = useCallback(
    (next) => {
      setSiteFilter(next);
      const code = String(next || "").trim();
      if (!code) return;
      void runPrmsImport(code);
    },
    [runPrmsImport],
  );

  useEffect(() => {
    if (!sites.length) return;

    const validCodes = sites
      .map((s) => String(s.siteCode || "").trim())
      .filter(Boolean);
    if (!validCodes.length) return;

    const current = String(siteFilter || "").trim();
    if (current && validCodes.includes(current)) return;

    const preferred =
      (authSite && validCodes.find((c) => c.toLowerCase() === authSite.toLowerCase())) ||
      validCodes[0];
    setSiteFilter(preferred);

    const key = `default:${preferred}`;
    if (initialSitePrmsKeyRef.current === key) return;
    initialSitePrmsKeyRef.current = key;
    void runPrmsImport(preferred);
  }, [sites, siteFilter, runPrmsImport, authSite]);

  const filtered = useMemo(() => {
    // Participants list: only subjects with a randomization number.
    let list = subjects.filter((s) => String(s.randomizationNo || "").trim().length > 0);
    if (siteFilter) list = list.filter((s) => (s.siteCode || s.siteNo || "") === siteFilter);
    if (statusFilter) {
      const q = statusFilter.toLowerCase();
      list = list.filter((s) => String(s.patientStatus || "").toLowerCase().includes(q));
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (s) =>
          String(s.mySubjectNo || "").toLowerCase().includes(q) ||
          String(s.subjectId || "").toLowerCase().includes(q) ||
          String(s.initials || "").toLowerCase().includes(q) ||
          String(s.randomizationNo || "").toLowerCase().includes(q) ||
          String(s.siteRandomizationNo || "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [subjects, siteFilter, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filtered.length);
  const paginatedRows = useMemo(() => {
    return filtered.slice(startIndex, startIndex + pageSize);
  }, [filtered, startIndex, pageSize]);

  useEffect(() => { setPage(1); }, [siteFilter, statusFilter, search, pageSize]);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const siteOptions = useMemo(() => {
    if (!sites.length) return [];
    return sites.map((s) => ({ value: s.siteCode || "", label: s.siteCode || "—" }));
  }, [sites]);

  if (loading) {
    return (
      <div className="admin-wrap admin-wrap--participants">
        <div className="admin-spinner" style={{ padding: "2rem" }}>Loading participants…</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="admin-wrap admin-wrap--participants">
        <div className="admin-card admin-error-card">
          <div className="admin-error-title">Failed to load</div>
          <div className="admin-error-msg">{loadError}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-wrap admin-wrap--participants">
      <div className="admin-card admin-card--participants-table">
        <div className="admin-table-toolbar">
          <div className="participants-toolbar__filters">
            <ScrollableSelect
              value={siteFilter}
              onChange={handleSiteFilterChange}
              options={siteOptions}
              placeholder="Select site"
              allowEmpty={false}
              disabled={Boolean(authSite) || sites.length <= 1 || prmsImporting}
              className="participants-toolbar__site-select"
              searchable
              ariaLabel="Filter by site"
            />
            <input
              type="text"
              className="admin-search-input participants-toolbar__search"
              placeholder="Search by subject no., ID, initials, randomization no., site randomization no.…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <input
              type="text"
              className="admin-input participants-toolbar__status"
              placeholder="Filter status (PRMS)"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              title="Filter by patient status text from PRMS"
            />
          </div>
        </div>

        <div className="admin-table-wrapper admin-table-wrapper--scroll">
          <table className="admin-table">
            <thead className="admin-thead">
              <tr>
                <th className="admin-th">Site</th>
                <th className="admin-th">Screening No</th>
                <th className="admin-th">Initials</th>
                <th className="admin-th">DOB</th>
                <th className="admin-th">Gender</th>
                <th className="admin-th">Status</th>
                <th className="admin-th">Randomized</th>
                <th className="admin-th">Randomization No.</th>
                <th className="admin-th">Site Randomization No.</th>
                <th className="admin-th" style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRows.length > 0 ? (
                paginatedRows.map((sub) => (
                  <tr key={sub.subjectMstNo} className="admin-tr admin-tr--active">
                    <td className="admin-td">{sub.siteCode || sub.siteNo || "—"}</td>
                    <td className="admin-td" style={{ fontWeight: 600 }}>{sub.mySubjectNo || sub.subjectId || "—"}</td>
                    <td className="admin-td">{sub.initials || "—"}</td>
                    <td className="admin-td">{formatDate(sub.dob)}</td>
                    <td className="admin-td">{sub.gender || "—"}</td>
                    <td className="admin-td">
                      <span className="admin-pill admin-pill--active">{String(sub.patientStatus || "—")}</span>
                    </td>
                    <td className="admin-td">{formatDate(sub.randomizationDate)}</td>
                    <td className="admin-td">{String(sub.randomizationNo || "").trim() || "—"}</td>
                    <td className="admin-td">{String(sub.siteRandomizationNo || "").trim() || "—"}</td>
                    <td className="admin-td admin-td--actions">
                      <AdminButton
                        type="button"
                        variant="primary"
                        className="btn--sm"
                        onClick={() => navigate(`/subjects/${encodeURIComponent(sub.subjectMstNo)}`)}
                      >
                        <i className="fas fa-eye" /> View
                      </AdminButton>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", padding: "2rem", color: "#94a3b8" }}>
                    No participants found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="config-data-table__pagination participants-table__pagination">
          <div className="config-data-table__pagination-meta">
            <span>
              Showing {filtered.length === 0 ? 0 : startIndex + 1}–{endIndex} of {filtered.length}
            </span>
            <label className="config-data-table__page-size">
              <ScrollableSelect
                className="scrollable-select--compact"
                value={pageSize}
                onChange={(nextValue) => setPageSize(Number(nextValue))}
                options={[
                  { value: 10, label: "10 / page" },
                  { value: 20, label: "20 / page" },
                  { value: 50, label: "50 / page" },
                ]}
                allowEmpty={false}
                ariaLabel="Rows per page"
              />
            </label>
          </div>
          <div className="config-data-table__pager">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={safePage <= 1 || filtered.length === 0}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Prev
            </button>
            <span>{safePage} / {totalPages}</span>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={safePage >= totalPages || filtered.length === 0}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
