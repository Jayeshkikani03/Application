import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useMemo } from "react";
import { getCrfDefinitionForActivity, activityHasCrf, getCrfActiveFieldItems, resolveCrfSavedValues } from "../../services/crfService";
import { formatActivityTimepointLabel, formatDoseDisplayLabel } from "../../utils/visitDisplay";
import { resolveSiteRandomizationNumber } from "../../utils/participantDisplay";
import { isExecutionReviewLocked } from "../../features/activityExecution/utils/hdrStatus.js";
import { CrfForm } from "./CrfForm";

export { activityHasCrf };

function CrfModal({
  open,
  activity,
  sample,
  visit,
  subjects,
  crfAuditEntries = [],
  onOpenFieldAudit,
  onOpenQueryAudit,
  onResolveQuery,
  submitError = "",
  onClearSubmitError,
  onClose,
  onSave,
  viewOnly = false,
  notReadyMessage = ""
}) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const definition = useMemo(
    () => (open && activity ? getCrfDefinitionForActivity(activity) : null),
    [open, activity]
  );
  const savedValues = useMemo(
    () => (activity && definition ? resolveCrfSavedValues(activity, definition) : {}),
    [activity, definition]
  );

  if (!open || !activity) return null;
  if (!definition || getCrfActiveFieldItems(definition).length === 0) return null;

  const doseLabel = formatDoseDisplayLabel(activity.dose);
  const formId = `crf-form-${definition.id}`;
  const isSubmittedLocked =
    isExecutionReviewLocked(visit?.reviewStatus)
    || isExecutionReviewLocked(activity?.reviewStatus);
  const isFieldEditable = () => {
    if (viewOnly) return false;
    if (isSubmittedLocked) return false;
    return true;
  };
  const anyEditableField = !viewOnly && !isSubmittedLocked;

  return /* @__PURE__ */ jsx("div", {
    className: "modal-backdrop",
    role: "presentation",
    children: /* @__PURE__ */ jsxs("div", {
      className: "modal modal--wide crf-modal",
      onClick: (event) => event.stopPropagation(),
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Case Report Form",
      children: [
        /* @__PURE__ */ jsxs("div", {
          className: "crf-modal__toolbar",
          children: [
            /* @__PURE__ */ jsxs("div", {
              className: "crf-modal__context",
              children: [
                /* @__PURE__ */ jsxs("span", { children: ["Subject: ", /* @__PURE__ */ jsx("strong", { children: resolveSiteRandomizationNumber({ subjectId: activity.subjectId, subjects, subjectNumber: activity.subjectNumber }) })] }),
                /* @__PURE__ */ jsxs("span", { children: ["Visit: ", /* @__PURE__ */ jsx("strong", { children: activity.visitLabel ?? visit?.label ?? "—" })] }),
                /* @__PURE__ */ jsxs("span", { children: ["Dose: ", /* @__PURE__ */ jsx("strong", { children: doseLabel })] }),
                /* @__PURE__ */ jsxs("span", { children: ["Timepoint: ", /* @__PURE__ */ jsx("strong", { children: formatActivityTimepointLabel(activity) })] })
              ]
            }),
            /* @__PURE__ */ jsx("button", {
              type: "button",
              className: "btn btn--ghost crf-modal__close",
              onClick: onClose,
              "aria-label": "Close CRF",
              children: "×"
            })
          ]
        }),
        notReadyMessage ? /* @__PURE__ */ jsx("div", {
          className: "crf-modal__notice",
          role: "status",
          children: notReadyMessage
        }) : null,
        /* @__PURE__ */ jsx("div", {
          className: "crf-modal__body",
          children: /* @__PURE__ */ jsx(CrfForm, {
            formId,
            definition,
            activity,
            sample,
            visit,
            savedValues,
            crfAuditEntries,
            onOpenFieldAudit,
            onOpenQueryAudit,
            onResolveQuery,
            submitError,
            onClearSubmitError,
            viewOnly,
            isFieldEditable,
            onSave: viewOnly || !anyEditableField ? void 0 : (values, changeReason) => {
              const saved = onSave?.(definition.id, values, changeReason);
              if (saved !== false) onClose?.();
            }
          })
        }),
        /* @__PURE__ */ jsxs("div", {
          className: "modal__actions",
          children: [
            /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--ghost", onClick: onClose, children: "Close" }),
            !viewOnly && anyEditableField && /* @__PURE__ */ jsx("button", { type: "submit", form: formId, className: "btn btn--primary", children: "Save CRF" })
          ]
        })
      ]
    })
  });
}

export {
  CrfModal
};
