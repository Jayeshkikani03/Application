import { useEffect, useMemo, useState } from "react";
import {
  buildCrfInitialValues,
  getCrfActiveFieldItems,
  getCrfFieldUpdates,
  syncSectionsFromItems,
} from "../../services/crfService";
import {
  applyAgeCalculationReactions,
  applyCalculationReactions,
  coerceTextCase,
  getFieldLayoutFlags,
  getFieldRuntimeState,
  normalizeFieldOptions,
  validateFieldValue,
} from "../../services/crfFieldRuntime.js";
import {
  buildDobFieldValue,
  dobDayOptions,
  dobMonthOptions,
  dobYearOptions,
  parseDobFieldValue,
} from "../../services/crfDobField.js";
import {
  isActiveReviewQuery,
  hasOpenReviewQuery,
  matchesReviewQueryField,
  getReviewQueryStageForField,
  getReviewQueryStageBtnClass,
  getReviewQueryStageCellClass,
} from "../../services/reviewQueryService";
import { EditFieldRemarkAttach } from "./EditFieldRemark.jsx";
import { SoftAlertToast } from "./SoftAlertToast.jsx";
import { Time24Input } from "./Time24Input";

function fieldUsesSeconds(field) {
  return String(field?.timeFormat || "").trim() !== "HH:mm";
}

function timeInputStep(field) {
  return fieldUsesSeconds(field) ? 1 : 60;
}

function splitDateTimeValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { date: "", time: "" };
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const [date = "", time = ""] = normalized.split("T");
  return { date, time: time.replace(/Z.*$/, "").slice(0, 8) };
}

function subjectRuntimeContext(activity) {
  if (!activity || typeof activity !== "object") return null;
  return {
    isScreeningFailure: activity.isScreeningFailure === true,
    patientStatus: activity.patientStatus || "",
  };
}

/**
 * Apply calculation formulas, ageCalculation, and dependency setValue / clearValue.
 * When `skipFieldId` is set (user is editing that field), do not overwrite it —
 * otherwise empty-condition / cascading rules fight keystrokes and wipe input.
 * Collects alertMessage toasts (caller shows SoftAlertToast once per message).
 */
function applyDraftDependencyReactions(activeFieldItems, data, { skipFieldId, context } = {}) {
  if (!activeFieldItems?.length) {
    return { values: data, alertMessage: null };
  }
  let next = data;
  let mutated = false;
  let alertMessage = null;
  for (let iter = 0; iter < 8; iter += 1) {
    let changed = false;
    const working = { ...next };
    if (applyCalculationReactions(activeFieldItems, working, { skipFieldId })) {
      changed = true;
    }
    if (applyAgeCalculationReactions(activeFieldItems, working, { skipFieldId })) {
      changed = true;
    }
    for (const item of activeFieldItems) {
      const field = item?.field;
      if (!field?.id) continue;
      const runtime = getFieldRuntimeState(field, working, context);
      if (runtime.dependencyAlertMessage) {
        alertMessage = runtime.dependencyAlertMessage;
      }
      if (skipFieldId && field.id === skipFieldId) continue;
      if (runtime.clearValue) {
        if (working[field.id]) {
          working[field.id] = "";
          changed = true;
        }
      } else if (runtime.setValue !== undefined) {
        const asText = runtime.setValue == null ? "" : String(runtime.setValue);
        if (String(working[field.id] ?? "") !== asText) {
          working[field.id] = asText;
          changed = true;
        }
      }
    }
    if (!changed) break;
    next = working;
    mutated = true;
  }
  return { values: mutated ? next : data, alertMessage };
}

