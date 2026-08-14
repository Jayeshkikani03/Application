/** UI field key → `AuditDtl.vFieldName` for ActivityConfigDose. */
export const ACTIVITY_CONFIG_DOSE_FIELD_TO_COLUMN = {
  label: "vDoseLabel",
  period: "nPeriod",
  visit: "vStudyVisitScheduleDescription",
  studyVisitScheduleNo: "nStudyVisitScheduleNo",
  order: "iGlobalOrder",
  isActive: "IsActive",
};

/** UI field key → `AuditDtl.vFieldName` for ActivityConfigTimePoint. */
export const ACTIVITY_CONFIG_TIMEPOINT_FIELD_TO_COLUMN = {
  label: "vTimePointLabel",
  order: "iDisplayOrder",
  activityType: "vActivityType",
  visit: "vStudyVisitScheduleDescription",
  studyVisitScheduleNo: "nStudyVisitScheduleNo",
  duration: "nDuration",
  durationType: "vDurationType",
  windowPeriodMinus: "nWindowPeriodMinus",
  windowPeriodPlus: "nWindowPeriodPlus",
  windowPeriodDurationType: "vWindowPeriodDurationType",
  isActive: "IsActive",
};

/** UI field key → `AuditDtl.vFieldName` for ProjectParameter (aliquots / centrifuge). */
export const PROJECT_PARAMETER_FIELD_TO_COLUMN = {
  aliquotsPerSeparation: "vParameterValue",
  centrifugeTimeMinutes: "vParameterValue",
};

/**
 * Maps UI audit rows (`field` = UI key) to server `AuditDtl.vFieldName` keys.
 * @param {{ field: string, reason?: string }[]} entries
 * @param {Record<string, string>} fieldToColumn
 * @returns {Record<string, string>|undefined}
 */
export function mapUiAuditEntriesToReasonsByAuditedColumn(entries, fieldToColumn) {
  const out = {};
  for (const row of entries || []) {
    const field = String(row?.field || "").trim();
    const col = fieldToColumn?.[field];
    const reason = String(row?.reason || "").trim();
    if (!reason) continue;
    if (col) {
      out[col] = reason;
    }
    // Visit edits also change the schedule-no store column.
    if (field === "visit") {
      out.nStudyVisitScheduleNo = reason;
      out.vStudyVisitScheduleDescription = reason;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
