/**
 * Lightweight CRF dependency / validation runtime for Application fill UI.
 * Honors field.dependencyRules, validations, layout, and autoFetch from exported CRF JSON.
 * Aligned with WEB `crfFieldConditions` for visibility / readonly so visit CRF fill
 * does not falsely lock or hide fields when schedule context is absent.
 */

import { validateDobFieldValue } from "./crfDobField.js";

const SKIP_RULE = Symbol("skip-rule");
const LEGACY_RULE_ID = "__legacyVisibility";

function normalizeRaw(v) {
  if (Array.isArray(v)) return v.map(String).join(",");
  if (v === true) return "true";
  if (v === false) return "false";
  return v == null ? "" : String(v).trim();
}

/** Resolve a draft value by exact id or 8-char UUID prefix (eCRF condition ids). */
function fieldValue(data, fieldId) {
  if (!fieldId || !data) return "";
  const id = String(fieldId).trim();
  if (!id) return "";
  if (Object.prototype.hasOwnProperty.call(data, id)) {
    return normalizeRaw(data[id]);
  }
  if (id.length < 36) {
    const key = Object.keys(data).find((k) => k.startsWith(id));
    if (key) return normalizeRaw(data[key]);
  }
  return "";
}

export function resolveFieldIdByPrefix(prefix, allFields) {
  if (!prefix || typeof prefix !== "string") return "";
  if (prefix.length === 36) return prefix;
  const found = (allFields || []).find((f) => {
    const id = f?.id || f?.fieldId || f?.value;
    return id && String(id).startsWith(prefix);
  });
  return found ? (found.id || found.fieldId || found.value) : prefix;
}

function fieldHasExplicitDependencyRules(field) {
  return Array.isArray(field?.dependencyRules) && field.dependencyRules.length > 0;
}

/**
 * Normalize to rules array. Legacy conditionField/conditionValue become show-when-equals
 * with elseActions that hide (WEB parity).
 */
export function normalizeDependencyRules(field) {
  if (!field) return [];

  if (fieldHasExplicitDependencyRules(field)) {
    return field.dependencyRules
      .filter((r) => r && typeof r === "object")
      .map((r) => ({
        ...r,
        conditions: Array.isArray(r.conditions) ? r.conditions.map((c) => ({ ...c })) : [],
        actions: Array.isArray(r.actions) ? r.actions.map((a) => ({ ...a })) : [],
        elseActions: Array.isArray(r.elseActions) ? r.elseActions.map((a) => ({ ...a })) : [],
      }));
  }

  const cf = String(field.conditionField ?? "").trim();
  const cv = field.conditionValue;
  const hasLegacy = cf && cv != null && String(cv).trim() !== "";
  if (!hasLegacy) return [];

  const baseReq = field.required === true;
  return [
    {
      id: LEGACY_RULE_ID,
      isActive: true,
      priority: 0,
      logicalOperator: "AND",
      conditions: [{ fieldId: cf, operator: "equals", value: String(cv) }],
      actions: [
        { type: "visible", value: true },
        { type: "required", value: baseReq },
      ],
      elseActions: [
        { type: "visible", value: false },
        { type: "required", value: false },
      ],
    },
  ];
}

function compareGreaterLess(left, right, mode) {
  const n = Number(left);
  const m = Number(right);
  if (!Number.isNaN(n) && !Number.isNaN(m) && String(right).trim() !== "") {
    return mode === "gt" ? n > m : n < m;
  }
  const ls = String(left ?? "");
  const rs = String(right ?? "");
  return mode === "gt" ? ls > rs : ls < rs;
}

