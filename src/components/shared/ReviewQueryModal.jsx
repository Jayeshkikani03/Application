import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { DateTime24Input } from "./Modal";
import { Time24Input } from "./Time24Input";
import { CrfFormInput } from "./CrfForm";
import {
  getReviewQueryStatus,
  getReviewQueryRowActions,
  hasOpenReviewQuery,
  isActiveReviewQuery,
  isReviewQueryAwaitingReviewer,
  matchesReviewQueryField,
  resolveReviewQueryFieldLabel,
  REVIEW_QUERY_STATUS,
  REVIEW_QUERY_STAGE_LABELS
} from "../../services/reviewQueryService";
import {
  getReviewQueryCrfField,
  getReviewQueryFieldEditType,
  getReviewQueryFieldEditUnit,
  getReviewQueryFieldEditValue
} from "../../utils/reviewQueryFieldValue";

function AuditIconButton({ label, title, onClick }) {
  return /* @__PURE__ */ jsx(
    "button",
    {
      type: "button",
      className: "btn btn--sm btn--secondary activity-grid__edit-btn activity-grid__audit-btn",
      onClick,
      "aria-label": label,
      title: title ?? label,
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
    }
  );
}

function QueryStageBadge({ status }) {
  if (!status) return null;
  const label = REVIEW_QUERY_STAGE_LABELS[status] ?? status;
  return /* @__PURE__ */ jsx("span", {
    className: `review-query-modal__stage review-query-modal__stage--${status}`,
    children: label
  });
}

/** Same control patterns as CrfFieldModal / CrfForm — no alternate designs. */
function QueryFieldValueEditor({ title, type, unit = "", field = null, value, onChange }) {
  if (field) {
    return /* @__PURE__ */ jsxs("label", {
      className: "field modal__field",
      children: [
        /* @__PURE__ */ jsx("span", { children: title }),
        /* @__PURE__ */ jsx(CrfFormInput, {
          field,
          value,
          error: "",
          onChange: (_fieldId, nextValue) => onChange(nextValue)
        })
      ]
    });
  }

  if (type === "datetime") {
    return /* @__PURE__ */ jsxs("label", {
      className: "field modal__field",
      children: [
        /* @__PURE__ */ jsx("span", { children: title }),
        /* @__PURE__ */ jsx(DateTime24Input, {
          value,
          onChange,
          autoFocus: true
        })
      ]
    });
  }

  if (type === "number") {
    return /* @__PURE__ */ jsxs("label", {
      className: "field modal__field",
      children: [
        /* @__PURE__ */ jsx("span", { children: title }),
        /* @__PURE__ */ jsxs("div", {
          className: "crf-form__input-wrap",
          children: [
            /* @__PURE__ */ jsx("input", {
              type: "number",
              step: "any",
              value: value ?? "",
              onChange: (event) => onChange(event.target.value),
              autoFocus: true
            }),
            unit ? /* @__PURE__ */ jsx("span", { className: "crf-form__unit", children: unit }) : null
          ]
        })
      ]
    });
  }

  if (type === "textarea") {
    return /* @__PURE__ */ jsxs("label", {
      className: "field modal__field",
      children: [
        /* @__PURE__ */ jsx("span", { children: title }),
        /* @__PURE__ */ jsx("textarea", {
          className: "modal__textarea",
          value: value ?? "",
          onChange: (event) => onChange(event.target.value),
          rows: 3,
          autoFocus: true
        })
      ]
    });
  }

  if (type === "time") {
    return /* @__PURE__ */ jsxs("label", {
      className: "field modal__field",
      children: [
        /* @__PURE__ */ jsx("span", { children: title }),
        /* @__PURE__ */ jsx(Time24Input, {
          value: value ?? "",
          onChange
        })
      ]
    });
  }

  return /* @__PURE__ */ jsxs("label", {
    className: "field modal__field",
    children: [
      /* @__PURE__ */ jsx("span", { children: title }),
      /* @__PURE__ */ jsx("input", {
        type: type === "date" ? "date" : "text",
        value: value ?? "",
        onChange: (event) => onChange(event.target.value),
        autoFocus: true
      })
    ]
  });
}

