/** Clipboard audit + optional reopen (X) next to a field label. */
export function EditFieldRemarkToolbar({
  show,
  onOpenAudit,
  auditTitle = "Audit Detail",
  auditAriaLabel = "View audit history",
  showReopenX,
  remarkText,
  onReopenRemark,
}) {
  if (!show) return null;

  return (
    <span className="edit-field-remark-toolbar">
      {typeof onOpenAudit === "function" ? (
        <button
          type="button"
          className="edit-field-remark-toolbar__btn"
          title={auditTitle}
          aria-label={auditAriaLabel}
          onClick={onOpenAudit}
        >
          <i className="fas fa-clipboard-list" aria-hidden />
        </button>
      ) : null}
      {showReopenX && String(remarkText || "").trim() ? (
        <button
          type="button"
          className="edit-field-remark-toolbar__btn edit-field-remark-toolbar__btn--reopen"
          onClick={onReopenRemark}
          title={String(remarkText).trim()}
          aria-label="Edit reason — click to reopen"
        >
          <i className="fas fa-times" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

/** Bordered textarea + confirm check (shown while dirty and panel not dismissed). */
export function EditFieldRemarkAttach({
  show,
  value,
  onChange,
  onConfirm,
  toast,
  emptyConfirmMessage = "Enter a reason before confirming.",
  ariaLabel = "Reason for change",
  placeholder = "Enter Reason",
  rows = 2,
  floating = false,
  className = "",
}) {
  if (!show) return null;

  return (
    <div
      className={[
        "edit-field-remark-attach",
        floating ? "edit-field-remark-attach--floating" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="edit-field-remark-attach__row">
        <textarea
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="edit-field-remark-attach__textarea"
        />
        <button
          type="button"
          className="edit-field-remark-attach__confirm"
          aria-label="Confirm reason"
          title="Confirm"
          onClick={() => {
            if (!String(value || "").trim()) {
              toast?.(emptyConfirmMessage, "warning");
              return;
            }
            onConfirm?.();
          }}
        >
          <i className="fas fa-check" aria-hidden />
        </button>
      </div>
    </div>
  );
}
