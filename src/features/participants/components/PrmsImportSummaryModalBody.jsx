import { useMemo, useState } from "react";
import { formatDate } from "@/shared/format.js";

function formatCellDate(v) {
  if (v == null || v === "") return "—";
  const s = formatDate(v);
  return s && String(s).trim() !== "" ? s : "—";
}

function normalizeChangeType(r) {
  const t = r?.changeType ?? r?.ChangeType;
  return String(t ?? "").trim().toLowerCase();
}

function isSummaryTableRow(r) {
  const t = normalizeChangeType(r);
  return t === "visitinserted" || t === "visitupdated" || t === "newsubject";
}

export function PrmsImportSummaryModalBody({ result }) {
  const rawDetails = result?.changeDetails ?? result?.ChangeDetails;
  const allDetails = Array.isArray(rawDetails) ? rawDetails : [];
  const summaryRows = useMemo(() => allDetails.filter(isSummaryTableRow), [allDetails]);
  const rawWarnings = result?.warnings ?? result?.Warnings;
  const warnings = Array.isArray(rawWarnings) ? rawWarnings : [];

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const totalPages = Math.max(1, Math.ceil(summaryRows.length / pageSize));
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return summaryRows.slice(start, start + pageSize);
  }, [summaryRows, page, pageSize]);

  return (
    <div className="participants-import-summary">
      {warnings.length > 0 ? (
        <div className="participants-import-summary__warnings" role="status">
          {warnings.join(" ")}
        </div>
      ) : null}

      <div className="admin-table-toolbar">
        <div className="admin-page-size-wrapper">
          <span>Show</span>
          <select
            className="admin-page-size-select"
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
          >
            <option value={10}>10 records</option>
            <option value={25}>25 records</option>
            <option value={50}>50 records</option>
            <option value={100}>100 records</option>
          </select>
        </div>
        <span className="participants-import-summary__count">
          {summaryRows.length > 0
            ? `Showing ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, summaryRows.length)} of ${summaryRows.length}`
            : "No changes."}
        </span>
      </div>

      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead className="admin-thead">
            <tr>
              <th className="admin-th">Site</th>
              <th className="admin-th">Screening no.</th>
              <th className="admin-th">Visit</th>
              <th className="admin-th">Status</th>
              <th className="admin-th">Visit date</th>
              <th className="admin-th">Expected date</th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.length > 0 ? (
              paginatedRows.map((r, i) => (
                <tr key={`${normalizeChangeType(r)}-${r.subjectId ?? r.SubjectId}-${String(r.visitName ?? "")}-${i}`} className="admin-tr">
                  <td className="admin-td">{r.siteNo || r.SiteNo || "—"}</td>
                  <td className="admin-td">{r.mySubjectNo || r.MySubjectNo || r.subjectId || r.SubjectId || "—"}</td>
                  <td className="admin-td">
                    {normalizeChangeType(r) === "newsubject" ? "—" : (r.visitName ?? r.VisitName ?? "—")}
                  </td>
                  <td className="admin-td">{r.status ?? r.Status ?? "—"}</td>
                  <td className="admin-td">{formatCellDate(r.visitDate ?? r.VisitDate)}</td>
                  <td className="admin-td">{formatCellDate(r.expectingDate ?? r.ExpectingDate)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: "1.5rem", color: "#94a3b8" }}>
                  No changes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {summaryRows.length > pageSize ? (
        <div className="admin-pagination-wrapper">
          <div className="admin-pagination">
            <button type="button" className="admin-page-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(p - 1, 1))}>
              <i className="fas fa-chevron-left" />
            </button>
            <span className="admin-page-num">Page {page} of {totalPages}</span>
            <button type="button" className="admin-page-btn" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(p + 1, totalPages))}>
              <i className="fas fa-chevron-right" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
