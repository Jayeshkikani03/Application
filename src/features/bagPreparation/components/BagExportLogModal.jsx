import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ConfigDataTable } from "../../../components/shared/ConfigDataTable";
import { ExportLogCards } from "../../../components/shared/ExportLogCards";
import { ScrollableSelect } from "../../../components/shared/ScrollableSelect";
import { useViewport } from "../../../hooks/useViewport";

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

function formatBody(body) {
  if (!body) return "";
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return String(body);
  }
}

function logMatchesBag(row, bagPreparationNo, bagBarcode) {
  const bagNo = Number(bagPreparationNo) || 0;
  const nos = Array.isArray(row?.bagPreparationNos) ? row.bagPreparationNos.map(Number) : [];
  if (bagNo > 0 && nos.includes(bagNo)) return true;

  const barcode = String(bagBarcode || "").trim().toLowerCase();
  if (!barcode) return bagNo <= 0;

  const names = String(row?.bagNames || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return names.includes(barcode) || names.some((name) => name.includes(barcode));
}

/**
 * Bag Export Log modal.
 * - Common (all logs): pass no bag filter.
 * - Respective (one bag): pass filterBagPreparationNo / filterBagBarcode.
 * Mobile/tablet always uses audit-style cards.
 */
export function BagExportLogModal({
  open,
  onClose,
  logs = [],
  loading = false,
  exportingId = null,
  onExport,
  title = "Dispatch Audit",
  filterBagPreparationNo = null,
  filterBagBarcode = null,
  showFilters = false,
}) {
  const { isMobileOrTablet } = useViewport();
  const [viewRow, setViewRow] = useState(null);
  const [participantFilter, setParticipantFilter] = useState("");

  const isRowScoped = Boolean(filterBagPreparationNo || filterBagBarcode);

  useEffect(() => {
    if (!open) {
      setViewRow(null);
      setParticipantFilter("");
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const scopedLogs = useMemo(() => {
    if (!isRowScoped) return logs ?? [];
    return (logs ?? []).filter((row) =>
      logMatchesBag(row, filterBagPreparationNo, filterBagBarcode)
    );
  }, [logs, isRowScoped, filterBagPreparationNo, filterBagBarcode]);

  const participantOptions = useMemo(() => {
    const names = new Set();
    for (const row of scopedLogs) {
      String(row.participantNames || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((name) => names.add(name));
    }
    return [...names]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((name) => ({ value: name, label: name }));
  }, [scopedLogs]);

  const rows = useMemo(() => {
    let list = scopedLogs;
    if (participantFilter && !isRowScoped) {
      const wanted = participantFilter.toLowerCase();
      list = list.filter((row) =>
        String(row.participantNames || "")
          .toLowerCase()
          .split(",")
          .map((p) => p.trim())
          .includes(wanted)
      );
    }
    return list.map((row, index) => ({ ...row, _rowNo: index + 1 }));
  }, [scopedLogs, participantFilter, isRowScoped]);

  const columns = useMemo(
    () => [
      {
        key: "id",
        label: "Id",
        align: "center",
        render: (row) => <span title={String(row.id)}>{row.id}</span>,
      },
      {
        key: "bagNames",
        label: "Bag barcode",
        render: (row) => (
          <span className="config-data-table__truncate" title={row.bagNames}>
            {row.bagNames || "—"}
          </span>
        ),
        searchValue: (row) => row.bagNames ?? "",
      },
      {
        key: "status",
        label: "Status",
        align: "center",
        render: (row) => {
          const ok = String(row.status || "").toLowerCase() === "success";
          return (
            <span
              className={`status-badge status-badge--compact ${ok ? "status--completed" : "status--inactive"}`}
            >
              {row.status || "—"}
            </span>
          );
        },
        searchValue: (row) => row.status ?? "",
      },
      {
        key: "performedBy",
        label: "Performed By",
        render: (row) => (
          <span className="config-data-table__truncate" title={row.performedBy || ""}>
            {row.performedBy || "—"}
          </span>
        ),
        searchValue: (row) => row.performedBy ?? "",
      },
      {
        key: "performedOnUtc",
        label: "Performed On (UTC)",
        align: "center",
        render: (row) => {
          const text = formatUtc(row.performedOnUtc);
          return <span title={text}>{text}</span>;
        },
        searchValue: (row) => formatUtc(row.performedOnUtc),
      },
      {
        key: "offset",
        label: "Performed On (Offset)",
        align: "center",
        render: (row) => formatOffset(row.offset),
        searchValue: (row) => formatOffset(row.offset),
      },
      {
        key: "actions",
        label: "Actions",
        align: "center",
        stopRowClick: true,
        render: (row) => {
          const busy = exportingId === row.id;
          const canExport = Array.isArray(row.bagPreparationNos) && row.bagPreparationNos.length > 0;
          return (
            <span className="activity-config-table__actions">
              <button
                type="button"
                className="btn btn--sm btn--secondary"
                onClick={() => setViewRow(row)}
                disabled={busy}
              >
                View
              </button>
              <button
                type="button"
                className="btn btn--sm btn--primary"
                onClick={() => onExport?.(row)}
                disabled={busy || !canExport || loading}
                title={canExport ? "Re-export and update this log" : "No bag numbers available for re-export"}
              >
                {busy ? "Exporting…" : "Export"}
              </button>
            </span>
          );
        },
      },
    ],
    [exportingId, loading, onExport]
  );

  const filterBar = showFilters && !isRowScoped ? (
    <div className="export-log-filter-bar">
      <label className="export-log-filter-bar__field">
        <span className="config-data-table__search-label">Participant</span>
        <ScrollableSelect
          value={participantFilter}
          onChange={setParticipantFilter}
          options={participantOptions}
          placeholder={participantOptions.length > 0 ? "All participants" : "No participants"}
          allowEmpty
          searchable
          disabled={participantOptions.length === 0}
          ariaLabel="Filter by participant"
        />
      </label>
    </div>
  ) : null;

  const emptyMessage = isRowScoped
    ? `No export logs for ${filterBagBarcode || "this bag"} yet.`
    : "No bag exports yet. Dispatch a prepared bag to create an export log.";

  const bodyContent = loading ? (
    <p className="admin-audit-empty">Loading export log…</p>
  ) : isMobileOrTablet ? (
    <>
      {filterBar}
      <ExportLogCards
        rows={rows}
        loading={false}
        emptyMessage={emptyMessage}
        nameLabel="Bag barcode"
        getName={(row) => row.bagNames}
        canExport={(row) => Array.isArray(row.bagPreparationNos) && row.bagPreparationNos.length > 0}
        exportingId={exportingId}
        onView={setViewRow}
        onExport={onExport}
        showView={false}
        searchPlaceholder="Search export log..."
      />
    </>
  ) : (
    <>
      {filterBar}
      <ConfigDataTable
        columns={columns}
        rows={rows}
        emptyMessage={emptyMessage}
        variant="exportLog"
        getRowKey={(row) => row.id ?? row._rowNo}
        searchable={rows.length > 1}
        paginated
        searchPlaceholder="Search export log..."
        defaultPageSize={10}
      />
    </>
  );

  const modalTitle = isRowScoped
    ? `${title} — ${filterBagBarcode || `Bag #${filterBagPreparationNo}`}`
    : title;

  const viewBodyModal = viewRow ? (
    <div
      className={isMobileOrTablet ? "admin-reason-modal-backdrop" : "modal-backdrop modal-backdrop--stack"}
      role="presentation"
      style={isMobileOrTablet ? { zIndex: 130 } : undefined}
    >
      <div
        className={
          isMobileOrTablet
            ? "admin-reason-modal admin-reason-modal--wide admin-reason-modal--audit"
            : "modal timepoint-export-body-modal"
        }
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bag-export-body-title"
      >
        {isMobileOrTablet ? (
          <div className="admin-reason-modal-title" id="bag-export-body-title">
            Export body — {viewRow.bagNames || `Log #${viewRow.id}`}
          </div>
        ) : (
          <div className="barcode-preview-modal__head">
            <h3 className="modal__title" id="bag-export-body-title">
              Export body — {viewRow.bagNames || `Log #${viewRow.id}`}
            </h3>
            <button type="button" className="btn btn--ghost" onClick={() => setViewRow(null)}>
              Close
            </button>
          </div>
        )}
        <div className={isMobileOrTablet ? "admin-audit-modal__body" : "modal__body"}>
          {viewRow.message ? (
            <p className="pdf-import-grid__hint" style={{ marginBottom: "0.75rem" }}>
              {viewRow.message}
            </p>
          ) : null}
          <pre
            className="code-block"
            style={{
              margin: 0,
              maxHeight: isMobileOrTablet ? "55dvh" : "60vh",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: "0.8rem",
            }}
          >
            {formatBody(viewRow.body) || "—"}
          </pre>
        </div>
        {isMobileOrTablet ? (
          <div className="admin-reason-actions admin-reason-actions--center">
            <button type="button" className="btn btn--secondary" onClick={() => setViewRow(null)}>
              Close
            </button>
          </div>
        ) : null}
      </div>
    </div>
  ) : null;

  if (!open) return null;

  if (isMobileOrTablet) {
    return createPortal(
      <>
        <div className="admin-reason-modal-backdrop" role="presentation">
          <div
            className="admin-reason-modal admin-reason-modal--wide admin-reason-modal--audit export-log-modal--audit"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="bag-export-log-title"
          >
            <div className="admin-reason-modal-title" id="bag-export-log-title">
              {modalTitle}
            </div>
            <div className="admin-audit-modal__body">{bodyContent}</div>
            <div className="admin-reason-actions admin-reason-actions--center">
              <button type="button" className="btn btn--secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>
        {viewBodyModal}
      </>,
      document.body
    );
  }

  return createPortal(
    <>
      <div className="modal-backdrop" role="presentation">
        <div
          className="modal modal--wide timepoint-export-log-modal"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="bag-export-log-title"
        >
          <div className="barcode-preview-modal__head">
            <h3 className="modal__title" id="bag-export-log-title">
              {modalTitle}
            </h3>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onClose}
              aria-label="Close export log"
            >
              Close
            </button>
          </div>
          <div className="modal__body">{bodyContent}</div>
        </div>
      </div>
      {viewBodyModal}
    </>,
    document.body
  );
}
