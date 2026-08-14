import { getNextActivity } from "../../../services/workflowService";
import {
  compareActivitiesBySchedule,
  filterActivitiesBySchedule,
} from "../../../services/activityScheduleSyncService";
import { isTerminalActivityStatus } from "../../../shared/domain/activityStatuses.js";

function isActivityFilled(activity) {
  if (!activity) return false;
  if (activity.actualTime) return true;
  return isTerminalActivityStatus(activity.status);
}

function buildFillProgress(subjectActivities, subjectVisits) {
  const total = subjectActivities.length;
  const completed = subjectActivities.filter(isActivityFilled).length;
  const byVisit = (subjectVisits ?? []).map((visit) => {
    const rows = subjectActivities.filter((a) => a.visitId === visit.id);
    const done = rows.filter(isActivityFilled).length;
    return {
      visitId: visit.id,
      label: visit.label ?? visit.doseLabel ?? visit.id,
      total: rows.length,
      completed: done,
      remaining: Math.max(0, rows.length - done),
    };
  });
  return {
    total,
    completed,
    remaining: Math.max(0, total - completed),
    byVisit,
  };
}

function buildPreviousActivities(subjectActivities, nextActivity) {
  if (!subjectActivities?.length) return [];

  let startIdx = subjectActivities.length - 1;
  if (nextActivity) {
    const curIdx = subjectActivities.findIndex((a) => a.id === nextActivity.id);
    if (curIdx !== -1) {
      startIdx = curIdx - 1;
    }
  }

  if (startIdx < 0) return [];
  // Include IMP Dose Administration — previously skipped, so completed dose never appeared.
  return [subjectActivities[startIdx]];
}

/**
 * Derives Activity Execution page lists from LabContext state.
 *
 * Grid bind:
 * - Previous timepoint ActivityGrid → previousActivities
 * - Next card → nextActivity (PK barcode, windows)
 * - Pending tab → samples elsewhere (not this helper)
 * - Handlers look up by id in visitActivities / subjectActivities
 *
 * Fill progress: schedule timepoints = total; history-filled = completed.
 */
export function buildExecutionPageView(state, { subjectId, visitId, subjectVisits }) {
  const visitActivities = filterActivitiesBySchedule(
    state,
    (state.activities ?? []).filter((a) => a.visitId === visitId)
  ).sort((a, b) => compareActivitiesBySchedule(state, a, b));

  const subjectVisitIds = new Set((subjectVisits ?? []).map((v) => v.id));
  const subjectActivities = filterActivitiesBySchedule(
    state,
    (state.activities ?? []).filter((a) => subjectVisitIds.has(a.visitId))
  ).sort((a, b) => compareActivitiesBySchedule(state, a, b));

  const nextActivity =
    subjectId && visitId ? getNextActivity(state, subjectId, visitId) : undefined;

  const previousActivities = buildPreviousActivities(subjectActivities, nextActivity);
  const fillProgress = buildFillProgress(subjectActivities, subjectVisits);

  return {
    visitActivities,
    subjectActivities,
    nextActivity,
    previousActivities,
    fillProgress,
  };
}