function evalCondition(cond, data) {
  if (!cond || typeof cond !== "object") return false;
  const op = String(cond.operator || "equals").trim();
  const opKey = op.toLowerCase();

  // Schedule-window ops need activity context Application fill often lacks.
  // Never fall through to equals (empty === empty) — that falsely matches and then
  // flips when the user enters a time, locking/hiding sibling fields.
  if (opKey === "samplingwindowoutside") {
    return SKIP_RULE;
  }

  if (!cond.fieldId) return false;

  const left = fieldValue(data, cond.fieldId);
  const right = cond.value == null ? "" : String(cond.value).trim();
  const values = cond.values;

  switch (opKey) {
    case "equals":
    case "eq":
    case "==":
      return left.toLowerCase() === right.toLowerCase();
    case "notequals":
    case "neq":
    case "!=":
      return left.toLowerCase() !== right.toLowerCase();
    case "isempty":
    case "empty":
      return !left;
    case "isnotempty":
    case "notempty":
      return !!left;
    case "contains":
      return left.toLowerCase().includes(right.toLowerCase());
    case "notcontains":
      return !left.toLowerCase().includes(right.toLowerCase());
    case "in": {
      let list = [];
      if (Array.isArray(values) && values.length) list = values;
      else if (Array.isArray(cond.value)) list = cond.value;
      else if (typeof cond.value === "string" && cond.value.includes(",")) {
        list = cond.value.split(",").map((s) => s.trim()).filter(Boolean);
      } else if (right) list = [right];
      return list.map(String).includes(left);
    }
    case "notin": {
      let list = [];
      if (Array.isArray(values) && values.length) list = values;
      else if (Array.isArray(cond.value)) list = cond.value;
      else if (typeof cond.value === "string" && cond.value.includes(",")) {
        list = cond.value.split(",").map((s) => s.trim()).filter(Boolean);
      } else if (right) list = [right];
      return !list.map(String).includes(left);
    }
    case "gt":
    case ">":
    case "greaterthan":
      // Incomplete greaterThan (no compare value): non-match (WEB Number(x) > NaN → false).
      if (cond.value === undefined || cond.value === null || right === "") return false;
      return compareGreaterLess(left, right, "gt");
    case "gte":
    case ">=":
      if (right === "") return false;
      return Number(left) >= Number(right);
    case "lt":
    case "<":
    case "lessthan":
      if (cond.value === undefined || cond.value === null || right === "") return false;
      return compareGreaterLess(left, right, "lt");
    case "lte":
    case "<=":
      if (right === "") return false;
      return Number(left) <= Number(right);
    default:
      // Unknown / unsupported operators: skip the whole rule (do not run elseActions).
      return SKIP_RULE;
  }
}

function evalRule(rule, data) {
  const conditions = Array.isArray(rule?.conditions) ? rule.conditions : [];
  if (!conditions.length) return true;
  const results = conditions.map((c) => evalCondition(c, data));
  if (results.some((r) => r === SKIP_RULE)) return SKIP_RULE;
  const op = String(rule.logicalOperator || "AND").trim().toUpperCase();
  if (op === "OR") return results.some(Boolean);
  return results.every(Boolean);
}

function applyAction(state, action) {
  if (!action || typeof action !== "object") return;
  const type = String(action.type || "").trim().toLowerCase();
  const value = action.value;

  switch (type) {
    case "visible":
      // Match WEB: Boolean(action.value) — missing value → not visible.
      state.visible = Boolean(value);
      break;
    case "show":
      state.visible = value !== false && value !== "false" && value !== 0;
      break;
    case "hide":
      state.visible = false;
      break;
    case "required":
      state.required = value === true || value === "true" || value === 1;
      break;
    case "disabled":
    case "disable":
      state.disabled = value === true || value === "true" || value === 1;
      break;
    case "readonly":
      state.readonly = value === true || value === "true" || value === 1;
      break;
    case "setvalue":
      state.setValue = value;
      state.clearValue = false;
      break;
    case "clearvalue":
      if (value === false || value === "false" || value === 0) state.clearValue = false;
      else state.clearValue = true;
      break;
    case "showmessage":
      state.dependencyMessage = action.message || (typeof value === "string" ? value : null);
      break;
    case "alertmessage":
      state.dependencyAlertMessage =
        String(action.message ?? action.value ?? "").trim() || null;
      break;
    default:
      break;
  }
}

