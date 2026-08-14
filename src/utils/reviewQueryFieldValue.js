import { buildCrfInitialValues, getCrfDefinitionForActivity, getCrfActiveFieldItems } from "../services/crfService";
import {
  formatDateTimeLocal,
  formatDisplayTime,
  resolveActivitySample,
  resolveCentrifugeStartTime
} from "../services/workflowService";

function normalizeReviewQueryFieldKey(fieldKey) {
  if (!fieldKey) return "";
  if (fieldKey.startsWith("crf:")) return fieldKey;
  return /^[0-9a-f-]{36}$/i.test(fieldKey) ? `crf:${fieldKey}` : fieldKey;
}

function getReviewQueryCrfField(activity, fieldKey) {
  const normalizedKey = normalizeReviewQueryFieldKey(fieldKey);
  if (!normalizedKey.startsWith("crf:")) return null;
  const fieldId = normalizedKey.slice(4);
  const definition = getCrfDefinitionForActivity(activity);
  if (!definition) return null;
  const item = getCrfActiveFieldItems(definition).find((entry) => entry.field?.id === fieldId);
  return item?.field ?? null;
}

/**
 * @returns {"datetime"|"time"|"date"|"number"|"textarea"|"text"}
 */
function getReviewQueryFieldEditType(fieldKey, activity = null) {
  const normalizedKey = normalizeReviewQueryFieldKey(fieldKey);
  if (normalizedKey === "actual" || normalizedKey === "scanStart") return "datetime";
  if (normalizedKey === "remark") return "textarea";

  const crfField = getReviewQueryCrfField(activity, normalizedKey);
  if (crfField) {
    const type = String(crfField.type ?? "text").trim().toLowerCase();
    if (type === "time") return "time";
    if (type === "date") return "date";
    if (type === "number") return "number";
    if (type === "datetime" || type === "datetime-local") return "datetime";
    if (type === "pk-label-auto") return "text";
    if (type === "text" && String(crfField.label ?? "").toLowerCase().includes("remark")) {
      return "textarea";
    }
    return type === "textarea" ? "textarea" : "text";
  }

  return "text";
}

function getReviewQueryFieldEditUnit(fieldKey, activity = null) {
  const crfField = getReviewQueryCrfField(activity, fieldKey);
  return String(crfField?.unit ?? "").trim();
}

function resolveReviewQueryCrfFieldValue(activity, fieldId, { samples = [], visits = [] } = {}) {
  const definition = getCrfDefinitionForActivity(activity);
  const sample = resolveActivitySample(samples, activity);
  const visit = visits.find((item) => item.id === activity.visitId) ?? null;
  const definitionIds = definition
    ? [definition.id, ...Object.keys(activity.crfResponses ?? {})]
    : Object.keys(activity.crfResponses ?? {});

  for (const definitionId of [...new Set(definitionIds)]) {
    const savedValues = activity.crfResponses?.[definitionId]?.values ?? {};
    if (savedValues[fieldId] !== undefined && savedValues[fieldId] !== null) {
      return String(savedValues[fieldId]).trim();
    }
  }

  const directValues = activity.crfValues && typeof activity.crfValues === "object"
    ? activity.crfValues
    : null;
  if (directValues && directValues[fieldId] !== undefined && directValues[fieldId] !== null) {
    return String(directValues[fieldId]).trim();
  }

  if (definition) {
    const savedValues = activity.crfResponses?.[definition.id]?.values ?? {};
    const values = buildCrfInitialValues(definition, activity, sample, savedValues, visit);
    return String(values[fieldId] ?? "").trim();
  }

  return "";
}

function isMeaningfulReviewQueryValue(value) {
  if (value === null || value === undefined) return false;
  const str = String(value).trim();
  return str !== "" && str !== "-" && str !== "\u2014";
}

function hasReviewQueryFieldData(activity, fieldKey, { samples = [], visits = [] } = {}) {
  if (!activity || !fieldKey) return false;

  const sample = resolveActivitySample(samples, activity);
  const normalizedKey = normalizeReviewQueryFieldKey(fieldKey);

  if (normalizedKey === "actual") {
    return isMeaningfulReviewQueryValue(activity.actualTime) || !!activity.fieldIds?.ActualTime;
  }

  if (normalizedKey === "remark") {
    return isMeaningfulReviewQueryValue(activity.remarks) || !!activity.fieldIds?.Remarks;
  }

  if (normalizedKey === "scanStart") {
    const value = resolveCentrifugeStartTime(activity, sample);
    return isMeaningfulReviewQueryValue(value) || !!activity.fieldIds?.CentrifugationStart;
  }

  if (normalizedKey.startsWith("crf:")) {
    const fieldId = normalizedKey.slice(4);
    for (const definitionId of Object.keys(activity.crfResponses ?? {})) {
      const savedValue = activity.crfResponses?.[definitionId]?.values?.[fieldId];
      if (isMeaningfulReviewQueryValue(savedValue)) return true;
    }
    return !!activity.fieldIds?.[fieldId];
  }

  return false;
}

function resolveReviewQueryFieldValue(activity, fieldKey, { samples = [], visits = [] } = {}) {
  if (!activity || !fieldKey) return "-";

  const sample = resolveActivitySample(samples, activity);
  const visit = visits.find((item) => item.id === activity.visitId) ?? null;

  if (fieldKey === "actual") {
    return activity.actualTime ? formatDisplayTime(activity.actualTime) : "-";
  }

  if (fieldKey === "remark") {
    return String(activity.remarks ?? "").trim() || "-";
  }

  if (fieldKey === "scanStart") {
    const value = resolveCentrifugeStartTime(activity, sample);
    return value ? formatDisplayTime(value) : "-";
  }

  const normalizedKey = normalizeReviewQueryFieldKey(fieldKey);

  if (normalizedKey.startsWith("crf:")) {
    const fieldId = normalizedKey.slice(4);
    const resolved = resolveReviewQueryCrfFieldValue(activity, fieldId, { samples, visits });
    return resolved || "-";
  }

  return "-";
}

function getReviewQueryFieldEditValue(activity, fieldKey, { samples = [], visits = [] } = {}) {
  if (!activity || !fieldKey) return "";

  const sample = resolveActivitySample(samples, activity);
  const normalizedKey = normalizeReviewQueryFieldKey(fieldKey);

  if (normalizedKey === "actual") {
    return activity.actualTime ? formatDateTimeLocal(activity.actualTime) : "";
  }

  if (normalizedKey === "remark") {
    return String(activity.remarks ?? "").trim();
  }

  if (normalizedKey === "scanStart") {
    const value = resolveCentrifugeStartTime(activity, sample);
    return value ? formatDateTimeLocal(value) : "";
  }

  if (normalizedKey.startsWith("crf:")) {
    return resolveReviewQueryCrfFieldValue(activity, normalizedKey.slice(4), { samples, visits });
  }

  return "";
}

export {
  getReviewQueryCrfField,
  getReviewQueryFieldEditType,
  getReviewQueryFieldEditUnit,
  getReviewQueryFieldEditValue,
  hasReviewQueryFieldData,
  resolveReviewQueryFieldValue
};
