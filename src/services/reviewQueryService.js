import { getCrfActiveFieldItems, getCrfDefinitionForActivity } from "./crfService";
import {
  RECORD_QUERY_FIELDS,
  REVIEW_QUERY_STATUS,
  REVIEW_QUERY_STAGE_ACTIONS,
  REVIEW_QUERY_STAGE_LABELS,
} from "../features/review/constants/reviewQueryFields.js";

function getReviewQueryFieldOptions(activity) {
  const options = RECORD_QUERY_FIELDS.map((field) => ({ ...field }));
  const definition = getCrfDefinitionForActivity(activity);
  if (definition) {
    for (const item of getCrfActiveFieldItems(definition)) {
      options.push({
        value: `crf:${item.field.id}`,
        label: item.field.label
      });
    }
  }
  return options;
}

function stripCrfFieldLabelPrefix(label) {
  return String(label ?? "").replace(/^CRF:\s*/i, "").trim();
}

function normalizeReviewQueryFieldKey(fieldKey) {
  if (!fieldKey) return "";
  const key = String(fieldKey).trim();
  if (key.startsWith("crf:")) return key;
  if (/^[0-9a-f-]{36}$/i.test(key)) return `crf:${key}`;
  return key;
}

function reviewQueryFieldKeysMatch(storedKey, fieldKey) {
  if (!storedKey || !fieldKey) return false;
  return normalizeReviewQueryFieldKey(storedKey) === normalizeReviewQueryFieldKey(fieldKey);
}

function resolveReviewQueryFieldLabel(activity, fieldKey) {
  if (!fieldKey) return "";

  const query = findReviewQueryForField(activity, fieldKey);
  if (query?.fieldLabel) return stripCrfFieldLabelPrefix(query.fieldLabel);

  if (
    activity?.reviewQueryFieldLabel
    && reviewQueryFieldKeysMatch(activity.reviewQueryFieldKey, fieldKey)
  ) {
    return stripCrfFieldLabelPrefix(activity.reviewQueryFieldLabel);
  }

  const normalizedKey = normalizeReviewQueryFieldKey(fieldKey);
  const optionLabel = getReviewQueryFieldOptions(activity).find(
    (option) => option.value === normalizedKey || option.value === fieldKey
  )?.label;
  if (optionLabel) return stripCrfFieldLabelPrefix(optionLabel);

  const fieldId = resolveReviewQueryFieldId(normalizedKey);
  if (fieldId) {
    const definition = getCrfDefinitionForActivity(activity);
    const fieldItem = getCrfActiveFieldItems(definition).find((item) => item.field.id === fieldId);
    if (fieldItem?.field?.label) {
      return fieldItem.field.label;
    }
    if (activity?.reviewQueryFieldLabel) {
      return stripCrfFieldLabelPrefix(activity.reviewQueryFieldLabel);
    }
    return "CRF Field";
  }

  return RECORD_QUERY_FIELDS.find((field) => field.value === fieldKey)?.label ?? fieldKey;
}

function resolveReviewQueryFieldId(fieldKey) {
  if (!fieldKey?.startsWith("crf:")) return null;
  return fieldKey.slice(4);
}

function normalizeReviewQueryStatus(rawStatus) {
  const raw = String(rawStatus ?? REVIEW_QUERY_STATUS.RAISED).trim().toLowerCase();
  if (raw === REVIEW_QUERY_STATUS.RESOLVED) return REVIEW_QUERY_STATUS.RESOLVED;
  if (raw === REVIEW_QUERY_STATUS.SENDBACK) return REVIEW_QUERY_STATUS.SENDBACK;
  if (raw === REVIEW_QUERY_STATUS.CLOSED) return REVIEW_QUERY_STATUS.CLOSED;
  return REVIEW_QUERY_STATUS.RAISED;
}