function isAutoFetchReadOnly(field) {
  const af = field?.autoFetch;
  if (!af || typeof af !== "object") return false;
  if (af.allowManualEdit === true) return false;
  const en = af.enabled;
  const enabled = en === true || en === 1 || en === "1" || String(en).toLowerCase() === "true";
  // Only hard-lock when auto-fetch is explicitly enabled (Activity Mapping often has no schedule).
  return enabled;
}

function isTruthyFlag(v) {
  return v === true || v === 1 || v === "1" || v === "true" || String(v).toLowerCase() === "yes";
}

/**
 * Normalize fieldFlags from object / CSV / legacy top-level props.
 * Preserves DuplicateCheck / IsAudit metadata; maps DisableOnRescreen ↔ reScreening.
 */
export function normalizeFieldFlags(field) {
  const flags = {
    disableOnRescreen: false,
    reScreening: false,
    duplicateCheck: false,
    isAudit: false,
  };
  if (!field || typeof field !== "object") return flags;

  const raw = field.fieldFlags;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      const keyL = String(k).trim().toLowerCase();
      if (keyL === "disableonrescreen" || keyL === "rescreening") {
        flags.disableOnRescreen = isTruthyFlag(v);
        flags.reScreening = flags.disableOnRescreen;
      } else if (keyL === "duplicatecheck") {
        flags.duplicateCheck = isTruthyFlag(v);
      } else if (keyL === "isaudit" || keyL === "audit") {
        flags.isAudit = isTruthyFlag(v);
      }
    }
  } else if (typeof raw === "string" && raw.trim()) {
    for (const part of raw.split(",")) {
      const keyL = part.trim().toLowerCase();
      if (keyL === "disableonrescreen" || keyL === "rescreening") {
        flags.disableOnRescreen = true;
        flags.reScreening = true;
      } else if (keyL === "duplicatecheck") {
        flags.duplicateCheck = true;
      } else if (keyL === "isaudit" || keyL === "audit") {
        flags.isAudit = true;
      }
    }
  }

  // Legacy top-level props on the field
  if (isTruthyFlag(field.DisableOnRescreen) || isTruthyFlag(field.disableOnRescreen)
    || isTruthyFlag(field.reScreening) || isTruthyFlag(field.ReScreening)) {
    flags.disableOnRescreen = true;
    flags.reScreening = true;
  }
  if (isTruthyFlag(field.DuplicateCheck) || isTruthyFlag(field.duplicateCheck)) {
    flags.duplicateCheck = true;
  }
  if (isTruthyFlag(field.IsAudit) || isTruthyFlag(field.isAudit)
    || (field.setAuditDetails && typeof field.setAuditDetails === "object")) {
    flags.isAudit = true;
  }

  return flags;
}

function subjectNeedsRescreenLock(context) {
  if (!context || typeof context !== "object") return false;
  if (context.isScreeningFailure === true) return true;
  const status = String(context.patientStatus || "").trim().toLowerCase();
  return status === "screening failure"
    || status === "screeningfailure"
    || status === "rescreen"
    || status === "re-screening"
    || status.includes("rescreen");
}

/**
 * @param {object} field
 * @param {Record<string, unknown>} data
 * @param {{ isScreeningFailure?: boolean, patientStatus?: string } | null} [context]
 */
