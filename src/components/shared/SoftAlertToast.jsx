import { useEffect } from "react";

const VARIANT_CLASS = {
  success: "soft-alert-toast--success",
  ok: "soft-alert-toast--success",
  error: "soft-alert-toast--error",
  warning: "soft-alert-toast--warning",
};

export function SoftAlertToast({
  title = "Alert",
  message,
  variant = "warning",
  onClose,
  autoDismissMs = 4500,
}) {
  useEffect(() => {
    if (!message || !onClose || !autoDismissMs) return undefined;
    const id = window.setTimeout(onClose, autoDismissMs);
    return () => window.clearTimeout(id);
  }, [message, onClose, autoDismissMs]);

  if (!message) return null;

  const variantClass = VARIANT_CLASS[variant] ?? VARIANT_CLASS.warning;

  return (
    <div className={`soft-alert-toast ${variantClass}`} role="alert">
      <div>
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      {onClose && (
        <button type="button" aria-label="Close alert" onClick={onClose}>
          x
        </button>
      )}
    </div>
  );
}
