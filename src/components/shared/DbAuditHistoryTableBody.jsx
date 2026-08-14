import { useEffect, useMemo, useState } from "react";
import { getAuditFieldHistory, getAuditFieldHistoryBatch } from "@/shared/api/auditApi.js";
import {
  formatAuditOffsetDisplay,
  formatAuditUtc,
  mapAuditApiRows,
  toAuditDisplayRow,
} from "@/shared/audit/auditDisplayUtils.js";
import { useViewport } from "@/hooks/useViewport.js";

function EditAuditDetailTableBody({ rows, emptyMessage = "No audit entries yet." }) {
  const { isMobileOrTablet } = useViewport();
  const [page, setPage] = useState(1);
  const pageSize = isMobileOrTablet ? 5 : 10;

  useEffect(() => {
    setPage(1);
  }, [rows, isMobileOrTablet]);

  if (!rows?.length) {
    return <p className="admin-audit-empty">{emptyMessage}</p>;
  }

  const displayRows = rows.map(toAuditDisplayRow);
  const pageCount = Math.max(1, Math.ceil(displayRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const startIndex = (safePage - 1) * pageSize;
  const visibleRows = displayRows.slice(startIndex, startIndex + pageSize);

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

  if (isMobileOrTablet) {
    return (
      <>
        <div className="audit-detail-card-list">
          {visibleRows.map((row) => {
            const field = row.label || "—";
            const oldValue = String(row.oldValue || "").trim() || "—";
            const newValue = String(row.newValue || "").trim() || "—";
            const when = formatAuditUtc(row.at);
            const offset = formatAuditOffsetDisplay(row.recordedAtOffset);
            const performedBy = String(row.performedBy || "").trim() || "—";
            const reason = String(row.reason || "").trim();
            return (
              <article key={row.id} className="audit-detail-card">
                <dl className="audit-detail-card__meta audit-detail-card__meta--top">
                  <div>
                    <dt>Label</dt>
                    <dd>{field}</dd>
                  </div>
                </dl>

                <div className="audit-detail-card__compare">
                  <div className="audit-detail-card__compare-col audit-detail-card__compare-col--old">
                    <span className="audit-detail-card__compare-label">Old value</span>
                    <span className="audit-detail-card__compare-value">{oldValue}</span>
                  </div>
                  <div className="audit-detail-card__compare-col audit-detail-card__compare-col--new">
                    <span className="audit-detail-card__compare-label">New value</span>
                    <span className="audit-detail-card__compare-value">{newValue}</span>
                  </div>
                </div>

                <dl className="audit-detail-card__meta">
                  <div>
                    <dt>Reason</dt>
                    <dd>{reason || "—"}</dd>
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
  }

  return (
    <>
      <div className="audit-detail-table-wrap admin-audit-table-wrap">
        <table className="audit-detail-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Old value</th>
              <th>New value</th>
              <th>Reason</th>
              <th>Performed By</th>
              <th>Performed On (UTC)</th>
              <th>Performed On (Offset)</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id}>
                <td data-label="Label">{row.label}</td>
                <td data-label="Old value">{row.oldValue}</td>
                <td data-label="New value">{row.newValue}</td>
                <td data-label="Reason">{row.reason}</td>
                <td data-label="Performed By">{row.performedBy}</td>
                <td data-label="Performed On (UTC)">{formatAuditUtc(row.at)}</td>
                <td data-label="Performed On (Offset)">
                  {formatAuditOffsetDisplay(row.recordedAtOffset)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pager}
    </>
  );
}

/**
 * Server field-level audit viewer.
 *
 * **Batch:** pass `auditBatchTargets` — `{ tableName, recordId, fieldNames? }[]`.
 * **Single:** pass `tableName`, `recordId`, optional `fieldName` (DB column name).
 */
export function DbAuditHistoryTableBody({
  emptyMessage = "No audit entries yet.",
  auditBatchTargets,
  tableName,
  fieldName,
  recordId,
  allowedFieldNames,
  excludedFieldNames,
  customLabel,
  labelByRecordId,
  valueMap,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const useBatch = Array.isArray(auditBatchTargets) && auditBatchTargets.length > 0;
  const useDirect = Boolean(
    !useBatch &&
    tableName != null && String(tableName).trim() &&
    recordId != null && String(recordId).trim()
  );

  const batchKey = useBatch
    ? JSON.stringify(
        auditBatchTargets.map((target) => ({
          tableName: target.tableName,
          recordId: target.recordId,
          fieldNames: target.fieldNames,
        })),
      )
    : "";

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError("");
      try {
        let result;
        if (useBatch) {
          result = await getAuditFieldHistoryBatch(auditBatchTargets);
        } else if (useDirect) {
          result = await getAuditFieldHistory({ tableName, recordId, fieldName });
        } else {
          result = [];
        }
        if (!cancelled) {
          setRows(mapAuditApiRows(result));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || "Could not load audit history");
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [useBatch, batchKey, useDirect, tableName, recordId, fieldName, auditBatchTargets]);

  const displayRows = useMemo(() => {
    let list = rows;
    if (Array.isArray(allowedFieldNames) && allowedFieldNames.length > 0) {
      const allowed = new Set(allowedFieldNames.map((name) => String(name).toLowerCase()));
      list = list.filter((row) => allowed.has(String(row.field ?? "").toLowerCase()));
    }
    if (Array.isArray(excludedFieldNames) && excludedFieldNames.length > 0) {
      const excluded = new Set(excludedFieldNames.map((name) => String(name).toLowerCase()));
      list = list.filter((row) => !excluded.has(String(row.field ?? "").toLowerCase()));
    }
    if (labelByRecordId && typeof labelByRecordId === "object") {
      list = list.map((row) => {
        const id = String(row.recordId ?? "").trim();
        const mapped = id ? labelByRecordId[id] : null;
        return mapped
          ? { ...row, fieldLabel: mapped, tableName: "" }
          : row;
      });
    } else if (customLabel) {
      list = list.map((row) => ({ ...row, fieldLabel: customLabel, tableName: "" }));
    }
    if (valueMap && typeof valueMap === "object") {
      const resolveValue = (raw) => {
        const key = String(raw ?? "").trim();
        if (!key) return raw;
        if (valueMap[key] != null && String(valueMap[key]).trim()) return valueMap[key];
        return raw;
      };
      list = list.map((row) => ({
        ...row,
        oldValue: resolveValue(row.oldValue),
        newValue: resolveValue(row.newValue),
      }));
    }
    return list;
  }, [rows, allowedFieldNames, excludedFieldNames, customLabel, labelByRecordId, valueMap]);

  if (loading) {
    return <p className="admin-audit-empty">Loading audit history…</p>;
  }

  if (error) {
    return <p className="admin-audit-empty admin-audit-empty--error">{error}</p>;
  }

  return <EditAuditDetailTableBody rows={displayRows} emptyMessage={emptyMessage} />;
}