export function getFieldRuntimeState(field, data, context) {
  const rules = normalizeDependencyRules(field);
  const baseRequired = field?.required === true;
  const autoFetchReadOnly = isAutoFetchReadOnly(field);
  const flags = normalizeFieldFlags(field);
  const rescreenLock = flags.disableOnRescreen && subjectNeedsRescreenLock(context);

  if (!rules.length) {
    return {
      visible: field?.active !== false,
      required: baseRequired,
      disabled: rescreenLock,
      readonly: autoFetchReadOnly || rescreenLock,
      dependencyMessage: null,
      dependencyAlertMessage: null,
      clearValue: false,
      setValue: undefined,
      fieldFlags: flags,
    };
  }

  const state = {
    visible: undefined,
    required: undefined,
    disabled: undefined,
    readonly: undefined,
    dependencyMessage: null,
    dependencyAlertMessage: null,
    clearValue: false,
    setValue: undefined,
    fieldFlags: flags,
  };

  const sorted = [...rules]
    .filter((r) => r && r.isActive !== false)
    .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));

  for (const rule of sorted) {
    const match = evalRule(rule, data);
    // Unevaluable schedule rules: skip entirely (do not run elseActions either).
    if (match === SKIP_RULE) continue;
    const acts = match ? rule.actions || [] : rule.elseActions || [];
    for (const a of acts) applyAction(state, a);
  }

  if (state.visible === undefined) state.visible = field?.active !== false;
  if (state.required === undefined) state.required = baseRequired;
  if (state.disabled === undefined) state.disabled = false;
  if (state.readonly === undefined) state.readonly = autoFetchReadOnly;

  if (rescreenLock) {
    state.readonly = true;
    state.disabled = true;
  } else if (autoFetchReadOnly) {
    state.readonly = true;
  }

  if (!state.visible) {
    state.required = false;
    state.disabled = false;
    state.readonly = false;
  }

  return state;
}

export function isFullRowLayout(field) {
  const layout = String(field?.layout || "").toLowerCase();
  return layout.startsWith("full-") || field?.fullRow === true || field?.colSpan === "full";
}

export function isInlineLayout(field) {
  const layout = String(field?.layout || "").toLowerCase();
  return layout.endsWith("-inline") || layout === "inline";
}

/** Layout flags matching WEB `fieldLayoutFlags` (half/full × stack/inline). */
export function getFieldLayoutFlags(field) {
  return {
    isInline: isInlineLayout(field),
    isFullRow: isFullRowLayout(field),
  };
}

export function inputWidthModifierForType(type) {
  const t = String(type || "").toLowerCase();
  if (t === "date" || t === "time") return "crf-form__input--narrow";
  if (t === "datetime" || t === "datetime-local") return "crf-form__input--datetime";
  return "";
}

export function normalizeFieldOptions(field) {
  const raw = field?.options;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((opt) => {
      if (opt == null) return null;
      if (typeof opt === "string" || typeof opt === "number") {
        const s = String(opt).trim();
        return s ? { value: s, label: s } : null;
      }
      if (typeof opt === "object") {
        const value = String(opt.value ?? opt.id ?? opt.label ?? opt.text ?? "").trim();
        const label = String(opt.label ?? opt.text ?? opt.value ?? value).trim();
        return value ? { value, label: label || value } : null;
      }
      return null;
    })
    .filter(Boolean);
}

function deserializeAgeSource(source) {
  // ageCalc:dob=...;end=...;fmt=...
  const raw = String(source || "").replace(/^ageCalc:/i, "");
  const parts = Object.fromEntries(
    raw.split(";").map((p) => {
      const [k, ...rest] = p.split("=");
      return [String(k || "").trim(), rest.join("=").trim()];
    }).filter(([k]) => k)
  );
  return {
    ageSourceFieldId: parts.dob || parts.source || "",
    ageEndFieldId: parts.end || parts.endDate || "",
    ageYearFieldId: parts.year || "",
    ageMonthFieldId: parts.month || "",
    ageDayFieldId: parts.day || "",
    ageFormat: parts.fmt || parts.format || "numeric",
  };
}

