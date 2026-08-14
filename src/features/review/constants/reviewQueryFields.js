/** Fixed execution/record fields for review queries; CRF fields append dynamically. */
export const RECORD_QUERY_FIELDS = [
  { value: "actual", label: "Actual Time" },
  { value: "remark", label: "Deviation / Remark" },
  { value: "scanStart", label: "Centrifuge Start" },
];

export const REVIEW_QUERY_STATUS = {
  RAISED: "raised",
  RESOLVED: "resolved",
  SENDBACK: "sendback",
  CLOSED: "closed",
};

export const REVIEW_QUERY_STAGE_ACTIONS = {
  raised: "Review Query Raised",
  resolved: "Review Query Resolved",
  sendback: "Review Query Sendback",
  closed: "Review Query Closed",
};

export const REVIEW_QUERY_STAGE_LABELS = {
  raised: "Query Raised",
  resolved: "Query Resolved",
  sendback: "Query Sendback",
  closed: "Query Closed",
};
