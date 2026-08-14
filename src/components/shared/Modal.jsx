import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { SoftAlertToast } from "./SoftAlertToast.jsx";
import { HOURS_24, MINUTES, Time24Input } from "./Time24Input";
export { Time24Input } from "./Time24Input";
function splitDateTimeValue(value) {
  const [date = "", time = ""] = (value ?? "").split("T");
  const [hour = "00", minute = "00"] = time.split(":");
  return {
    date,
    hour: HOURS_24.includes(hour) ? hour : "00",
    minute: MINUTES.includes(minute) ? minute : "00"
  };
}
function DateTime24Input({ value, onChange, autoFocus = false, disabled = false }) {
  const { date, hour, minute } = splitDateTimeValue(value);
  const updateValue = (nextDate, nextHour, nextMinute) => {
    if (disabled) return;
    onChange(nextDate ? `${nextDate}T${nextHour}:${nextMinute}` : "");
  };
  return /* @__PURE__ */ jsxs("div", { className: "datetime-24", children: [
    /* @__PURE__ */ jsx(
      "input",
      {
        type: "date",
        value: date,
        onChange: (event) => updateValue(event.target.value, hour, minute),
        autoFocus,
        disabled
      }
    ),
    /* @__PURE__ */ jsx(Time24Input, {
      value: `${hour}:${minute}`,
      allowEmpty: false,
      onChange: (nextTime) => {
        const [nextHour = "00", nextMinute = "00"] = String(nextTime || "00:00").split(":");
        updateValue(date, nextHour, nextMinute);
      },
      disabled
    })
  ] });
}
function ModalQueryAuditButton({ onOpenQueryAudit }) {
  if (!onOpenQueryAudit) return null;
  return /* @__PURE__ */ jsx("button", {
    type: "button",
    className: "btn btn--sm btn--secondary activity-grid__edit-btn activity-grid__audit-btn",
    onClick: onOpenQueryAudit,
    "aria-label": "View query audit",
    title: "View query audit",
    children: /* @__PURE__ */ jsx("svg", {
      width: "14",
      height: "14",
      viewBox: "0 0 16 16",
      fill: "none",
      "aria-hidden": "true",
      children: /* @__PURE__ */ jsx("path", {
        d: "M4 2.5h5.2L12 5.3v8.2H4v-11zM9 2.5v3h3M5.8 8h4.4M5.8 10h4.4M5.8 12h2.4",
        stroke: "currentColor",
        strokeWidth: "1.3",
        strokeLinecap: "round",
        strokeLinejoin: "round"
      })
    })
  });
}