export function normalizeAgeCalculationAutoFetch(autoFetch) {
  const cfg = autoFetch && typeof autoFetch === "object" ? autoFetch : {};
  if (typeof cfg.source === "string" && cfg.source.startsWith("ageCalc:")) {
    return deserializeAgeSource(cfg.source);
  }
  const fields = Array.isArray(cfg.ageSourceFields) ? cfg.ageSourceFields : [];
  const byRole = (role) => {
    const hit = fields.find((f) => String(f?.role || "").trim() === role);
    return String(hit?.fieldId || hit?.id || "").trim();
  };
  const formatRaw = cfg.ageFormat;
  const format = typeof formatRaw === "object" ? formatRaw?.value : formatRaw;
  return {
    ageSourceFieldId: String(cfg.ageSourceFieldId || byRole("dob") || "").trim(),
    ageEndFieldId: String(cfg.ageEndFieldId || byRole("endDate") || "").trim(),
    ageYearFieldId: String(cfg.ageYearFieldId || byRole("year") || "").trim(),
    ageMonthFieldId: String(cfg.ageMonthFieldId || byRole("month") || "").trim(),
    ageDayFieldId: String(cfg.ageDayFieldId || byRole("day") || "").trim(),
    ageFormat: String(format || "numeric").trim() || "numeric",
  };
}

function monthIndexFromName(name) {
  const s = String(name || "").trim().toLowerCase();
  if (!s) return NaN;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  for (let i = 0; i < months.length; i += 1) {
    if (s.startsWith(months[i])) return i;
  }
  return NaN;
}

/**
 * Precise age in years/months/days relative to end date (or today).
 */
export function calculateAge(birthDateStr, endDateStr) {
  const makeDate = (year, month, day) => {
    const temp = new Date(year, month, day);
    if (Number.isNaN(temp.getTime())) return null;
    if (temp.getFullYear() !== year || temp.getMonth() !== month || temp.getDate() !== day) return null;
    return temp;
  };
  const parseDateValue = (raw) => {
    if (!raw || typeof raw !== "string" || !raw.trim()) return null;
    const s = raw.trim();
    const dmyNameRegex = /^(\d{1,2})[/\-\s]([A-Za-z]{3,})[/\-\s](\d{4})$/;
    const dmyNameMatch = s.match(dmyNameRegex);
    if (dmyNameMatch) {
      const day = parseInt(dmyNameMatch[1], 10);
      const month = monthIndexFromName(dmyNameMatch[2]);
      const year = parseInt(dmyNameMatch[3], 10);
      if (year > 1000 && month >= 0 && month < 12 && day > 0 && day <= 31) {
        return makeDate(year, month, day);
      }
    }
    const dmyRegex = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/;
    const dmyMatch = s.match(dmyRegex);
    if (dmyMatch) {
      const day = parseInt(dmyMatch[1], 10);
      const month = parseInt(dmyMatch[2], 10) - 1;
      const year = parseInt(dmyMatch[3], 10);
      if (year > 1000 && month >= 0 && month < 12 && day > 0 && day <= 31) {
        return makeDate(year, month, day);
      }
    }
    const ymdRegex = /^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})$/;
    const ymdMatch = s.match(ymdRegex);
    if (ymdMatch) {
      const year = parseInt(ymdMatch[1], 10);
      const month = parseInt(ymdMatch[2], 10) - 1;
      const day = parseInt(ymdMatch[3], 10);
      if (year > 1000 && month >= 0 && month < 12 && day > 0 && day <= 31) {
        return makeDate(year, month, day);
      }
    }
    const temp = new Date(s);
    return Number.isNaN(temp.getTime()) ? null : temp;
  };

  if (!birthDateStr || typeof birthDateStr !== "string" || !birthDateStr.trim()) {
    return { years: "", months: "", days: "" };
  }

  const birthDate = parseDateValue(birthDateStr);
  if (!birthDate) {
    return { years: "", months: "", days: "" };
  }

  const today = parseDateValue(endDateStr) || new Date();

  let years = today.getFullYear() - birthDate.getFullYear();
  let months = today.getMonth() - birthDate.getMonth();
  let days = today.getDate() - birthDate.getDate();

  if (days < 0) {
    months -= 1;
    const prevMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    days += prevMonth.getDate();
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years < 0) {
    return { years: 0, months: 0, days: 0 };
  }

  return { years, months, days };
}