function ReviewQueryModal({
  open,
  activity,
  defaultFieldKey,
  fieldValue = "",
  fieldEditContext = null,
  showFieldValue = false,
  resolveMode = false,
  closeMode = false,
  reraiseMode = false,
  hasFieldAudit = false,
  onOpenFieldAudit,
  onClose,
  onSubmit,
  onResolve,
  onSendback,
  onCloseQuery
}) {
  const [text, setText] = useState("");
  const [resolveText, setResolveText] = useState("");
  const [editableFieldValue, setEditableFieldValue] = useState("");
  const [actionRemark, setActionRemark] = useState("");
  const [error, setError] = useState("");
  const fieldKey = defaultFieldKey ?? "";
  const fieldEditType = getReviewQueryFieldEditType(fieldKey, activity);
  const fieldEditUnit = getReviewQueryFieldEditUnit(fieldKey, activity);
  const crfField = getReviewQueryCrfField(activity, fieldKey);
  const fieldLabel = activity && fieldKey
    ? resolveReviewQueryFieldLabel(activity, fieldKey)
    : "";
  const displayFieldLabel = fieldLabel || fieldKey;
  const hasQueryOnField = matchesReviewQueryField(activity, fieldKey);
  const hasOpenQueryOnField = hasOpenReviewQuery(activity, fieldKey);
  const queryStatus = hasOpenQueryOnField ? getReviewQueryStatus(activity, fieldKey) : null;
  const isRaiseMode = !hasOpenQueryOnField && !!onSubmit && !resolveMode;
  // When opened explicitly for resolve, trust resolveMode even if field-key matching is flaky.
  const isResolveMode = Boolean(
    resolveMode
    && !!onResolve
    && (
      isActiveReviewQuery(activity, fieldKey)
      || queryStatus === REVIEW_QUERY_STATUS.RAISED
      || queryStatus === REVIEW_QUERY_STATUS.SENDBACK
    )
  );
  const rowActions = queryStatus ? getReviewQueryRowActions(queryStatus) : null;
  const canSendback = !isResolveMode && !closeMode
    && String(activity?.reviewStatus || "").trim().toLowerCase() !== "reviewed"
    && isReviewQueryAwaitingReviewer(activity, fieldKey) && !!onSendback;
  const canCloseQuery = !isResolveMode && !!rowActions?.canClose && !!onCloseQuery;
  const needsActionRemark = canSendback || canCloseQuery;

  useEffect(() => {
    if (!open) return;
    setText(isRaiseMode ? "" : activity?.reviewQuery ?? "");
    setResolveText("");
    setEditableFieldValue(
      isResolveMode && activity && fieldKey
        ? getReviewQueryFieldEditValue(activity, fieldKey, fieldEditContext ?? {})
        : ""
    );
    setActionRemark("");
    setError("");
  }, [activity, fieldEditContext, fieldKey, isRaiseMode, isResolveMode, open]);

  if (!open || !activity || !fieldKey) return null;

  const modalTitle = isRaiseMode
    ? reraiseMode
      ? "Reraise Query"
      : "Raise Query"
    : isResolveMode
      ? "Resolve Query"
      : closeMode
        ? "Close Query"
      : "Query";

  return /* @__PURE__ */ jsx("div", {
    className: "modal-backdrop modal-backdrop--raise",
    role: "presentation",
    children: /* @__PURE__ */ jsxs("div", {
      className: "modal",
      onClick: (event) => event.stopPropagation(),
      role: "dialog",
      "aria-modal": "true",
      children: [
        /* @__PURE__ */ jsx("h3", {
          className: "modal__title",
          children: modalTitle
        }),
        /* @__PURE__ */ jsxs("div", {
          className: "review-query-modal__field-row",
          children: [
            /* @__PURE__ */ jsx("span", {
              className: "review-query-modal__field-label",
              children: displayFieldLabel
            }),
            queryStatus ? /* @__PURE__ */ jsx(QueryStageBadge, { status: queryStatus }) : null,
            hasFieldAudit && onOpenFieldAudit
              ? /* @__PURE__ */ jsx(AuditIconButton, {
                  label: `View ${displayFieldLabel} query audit`,
                  title: `View ${displayFieldLabel} query audit`,
                  onClick: () => onOpenFieldAudit(fieldKey)
                })
              : null
          ]
        }),
        isRaiseMode
          ? /* @__PURE__ */ jsxs("label", {
              className: "field modal__field",
              children: [
                /* @__PURE__ */ jsx("span", { children: "Remark" }),
                /* @__PURE__ */ jsx("textarea", {
                  className: "modal__textarea",
                  value: text,
                  onChange: (event) => setText(event.target.value),
                  placeholder: "Enter remark\u2026",
                  rows: 4,
                  autoFocus: true
                })
              ]
            })
          : /* @__PURE__ */ jsxs(Fragment, {
              children: [
                isResolveMode
                  ? /* @__PURE__ */ jsx(QueryFieldValueEditor, {
                      title: "Field Value",
                      type: fieldEditType,
                      unit: fieldEditUnit,
                      field: crfField,
                      value: editableFieldValue,
                      onChange: setEditableFieldValue
                    })
                  : null,
                isResolveMode
                  ? /* @__PURE__ */ jsxs("label", {
                      className: "field modal__field",
                      children: [
                        /* @__PURE__ */ jsx("span", { children: "Response / Change Remark" }),
                        /* @__PURE__ */ jsx("textarea", {
                          className: "modal__textarea",
                          value: resolveText,
                          onChange: (event) => setResolveText(event.target.value),
                          placeholder: "Enter response used as the field-change remark...",
                          rows: 4,
                          autoFocus: true
                        })
                      ]
                    })
                  : null,
                needsActionRemark
                  ? /* @__PURE__ */ jsxs("label", {
                      className: "field modal__field",
                      children: [
                        /* @__PURE__ */ jsx("span", { children: "Remark" }),
                        /* @__PURE__ */ jsx("textarea", {
                          className: "modal__textarea",
                          value: actionRemark,
                          onChange: (event) => setActionRemark(event.target.value),
                          placeholder: "Enter remark\u2026",
                          rows: 3,
                          autoFocus: true
                        })
                      ]
                    })
                  : null
              ]
            }),
        error && /* @__PURE__ */ jsx("p", { className: "modal__error", children: error }),
        /* @__PURE__ */ jsxs("div", {
          className: "modal__actions",
          children: [
            isRaiseMode
              ? /* @__PURE__ */ jsxs(Fragment, {
                  children: [
                    /* @__PURE__ */ jsx("button", {
                      type: "button",
                      className: "btn btn--ghost",
                      onClick: onClose,
                      children: "Cancel"
                    }),
                    /* @__PURE__ */ jsx("button", {
                      type: "button",
                      className: "btn btn--primary",
                      onClick: () => {
                        const trimmed = text.trim();
                        if (!trimmed) {
                          setError("Remark is required.");
                          return;
                        }
                        const shouldClose = onSubmit(fieldKey, trimmed);
                        if (shouldClose !== false) {
                          onClose();
                        }
                      },
                      children: reraiseMode ? "Reraise Query" : "Raise Query"
                    })
                  ]
                })
              : /* @__PURE__ */ jsxs(Fragment, {
                  children: [
                    isResolveMode
                      ? /* @__PURE__ */ jsxs(Fragment, {
                          children: [
                            /* @__PURE__ */ jsx("button", {
                              type: "button",
                              className: "btn btn--ghost",
                              onClick: onClose,
                              children: "Cancel"
                            }),
                            /* @__PURE__ */ jsx("button", {
                              type: "button",
                              className: "btn btn--primary",
                              onClick: async () => {
                                const trimmed = resolveText.trim();
                                if (!trimmed) {
                                  setError("Response is required.");
                                  return;
                                }
                                const trimmedFieldValue = String(editableFieldValue ?? "").trim();
                                if (!trimmedFieldValue) {
                                  setError("Field value is required.");
                                  return;
                                }
                                setError("");
                                try {
                                  const shouldClose = await onResolve(fieldKey, {
                                    responseText: trimmed,
                                    fieldValue: editableFieldValue
                                  });
                                  if (shouldClose === false) return;
                                  if (typeof shouldClose === "string" && shouldClose.trim()) {
                                    setError(shouldClose.trim());
                                    return;
                                  }
                                  onClose();
                                } catch (err) {
                                  setError(err?.response?.data?.message || err?.message || "Could not resolve query.");
                                }
                              },
                              children: "Resolve"
                            })
                          ]
                        })
                      : /* @__PURE__ */ jsxs(Fragment, {
                          children: [
                    canSendback
                      ? /* @__PURE__ */ jsx("button", {
                          type: "button",
                          className: "btn btn--secondary",
                          onClick: () => {
                            const trimmed = actionRemark.trim();
                            if (!trimmed) {
                              setError("Remark is required.");
                              return;
                            }
                            const shouldClose = onSendback(fieldKey, trimmed);
                            if (shouldClose !== false) {
                              onClose();
                            }
                          },
                          children: "Send Back"
                        })
                      : null,
                    canCloseQuery
                      ? /* @__PURE__ */ jsx("button", {
                          type: "button",
                          className: "btn btn--primary",
                          onClick: () => {
                            const trimmed = actionRemark.trim();
                            if (!trimmed) {
                              setError("Remark is required.");
                              return;
                            }
                            const shouldClose = onCloseQuery(fieldKey, trimmed);
                            if (shouldClose !== false) {
                              onClose();
                            }
                          },
                          children: "Close Query"
                        })
                      : null,
                    /* @__PURE__ */ jsx("button", {
                      type: "button",
                      className: canSendback || canCloseQuery ? "btn btn--ghost" : "btn btn--primary",
                      onClick: onClose,
                      children: "Close"
                    })
                          ]
                        })
                  ]
                })
          ]
        })
      ]
    })
  });
}

export { ReviewQueryModal };
