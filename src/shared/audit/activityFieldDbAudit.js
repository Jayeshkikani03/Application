import { formatActivityTimepointLabel } from "../../utils/visitDisplay";

/**
 * Build AuditHistoryModal target for an ActivityExecutionDtl field.
 * @param {object} activity
 * @param {string} fieldName - API field name, or "WindowPeriod" / "DoseDateTime" for multi-field batches
 * @param {string} [title]
 * @returns {object|null}
 */
export function buildActivityFieldDbAuditTarget(activity, fieldName, title) {
  if (!activity || !fieldName) return null;

  const timepointLabel = formatActivityTimepointLabel(activity) || activity.timepoint || "Activity";
  const hdrNo = activity.activityExecutionHdrNo || null;
  const ids = activity.fieldIds ?? {};
  const isImpDose = activity.activity === "IMP Dose Administration";

  if (fieldName === "WindowPeriod") {
    const batch = [];
    const startId = ids.WindowStart ?? ids.windowStart;
    const endId = ids.WindowEnd ?? ids.windowEnd;
    const labelByRecordId = {};
    if (startId) {
      const id = String(startId);
      batch.push({
        tableName: "ActivityExecutionDtl",
        recordId: id,
        fieldNames: ["vFieldValue"],
      });
      labelByRecordId[id] = "Window Period Start";
    }
    if (endId) {
      const id = String(endId);
      batch.push({
        tableName: "ActivityExecutionDtl",
        recordId: id,
        fieldNames: ["vFieldValue"],
      });
      labelByRecordId[id] = "Window Period End";
    }
    return {
      tableName: "ActivityExecutionDtl",
      recordId: startId || endId || null,
      hdrNo,
      fieldName: "WindowPeriod",
      title: title || `${timepointLabel} Window Period Audit`,
      auditBatchTargets: batch.length > 0 ? batch : undefined,
      labelByRecordId: Object.keys(labelByRecordId).length > 0 ? labelByRecordId : undefined,
    };
  }

  // IMP dose: Scheduled Time and Actual Time share one clock — both audit icons open Actual Time only
  // (do not load Scheduled Time history from the backend).
  const doseTimeFields = fieldName === "DoseDateTime"
    || (isImpDose && (fieldName === "ActualTime" || fieldName === "ScheduledTime"));
  if (doseTimeFields) {
    const actualId = ids.ActualTime ?? ids.actual;
    return {
      tableName: "ActivityExecutionDtl",
      recordId: actualId || null,
      hdrNo,
      fieldName: "ActualTime",
      fieldLabel: "Actual Time",
      title: title || `${timepointLabel} Actual Time Audit`,
    };
  }

  const aliasMap = {
    ActualTime: ["ActualTime", "actual"],
    CentrifugationStart: ["CentrifugationStart", "scanStart"],
    CentrifugationEnd: ["CentrifugationEnd", "scanEnd"],
    Remarks: ["Remarks", "remark"],
    ExecutionMethod: ["ExecutionMethod", "executionMethod"],
    BarcodeValue: ["BarcodeValue", "barcode"],
    ScheduledTime: ["ScheduledTime", "scheduled"],
  };

  const keys = aliasMap[fieldName] ?? [fieldName];
  let dtlNo = null;
  for (const key of keys) {
    if (ids[key] != null && String(ids[key]).trim() !== "") {
      dtlNo = ids[key];
      break;
    }
  }

  const defaultTitles = {
    ActualTime: `${timepointLabel} Actual Time Audit`,
    CentrifugationStart: `${timepointLabel} Centrifuge Start Audit`,
    CentrifugationEnd: `${timepointLabel} Centrifuge End Audit`,
    Remarks: `${timepointLabel} Deviation / Remark Audit`,
    ExecutionMethod: `${timepointLabel} Method Audit`,
    BarcodeValue: `${timepointLabel} Barcode Audit`,
    ScheduledTime: `${timepointLabel} Scheduled Time Audit`,
  };

  const fieldLabels = {
    ActualTime: "Actual Time",
    CentrifugationStart: "Centrifuge Start",
    CentrifugationEnd: "Centrifuge End",
    Remarks: "Deviation / Remark",
    ExecutionMethod: "Method",
    BarcodeValue: "Barcode",
    ScheduledTime: "Scheduled Time",
  };

  return {
    tableName: "ActivityExecutionDtl",
    recordId: dtlNo || null,
    hdrNo,
    fieldName,
    fieldLabel: fieldLabels[fieldName] || fieldName,
    title: title || defaultTitles[fieldName] || `${fieldName} Audit`,
  };
}