function isAgeCalcField(field) {
  if (!field) return false;
  if (field.ageSourceFieldId) return true;
  const src = String(field.autoFetch?.source || "");
  return field.autoFetch?.enabled === true
    && (src === "ageCalculation" || src.startsWith("ageCalc:"));
}

/** Normalize `calculationDetails` object or legacy flat field props (WEB parity). */
export function normalizeCalculationDetails(fieldOrValue) {
  if (fieldOrValue == null) {
    return {
      calculationFormula: "",
      calculationFields: [],
      calculationDecimalPlaces: null,
    };
  }

  const details =
    typeof fieldOrValue === "object"
    && !Array.isArray(fieldOrValue)
    && fieldOrValue.calculationDetails != null
      ? fieldOrValue.calculationDetails
      : fieldOrValue;

  if (typeof details === "object" && !Array.isArray(details)) {
    const calculationFormula = String(details.calculationFormula ?? "").trim();
    const calculationFields = Array.isArray(details.calculationFields)
      ? details.calculationFields.map((id) => String(id ?? "").trim()).filter(Boolean)
      : [];
    const rawDp = details.calculationDecimalPlaces;
    const calculationDecimalPlaces =
      rawDp != null && rawDp !== "" && Number.isFinite(Number(rawDp))
        ? Number(rawDp)
        : null;

    return { calculationFormula, calculationFields, calculationDecimalPlaces };
  }

  return {
    calculationFormula: "",
    calculationFields: [],
    calculationDecimalPlaces: null,
  };
}

/**
 * Safe calculation formula evaluation (WEB parity).
 * Replaces [fieldId]/label brackets with numeric values from data.
 */
export function evaluateFormula(formula, relatedFields, data, allFields, decimalPlaces = 4) {
  if (!formula || typeof formula !== "string" || !formula.trim()) return "";

  const resolveFieldVal = (term) => {
    const t = String(term || "").trim().toLowerCase();
    if (!t) return undefined;

    const f = (allFields || []).find((x) =>
      String(x.label || "").trim().toLowerCase() === t
      || String(x.id || "").trim().toLowerCase() === t
    );
    const actualId = f ? f.id : term;
    const fromData = fieldValue(data, actualId);
    if (fromData !== "") return fromData;
    if (data && Object.prototype.hasOwnProperty.call(data, actualId)) {
      return data[actualId];
    }
    return undefined;
  };

  const resolvedRelated = (Array.isArray(relatedFields) ? relatedFields : [])
    .map((fid) => resolveFieldIdByPrefix(String(fid || "").trim(), allFields) || String(fid || "").trim())
    .filter(Boolean);

  if (resolvedRelated.length > 0) {
    for (const fid of resolvedRelated) {
      const val = fieldValue(data, fid);
      if (val === undefined || val === null || String(val).trim() === "") {
        return "";
      }
    }
  }

  let expression = formula;

  const matches = formula.match(/\[([^\]]+)\]/g);
  if (matches) {
    for (const match of matches) {
      const term = match.slice(1, -1);
      const val = resolveFieldVal(term);
      const numVal = val !== undefined && val !== null && val !== "" ? Number(val) : 0;
      expression = expression.replace(match, Number.isNaN(numVal) ? "0" : String(numVal));
    }
  }

  const allFieldKeys = new Set();
  for (const fid of resolvedRelated) {
    allFieldKeys.add(fid);
    const f = (allFields || []).find((x) => x.id === fid);
    if (f?.label) allFieldKeys.add(f.label);
  }

  if (data && typeof data === "object") {
    for (const k of Object.keys(data)) {
      allFieldKeys.add(k);
      const f = (allFields || []).find((x) => x.id === k);
      if (f?.label) allFieldKeys.add(f.label);
    }
  }

  const sortedKeys = Array.from(allFieldKeys).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    const escapedKey = key.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`\\b${escapedKey}\\b`, "g");
    if (regex.test(expression)) {
      const val = resolveFieldVal(key);
      const numVal = val !== undefined && val !== null && val !== "" ? Number(val) : 0;
      expression = expression.replace(regex, Number.isNaN(numVal) ? "0" : String(numVal));
    }
  }

  if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
    return "";
  }

  try {
    // Expression is sanitized to digits/operators only above.
    // eslint-disable-next-line no-new-func
    const result = new Function(`return (${expression})`)();
    if (result === undefined || result === null || !Number.isFinite(result)) {
      return "";
    }
    const dp = Number.isFinite(Number(decimalPlaces)) && Number(decimalPlaces) >= 0
      ? Math.min(10, Math.floor(Number(decimalPlaces)))
      : 4;
    return Number(result.toFixed(dp)).toString();
  } catch {
    return "";
  }
}