function ModalTitleRow({ title, onOpenQueryAudit }) {
  return /* @__PURE__ */ jsxs("div", {
    className: "modal__title-row",
    style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" },
    children: [
      /* @__PURE__ */ jsx("h3", { className: "modal__title", style: { margin: 0 }, children: title }),
      /* @__PURE__ */ jsx(ModalQueryAuditButton, { onOpenQueryAudit })
    ]
  });
}
function RemarkModal({
  open,
  title,
  details,
  onClose,
  onSubmit,
  submitLabel = "Save",
  placeholder = "Enter remark\u2026",
  initialValue = "",
  required = false,
  lockClose = false,
  queryRemark = "",
  valueLabel = "Remark",
  onOpenQueryAudit
}) {
  const [text, setText] = useState(initialValue);
  const [responseRemark, setResponseRemark] = useState("");
  const [error, setError] = useState("");
  const hasQuery = String(queryRemark ?? "").trim() !== "";
  useEffect(() => {
    if (open) {
      setText(initialValue);
      setResponseRemark("");
      setError("");
    }
  }, [initialValue, open]);
  if (!open) return null;
  return /* @__PURE__ */ jsx("div", { className: "modal-backdrop", role: "presentation", children: /* @__PURE__ */ jsxs("div", { className: "modal", onClick: (e) => e.stopPropagation(), role: "dialog", "aria-modal": "true", children: [
    /* @__PURE__ */ jsx(ModalTitleRow, { title, onOpenQueryAudit }),
    details && !hasQuery && /* @__PURE__ */ jsx("div", { className: "confirm-detail-card", children: details.map((detail) => /* @__PURE__ */ jsxs("div", { className: "confirm-detail-card__row", children: [
      /* @__PURE__ */ jsx("span", { children: detail.label }),
      /* @__PURE__ */ jsx("strong", { className: detail.label.toLowerCase().includes("barcode") ? "mono" : void 0, children: detail.value })
    ] }, detail.label)) }),
    hasQuery ? /* @__PURE__ */ jsxs("label", {
      className: "field modal__field",
      children: [
        /* @__PURE__ */ jsx("span", { children: valueLabel }),
        /* @__PURE__ */ jsx("textarea", {
          className: "modal__textarea",
          value: text,
          onChange: (e) => {
            setText(e.target.value);
            setError("");
          },
          placeholder,
          rows: 3,
          autoFocus: true
        })
      ]
    }) : /* @__PURE__ */ jsx(
      "textarea",
      {
        className: "modal__textarea",
        value: text,
        onChange: (e) => setText(e.target.value),
        placeholder,
        rows: 4,
        autoFocus: true
      }
    ),
    hasQuery && /* @__PURE__ */ jsxs("label", {
      className: "field modal__field",
      children: [
        /* @__PURE__ */ jsx("span", { children: "Resolve / Value Change Remark" }),
        /* @__PURE__ */ jsx("textarea", {
          className: "modal__textarea",
          value: responseRemark,
          onChange: (e) => {
            setResponseRemark(e.target.value);
            setError("");
          },
          placeholder: "Enter resolve / value change remark...",
          rows: 3
        })
      ]
    }),
    error && /* @__PURE__ */ jsx("p", { className: "modal__error", children: error }),
    /* @__PURE__ */ jsxs("div", { className: "modal__actions", children: [
      !lockClose && /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--ghost", onClick: onClose, children: "Cancel" }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          className: "btn btn--primary",
          onClick: async () => {
            const trimmed = text.trim();
            const trimmedResponse = responseRemark.trim();
            if (required && !trimmed) {
              setError("Remark is required.");
              return;
            }
            if (hasQuery && !trimmedResponse) {
              setError("Response remark is required.");
              return;
            }
            try {
              if (hasQuery) {
                await onSubmit(trimmed, trimmedResponse);
              } else {
                await onSubmit(trimmed);
              }
              onClose();
            } catch (err) {
              setError(err?.response?.data?.message || err?.message || "Could not save.");
            }
          },
          children: submitLabel
        }
      )
    ] })
  ] }) });
}
function ModalContextBlock({ subjectLabel, contextLabel }) {
  if (!subjectLabel && !contextLabel) return null;
  return /* @__PURE__ */ jsxs("div", { className: "modal__context", children: [
    subjectLabel && /* @__PURE__ */ jsx("p", { className: "modal__context-subject", children: subjectLabel }),
    contextLabel && /* @__PURE__ */ jsx("p", { className: "modal__context-line", children: contextLabel })
  ] });
}
function DoseModal({
  open,
  title,
  subjectLabel,
  subtitle,
  fieldLabel = "Actual Dose Date/Time",
  initialValue,
  isNewSetup = false,
  submitLabel = "Save Dose Time",
  requireEditRemark = true,
  submitError = "",
  queryRemark = "",
  onClose,
  onSubmit,
  onOpenQueryAudit
}) {
  const [value, setValue] = useState(initialValue);
  const [remark, setRemark] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setRemark("");
      setError("");
    }
  }, [initialValue, open]);
  const displayError = error || submitError;
  if (!open) return null;
  const hasQuery = String(queryRemark ?? "").trim() !== "";
  return /* @__PURE__ */ jsx("div", { className: "modal-backdrop", role: "presentation", children: /* @__PURE__ */ jsxs("div", { className: "modal", onClick: (e) => e.stopPropagation(), role: "dialog", "aria-modal": "true", children: [
    /* @__PURE__ */ jsx(ModalTitleRow, { title, onOpenQueryAudit }),
    /* @__PURE__ */ jsx(ModalContextBlock, { subjectLabel, contextLabel: subtitle }),
    /* @__PURE__ */ jsxs("label", { className: "field modal__field", children: [
      /* @__PURE__ */ jsx("span", { children: fieldLabel }),
      /* @__PURE__ */ jsx(
        DateTime24Input,
        {
          value,
          onChange: (val) => {
            setValue(val);
            setError("");
          },
          autoFocus: true
        }
      )
    ] }),
    initialValue && (requireEditRemark || hasQuery) && !isNewSetup && /* @__PURE__ */ jsxs("label", { className: "field modal__field", children: [
      /* @__PURE__ */ jsx("span", { children: hasQuery ? "Resolve / Value Change Remark" : "Remark For Time Change" }),
      /* @__PURE__ */ jsx("textarea", {
        className: "modal__textarea",
        value: remark,
        onChange: (event) => {
          setRemark(event.target.value);
          setError("");
        },
        placeholder: hasQuery ? "Enter resolve / value change remark..." : "Enter remark for changing actual time...",
        rows: 3
      })
    ] }),
    displayError && /* @__PURE__ */ jsx("p", { className: "modal__error", children: displayError }),
    /* @__PURE__ */ jsxs("div", { className: "modal__actions", children: [
      /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--ghost", onClick: onClose, children: "Cancel" }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          className: "btn btn--primary",
          onClick: async () => {
            if (!value) {
              setError("Dose date/time is required.");
              return;
            }
            // Allow resolve-with-response without changing the value when a query is open.
            if (!isNewSetup && initialValue && value === initialValue && !hasQuery) {
              setError("No value changed. Please change the actual date/time before saving.");
              return;
            }
            const trimmedRemark = remark.trim();
            if (hasQuery && !trimmedRemark) {
              setError("Resolve / value change remark is required before resolving query.");
              return;
            }
            if (!isNewSetup && initialValue && requireEditRemark && !trimmedRemark && !hasQuery) {
              setError("Remark is required before changing actual time.");
              return;
            }
            try {
              const shouldClose = await onSubmit(value, trimmedRemark || undefined);
              if (shouldClose !== false) {
                onClose();
              }
            } catch (err) {
              setError(err?.response?.data?.message || err?.message || "Could not save.");
            }
          },
          children: submitLabel
        }
      )
    ] })
  ] }) });
}
function CrfFieldModal({
  open,
  title,
  fieldLabel,
  fieldType = "text",
  unit = "",
  initialValue = "",
  submitLabel = "Save",
  submitError = "",
  onClearSubmitError,
  queryRemark = "",
  onClose,
  onSubmit,
  onOpenQueryAudit
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [remark, setRemark] = useState("");
  const [error, setError] = useState("");
  const hasExistingValue = String(initialValue ?? "").trim() !== "";
  const hasQuery = String(queryRemark ?? "").trim() !== "";
  const softAlertMessage = error || submitError;
  const clearSoftAlert = () => {
    setError("");
    onClearSubmitError?.();
  };

  useEffect(() => {
    if (open) {
      setValue(initialValue ?? "");
      setRemark("");
      setError("");
    }
  }, [initialValue, open]);

  if (!open) return null;

  return /* @__PURE__ */ jsx("div", { className: "modal-backdrop", role: "presentation", children: /* @__PURE__ */ jsxs("div", { className: "modal", onClick: (e) => e.stopPropagation(), role: "dialog", "aria-modal": "true", children: [
    softAlertMessage ? /* @__PURE__ */ jsx(SoftAlertToast, {
      title: "Alert",
      message: softAlertMessage,
      variant: "warning",
      onClose: clearSoftAlert
    }) : null,
    /* @__PURE__ */ jsx(ModalTitleRow, { title, onOpenQueryAudit }),
    /* @__PURE__ */ jsxs("label", { className: "field modal__field", children: [
      /* @__PURE__ */ jsx("span", { children: fieldLabel }),
      fieldType === "number" ? /* @__PURE__ */ jsxs("div", { className: "crf-form__input-wrap", children: [
        /* @__PURE__ */ jsx("input", {
          type: "number",
          step: "any",
          value: value ?? "",
          onChange: (event) => {
            setValue(event.target.value);
            setError("");
          },
          autoFocus: true
        }),
        unit ? /* @__PURE__ */ jsx("span", { className: "crf-form__unit", children: unit }) : null
      ] }) : fieldType === "time" ? /* @__PURE__ */ jsx(Time24Input, {
        value: value ?? "",
        onChange: (nextValue) => {
          setValue(nextValue);
          setError("");
        }
      }) : /* @__PURE__ */ jsx("input", {
        type: "text",
        value: value ?? "",
        onChange: (event) => {
          setValue(event.target.value);
          setError("");
        },
        autoFocus: true
      })
    ] }),
    (hasExistingValue || hasQuery) && /* @__PURE__ */ jsxs("label", { className: "field modal__field", children: [
      /* @__PURE__ */ jsx("span", { children: hasQuery ? "Resolve / Value Change Remark" : "Remark For Change" }),
      /* @__PURE__ */ jsx("textarea", {
        className: "modal__textarea",
        value: remark,
        onChange: (event) => {
          setRemark(event.target.value);
          setError("");
        },
        placeholder: hasQuery ? "Enter resolve / value change remark..." : "Enter remark for changing this value...",
        rows: 3
      })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "modal__actions", children: [
      /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--ghost", onClick: onClose, children: "Cancel" }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          className: "btn btn--primary",
          onClick: async () => {
            const trimmedValue = String(value ?? "").trim();
            if (!trimmedValue) {
              setError(`${fieldLabel} is required.`);
              return;
            }
            if (hasExistingValue && trimmedValue === String(initialValue ?? "").trim() && !hasQuery) {
              setError("No value changed. Please change the value before saving.");
              return;
            }
            const trimmedRemark = remark.trim();
            if (hasQuery && !trimmedRemark) {
              setError("Resolve / value change remark is required before resolving query.");
              return;
            }
            if (hasExistingValue && !trimmedRemark && !hasQuery) {
              setError("Remark is required before updating this field.");
              return;
            }
            try {
              const shouldClose = await onSubmit(trimmedValue, trimmedRemark || void 0);
              if (shouldClose !== false) {
                onClose();
              }
            } catch (err) {
              setError(err?.response?.data?.message || err?.message || "Could not save.");
            }
          },
          children: submitLabel
        }
      )
    ] })
  ] }) });
}
function ConfirmModal({
  open,
  title,
  message,
  details,
  onClose,
  onConfirm,
  confirmLabel = "Confirm"
}) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      onConfirm();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onConfirm, open]);
  if (!open) return null;
  return /* @__PURE__ */ jsx("div", { className: "modal-backdrop", role: "presentation", children: /* @__PURE__ */ jsxs("div", { className: "modal", onClick: (e) => e.stopPropagation(), role: "dialog", "aria-modal": "true", children: [
    /* @__PURE__ */ jsx("h3", { className: "modal__title", children: title }),
    message && /* @__PURE__ */ jsx("p", { className: "modal__message", children: message }),
    details && /* @__PURE__ */ jsx("div", { className: "confirm-detail-card", children: details.map((detail) => /* @__PURE__ */ jsxs("div", { className: "confirm-detail-card__row", children: [
      /* @__PURE__ */ jsx("span", { children: detail.label }),
      /* @__PURE__ */ jsx("strong", { className: detail.label.toLowerCase().includes("barcode") ? "mono" : void 0, children: detail.value })
    ] }, detail.label)) }),
    /* @__PURE__ */ jsxs("div", { className: "modal__actions modal__actions--center", children: [
      /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--ghost", onClick: onClose, children: "Cancel" }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          className: "btn btn--danger",
          autoFocus: true,
          onClick: () => {
            onConfirm();
            onClose();
          },
          children: confirmLabel
        }
      )
    ] })
  ] }) });
}
function PasswordConfirmModal({
  open,
  title = "Verify Identity",
  message,
  details,
  onClose,
  onConfirm,
  confirmLabel = "Verify & Submit",
  onValidatePassword = null
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [validating, setValidating] = useState(false);
  useEffect(() => {
    if (open) {
      setPassword("");
      setError("");
      setValidating(false);
    }
  }, [open]);
  if (!open) return null;
  const handleSubmit = async () => {
    if (!password.trim()) {
      setError("Password is required.");
      return;
    }

    if (onValidatePassword) {
      try {
        setValidating(true);
        const result = await onValidatePassword(password);
        if (!result?.isValid) {
          setError(result?.message || "Incorrect password. Please try again.");
          setPassword("");
          return;
        }
      } catch (validationError) {
        setError(validationError.message || "Password verification failed.");
        setPassword("");
        return;
      } finally {
        setValidating(false);
      }
    } else if (password !== "1234") {
      setError("Incorrect password. Please try again.");
      setPassword("");
      return;
    }

    setError("");
    onConfirm(password);
    onClose();
  };
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      onClose();
    }
  };
  return /* @__PURE__ */ jsx("div", { className: "modal-backdrop", role: "presentation", children: /* @__PURE__ */ jsxs("div", { className: "modal modal--password-confirm", onClick: (e) => e.stopPropagation(), role: "dialog", "aria-modal": "true", "aria-labelledby": "pwd-confirm-title", children: [
    /* @__PURE__ */ jsxs("div", { className: "modal__title-row", children: [
      /* @__PURE__ */ jsxs("svg", { width: "22", height: "22", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", className: "modal__title-icon modal__title-icon--warning", children: [
        /* @__PURE__ */ jsx("circle", { cx: "12", cy: "12", r: "10" }),
        /* @__PURE__ */ jsx("line", { x1: "12", y1: "8", x2: "12", y2: "12" }),
        /* @__PURE__ */ jsx("line", { x1: "12", y1: "16", x2: "12.01", y2: "16" })
      ] }),
      /* @__PURE__ */ jsx("h3", { className: "modal__title", id: "pwd-confirm-title", children: title })
    ] }),
    message && /* @__PURE__ */ jsx("p", { className: "modal__message", children: message }),
    details && /* @__PURE__ */ jsx("div", { className: "confirm-detail-card", children: details.map((detail) => /* @__PURE__ */ jsxs("div", { className: "confirm-detail-card__row", children: [
      /* @__PURE__ */ jsx("span", { children: detail.label }),
      /* @__PURE__ */ jsx("strong", { children: detail.value })
    ] }, detail.label)) }),
    /* @__PURE__ */ jsxs("div", { className: "modal__field-group", children: [
      /* @__PURE__ */ jsx("label", { className: "modal__field-label", htmlFor: "pwd-confirm-input", children: "Enter your password to confirm" }),
      /* @__PURE__ */ jsx("input", {
        id: "pwd-confirm-input",
        type: "password",
        className: `modal__password-input${error ? " modal__password-input--error" : ""}`,
        value: password,
        onChange: (e) => { setPassword(e.target.value); setError(""); },
        onKeyDown: handleKeyDown,
        placeholder: "Password",
        autoFocus: true,
        autoComplete: "current-password"
      }),
      error && /* @__PURE__ */ jsxs("p", { className: "modal__error modal__error--with-icon", children: [
        /* @__PURE__ */ jsxs("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
          /* @__PURE__ */ jsx("circle", { cx: "12", cy: "12", r: "10" }),
          /* @__PURE__ */ jsx("line", { x1: "12", y1: "8", x2: "12", y2: "12" }),
          /* @__PURE__ */ jsx("line", { x1: "12", y1: "16", x2: "12.01", y2: "16" })
        ] }),
        error
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "modal__actions modal__actions--center", children: [
      /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--ghost", onClick: onClose, disabled: validating, children: "Cancel" }),
      /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--primary", onClick: handleSubmit, disabled: validating, children: validating ? "Verifying..." : confirmLabel })
    ] })
  ] }) });
}
export {
  ConfirmModal,
  CrfFieldModal,
  DateTime24Input,
  DoseModal,
  ModalContextBlock,
  PasswordConfirmModal,
  RemarkModal
};