function CrfDobInput({ field, value, error, locked, onChange }) {
  const dobValue = parseDobFieldValue(value);
  const setPart = (part, next) => {
    onChange(field.id, buildDobFieldValue({ ...dobValue, [part]: next || "" }));
  };
  const selectClass = `crf-form__input crf-form__part-select${error ? " crf-form__input--error" : ""}`;
  const label = field.label || "Date of birth";
  return (
    <div className="crf-form__control crf-form__control--dob" role="group" aria-label={label}>
      <select
        className={selectClass}
        value={dobValue.day}
        disabled={locked}
        aria-label={`${label} day`}
        onChange={(e) => setPart("day", e.target.value)}
      >
        <option value="">Day</option>
        {dobDayOptions().map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <select
        className={selectClass}
        value={dobValue.month}
        disabled={locked}
        aria-label={`${label} month`}
        onChange={(e) => setPart("month", e.target.value)}
      >
        <option value="">Month</option>
        {dobMonthOptions().map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <select
        className={selectClass}
        value={dobValue.year}
        disabled={locked}
        aria-label={`${label} year`}
        onChange={(e) => setPart("year", e.target.value)}
      >
        <option value="">Year</option>
        {dobYearOptions(field).map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

function CrfDateTimeInput({ field, value, error, locked, onChange, id }) {
  const { date, time } = splitDateTimeValue(value);
  const withSeconds = fieldUsesSeconds(field);
  const errorClass = error ? " crf-form__input--error" : "";
  const commit = (nextDate, nextTime) => {
    if (!nextDate) {
      onChange(field.id, "");
      return;
    }
    const fallback = withSeconds ? "00:00:00" : "00:00";
    onChange(field.id, `${nextDate}T${nextTime || fallback}`);
  };

  return (
    <div id={id} className="crf-form__control crf-form__control--datetime" role="group" aria-label={field.label || "Date time"}>
      <input
        type="date"
        className={`crf-form__input crf-form__control--date${errorClass}`}
        value={date}
        disabled={locked}
        onChange={(e) => commit(e.target.value, time)}
      />
      <Time24Input
        className={`crf-form__control--time${errorClass}`}
        value={time}
        disabled={locked}
        allowEmpty={false}
        onChange={(nextTime) => commit(date, nextTime)}
      />
    </div>
  );
}

function CrfAuditButton({ label, onClick }) {
  return (
    <button
      type="button"
      className="btn btn--sm btn--secondary activity-grid__edit-btn activity-grid__audit-btn crf-form__audit-btn"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4 2.5h5.2L12 5.3v8.2H4v-11zM9 2.5v3h3M5.8 8h4.4M5.8 10h4.4M5.8 12h2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function CrfQueryButton({ label, title, stage = "", onClick }) {
  const stageClass = stage ? ` ${getReviewQueryStageBtnClass(stage)}` : "";
  return (
    <button
      type="button"
      className={`btn btn--sm btn--secondary activity-grid__edit-btn activity-grid__query-btn crf-form__query-btn${stageClass}`}
      onClick={onClick}
      aria-label={label}
      title={title ?? label}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M6.2 5.4a1.8 1.8 0 1 1 3.2 1.2c-.5.5-1.1.7-1.5 1.1-.3.3-.4.7-.4 1.3M8 12.2h.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function CrfHelpIcon({ help }) {
  const text = String(help || "").trim();
  if (!text) return null;
  return (
    <span
      className="crf-form__help-icon"
      title={text}
      aria-label={`Help: ${text}`}
    >
      <i className="fas fa-info-circle" aria-hidden />
    </span>
  );
}

function CrfFormInput({ field, value, error, onChange, viewOnly = false, runtime }) {
  const inputId = `crf-field-${field.id}`;
  const type = String(field.type || "text").toLowerCase();
  const isRemarks = type === "textarea" || field.label?.toLowerCase().includes("remark");
  // Only lock from explicit runtime flags — never treat missing runtime as locked.
  const locked = Boolean(viewOnly || runtime?.disabled || runtime?.readonly);
  const options = normalizeFieldOptions(field);
  const errorClass = error ? " crf-form__input--error" : "";
  const textTransform = field.textCase === "upper"
    ? "uppercase"
    : field.textCase === "lower"
      ? "lowercase"
      : undefined;
  const commonProps = {
    id: inputId,
    value: value ?? "",
    onChange: (event) => {
      if (locked) return;
      onChange(field.id, coerceTextCase(field, event.target.value));
    },
    placeholder: field.placeholder || undefined,
    "aria-invalid": error ? "true" : undefined,
    "aria-describedby": error ? `${inputId}-error` : undefined,
    readOnly: locked || type === "pk-label-auto",
    disabled: locked && runtime?.disabled ? true : undefined,
    style: textTransform ? { textTransform } : undefined,
  };

  if (type === "label") {
    return (
      <div className="crf-form__control crf-form__control--label">
        <div className="crf-form__label-value">
          {String(value ?? "").trim() || ""}
          {field.unit ? <span className="crf-form__unit">{field.unit}</span> : null}
        </div>
      </div>
    );
  }

  if (type === "pk-label-auto" || type === "aliquot-barcode") {
    return (
      <div className="crf-form__control crf-form__control--pk">
        <input
          {...commonProps}
          type="text"
          className={`crf-form__input crf-form__input--readonly mono${errorClass}`}
          readOnly
          disabled
          placeholder={field.placeholder || "From activity barcode"}
        />
      </div>
    );
  }

  if (type === "dob") {
    return (
      <CrfDobInput
        field={field}
        value={value}
        error={error}
        locked={locked}
        onChange={onChange}
      />
    );
  }

  if (type === "date") {
    return (
      <div className="crf-form__control crf-form__control--date-wrap">
        <input
          {...commonProps}
          type="date"
          className={`crf-form__input crf-form__control--date${errorClass}`}
        />
      </div>
    );
  }

  if (type === "time") {
    if (fieldUsesSeconds(field)) {
      return (
        <div className="crf-form__control crf-form__control--time-wrap">
          <input
            {...commonProps}
            type="time"
            step={timeInputStep(field)}
            className={`crf-form__input crf-form__control--time-native${errorClass}`}
          />
        </div>
      );
    }
    return (
      <div className="crf-form__control crf-form__control--time-wrap">
        <Time24Input
          id={inputId}
          className={`crf-form__control--time${errorClass}`}
          value={value ?? ""}
          onChange={(nextValue) => onChange(field.id, nextValue)}
          disabled={locked}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
        />
      </div>
    );
  }

  if (type === "datetime" || type === "datetime-local") {
    return (
      <CrfDateTimeInput
        id={inputId}
        field={field}
        value={value}
        error={error}
        locked={locked}
        onChange={onChange}
      />
    );
  }

  if (type === "number") {
    const minNum = field.min != null && field.min !== "" ? Number(field.min) : null;
    const maxNum = field.max != null && field.max !== "" ? Number(field.max) : null;
    return (
      <div className={`crf-form__control crf-form__control--number${error ? " crf-form__control--error" : ""}`}>
        <input
          {...commonProps}
          className={`crf-form__input${errorClass}`}
          type="number"
          inputMode="decimal"
          step="any"
          min={minNum != null && !Number.isNaN(minNum) ? minNum : undefined}
          max={maxNum != null && !Number.isNaN(maxNum) ? maxNum : undefined}
        />
        {field.unit ? <span className="crf-form__unit">{field.unit}</span> : null}
      </div>
    );
  }

  if (type === "dropdown" || type === "select") {
    const emptyLabel = String(field.placeholder || "Select…").trim() || "Select…";
    return (
      <div className="crf-form__control crf-form__control--dropdown">
        <select
          {...commonProps}
          className={`crf-form__input${errorClass}`}
          disabled={locked}
          value={value ?? ""}
          onChange={(event) => onChange(field.id, event.target.value)}
        >
          <option value="">{emptyLabel}</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    );
  }

  if (type === "radio") {
    return (
      <div
        className={`crf-form__control crf-form__control--radio crf-form__option-group crf-form__option-group--plain${error ? " crf-form__option-group--error" : ""}`}
        role="radiogroup"
        aria-labelledby={`${inputId}-label`}
      >
        {options.length ? options.map((opt) => (
          <label key={opt.value} className="crf-form__option">
            <input
              type="radio"
              name={inputId}
              value={opt.value}
              checked={String(value ?? "") === opt.value}
              disabled={locked}
              onChange={() => onChange(field.id, opt.value)}
            />
            <span>{opt.label}</span>
          </label>
        )) : (
          <span className="crf-form__option-empty">No options configured</span>
        )}
      </div>
    );
  }

  if (type === "checkbox") {
    if (options.length > 0) {
      const selected = new Set(
        String(value ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      );
      return (
        <div className={`crf-form__control crf-form__control--checkbox crf-form__option-group crf-form__option-group--plain${error ? " crf-form__option-group--error" : ""}`}>
          {options.map((opt) => (
            <label key={opt.value} className="crf-form__option">
              <input
                type="checkbox"
                checked={selected.has(opt.value)}
                disabled={locked}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(opt.value);
                  else next.delete(opt.value);
                  onChange(field.id, [...next].join(","));
                }}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      );
    }
    return (
      <div className="crf-form__control crf-form__control--checkbox">
        <label className="crf-form__option">
          <input
            type="checkbox"
            checked={value === true || value === "true" || value === "1" || value === "yes"}
            disabled={locked}
            onChange={(event) => onChange(field.id, event.target.checked ? "true" : "false")}
          />
          <span>Yes</span>
        </label>
      </div>
    );
  }

  if (type === "multiselect") {
    const selected = new Set(
      String(value ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
    return (
      <div className="crf-form__control crf-form__control--multiselect">
        <select
          id={inputId}
          className={`crf-form__input crf-form__input--multi${errorClass}`}
          multiple
          disabled={locked}
          value={[...selected]}
          aria-label={field.label || "Select options"}
          onChange={(event) => {
            const next = [...event.target.selectedOptions].map((o) => o.value);
            onChange(field.id, next.join(","));
          }}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    );
  }

  if (isRemarks || type === "textarea") {
    return (
      <div className="crf-form__control crf-form__control--textarea">
        <textarea {...commonProps} className={`crf-form__textarea${errorClass}`} rows={3} />
      </div>
    );
  }

  return (
    <div className="crf-form__control crf-form__control--text">
      <input {...commonProps} className={`crf-form__input${errorClass}`} type="text" />
    </div>
  );
}

function CrfInstructionBlock({ item }) {
  const title = String(item?.title || "").trim();
  const html = String(item?.html || "").trim();
  if (!title && !html) return null;
  return (
    <div className="crf-form__instruction">
      {title ? <div className="crf-form__instruction-title">{title}</div> : null}
      {html ? (
        <div
          className="crf-form__instruction-body"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : null}
    </div>
  );
}

function CrfFieldBlock({
  item,
  values,
  errors,
  viewOnly,
  activity,
  crfAuditEntries,
  onOpenFieldAudit,
  onOpenQueryAudit,
  onRaiseFieldQuery,
  onResolveQuery,
  allowFieldQuery,
  isFieldEditable,
  hideClosedQueries = false,
  requiresChangeRemark,
  fieldNeedsChangeRemark,
  changeRemarkText,
  changeRemarkConfirmed,
  setChangeRemarkText,
  setChangeRemarkConfirmed,
  setErrors,
  onClearSubmitError,
  onChange,
  hideLabel = false,
}) {
  const field = item.field;
  if (!field || field.active === false) return null;

  const runtime = getFieldRuntimeState(field, values, subjectRuntimeContext(activity));
  if (runtime.visible === false) return null;

  const { isInline: inline, isFullRow: fullRow } = getFieldLayoutFlags(field);
  const queryFieldKey = `crf:${field.id}`;
  const queryStage = getReviewQueryStageForField(activity, queryFieldKey, { hideClosed: hideClosedQueries })
    || (field.label
      ? getReviewQueryStageForField(activity, field.label, { hideClosed: hideClosedQueries })
      : null);
  const hasQueryOnField = isActiveReviewQuery(activity, queryFieldKey)
    || (field.label ? isActiveReviewQuery(activity, field.label) : false);
  const hasOpenQueryOnField = hasOpenReviewQuery(activity, queryFieldKey)
    || (field.label ? hasOpenReviewQuery(activity, field.label) : false);
  const hasQueryOnThisField = matchesReviewQueryField(activity, queryFieldKey)
    || (field.label ? matchesReviewQueryField(activity, field.label) : false);
  const fieldHasDbAudit = () => {
    const ids = activity?.fieldIds ?? {};
    if (ids[field.id] || ids[field.label] || ids[`crf:${field.id}`]) return true;
    if (activity?.activityExecutionHdrNo > 0 && values && values[field.id] !== undefined && values[field.id] !== null && String(values[field.id]).trim() !== "") {
      return true;
    }
    return false;
  };
  const fieldHasValueChangeAudit = () => {
    const audited = activity?.auditedFieldIds;
    if (audited && typeof audited === "object") {
      return !!(audited[field.id] || audited[field.label] || audited[`crf:${field.id}`]);
    }
    // Legacy: when auditedFieldIds is absent, fall back to Dtl presence only (not value/isAudit).
    return fieldHasDbAudit();
  };
  // Value-change audit icon only when change history is available (not merely because a value exists).
  const hasDataAudit = crfAuditEntries.some(
    (entry) => entry.entityId === activity?.id && entry.fieldId === field.id
  ) || fieldHasValueChangeAudit() || hasQueryOnThisField;
  const canRaiseFieldQuery = allowFieldQuery
    && !!onRaiseFieldQuery
    && activity?.reviewStatus !== "Reviewed";
  const showQuery = !!onRaiseFieldQuery && (canRaiseFieldQuery || hasOpenQueryOnField || hasQueryOnThisField);
  // Site users: hide closed-query tint/icons. Reviewers still see closed (green).
  const showDataAudit = hasDataAudit && !!onOpenFieldAudit;
  const queryBtnStage = queryStage ?? "";
  const queryHighlightStage = queryStage
    || (hasOpenQueryOnField ? "raised" : "");
  const fieldLocked = viewOnly || runtime.disabled || runtime.readonly
    || (isFieldEditable ? !isFieldEditable(field.id) : false);
  const canResolveQuery = !viewOnly && hasQueryOnField && !!onResolveQuery;
  const showChangeRemark = Boolean(
    requiresChangeRemark
    && !viewOnly
    && fieldNeedsChangeRemark?.(field.id)
  );
  const fieldRemarkText = changeRemarkText?.(field.id) ?? "";
  const fieldRemarkConfirmed = Boolean(changeRemarkConfirmed?.(field.id));
  const help = String(field.helpText || "").trim();
  const showStackedLabel = !hideLabel && !inline;

  const control = (
    <>
      {runtime.dependencyMessage ? (
        <small className="crf-form__help crf-form__help--dependency">{runtime.dependencyMessage}</small>
      ) : null}

      <CrfFormInput
        field={field}
        value={values[field.id]}
        error={errors[field.id] || ""}
        viewOnly={fieldLocked}
        runtime={runtime}
        onChange={onChange}
      />

      {showChangeRemark && !fieldRemarkConfirmed ? (
        <EditFieldRemarkAttach
          show
          floating
          className="crf-form__change-remark-attach"
          value={fieldRemarkText}
          onChange={(value) => {
            setChangeRemarkText?.(field.id, value);
            setErrors((current) => {
              if (!current.form) return current;
              const next = { ...current };
              delete next.form;
              return next;
            });
          }}
          onConfirm={() => {
            if (!String(fieldRemarkText || "").trim()) return;
            setChangeRemarkConfirmed?.(field.id, true);
            setErrors((current) => {
              if (!current.form) return current;
              const next = { ...current };
              delete next.form;
              return next;
            });
          }}
          toast={(message) => setErrors({ form: message })}
          emptyConfirmMessage="Enter a reason before confirming."
          placeholder={`Reason for changing ${field.label || "this field"}`}
          ariaLabel={`Reason for changing ${field.label || "field"}`}
          rows={2}
        />
      ) : null}

      {errors[field.id] ? (
        <small id={`crf-field-${field.id}-error`} className="crf-form__error">{errors[field.id]}</small>
      ) : null}
    </>
  );

  const labelRow = (
    <span className="crf-form__label-row" id={hideLabel || inline ? undefined : `crf-field-${field.id}-label`}>
      <span className="crf-form__label crf-modal__field-label">
        {field.label}
        {runtime.required ? <span className="crf-form__required"> *</span> : null}
        <CrfHelpIcon help={help} />
      </span>
      <span className="crf-form__label-actions">
        {canResolveQuery ? (
          <button
            type="button"
            className="btn btn--sm btn--primary crf-form__resolve-btn"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onResolveQuery(field.id, queryFieldKey);
            }}
          >
            Resolve
          </button>
        ) : null}
        {showQuery ? (
          <CrfQueryButton
            label={hasOpenQueryOnField ? `View query on ${field.label}` : `Raise query on ${field.label}`}
            title={hasOpenQueryOnField ? "View query" : "Raise query"}
            stage={queryBtnStage}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (canRaiseFieldQuery) {
                onRaiseFieldQuery(field.id, queryFieldKey);
                return;
              }
              if (onOpenQueryAudit && (activity?.reviewStatus === "Reviewed" || !allowFieldQuery)) {
                onOpenQueryAudit(field.id, queryFieldKey);
                return;
              }
              onRaiseFieldQuery(field.id, queryFieldKey);
            }}
          />
        ) : null}
        {showDataAudit ? (
          <CrfAuditButton
            label={`View ${field.label} value audit`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenFieldAudit(field.id);
            }}
          />
        ) : null}
        {showChangeRemark && fieldRemarkConfirmed ? (
          <button
            type="button"
            className="edit-field-remark-toolbar__btn edit-field-remark-toolbar__btn--reopen"
            title={fieldRemarkText.trim() || "Edit reason"}
            aria-label={`Edit reason for ${field.label || "field"}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setChangeRemarkConfirmed?.(field.id, false);
            }}
          >
            <i className="fas fa-times" aria-hidden />
          </button>
        ) : null}
      </span>
    </span>
  );

  const fieldClassName = [
    "crf-form__field",
    "crf-modal__field",
    inline ? "crf-form__field--inline" : "crf-form__field--stack",
    fullRow ? "crf-form__field--full" : "",
    showChangeRemark ? "field--with-audit crf-form__field--change-remark" : "",
    queryHighlightStage ? `crf-form__field--query crf-form__field--query-${queryHighlightStage}` : "",
    queryHighlightStage ? getReviewQueryStageCellClass(queryHighlightStage) : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={fieldClassName}
      style={fullRow ? { gridColumn: "1 / -1" } : undefined}
    >
      {(showStackedLabel || inline) ? (
        <div
          className={[
            "crf-form__inline-label",
            fullRow && inline ? "crf-form__inline-label--wide" : "",
          ].filter(Boolean).join(" ")}
        >
          {labelRow}
        </div>
      ) : null}
      <div className="crf-form__inline-control">{control}</div>
    </div>
  );
}

function CrfBlocksGrid(props) {
  const { items } = props;
  return (
    <div className="crf-form__grid crf-modal__grid">
      {(items ?? []).map((item, index) => {
        const kind = String(item?.kind || "").toLowerCase();
        if (kind === "field" && item.field) {
          return (
            <CrfFieldBlock
              key={item.id || item.field.id || `field-${index}`}
              item={item}
              {...props}
            />
          );
        }
        if (kind === "instruction") {
          return (
            <div key={item.id || `ins-${index}`} className="crf-form__field--full" style={{ gridColumn: "1 / -1" }}>
              <CrfInstructionBlock item={item} />
            </div>
          );
        }
        if (kind === "subsection") {
          return (
            <div
              key={item.id || `sub-${index}`}
              className="crf-form__subsection"
              style={{ gridColumn: "1 / -1" }}
            >
              <div className="crf-form__subsection-title">{item.name || "Subsection"}</div>
              <CrfBlocksGrid {...props} items={item.items || []} />
            </div>
          );
        }
        if (kind === "section") {
          return (
            <div
              key={item.id || `nested-sec-${index}`}
              className="crf-form__subsection"
              style={{ gridColumn: "1 / -1" }}
            >
              {item.name ? (
                <div className="crf-form__subsection-title">{item.name}</div>
              ) : null}
              <CrfBlocksGrid {...props} items={item.items || []} />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function CrfForm({
  formId,
  definition,
  activity,
  sample,
  visit,
  savedValues,
  crfAuditEntries = [],
  onOpenFieldAudit,
  onOpenQueryAudit,
  onRaiseFieldQuery,
  onResolveQuery,
  allowFieldQuery = false,
  isFieldEditable,
  hideClosedQueries = false,
  submitError = "",
  onClearSubmitError,
  viewOnly = false,
  onSave,
}) {
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  /** fieldId → { text, confirmed } for value-change remarks */
  const [changeRemarksByFieldId, setChangeRemarksByFieldId] = useState({});
  const [dependencyAlert, setDependencyAlert] = useState("");

  const activityId = activity?.id ?? "";
  const definitionId = definition?.id ?? "";
  const activeFieldItems = useMemo(() => getCrfActiveFieldItems(definition), [definition]);
  const displaySections = useMemo(
    () => syncSectionsFromItems(definition?.items ?? []),
    [definition]
  );
  const runtimeContext = useMemo(() => subjectRuntimeContext(activity), [activity]);

  useEffect(() => {
    if (!definition || !activityId) return;
    const seeded = buildCrfInitialValues(definition, activity, sample, savedValues, visit);
    const fields = getCrfActiveFieldItems(definition);
    const reacted = applyDraftDependencyReactions(fields, seeded, {
      context: subjectRuntimeContext(activity),
    });
    setValues(reacted.values);
    if (reacted.alertMessage) setDependencyAlert(reacted.alertMessage);
    else setDependencyAlert("");
    setErrors({});
    setChangeRemarksByFieldId({});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per activity/definition
  }, [activityId, definitionId]);

  const crfFieldUpdates = useMemo(
    () => getCrfFieldUpdates(definition, activity, sample, visit, savedValues, values),
    [definition, activity, sample, visit, savedValues, values]
  );
  const requiresChangeRemark = crfFieldUpdates.length > 0;
  const changedFieldIdSet = useMemo(
    () => new Set(crfFieldUpdates.map((u) => u.fieldId).filter(Boolean)),
    [crfFieldUpdates]
  );

  useEffect(() => {
    setChangeRemarksByFieldId((prev) => {
      const next = {};
      let changed = false;
      for (const fieldId of changedFieldIdSet) {
        if (prev[fieldId]) next[fieldId] = prev[fieldId];
        else changed = true;
      }
      if (!changed && Object.keys(prev).length === Object.keys(next).length) {
        return prev;
      }
      return next;
    });
  }, [changedFieldIdSet]);

  const softAlertMessage = errors.form || submitError || dependencyAlert;
  const clearSoftAlert = () => {
    setDependencyAlert("");
    setErrors((current) => {
      if (!current.form) return current;
      const next = { ...current };
      delete next.form;
      return next;
    });
    onClearSubmitError?.();
  };

  if (!definition) return null;

  const getChangeRemarkText = (fieldId) => String(changeRemarksByFieldId[fieldId]?.text ?? "");
  const isChangeRemarkConfirmed = (fieldId) => Boolean(changeRemarksByFieldId[fieldId]?.confirmed);
  const setChangeRemarkText = (fieldId, text) => {
    setChangeRemarksByFieldId((prev) => ({
      ...prev,
      [fieldId]: {
        text: String(text ?? ""),
        confirmed: false,
      },
    }));
  };
  const setFieldChangeRemarkConfirmed = (fieldId, confirmed) => {
    setChangeRemarksByFieldId((prev) => ({
      ...prev,
      [fieldId]: {
        text: String(prev[fieldId]?.text ?? ""),
        confirmed: Boolean(confirmed),
      },
    }));
  };

  const handleChange = (fieldId, nextValue) => {
    setValues((current) => {
      const withValue = { ...current, [fieldId]: nextValue };
      return applyDraftDependencyReactions(activeFieldItems, withValue, {
        skipFieldId: fieldId,
        context: runtimeContext,
      }).values;
    });
    setChangeRemarksByFieldId((prev) => ({
      ...prev,
      [fieldId]: {
        text: String(prev[fieldId]?.text ?? ""),
        confirmed: false,
      },
    }));
    onClearSubmitError?.();
    setErrors((current) => {
      if (!current[fieldId] && !current.form) return current;
      const next = { ...current };
      delete next[fieldId];
      delete next.form;
      return next;
    });
  };

  // Soft toast when dependency alertMessage appears (one-shot per message text).
  useEffect(() => {
    if (!activeFieldItems.length) return;
    let msg = null;
    for (const item of activeFieldItems) {
      const field = item?.field;
      if (!field) continue;
      const runtime = getFieldRuntimeState(field, values, runtimeContext);
      if (runtime.dependencyAlertMessage) msg = runtime.dependencyAlertMessage;
    }
    if (msg) {
      setDependencyAlert((prev) => (prev === msg ? prev : msg));
    }
  }, [values, activeFieldItems, runtimeContext]);

  const resolveSaveMode = (event) => {
    const submitter = event?.nativeEvent?.submitter;
    const active = typeof document !== "undefined" ? document.activeElement : null;
    const formEl = event?.currentTarget;
    const fromSubmitter = submitter?.getAttribute?.("data-save-mode") || submitter?.dataset?.saveMode;
    const fromActive = active?.getAttribute?.("data-save-mode") || active?.dataset?.saveMode;
    const fromForm = formEl?.getAttribute?.("data-pending-save-mode") || formEl?.dataset?.pendingSaveMode;
    const mode = String(fromSubmitter || fromActive || fromForm || "save").trim().toLowerCase();
    if (formEl?.removeAttribute) {
      formEl.removeAttribute("data-pending-save-mode");
    }
    return mode;
  };

  const handleSubmit = async (event) => {
    const mode = resolveSaveMode(event);
    const asDraft = mode === "draft";

    if (!asDraft) {
      const nextErrors = {};
      for (const item of activeFieldItems) {
        const field = item.field;
        if (!field) continue;
        const runtime = getFieldRuntimeState(field, values, runtimeContext);
        const msg = validateFieldValue(field, values[field.id], runtime);
        if (msg) nextErrors[field.id] = msg;
      }
    if (Object.keys(nextErrors).length) {
        setErrors({ ...nextErrors, form: Object.values(nextErrors)[0] });
      return false;
      }
    }

    if (requiresChangeRemark) {
      const missing = crfFieldUpdates.find((update) => {
        const entry = changeRemarksByFieldId[update.fieldId];
        return !String(entry?.text || "").trim() || !entry?.confirmed;
      });
      if (missing) {
        const label = missing.field?.label || missing.fieldId || "a field";
        setErrors({
          form: `Enter and confirm a reason for each changed field (missing: ${label}).`,
        });
      return false;
      }
    }

    const changeReasonsByFieldId = {};
    for (const update of crfFieldUpdates) {
      const text = String(changeRemarksByFieldId[update.fieldId]?.text || "").trim();
      if (update.fieldId && text) {
        changeReasonsByFieldId[update.fieldId] = text;
      }
    }

    const saved = await onSave?.(values, changeReasonsByFieldId, { asDraft });
    return saved !== false;
  };

  const blockProps = {
    values,
    errors,
    viewOnly,
    activity,
    crfAuditEntries,
    onOpenFieldAudit,
    onOpenQueryAudit,
    onRaiseFieldQuery,
    onResolveQuery,
    allowFieldQuery,
    isFieldEditable,
    hideClosedQueries,
    requiresChangeRemark,
    fieldNeedsChangeRemark: (fieldId) => changedFieldIdSet.has(fieldId),
    changeRemarkText: getChangeRemarkText,
    changeRemarkConfirmed: isChangeRemarkConfirmed,
    setChangeRemarkText,
    setChangeRemarkConfirmed: setFieldChangeRemarkConfirmed,
    setErrors,
    onClearSubmitError,
    onChange: handleChange,
  };

  return (
    <form
      id={formId}
      className="crf-form crf-form--preview"
      onSubmit={(event) => {
      event.preventDefault();
        void handleSubmit(event);
      }}
    >
      <div className="crf-form__sheet">
        {displaySections.map((sec, idx) => {
          const titled = !sec.hideHeader && String(sec.name || "").trim().length > 0;
          const sep = idx > 0 && !titled;
          return (
            <div
              key={sec.id || `sec-${idx}`}
              className={[
                "crf-form__section-wrap",
                sep ? "crf-form__section-wrap--sep" : "",
                titled && idx > 0 ? "crf-form__section-wrap--spaced" : "",
              ].filter(Boolean).join(" ")}
            >
              {titled ? (
                <section className="crf-form__section">
                  <header className="crf-form__section-header">{sec.name || "Section"}</header>
                  <div className="crf-form__section-body">
                    <CrfBlocksGrid {...blockProps} items={sec.items || []} />
                  </div>
                </section>
              ) : (
                <CrfBlocksGrid {...blockProps} items={sec.items || []} />
              )}
            </div>
          );
        })}
      </div>

      {softAlertMessage ? (
        <SoftAlertToast
          title="Alert"
          message={softAlertMessage}
          variant="warning"
          onClose={clearSoftAlert}
        />
      ) : null}

      <button type="submit" className="crf-form__submit-proxy" hidden aria-hidden tabIndex={-1} />
    </form>
  );
}

export { CrfForm, CrfFormInput };