/**
 * Apply calculationDetails formulas into working values (mutates copy).
 * @returns {boolean} whether any value changed
 */
export function applyCalculationReactions(activeFieldItems, working, { skipFieldId } = {}) {
  const allFields = (activeFieldItems || []).map((i) => i?.field).filter(Boolean);
  let changed = false;

  for (const field of allFields) {
    if (!field?.id) continue;
    if (skipFieldId && field.id === skipFieldId) continue;
    const calculation = normalizeCalculationDetails(field);
    if (!calculation.calculationFormula) continue;

    const calculatedVal = evaluateFormula(
      calculation.calculationFormula,
      calculation.calculationFields,
      working,
      allFields,
      calculation.calculationDecimalPlaces,
    );
    // WEB: only write when formula yields a value (do not wipe on incomplete inputs).
    if (calculatedVal === "") continue;
    if (String(working[field.id] ?? "") !== calculatedVal) {
      working[field.id] = calculatedVal;
      changed = true;
    }
  }

  return changed;
}

/**
 * Apply ageCalculation autofetch into working values (mutates copy).
 * @returns {boolean} whether any value changed
 */
export function applyAgeCalculationReactions(activeFieldItems, working, { skipFieldId } = {}) {
  const allFields = (activeFieldItems || []).map((i) => i?.field).filter(Boolean);
  let changed = false;

  for (const field of allFields) {
    if (!isAgeCalcField(field)) continue;
    if (skipFieldId && field.id === skipFieldId) continue;

    let ageSourceFieldId = field.ageSourceFieldId || "";
    let ageEndFieldId = "";
    let ageFormat = field.ageFormat || "numeric";
    let ageYearFieldId = "";
    let ageMonthFieldId = "";
    let ageDayFieldId = "";

    if (field.autoFetch?.enabled) {
      const ageCfg = normalizeAgeCalculationAutoFetch(field.autoFetch);
      ageSourceFieldId = resolveFieldIdByPrefix(ageCfg.ageSourceFieldId, allFields) || ageSourceFieldId;
      ageEndFieldId = resolveFieldIdByPrefix(ageCfg.ageEndFieldId, allFields);
      ageFormat = ageCfg.ageFormat || ageFormat;
      ageYearFieldId = resolveFieldIdByPrefix(ageCfg.ageYearFieldId, allFields);
      ageMonthFieldId = resolveFieldIdByPrefix(ageCfg.ageMonthFieldId, allFields);
      ageDayFieldId = resolveFieldIdByPrefix(ageCfg.ageDayFieldId, allFields);
    }

    if (!ageSourceFieldId) continue;

    const dateVal = fieldValue(working, ageSourceFieldId);
    const endDateVal = ageEndFieldId ? fieldValue(working, ageEndFieldId) : "";
    const { years, months, days } = calculateAge(dateVal, endDateVal);
    let valStr = "";
    if (years !== "") {
      valStr = ageFormat === "numeric"
        ? String(years)
        : `${years} years ${months} months and ${days} days`;
    }

    if (String(working[field.id] ?? "") !== valStr) {
      working[field.id] = valStr;
      changed = true;
    }
    if (ageYearFieldId && String(working[ageYearFieldId] ?? "") !== String(years)) {
      working[ageYearFieldId] = String(years);
      changed = true;
    }
    if (ageMonthFieldId && String(working[ageMonthFieldId] ?? "") !== String(months)) {
      working[ageMonthFieldId] = String(months);
      changed = true;
    }
    if (ageDayFieldId && String(working[ageDayFieldId] ?? "") !== String(days)) {
      working[ageDayFieldId] = String(days);
      changed = true;
    }
  }

  return changed;
}