function mapReviewQueryItem(raw) {
  if (!raw) return null;
  const queryText = raw.queryText ?? raw.QueryText ?? raw.reviewQuery ?? null;
  const fieldKey = String(raw.fieldKey ?? raw.FieldKey ?? raw.reviewQueryFieldKey ?? "").trim();
  // Keep field-keyed rows even when query text is temporarily empty so highlights still apply.
  if (!queryText && !fieldKey) return null;
  return {
    activityExecutionQueryNo:
      Number(raw.activityExecutionQueryNo ?? raw.ActivityExecutionQueryNo) || null,
    fieldKey,
    fieldLabel: raw.fieldLabel ?? raw.FieldLabel ?? raw.reviewQueryFieldLabel ?? "",
    queryText: queryText ?? "",
    status: normalizeReviewQueryStatus(raw.status ?? raw.Status ?? raw.reviewQueryStatus),
    responseText: raw.responseText ?? raw.ResponseText ?? raw.reviewQueryResponse ?? "",
    sendbackRemark: raw.sendbackRemark ?? raw.SendbackRemark ?? raw.reviewQuerySendbackRemark ?? "",
    recordedOnUtc: raw.recordedOnUtc ?? raw.RecordedOnUtc ?? raw.reviewQueryAt ?? null,
    resolvedAt: raw.resolvedAt ?? raw.ResolvedAt ?? raw.reviewQueryResolvedAt ?? null,
    closedAt: raw.closedAt ?? raw.ClosedAt ?? raw.reviewQueryClosedAt ?? null,
    performedBy: raw.performedBy ?? raw.PerformedBy ?? "",
    recordedAtOffset: raw.recordedAtOffset ?? raw.RecordedAtOffset ?? ""
  };
}

/** All queries on an activity (multi-field). Falls back to legacy single reviewQuery* fields. */
function getReviewQueries(activity) {
  const list = activity?.reviewQueries ?? activity?.queries ?? activity?.Queries;
  if (Array.isArray(list) && list.length) {
    return list.map(mapReviewQueryItem).filter(Boolean);
  }
  if (activity?.reviewQuery) {
    const single = mapReviewQueryItem({
      queryText: activity.reviewQuery,
      fieldKey: activity.reviewQueryFieldKey,
      fieldLabel: activity.reviewQueryFieldLabel,
      status: activity.reviewQueryStatus,
      responseText: activity.reviewQueryResponse,
      sendbackRemark: activity.reviewQuerySendbackRemark,
      recordedOnUtc: activity.reviewQueryAt,
      resolvedAt: activity.reviewQueryResolvedAt,
      closedAt: activity.reviewQueryClosedAt,
      activityExecutionQueryNo: activity.activityExecutionQueryNo,
      performedBy: activity.performedBy,
      recordedAtOffset: activity.performedOffset ?? activity.recordedAtOffset
    });
    return single ? [single] : [];
  }
  return [];
}

function findReviewQueryForField(activity, fieldKey) {
  const queries = getReviewQueries(activity);
  if (!queries.length) return null;
  if (!fieldKey) return queries[0];
  const byKey = queries.find((query) => reviewQueryFieldKeysMatch(query.fieldKey, fieldKey));
  if (byKey) return byKey;

  // Fallback: match by field label (e.g. "Initials") when key shapes differ across versions.
  const needle = String(fieldKey).trim().toLowerCase();
  const needleId = resolveReviewQueryFieldId(fieldKey)?.toLowerCase();
  const needleLabel = stripCrfFieldLabelPrefix(fieldKey).toLowerCase();
  return queries.find((query) => {
    const label = stripCrfFieldLabelPrefix(query.fieldLabel).toLowerCase();
    if (label && (label === needle || label === needleLabel)) return true;
    const storedId = resolveReviewQueryFieldId(query.fieldKey)?.toLowerCase();
    return !!(needleId && storedId && needleId === storedId);
  }) ?? null;
}

function syncLegacyQueryFieldsFromList(activity, queries) {
  const latest = queries[0];
  if (!latest) {
    return {
      ...activity,
      reviewQueries: [],
      reviewQuery: undefined,
      reviewQueryAt: undefined,
      reviewQueryFieldKey: undefined,
      reviewQueryFieldLabel: undefined,
      reviewQueryStatus: undefined,
      reviewQueryResponse: undefined,
      reviewQuerySendbackRemark: undefined,
      reviewQueryResolvedAt: undefined,
      reviewQueryClosedAt: undefined,
      activityExecutionQueryNo: undefined
    };
  }
  return {
    ...activity,
    reviewQueries: queries,
    reviewQuery: latest.queryText,
    reviewQueryAt: latest.recordedOnUtc,
    reviewQueryFieldKey: latest.fieldKey,
    reviewQueryFieldLabel: latest.fieldLabel,
    reviewQueryStatus: latest.status,
    reviewQueryResponse: latest.responseText,
    reviewQuerySendbackRemark: latest.sendbackRemark,
    reviewQueryResolvedAt: latest.resolvedAt,
    reviewQueryClosedAt: latest.closedAt,
    activityExecutionQueryNo: latest.activityExecutionQueryNo
  };
}

