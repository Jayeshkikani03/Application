import { PdfImportTasksGrid } from "./PdfImportTasksGrid.jsx";

export function PdfImportAuditModal({
  open,
  onClose,
  tasks,
  refreshing = false,
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal modal--wide activity-config-pdf-import-audit-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-import-audit-title"
      >
        <div className="barcode-preview-modal__head activity-config-pdf-import-audit-modal__head">
          <div>
            <h3 className="modal__title" id="pdf-import-audit-title">
              PDF Import Audit
            </h3>
            <p className="activity-config-pdf-import-audit-modal__hint">
              Open Action → View error / View result for prompt, model, input, and output.
            </p>
          </div>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={onClose}
            aria-label="Close PDF import audit"
          >
            Close
          </button>
        </div>
        <PdfImportTasksGrid
          embedded
          viewOnly
          tasks={tasks}
          refreshing={refreshing}
          emptyMessage="No PDF import records yet."
        />
      </div>
    </div>
  );
}
