import { useEffect, useMemo, useState } from "react";

function formatUtc(value) {
  if (!value) return "—";
  const raw = String(value).trim();
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/
  );
  if (match) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${match[3]}-${months[Number(match[2]) - 1] || match[2]}-${match[1]} ${match[4]}:${match[5]}`;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function formatOffset(value) {
  const text = String(value ?? "").trim();
  if (!text) return "—";
  const match = text.match(/^([+-]\d{2}:\d{2})(?::\d{2})?$/);
  return match ? match[1] : text;
}

/**
 * Audit-style card list for Export Log on mobile / tablet.
 */
export function ExportLogCards({
  rows = [],
  loading = false,
  emptyMessage = "No export logs yet.",
  nameLabel = "Name",
  getName,
  canExport,
  exportingId = null,
  busy = false,
  onView,
  onExport,
  searchPlaceholder = "Search export log...",
  pageSize = 5,
  /** When false (modal / row Export Log), show all cards with no Prev/Next footer. */
  paginated = false,
  listClassName = "",
  /** Hide View on bag Dispatch Audit mobile/tablet cards. */
  showView = true,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => {
      const name = String(getName?.(row) ?? "").toLowerCase();
      const status = String(row.status ?? "").toLowerCase();
      const by = String(row.performedBy ?? "").toLowerCase();
      const id = String(row.id ?? "");
      const utc = formatUtc(row.performedOnUtc).toLowerCase();
      const offset = formatOffset(row.offset).toLowerCase();
      return (
        id.includes(query)
        || name.includes(query)
        || status.includes(query)
        || by.includes(query)
        || utc.includes(query)
        || offset.includes(query)
      );
    });
  }, [rows, searchQuery, getName]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, rows, pageSize, paginated]);

  if (loading) {
    return <p className="admin-audit-empty">Loading export log…</p>;
  }

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / Math.max(1, pageSize)));
  const safePage = Math.min(page, pageCount);
  const startIndex = (safePage - 1) * pageSize;
  const visibleRows = paginated
    ? filteredRows.slice(startIndex, startIndex + pageSize)
    : filteredRows;
  const showSearch = rows.length > 1;
  const showPager = paginated && filteredRows.length > 0;

  return (
    <>
      {showSearch ? (
        <label className="export-log-cards__search">
          <span className="config-data-table__search-label">Search</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
        </label>
      ) : null}

      {filteredRows.length === 0 ? (
        <p className="admin-audit-empty">
          {searchQuery.trim() ? "No matching records found." : emptyMessage}
        </p>
      ) : (
        <div className={`audit-detail-card-list export-log-cards__list${listClassName ? ` ${listClassName}` : ""}`}>
          {visibleRows.map((row) => {
            const name = String(getName?.(row) ?? "").trim() || "—";
            const ok = String(row.status || "").toLowerCase() === "success";
            const exportEnabled = canExport?.(row) !== false;
            const rowBusy = exportingId === row.id;
            return (
              <article key={row.id ?? row._rowNo} className="audit-detail-card">
                <dl className="audit-detail-card__meta audit-detail-card__meta--top">
                  <div>
                    <dt>{nameLabel}</dt>
                    <dd>{name}</dd>
                  </div>
                </dl>

                <dl className="audit-detail-card__meta">
                  <div>
                    <dt>Id</dt>
                    <dd>{row.id ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <span
                        className={`status-badge status-badge--compact ${ok ? "status--completed" : "status--inactive"}`}
                      >
                        {row.status || "—"}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Performed By</dt>
                    <dd>{String(row.performedBy || "").trim() || "—"}</dd>
                  </div>
                  <div>
                    <dt>Performed On (UTC)</dt>
                    <dd>{formatUtc(row.performedOnUtc)}</dd>
                  </div>
                  <div>
                    <dt>Performed On (Offset)</dt>
                    <dd>{formatOffset(row.offset)}</dd>
                  </div>
                </dl>

                <div
                  className={`export-log-card__actions${showView ? "" : " export-log-card__actions--single"}`}
                >
                  {showView ? (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => onView?.(row)}
                      disabled={rowBusy || busy}
                    >
                      View
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => onExport?.(row)}
                    disabled={rowBusy || busy || !exportEnabled}
                    title={exportEnabled ? "Re-export and update this log" : "No items available for re-export"}
                  >
                    {rowBusy ? "Exporting…" : "Export"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {showPager ? (
        <div className="audit-detail-footer admin-audit-table-footer">
          <div className="audit-detail-pager">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={safePage <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Prev
            </button>
            <span>
              {safePage} / {pageCount}
            </span>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={safePage >= pageCount}
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export { formatUtc as formatExportLogUtc, formatOffset as formatExportLogOffset };