function getReviewQueryStatus(activity, fieldKey) {
  const query = findReviewQueryForField(activity, fieldKey);
  if (!query) return null;
  return normalizeReviewQueryStatus(query.status);
}

function matchesReviewQueryField(activity, fieldKey) {
  if (!getReviewQueries(activity).length) return false;
  if (!fieldKey) return true;
  return !!findReviewQueryForField(activity, fieldKey);
}

/** Whether a new query can be raised on this field (closed or no prior query). */
function canRaiseNewReviewQuery(activity, fieldKey) {
  const existing = findReviewQueryForField(activity, fieldKey);
  if (!existing) return true;
  return normalizeReviewQueryStatus(existing.status) === REVIEW_QUERY_STATUS.CLOSED;
}

/** User must respond while query is raised or sent back. */
function isActiveReviewQuery(activity, fieldKey) {
  const status = getReviewQueryStatus(activity, fieldKey);
  return status === REVIEW_QUERY_STATUS.RAISED || status === REVIEW_QUERY_STATUS.SENDBACK;
}

/** Query still exists and is not closed. */
function hasOpenReviewQuery(activity, fieldKey) {
  const status = getReviewQueryStatus(activity, fieldKey);
  return !!status && status !== REVIEW_QUERY_STATUS.CLOSED;
}

/** Reviewer can send back or close after user responds. */
function isReviewQueryAwaitingReviewer(activity, fieldKey) {
  return getReviewQueryStatus(activity, fieldKey) === REVIEW_QUERY_STATUS.RESOLVED;
}

function formatReviewQueryAuditLabel(activity, fieldKey, stage) {
  const fieldLabel = resolveReviewQueryFieldLabel(activity, fieldKey);
  const stageLabel = REVIEW_QUERY_STAGE_LABELS[stage] ?? stage;
  return `${fieldLabel} - ${stageLabel}`;
}

function buildReviewQueryAuditExtras(activity, fieldKey, stage, text) {
  return {
    auditType: "reviewQuery",
    queryStage: stage,
    label: formatReviewQueryAuditLabel(activity, fieldKey, stage),
    fieldId: resolveReviewQueryFieldId(fieldKey),
    fieldKey,
    newValue: text,
    reason: stage === REVIEW_QUERY_STATUS.RESOLVED ? text : ""
  };
}

function createRaisedReviewQueryActivity(activity, fieldKey, fieldLabel, queryText, raisedAt) {
  const existing = findReviewQueryForField(activity, fieldKey);
  const nextItem = {
    activityExecutionQueryNo: existing?.activityExecutionQueryNo ?? null,
    fieldKey,
    fieldLabel: fieldLabel || existing?.fieldLabel || fieldKey,
    queryText,
    status: REVIEW_QUERY_STATUS.RAISED,
    responseText: "",
    sendbackRemark: "",
    recordedOnUtc: raisedAt,
    resolvedAt: null,
    closedAt: null,
    performedBy: existing?.performedBy ?? "",
    recordedAtOffset: existing?.recordedAtOffset ?? ""
  };
  const others = getReviewQueries(activity).filter(
    (query) => !reviewQueryFieldKeysMatch(query.fieldKey, fieldKey)
  );
  return syncLegacyQueryFieldsFromList(activity, [nextItem, ...others]);
}

function applyReviewQueryResolved(activity, fieldKey, responseText) {
  if (!isActiveReviewQuery(activity, fieldKey)) return activity;
  const queries = getReviewQueries(activity).map((query) => {
    if (!reviewQueryFieldKeysMatch(query.fieldKey, fieldKey)) return query;
    return {
      ...query,
      status: REVIEW_QUERY_STATUS.RESOLVED,
      responseText: String(responseText ?? "").trim() || query.responseText,
      resolvedAt: new Date().toISOString()
    };
  });
  return syncLegacyQueryFieldsFromList(activity, queries);
}

