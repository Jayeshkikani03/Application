import { EditFieldRemarkToolbar } from "./EditFieldRemarkToolbar.jsx";

export function AdminFieldLabel({
  htmlFor,
  children,
  showAudit = false,
  onOpenAudit,
  auditTitle,
  showReopenX = false,
  remarkText,
  onReopenRemark,
  variant = "default",
}) {
  if (variant === "checkbox") {
    return (
      <>
        <label className="admin-checkbox-label" htmlFor={htmlFor}>
          {children}
        </label>
        <EditFieldRemarkToolbar
          show={showAudit}
          onOpenAudit={onOpenAudit}
          auditTitle={auditTitle}
          showReopenX={showReopenX}
          remarkText={remarkText}
          onReopenRemark={onReopenRemark}
        />
      </>
    );
  }

  return (
    <div className="admin-label-row">
      <label className="admin-label" htmlFor={htmlFor}>
        {children}
      </label>
      <EditFieldRemarkToolbar
        show={showAudit}
        onOpenAudit={onOpenAudit}
        auditTitle={auditTitle}
        showReopenX={showReopenX}
        remarkText={remarkText}
        onReopenRemark={onReopenRemark}
      />
    </div>
  );
}
