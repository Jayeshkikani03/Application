/**
 * Canonical activity / sample status strings used across Application.
 * Values match existing UI / workflow literals — do not invent new ones here.
 */

/** Activity statuses that end the collection lifecycle for a timepoint. */
export const TERMINAL_ACTIVITY_STATUSES = ["Completed", "Skipped", "Deviation"];

/**
 * Statuses where an activity may still be collected / acted on
 * (Ready / Missed window / open Deviation).
 */
export const ACTIVITY_READY_STATUSES = ["Ready", "Missed", "Deviation"];

/** Ready or Missed — primary actionable queue statuses. */
export const ACTIVITY_ACTIONABLE_STATUSES = ["Ready", "Missed"];

/** Open / not-yet-collected PK statuses used for pending metrics. */
export const ACTIVITY_PENDING_COLLECTION_STATUSES = [
  "Ready",
  "Upcoming",
  "Missed",
  "Pending",
];

/**
 * Known activity lifecycle values (including open + terminal).
 * Used when accepting raw API / legacy status strings.
 */
export const ACTIVITY_LIFECYCLE_STATUSES = [
  "Completed",
  "Deviation",
  "Skipped",
  "Ready",
  "Upcoming",
  "Missed",
];

/** Statuses that allow recording a remark on an activity row. */
export const ACTIVITY_REMARKABLE_STATUSES = [
  "Completed",
  "Deviation",
  "Skipped",
  "Missed",
];

/**
 * Statuses that show Skip in ActivityGrid (activity + in-progress sample labels).
 */
export const ACTIVITY_SKIPPABLE_STATUSES = [
  "Ready",
  "Missed",
  "Pending",
  "Blood Collected",
  "Awaiting Centrifugation",
  "Centrifuging",
  "Ready For Aliquot",
  "Centrifuged",
];

/** Sample statuses used in the PK processing workflow. */
export const SAMPLE_WORKFLOW_STATUSES = [
  "Collected",
  "Awaiting Centrifugation",
  "Centrifuging",
  "Ready For Aliquot",
  "Aliquoted",
  "Stored",
  "Centrifuged",
];

/** Parent sample eligible to open / continue aliquot separation. */
export const ALIQUOT_PARENT_STATUSES = [
  "Ready For Aliquot",
  "Aliquoted",
  "Centrifuging",
];

/** Parent sample finished aliquot separation / storage. */
export const SAMPLE_ALIQUOT_COMPLETE_STATUSES = ["Aliquoted", "Stored"];

export function isTerminalActivityStatus(status) {
  return TERMINAL_ACTIVITY_STATUSES.includes(status);
}

export function isActivityReadyStatus(status) {
  return ACTIVITY_READY_STATUSES.includes(status);
}

export function isActivityActionableStatus(status) {
  return ACTIVITY_ACTIONABLE_STATUSES.includes(status);
}

export function isActivityPendingCollectionStatus(status) {
  return ACTIVITY_PENDING_COLLECTION_STATUSES.includes(status);
}

export function isActivityLifecycleStatus(status) {
  return ACTIVITY_LIFECYCLE_STATUSES.includes(status);
}

export function isActivityRemarkableStatus(status) {
  return ACTIVITY_REMARKABLE_STATUSES.includes(status);
}

export function isActivitySkippableStatus(status) {
  return ACTIVITY_SKIPPABLE_STATUSES.includes(status);
}

export function isSampleWorkflowStatus(status) {
  return SAMPLE_WORKFLOW_STATUSES.includes(status);
}

export function isAliquotParentStatus(status) {
  return ALIQUOT_PARENT_STATUSES.includes(status);
}

export function isSampleAliquotCompleteStatus(status) {
  return SAMPLE_ALIQUOT_COMPLETE_STATUSES.includes(status);
}