export function coerceTextCase(field, rawValue) {
  if (rawValue == null) return rawValue;
  const mode = String(field?.textCase || "").trim().toLowerCase();
  if (mode !== "upper" && mode !== "lower") return rawValue;
  if (typeof rawValue !== "string") return rawValue;
  return mode === "upper" ? rawValue.toUpperCase() : rawValue.toLowerCase();
}

export function validateFieldValue(field, rawValue, runtime) {
  if (!field || runtime?.visible === false) return "";
  const required = runtime?.required === true;
  const type = String(field.type || "text").toLowerCase();
  let value = rawValue;
  if (Array.isArray(value)) value = value.join(",");
  if (value === true) value = "true";
  if (value === false) value = "false";
  const text = value == null ? "" : String(value).trim();

  if (type === "dob") {
    return validateDobFieldValue(
      field,
      text,
      required,
      `${field.label || "Field"} is required.`
    );
  }

  if (type === "date") {
    if (required && !text) return `${field.label || "Field"} is required.`;
    if (!text) return "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "Enter a valid date";
    return "";
  }

  if (type === "time") {
    if (required && !text) return `${field.label || "Field"} is required.`;
    if (!text) return "";
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(text)) return "Enter a valid time";
    return "";
  }

  if (type === "datetime" || type === "datetime-local") {
    if (required && !text) return `${field.label || "Field"} is required.`;
    if (!text) return "";
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return "Enter a valid date and time";
    return "";
  }

  if (required && !text && type !== "checkbox") {
    return `${field.label || "Field"} is required.`;
  }
  if (required && type === "checkbox" && text !== "true" && text !== "1" && text !== "yes") {
    if (!Array.isArray(field.options) || field.options.length === 0) {
      return `${field.label || "Field"} is required.`;
    }
  }
  if (required && type === "checkbox" && Array.isArray(field.options) && field.options.length > 0 && !text) {
    return `${field.label || "Field"} is required.`;
  }
  if (!text) return "";

  const textCase = String(field.textCase || "").trim().toLowerCase();
  if (textCase === "upper" && text !== text.toUpperCase()) {
    return field.validationMessage || `${field.label || "Field"} must be uppercase.`;
  }
  if (textCase === "lower" && text !== text.toLowerCase()) {
    return field.validationMessage || `${field.label || "Field"} must be lowercase.`;
  }

  const min = field.min != null && field.min !== "" ? Number(field.min) : null;
  const max = field.max != null && field.max !== "" ? Number(field.max) : null;
  if (type === "number" || (min != null && !Number.isNaN(min)) || (max != null && !Number.isNaN(max))) {
    const num = Number(text);
    if (!Number.isNaN(num)) {
      if (min != null && !Number.isNaN(min) && num < min) {
        return field.validationMessage || `${field.label || "Field"} must be at least ${min}.`;
      }
      if (max != null && !Number.isNaN(max) && num > max) {
        return field.validationMessage || `${field.label || "Field"} must be at most ${max}.`;
      }
    }
  }

  const len = Number(field.validationLength);
  if (len > 0 && text.length > len) {
    return field.validationMessage || `${field.label || "Field"} must be at most ${len} characters.`;
  }

  // Treat present validation props as active (WEB fill ignores useValidationRules gate).
  const pattern = String(field.pattern || "").trim();
  if (pattern) {
    try {
      const re = new RegExp(pattern);
      if (!re.test(text)) {
        return field.patternMessage || field.validationMessage || `${field.label || "Field"} is invalid.`;
      }
    } catch {
      // ignore bad pattern
    }
  }

  return "";
}
