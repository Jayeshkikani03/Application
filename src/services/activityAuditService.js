import { formatDisplayDateTime, resolveCentrifugeStartTime } from "./workflowService";
import {
  getReviewQueryStatus,
  REVIEW_QUERY_STAGE_LABELS,
  resolveReviewQueryFieldLabel
} from "./reviewQueryService";
import { formatAuditPerformedBy } from "../shared/audit/auditActor.js";

function formatAuditUtc(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false
  }).replace(",", "");
}

function formatAuditOffset(iso) {
  if (!iso) return "-";
  const offset = -new Date(iso).getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function getReviewQueryAuditFieldLabel(entry, activity, fieldLabel) {
  if (activity && entry?.fieldKey) {
    return resolveReviewQueryFieldLabel(activity, entry.fieldKey);
  }
  return activity?.reviewQueryFieldLabel ?? fieldLabel ?? "Field";
}

function getReviewQueryAuditStageLabel(entry) {
  const stageLabels = {
    ...REVIEW_QUERY_STAGE_LABELS,
    reraised: "Query Reraised"
  };
  if (entry?.queryStage) {
    return stageLabels[entry.queryStage] ?? entry.queryStage;
  }
  const byAction = {
    "Review Query Raised": stageLabels.raised,
    "Review Query Resolved": stageLabels.resolved,
    "Review Query Sendback": stageLabels.sendback,
    "Review Query Closed": stageLabels.closed,
    "Review Query Reraised": stageLabels.reraised
  };
  if (entry?.action && byAction[entry.action]) return byAction[entry.action];
  if (entry?.label?.includes(" - ")) {
    return entry.label.split(" - ").slice(1).join(" - ");
  }
  return "-";
}

function getReviewQueryAuditStageKey(entry) {
  if (entry?.queryStage) return entry.queryStage;
  const byAction = {
    "Review Query Raised": "raised",
    "Review Query Resolved": "resolved",
    "Review Query Sendback": "sendback",
    "Review Query Closed": "closed",
    "Review Query Reraised": "reraised"
  };
  if (entry?.action && byAction[entry.action]) return byAction[entry.action];
  return "";
}

function buildAuditFallbackRow({ type, activity, sample = null, fieldLabel, rows }) {
  return {
    id: `fallback-${type}-${activity?.id ?? "record"}`,
    entityId: activity?.id,
    timestamp: activity?.actualTime ?? new Date().toISOString(),
    user: "-",
    label:
      type === "actual"
        ? `${activity?.timepoint ?? "Activity"} Actual Time`
        : type === "scanStart"
          ? `${activity?.timepoint ?? "Activity"} Centrifuge Start`
          : type === "remark"
            ? `${activity?.timepoint ?? "Activity"} Deviation / Remark`
            : type === "crf"
              ? fieldLabel ?? "CRF Field"
              : type === "query"
                ? activity?.reviewQueryFieldLabel ?? fieldLabel ?? activity?.timepoint ?? "Field"
                : "Record Remark",
    queryStage: type === "query" ? getReviewQueryStatus(activity) : undefined,
    oldValue: "",
    newValue:
      type === "actual"
        ? formatDisplayDateTime(activity?.actualTime)
        : type === "scanStart"
          ? formatDisplayDateTime(resolveCentrifugeStartTime(activity, sample))
          : type === "remark"
            ? activity?.remarks ?? ""
            : type === "query"
              ? getReviewQueryAuditStageLabel({ queryStage: getReviewQueryStatus(activity) })
              : rows?.[0]?.newValue ?? "",
    reason: ""
  };
}

function resolveReasonEntry(type, entry, allEntries) {
  if (type === "actual") {
    return allEntries.find(
      (item) =>
        item.entityId === entry.entityId &&
        item.action === "Actual Time Change Reason" &&
        Math.abs(new Date(item.timestamp).getTime() - new Date(entry.timestamp).getTime()) < 2000
    );
  }
  if (type === "scanStart") {
    return allEntries.find(
      (item) =>
        item.entityId === entry.entityId &&
        (item.action === "Centrifuge Start Change Reason" ||
          item.action === "Timepoint Start Edit Reason" ||
          item.action === "Centrifugation Start Edit Reason") &&
        Math.abs(new Date(item.timestamp).getTime() - new Date(entry.timestamp).getTime()) < 2000
    );
  }
  return null;
}

export {
  buildAuditFallbackRow,
  formatAuditOffset,
  formatAuditPerformedBy,
  formatAuditUtc,
  getReviewQueryAuditFieldLabel,
  getReviewQueryAuditStageKey,
  getReviewQueryAuditStageLabel,
  resolveReasonEntry
};