function applyReviewQuerySendback(activity, remark, fieldKey) {
  const targetKey = fieldKey || activity?.reviewQueryFieldKey;
  if (!isReviewQueryAwaitingReviewer(activity, targetKey)) return activity;
  const queries = getReviewQueries(activity).map((query) => {
    if (targetKey && !reviewQueryFieldKeysMatch(query.fieldKey, targetKey)) return query;
    return {
      ...query,
      status: REVIEW_QUERY_STATUS.SENDBACK,
      sendbackRemark: String(remark ?? "").trim(),
      resolvedAt: null
    };
  });
  return syncLegacyQueryFieldsFromList(activity, queries);
}

function applyReviewQueryClosed(activity, fieldKey) {
  const targetKey = fieldKey || activity?.reviewQueryFieldKey;
  const status = getReviewQueryStatus(activity, targetKey);
  if (!status || status === REVIEW_QUERY_STATUS.CLOSED) return activity;
  const closable = [
    REVIEW_QUERY_STATUS.RAISED,
    REVIEW_QUERY_STATUS.RESOLVED,
    REVIEW_QUERY_STATUS.SENDBACK
  ].includes(status);
  if (!closable) return activity;
  const queries = getReviewQueries(activity).map((query) => {
    if (targetKey && !reviewQueryFieldKeysMatch(query.fieldKey, targetKey)) return query;
    return {
      ...query,
      status: REVIEW_QUERY_STATUS.CLOSED,
      closedAt: new Date().toISOString()
    };
  });
  return syncLegacyQueryFieldsFromList(activity, queries);
}

function getActiveReviewQueryRemarkText(activity, fieldKey) {
  if (!isActiveReviewQuery(activity, fieldKey)) return "";
  const query = findReviewQueryForField(activity, fieldKey);
  if (!query) return "";
  const parts = [query.queryText];
  if (query.sendbackRemark) {
    parts.push(`Sendback: ${query.sendbackRemark}`);
  }
  return parts.filter((part) => String(part ?? "").trim()).join("\n\n");
}

function activityHasReviewQuery(activity) {
  return getReviewQueries(activity).length > 0;
}

/** True when any query on the activity is still open (not closed). */
function activityHasOpenReviewQuery(activity) {
  return getReviewQueries(activity).some(
    (query) => normalizeReviewQueryStatus(query.status) !== REVIEW_QUERY_STATUS.CLOSED
  );
}

/** True when status is raised or sendback (sendback counts as raised for lists/counts). */
function isRaisedReviewQueryStatus(status) {
  const normalized = normalizeReviewQueryStatus(status);
  return normalized === REVIEW_QUERY_STATUS.RAISED
    || normalized === REVIEW_QUERY_STATUS.SENDBACK;
}

/** True when any query on the activity is in raised status (blocks review). */
function activityHasRaisedReviewQuery(activity) {
  return getReviewQueries(activity).some(
    (query) => isRaisedReviewQueryStatus(query.status)
  );
}

function getReviewQueryStageOptions() {
  return [
    { value: "", label: "All Stages" },
    ...Object.entries(REVIEW_QUERY_STAGE_LABELS)
      // Sendback is counted/filtered under Raised.
      .filter(([value]) => value !== REVIEW_QUERY_STATUS.SENDBACK)
      .map(([value, label]) => ({ value, label }))
  ];
}

function getReviewQueryDisplayRemark(activity, fieldKey) {
  const query = findReviewQueryForField(activity, fieldKey);
  if (!query) return "";
  const status = normalizeReviewQueryStatus(query.status);
  if (status === REVIEW_QUERY_STATUS.RESOLVED || status === REVIEW_QUERY_STATUS.CLOSED) {
    return query.responseText || query.queryText || "";
  }
  if (status === REVIEW_QUERY_STATUS.SENDBACK) {
    return query.sendbackRemark || query.queryText || "";
  }
  return query.queryText || "";
}

