import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ConfigDataTable } from "../../../components/shared/ConfigDataTable";
import { ExportLogCards } from "../../../components/shared/ExportLogCards";
import { MultiSelectDropdown } from "../../../components/shared/MultiSelectDropdown.jsx";
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

export function TimepointExportLogModal({
  open,
  onClose,
  logs = [],
  loading = false,
  exportingId = null,
  onExport,
  publishedDoses = [],
  exportingNew = false,
  onExportNew,
}) {
  const { isMobileOrTablet } = useViewport();
  const [viewRow, setViewRow] = useState(null);
  const [selectedDoseNos, setSelectedDoseNos] = useState([]);

  useEffect(() => {
    if (!open) {
      setViewRow(null);
      setSelectedDoseNos([]);
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const publishedOptions = useMemo(
    () =>
      (publishedDoses ?? []).map((dose) => ({
        value: String(dose.doseNo),
        label: dose.label || `Dose ${dose.doseNo}`,
      })),
    [publishedDoses]
  );

  useEffect(() => {
    setSelectedDoseNos((prev) => {
      if (prev.length === 0) return prev;
      const valid = new Set(publishedOptions.map((option) => option.value));
      const next = prev.filter((value) => valid.has(value));
      return next.length === prev.length ? prev : next;
    });
  }, [publishedOptions]);

  const toggleDose = (value) => {
    setSelectedDoseNos((prev) => (
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    ));
  };

  const rows = useMemo(
    () => (logs ?? []).map((row, index) => ({ ...row, _rowNo: index + 1 })),
    [logs]
  );

  const columns = useMemo(
    () => [
      {
        key: "id",
        label: "Id",
        align: "center",
        render: (row) => <span title={String(row.id)}>{row.id}</span>,
      },
      {
        key: "doseNames",
        label: "Name of dose",
        render: (row) => (
          <span className="config-data-table__truncate" title={row.doseNames}>
            {row.doseNames || "—"}
          </span>
        ),
        searchValue: (row) => row.doseNames ?? "",
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
          const canExport = Array.isArray(row.doseNos) && row.doseNos.length > 0;
          return (
            <span className="activity-config-table__actions">
              <button
                type="button"
                className="btn btn--sm btn--secondary"
                onClick={() => setViewRow(row)}
                disabled={busy || exportingNew}
              >
                View
              </button>
              <button
                type="button"
                className="btn btn--sm btn--primary"
                onClick={() => onExport?.(row)}
                disabled={busy || !canExport || loading || exportingNew}
                title={canExport ? "Re-export and update this log" : "No dose numbers available for re-export"}
              >
                {busy ? "Exporting…" : "Export"}
              </button>
            </span>
          );
        },
      },
    ],
    [exportingId, exportingNew, loading, onExport]
  );

  const handleNewExport = () => {
    const doseNos = selectedDoseNos
      .map((value) => Number(value))
      .filter((doseNo) => doseNo > 0);
    if (doseNos.length === 0) return;
    onExportNew?.(doseNos);
  };

  const exportBar = (
    <div className="timepoint-export-log-modal__export-bar">
      <label className="timepoint-export-log-modal__dose-field">
        <span className="config-data-table__search-label">Published dose</span>
        <MultiSelectDropdown
          label="Published doses"
          options={publishedOptions}
          selectedValues={selectedDoseNos}
          onChange={toggleDose}
          onSelectAll={() => {
            if (exportingNew || publishedOptions.length === 0) return;
            setSelectedDoseNos(publishedOptions.map((option) => option.value));
          }}
          onClear={() => {
            if (exportingNew) return;
            setSelectedDoseNos([]);
          }}
          placeholder={
            publishedOptions.length > 0
              ? "Select published dose(s)..."
              : "No published doses"
          }
          disabled={exportingNew || publishedOptions.length === 0}
          getOptionLabel={(option) => option.label}
          getOptionValue={(option) => option.value}
        />
      </label>
      <button
        type="button"
        className="btn btn--primary timepoint-export-log-modal__export-new-btn"
        onClick={handleNewExport}
        disabled={
          exportingNew
          || selectedDoseNos.length === 0
          || publishedOptions.length === 0
          || exportingId != null
        }
      >
        {exportingNew ? "Exporting…" : "Export"}
      </button>
    </div>
  );

  const bodyContent = loading ? (
    <p className="admin-audit-empty">Loading export log…</p>
  ) : isMobileOrTablet ? (
    <ExportLogCards
      rows={rows}
      loading={false}
      emptyMessage="No timepoint exports yet. Publish a dose or export from the dropdown above."
      nameLabel="Name of dose"
      getName={(row) => row.doseNames}
      canExport={(row) => Array.isArray(row.doseNos) && row.doseNos.length > 0}
      exportingId={exportingId}
      busy={exportingNew}
      onView={setViewRow}
      onExport={onExport}
      searchPlaceholder="Search export log..."
    />
  ) : (
    <ConfigDataTable
      columns={columns}
      rows={rows}
      emptyMessage="No timepoint exports yet. Publish a dose or export from the dropdown above."
      variant="exportLog"
      getRowKey={(row) => row.id ?? row._rowNo}
      searchable={rows.length > 1}
      paginated
      searchPlaceholder="Search export log..."
      defaultPageSize={10}
    />
  );

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
        aria-labelledby="timepoint-export-body-title"
      >
        {isMobileOrTablet ? (
          <div className="admin-reason-modal-title" id="timepoint-export-body-title">
            Export body — {viewRow.doseNames || `Log #${viewRow.id}`}
          </div>
        ) : (
          <div className="barcode-preview-modal__head">
            <h3 className="modal__title" id="timepoint-export-body-title">
              Export body — {viewRow.doseNames || `Log #${viewRow.id}`}
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
            aria-labelledby="timepoint-export-log-title"
          >
            <div className="admin-reason-modal-title" id="timepoint-export-log-title">
              Export Log
            </div>
            <div className="admin-audit-modal__body">
              {exportBar}
              {bodyContent}
            </div>
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
          aria-labelledby="timepoint-export-log-title"
        >
          <div className="barcode-preview-modal__head">
            <h3 className="modal__title" id="timepoint-export-log-title">
              Export Log
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
          <div className="modal__body">
            {exportBar}
            {bodyContent}
          </div>
        </div>
      </div>
      {viewBodyModal}
    </>,
    document.body
  );
}
