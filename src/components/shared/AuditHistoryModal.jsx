import { AdminButton } from "./AdminButton.jsx";

export function AuditHistoryModal({ open, onClose, title = "Audit Detail", children }) {
  if (!open) return null;

  return (
    <div className="admin-reason-modal-backdrop" role="presentation">
      <div
        className="admin-reason-modal admin-reason-modal--wide admin-reason-modal--audit"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-history-modal-title"
      >
        <div className="admin-reason-modal-title" id="audit-history-modal-title">
          {title}
        </div>
        <div className="admin-audit-modal__body">{children}</div>
        <div className="admin-reason-actions admin-reason-actions--center">
          <AdminButton type="button" variant="secondary" onClick={onClose}>
            Close
          </AdminButton>
        </div>
      </div>
    </div>
  );
}