function getReviewQueryStageBadgeClass(status) {
  if (status === REVIEW_QUERY_STATUS.RESOLVED) return "status-badge status--query-resolved";
  if (status === REVIEW_QUERY_STATUS.CLOSED) return "status-badge status--query-closed";
  if (status === REVIEW_QUERY_STATUS.SENDBACK) return "status-badge status--query-sendback";
  return "status-badge status--query-raised";
}

function getReviewQueryStageCellClass(status) {
  if (!status) return "";
  return `activity-grid__cell--query-${status}`;
}

function getReviewQueryStageBtnClass(status) {
  if (!status) return "";
  return `activity-grid__query-btn--${status}`;
}

function getReviewQueryStageCrfBtnClass(status) {
  if (!status) return "";
  return `activity-grid__crf-btn--query-${status}`;
}

function getReviewQueryRowActions(status) {
  return {
    canResolve: status === REVIEW_QUERY_STATUS.RAISED || status === REVIEW_QUERY_STATUS.SENDBACK,
    canClose: status === REVIEW_QUERY_STATUS.RAISED
      || status === REVIEW_QUERY_STATUS.RESOLVED
      || status === REVIEW_QUERY_STATUS.SENDBACK,
    canSendback: status === REVIEW_QUERY_STATUS.RESOLVED,
    canReraise: status === REVIEW_QUERY_STATUS.CLOSED
  };
}

function getReviewQueryStageForField(activity, fieldKey, { hideClosed = false } = {}) {
  const status = getReviewQueryStatus(activity, fieldKey);
  if (!status) return null;
  if (hideClosed && status === REVIEW_QUERY_STATUS.CLOSED) return null;
  return status;
}

function formatReviewQueryStageLabel(activity, fieldKey) {
  const status = getReviewQueryStatus(activity, fieldKey);
  return status ? REVIEW_QUERY_STAGE_LABELS[status] ?? status : "";
}

function filterActivitiesWithReviewQueries(activities, { subjectIds, stage } = {}) {
  const allowedSubjects = subjectIds?.length ? new Set(subjectIds) : null;
  return activities.filter((activity) => {
    if (!activityHasReviewQuery(activity)) return false;
    if (allowedSubjects && !allowedSubjects.has(activity.subjectId)) return false;
    if (stage) {
      const queries = getReviewQueries(activity);
      return queries.some((query) => {
        const status = normalizeReviewQueryStatus(query.status);
        if (stage === REVIEW_QUERY_STATUS.RAISED) {
          return isRaisedReviewQueryStatus(status);
        }
        return status === stage;
      });
    }
    return true;
  });
}

/** @deprecated Use applyReviewQueryResolved — kept for compatibility during migration. */
function clearOpenReviewQuery(activity, fieldKey) {
  return applyReviewQueryResolved(activity, fieldKey, "");
}

export {
  RECORD_QUERY_FIELDS,
  REVIEW_QUERY_STATUS,
  REVIEW_QUERY_STAGE_ACTIONS,
  REVIEW_QUERY_STAGE_LABELS,
  activityHasReviewQuery,
  activityHasOpenReviewQuery,
  activityHasRaisedReviewQuery,
  applyReviewQueryClosed,
  applyReviewQueryResolved,
  applyReviewQuerySendback,
  buildReviewQueryAuditExtras,
  canRaiseNewReviewQuery,
  clearOpenReviewQuery,
  createRaisedReviewQueryActivity,
  filterActivitiesWithReviewQueries,
  formatReviewQueryAuditLabel,
  formatReviewQueryStageLabel,
  getActiveReviewQueryRemarkText,
  getReviewQueryDisplayRemark,
  getReviewQueryFieldOptions,
  getReviewQueryRowActions,
  getReviewQueryStageBadgeClass,
  getReviewQueryStageBtnClass,
  getReviewQueryStageCellClass,
  getReviewQueryStageCrfBtnClass,
  getReviewQueryStageForField,
  getReviewQueryStageOptions,
  getReviewQueryStatus,
  getReviewQueries,
  findReviewQueryForField,
  hasOpenReviewQuery,
  isActiveReviewQuery,
  isRaisedReviewQueryStatus,
  isReviewQueryAwaitingReviewer,
  matchesReviewQueryField,
  resolveReviewQueryFieldId,
  resolveReviewQueryFieldLabel,
  stripCrfFieldLabelPrefix
};
