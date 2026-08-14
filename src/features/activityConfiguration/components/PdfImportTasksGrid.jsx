import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ConfigDataTable } from "../../../components/shared/ConfigDataTable";
import { PdfImportMessageModal } from "./PdfImportMessageModal.jsx";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatPerformedOnUtc(value) {
  if (!value) return "—";
  const raw = String(value).trim();
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/
  );
  if (match) {
    return `${match[3]}-${MONTH_SHORT[Number(match[2]) - 1] || match[2]}-${match[1]} ${match[4]}:${match[5]}`;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mmm = MONTH_SHORT[date.getUTCMonth()];
  const yyyy = date.getUTCFullYear();
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${dd}-${mmm}-${yyyy} ${hh}:${mm}`;
}

function rowMessage(row) {
  const error = String(row?.errorMessage || "").trim();
  const result = String(row?.resultMessage || "").trim();
  if (row?.status === "Failed") return error;
  if (result) return result;
  return error;
}

function formatOffset(value) {
  const stored = String(value ?? "").trim();
  if (!stored) return "—";
  const match = stored.match(/^([+-])(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return stored;
  return `${match[1]}${String(match[2]).padStart(2, "0")}:${match[3]}`;
}

function PdfImportStatusBadge({ status }) {
  const normalized = status || "—";
  const className = {
    Uploaded: "status--upcoming",
    Parsing: "status--active",
    Completed: "status--completed",
    Failed: "status--inactive",
    Cancelled: "status--inactive",
  }[normalized] ?? "status--upcoming";

  return (
    <span className={`status-badge status-badge--compact ${className}`}>
      {normalized}
    </span>
  );
}

function PdfImportRowMenu({
  disabled = false,
  canView = false,
  viewLabel = "View result",
  canProceed = false,
  canCancel = false,
  canAudit = false,
  onView,
  onProceed,
  onCancel,
  onAudit,
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const hasItems = canView || canProceed || canCancel || canAudit;

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    const menuEl = menuRef.current;
    if (!rect) return;
    const menuWidth = menuEl?.offsetWidth || 160;
    const menuHeight = menuEl?.offsetHeight || 0;
    const gap = 4;
    const viewportPad = 8;
    let left = rect.left;
    left = Math.max(viewportPad, Math.min(left, window.innerWidth - menuWidth - viewportPad));
    let top = rect.bottom + gap;
    if (menuHeight > 0 && top + menuHeight > window.innerHeight - viewportPad) {
      top = Math.max(viewportPad, rect.top - menuHeight - gap);
    }
    setPosition({ top, left });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (event) => {
      if (containerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [open]);

  const runAction = (fn) => {
    setOpen(false);
    fn?.();
  };

  if (!hasItems) {
    return <span className="pdf-import-grid__hint">—</span>;
  }

  const dropdown = open ? (
    <div
      ref={menuRef}
      className="query-actions-menu__dropdown"
      style={{ top: position.top, left: position.left }}
      role="menu"
    >
      {canView ? (
        <button type="button" role="menuitem" className="query-actions-menu__item" disabled={disabled} onClick={() => runAction(onView)}>
          {viewLabel}
        </button>
      ) : null}
      {canProceed ? (
        <button type="button" role="menuitem" className="query-actions-menu__item" disabled={disabled} onClick={() => runAction(onProceed)}>
          Proceed
        </button>
      ) : null}
      {canCancel ? (
        <button type="button" role="menuitem" className="query-actions-menu__item" disabled={disabled} onClick={() => runAction(onCancel)}>
          Cancel
        </button>
      ) : null}
      {canAudit ? (
        <button type="button" role="menuitem" className="query-actions-menu__item" disabled={disabled} onClick={() => runAction(onAudit)}>
          Audit
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="query-actions-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--sm btn--ghost query-actions-menu__trigger"
        aria-label="More actions"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          if (open) {
            setOpen(false);
            return;
          }
          updatePosition();
          setOpen(true);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="8" cy="3" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="8" cy="13" r="1.4" />
        </svg>
      </button>
      {dropdown ? createPortal(dropdown, document.body) : null}
    </div>
  );
}

export function PdfImportTasksGrid({
  tasks,
  refreshing,
  onProceed,
  onRemove,
  onOpenAudit,
  busyTaskNo = null,
  embedded = false,
  viewOnly = false,
  toolbarExtra = null,
  emptyMessage = "No PDF uploads yet. Use Upload PDF to add files to the queue.",
}) {
  const [viewingTask, setViewingTask] = useState(null);
  const rows = useMemo(
    () => [...(tasks ?? [])]
      .sort((a, b) => (b.importTaskNo || 0) - (a.importTaskNo || 0)),
    [tasks]
  );

  const isAnyParsing = useMemo(
    () => (tasks ?? []).some((task) => task.status === "Parsing"),
    [tasks]
  );

  const columns = useMemo(() => [
    {
      key: "actions",
      label: "Action",
      align: "center",
      stopRowClick: true,
      render: (row) => {
        const isBusy = busyTaskNo === row.importTaskNo;
        const canView = viewOnly
          ? Boolean(row.importTaskNo)
          : row.status === "Completed" || row.status === "Failed";
        return (
          <PdfImportRowMenu
            disabled={isBusy}
            canView={canView}
            viewLabel={row.status === "Failed" ? "View error" : "View result"}
            canProceed={!viewOnly && row.status === "Uploaded" && !isAnyParsing}
            canCancel={!viewOnly && row.status === "Uploaded"}
            canAudit={!viewOnly && Boolean(row.importTaskNo) && typeof onOpenAudit === "function"}
            onView={() => setViewingTask(row)}
            onProceed={() => onProceed?.(row)}
            onCancel={() => onRemove?.(row)}
            onAudit={() => onOpenAudit?.(row)}
          />
        );
      },
    },
    {
      key: "fileName",
      label: "File name",
      render: (row) => (
        <span className="config-data-table__truncate" title={row.fileName}>
          {row.fileName || "—"}
        </span>
      ),
      searchValue: (row) => row.fileName ?? "",
    },
    {
      key: "status",
      label: "Status",
      align: "center",
      render: (row) => <PdfImportStatusBadge status={row.status} />,
      searchValue: (row) => row.status ?? "",
    },
    {
      key: "message",
      label: "Message",
      render: (row) => {
        const text = rowMessage(row);
        if (!text) return "—";
        const tone = row.status === "Failed"
          ? " pdf-import-grid__message-btn--error"
          : row.status === "Completed"
            ? " pdf-import-grid__message-btn--success"
            : "";
        return (
          <span className={`config-data-table__wrap pdf-import-grid__message${tone}`} title={text}>
            {text}
          </span>
        );
      },
      searchValue: (row) => rowMessage(row),
    },
    {
      key: "recordedSign",
      label: "Performed By",
      render: (row) => {
        const value = String(row.recordedSign || "").trim() || "—";
        return (
          <span className="config-data-table__wrap" title={value}>
            {value}
          </span>
        );
      },
      searchValue: (row) => row.recordedSign ?? "",
    },
    {
      key: "recordedOnUtc",
      label: "UTC",
      render: (row) => formatPerformedOnUtc(row.recordedOnUtc),
      searchValue: (row) => formatPerformedOnUtc(row.recordedOnUtc),
    },
    {
      key: "recordedAtOffset",
      label: "Offset",
      render: (row) => formatOffset(row.recordedAtOffset),
      searchValue: (row) => row.recordedAtOffset ?? "",
    },
  ], [busyTaskNo, onProceed, onRemove, onOpenAudit, isAnyParsing, viewOnly]);

  const table = (
    <ConfigDataTable
      columns={columns}
      rows={rows}
      emptyMessage={emptyMessage}
      variant="pdf-import"
      getRowKey={(row) => row.importTaskNo ?? row.fileName}
      searchable
      paginated
      searchPlaceholder="Search imports..."
      defaultPageSize={10}
      toolbarExtra={toolbarExtra}
    />
  );

  return (
    <>
      {embedded ? (
        <div className="activity-config-pdf-import-table activity-config-pdf-import-table--embedded">
          {viewOnly ? (
            refreshing ? (
              <p className="pdf-import-grid__hint">
                <i className="fas fa-spinner fa-spin" aria-hidden="true" /> Refreshing...
              </p>
            ) : null
          ) : (
            <div className="activity-config-panel__head">
              <h3 className="activity-config-pdf-import-table__subtitle">Upload history</h3>
              {refreshing && (
                <span className="pdf-import-grid__hint">
                  <i className="fas fa-spinner fa-spin" aria-hidden="true" /> Refreshing...
                </span>
              )}
            </div>
          )}
          {table}
        </div>
      ) : (
        <section className="card activity-config-pdf-import-table">
          <div className="activity-config-panel__head">
            <h2>PDF import queue</h2>
            {refreshing && (
              <span className="pdf-import-grid__hint">
                <i className="fas fa-spinner fa-spin" aria-hidden="true" /> Refreshing...
              </span>
            )}
          </div>
          {table}
        </section>
      )}
      <PdfImportMessageModal
        open={Boolean(viewingTask)}
        onClose={() => setViewingTask(null)}
        task={viewingTask}
      />
    </>
  );
}
