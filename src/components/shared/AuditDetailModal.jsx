import { useEffect, useState } from "react";
import { AdminButton } from "./AdminButton.jsx";
import { useViewport } from "../../hooks/useViewport";
import { formatAuditOffsetDisplay } from "../../shared/audit/auditDisplayUtils";
import {
  formatAuditOffset,
  formatAuditPerformedBy,
  formatAuditUtc,
  getReviewQueryAuditFieldLabel,
  getReviewQueryAuditStageKey,
  getReviewQueryAuditStageLabel,
  resolveReasonEntry
} from "../../services/activityAuditService";

function AuditDetailModal({
  open,
  onClose,
  rows = [],
  fallbackRow = null,
  type = "actual",
  allEntries = [],
  activity = null,
  fieldLabel = ""
}) {
  const { isMobileOrTablet } = useViewport();
  const [page, setPage] = useState(1);
  const pageSize = isMobileOrTablet ? 5 : 10;
  const isQueryAudit = type === "query";

  useEffect(() => {
    if (open) setPage(1);
  }, [open, rows, type, activity?.id, isMobileOrTablet]);

  if (!open) return null;

  const displayRows = rows.length ? rows : fallbackRow ? [fallbackRow] : [];
  const pageCount = Math.max(1, Math.ceil(displayRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const startIndex = (safePage - 1) * pageSize;
  const visibleRows = displayRows.slice(startIndex, startIndex + pageSize);

  const resolveLabel = (entry) =>
    isQueryAudit
      ? getReviewQueryAuditFieldLabel(entry, activity, fieldLabel)
      : entry.label ??
        (type === "actual"
          ? `${activity?.timepoint ?? "Activity"} Actual Time`
          : type === "scanStart"
            ? `${activity?.timepoint ?? "Activity"} Centrifuge Start`
            : type === "remark"
              ? `${activity?.timepoint ?? "Activity"} Deviation / Remark`
              : fieldLabel || "CRF Field");

  const resolveOffset = (entry) => {
    const formatted = formatAuditOffsetDisplay(entry?.recordedAtOffset);
    if (formatted && formatted !== "—") return formatted;
    return formatAuditOffset(entry?.timestamp);
  };

  const renderStageValue = (entry) => {
    const stageKey = getReviewQueryAuditStageKey(entry);
    const stageLabel = getReviewQueryAuditStageLabel(entry);
    if (!stageKey) return stageLabel;
    return (
      <span className={`review-query-modal__stage review-query-modal__stage--${stageKey}`}>
        {stageLabel}
      </span>
    );
  };

  const pager = (
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
  );

  const emptyMessage = <p className="admin-audit-empty">No audit entries yet.</p>;

  const mobileBody = (
    <>
      <div className="audit-detail-card-list">
        {visibleRows.map((entry) => {
          const reasonEntry = resolveReasonEntry(type, entry, allEntries);
          const label = resolveLabel(entry);
          const reason = String(entry.reason || reasonEntry?.details || "").trim() || "—";
          const performedBy = formatAuditPerformedBy(entry.user) || "—";
          const when = formatAuditUtc(entry.timestamp);
          const offset = resolveOffset(entry);
          return (
            <article key={entry.id} className="audit-detail-card">
              <dl className="audit-detail-card__meta audit-detail-card__meta--top">
                <div>
                  <dt>Label</dt>
                  <dd>{label}</dd>
                </div>
              </dl>

              {isQueryAudit ? (
                <dl className="audit-detail-card__meta">
                  <div>
                    <dt>Value</dt>
                    <dd>{renderStageValue(entry)}</dd>
                  </div>
                </dl>
              ) : (
                <div className="audit-detail-card__compare">
                  <div className="audit-detail-card__compare-col audit-detail-card__compare-col--old">
                    <span className="audit-detail-card__compare-label">Old value</span>
                    <span className="audit-detail-card__compare-value">
                      {String(entry.oldValue || "").trim() || "—"}
                    </span>
                  </div>
                  <div className="audit-detail-card__compare-col audit-detail-card__compare-col--new">
                    <span className="audit-detail-card__compare-label">New value</span>
                    <span className="audit-detail-card__compare-value">
                      {String(entry.newValue || entry.details || "").trim() || "—"}
                    </span>
                  </div>
                </div>
              )}

              <dl className="audit-detail-card__meta">
                <div>
                  <dt>Reason</dt>
                  <dd>{reason}</dd>
                </div>
                <div>
                  <dt>Performed By</dt>
                  <dd>{performedBy}</dd>
                </div>
                <div>
                  <dt>Performed On (UTC)</dt>
                  <dd>{when}</dd>
                </div>
                <div>
                  <dt>Performed On (Offset)</dt>
                  <dd>{offset}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
      {pager}
    </>
  );

  const desktopBody = (
    <>
      <div className="audit-detail-table-wrap admin-audit-table-wrap">
        <table className="audit-detail-table">
          <thead>
            <tr>
              <th>Label</th>
              {isQueryAudit ? (
                <th>Value</th>
              ) : (
                <>
                  <th>Old value</th>
                  <th>New value</th>
                </>
              )}
              <th>Reason</th>
              <th>Performed By</th>
              <th>Performed On (UTC)</th>
              <th>Performed On (Offset)</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((entry) => {
              const reasonEntry = resolveReasonEntry(type, entry, allEntries);
              const label = resolveLabel(entry);
              return (
                <tr key={entry.id}>
                  <td data-label="Label">{label}</td>
                  {isQueryAudit ? (
                    <td data-label="Value">{renderStageValue(entry)}</td>
                  ) : (
                    <>
                      <td data-label="Old value">{entry.oldValue || ""}</td>
                      <td data-label="New value">{entry.newValue || entry.details || ""}</td>
                    </>
                  )}
                  <td data-label="Reason">{entry.reason || reasonEntry?.details || ""}</td>
                  <td data-label="Performed By">{formatAuditPerformedBy(entry.user)}</td>
                  <td data-label="Performed On (UTC)">{formatAuditUtc(entry.timestamp)}</td>
                  <td data-label="Performed On (Offset)">{resolveOffset(entry)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pager}
    </>
  );

  return (
    <div className="admin-reason-modal-backdrop" role="presentation">
      <div
        className="admin-reason-modal admin-reason-modal--wide admin-reason-modal--audit"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-detail-modal-title"
      >
        <div className="admin-reason-modal-title" id="audit-detail-modal-title">
          {isQueryAudit ? "Query Audit Detail" : "Audit Detail"}
        </div>
        <div className="admin-audit-modal__body">
          {displayRows.length === 0
            ? emptyMessage
            : isMobileOrTablet
              ? mobileBody
              : desktopBody}
        </div>
        <div className="admin-reason-actions admin-reason-actions--center">
          <AdminButton type="button" variant="secondary" onClick={onClose}>
            Close
          </AdminButton>
        </div>
      </div>
    </div>
  );
}

export { AuditDetailModal };
