import { getCrfDefinitionForActivity } from "../../../services/crfService";
import { mapHdrStatusToLocal } from "../../activityExecution/utils/hdrStatus.js";
import { extractDoseNumber, formatDoseDisplayLabel } from "../../../utils/visitDisplay";

function getDetailRow(details, fieldName) {
  const target = String(fieldName ?? "").toLowerCase();
  return (details ?? []).find(
    (row) => String(row.fieldName ?? row.FieldName ?? "").toLowerCase() === target
  );
}

function getDetailValue(details, fieldName) {
  const row = getDetailRow(details, fieldName);
  const value = row?.fieldValue ?? row?.FieldValue ?? null;
  return value == null ? null : String(value).trim() || null;
}

/** Parse ActivityExecutionDtl date strings (dd-MMM-yyyy HH:mm or ISO). */
export function parseExecutionDetailDate(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;

  const isoMatch = /^\d{4}-\d{2}-\d{2}/.test(str);
  if (isoMatch) {
    const parsed = new Date(str);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const match = str.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2})/);
  if (match) {
    const months = {
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      may: 4,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      oct: 9,
      nov: 10,
      dec: 11,
    };
    const month = months[match[2].toLowerCase()];
    if (month === undefined) return null;
    const parsed = new Date(
      Number(match[3]),
      month,
      Number(match[1]),
      Number(match[4]),
      Number(match[5])
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function buildFieldIds(details) {
  const fieldIds = {};
  const crfValues = {};

  for (const row of details ?? []) {
    const fieldName = String(row.fieldName ?? row.FieldName ?? "").trim();
    const fieldId = String(row.fieldId ?? row.FieldId ?? "").trim();
    const appActivityCrfNo = Number(row.appActivityCrfNo ?? row.AppActivityCrfNo) || 0;
    const dtlNo = row.activityExecutionDtlNo ?? row.ActivityExecutionDtlNo;
    if ((!fieldName && !fieldId) || !dtlNo) continue;

    const isCrfAnswer =
      Boolean(fieldId)
      || fieldName.startsWith("crf:")
      || appActivityCrfNo > 0;

    if (isCrfAnswer) {
      const fieldKey = fieldId || (fieldName.startsWith("crf:") ? fieldName.slice(4) : fieldName);
      if (!fieldKey) continue;
      fieldIds[fieldKey] = dtlNo;
      crfValues[fieldKey] = row.fieldValue ?? row.FieldValue ?? "";
    } else if (fieldName) {
      fieldIds[fieldName] = dtlNo;
    }
  }

  return { fieldIds, crfValues };
}

function inferExecutionMethod(activityType, barcodeValue, storedMethod) {
  const method = String(storedMethod ?? "").trim();
  if (method) return method;
  if (activityType === "IMP Dose Administration") return "manual";
  if (barcodeValue) return "pkBarcode";
  return "manual";
}

function normalizeActivityType(type) {
  const value = String(type ?? "").trim();
  if (!value) return "";
  if (/^pre[-\s]?dose blood collection$/i.test(value)) return "Pre-Dose Blood Collection";
  if (/^post[-\s]?dose blood collection$/i.test(value)) return "Post-Dose Blood Collection";
  if (/^imp dose administration$/i.test(value)) return "IMP Dose Administration";
  return value;
}

/**
 * Map GET /Review/activities payload (Hdr + ActivityExecutionDtl rows) to ActivityGrid shape.
 */
export function mapReviewApiActivity(act, visitContext = {}) {
  const details = act.details ?? act.Details ?? [];
  const activityType = normalizeActivityType(act.activityType ?? act.ActivityType ?? "");
  const isImp = activityType === "IMP Dose Administration";

  const barcodeValue = getDetailValue(details, "BarcodeValue");
  const scheduledTime = parseExecutionDetailDate(getDetailValue(details, "ScheduledTime"));
  const windowStart = parseExecutionDetailDate(getDetailValue(details, "WindowStart"));
  const windowEnd = parseExecutionDetailDate(getDetailValue(details, "WindowEnd"));
  const actualTime = parseExecutionDetailDate(getDetailValue(details, "ActualTime"));
  const scanStartTime = parseExecutionDetailDate(getDetailValue(details, "CentrifugationStart"));
  const scanEndTime = parseExecutionDetailDate(getDetailValue(details, "CentrifugationEnd"));
  const remarks = getDetailValue(details, "Remarks");
  const deviationReason = getDetailValue(details, "DeviationReason");
  const deviation = String(getDetailValue(details, "Deviation") ?? "").toLowerCase() === "true";
  const executionMethod = inferExecutionMethod(
    activityType,
    barcodeValue,
    getDetailValue(details, "ExecutionMethod")
  );

  const hdrStatus = String(act.status ?? act.Status ?? "").trim();
  const { activityStatus, sampleStatus } = mapHdrStatusToLocal(hdrStatus, {
    deviation,
    isImp,
    hasCentrifugeEnd: Boolean(scanEndTime),
  });

  const { fieldIds, crfValues } = buildFieldIds(details);

  let appActivityCrfNo =
    Number(act.appActivityCrfNo ?? act.AppActivityCrfNo) || 0;
  if (!(appActivityCrfNo > 0)) {
    for (const row of details ?? []) {
      const n = Number(row.appActivityCrfNo ?? row.AppActivityCrfNo) || 0;
      if (n > 0) {
        appActivityCrfNo = n;
        break;
      }
    }
  }
  const crfVersion = (() => {
    const n = Number(act.crfVersion ?? act.CrfVersion);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const crfName = String(act.crfName ?? act.CrfName ?? "").trim() || null;

  const timepoint = act.timePointLabel ?? act.TimePointLabel ?? "";
  const doseFromTimepoint = extractDoseNumber(timepoint);
  const dose =
    doseFromTimepoint
      ? `Dose ${doseFromTimepoint}`
      : formatDoseDisplayLabel(visitContext.visitName ?? visitContext.doseLabel ?? "");

  // --- query fields from DB (support multiple queries per timepoint) ---
  const reviewQueriesRaw = act.queries ?? act.Queries ?? act.reviewQueries ?? act.ReviewQueries ?? [];
  const reviewQueries = (Array.isArray(reviewQueriesRaw) ? reviewQueriesRaw : [])
    .map((q) => ({
      activityExecutionQueryNo: Number(q.activityExecutionQueryNo ?? q.ActivityExecutionQueryNo) || null,
      fieldKey: q.fieldKey ?? q.FieldKey ?? "",
      fieldLabel: q.fieldLabel ?? q.FieldLabel ?? "",
      queryText: q.queryText ?? q.QueryText ?? "",
      status: q.status ?? q.Status ?? "raised",
      responseText: q.responseText ?? q.ResponseText ?? "",
      sendbackRemark: q.sendbackRemark ?? q.SendbackRemark ?? "",
      recordedOnUtc: q.recordedOnUtc ?? q.RecordedOnUtc ?? null,
      resolvedAt: q.resolvedAt ?? q.ResolvedAt ?? null,
      closedAt: q.closedAt ?? q.ClosedAt ?? null,
      performedBy: q.performedBy ?? q.PerformedBy ?? "",
      recordedAtOffset: q.recordedAtOffset ?? q.RecordedAtOffset ?? ""
    }))
    .filter((q) => String(q.queryText ?? "").trim());

  const reviewQuery = act.reviewQuery ?? act.ReviewQuery ?? reviewQueries[0]?.queryText ?? null;
  const reviewQueryFieldKey = act.reviewQueryFieldKey ?? act.ReviewQueryFieldKey ?? reviewQueries[0]?.fieldKey ?? null;
  const reviewQueryFieldLabel = act.reviewQueryFieldLabel ?? act.ReviewQueryFieldLabel ?? reviewQueries[0]?.fieldLabel ?? null;
  const reviewQueryStatus = act.reviewQueryStatus ?? act.ReviewQueryStatus ?? reviewQueries[0]?.status ?? null;
  const reviewQueryAt = act.reviewQueryAt ?? act.ReviewQueryAt ?? reviewQueries[0]?.recordedOnUtc ?? null;
  const reviewQueryResponse = act.reviewQueryResponse ?? act.ReviewQueryResponse ?? reviewQueries[0]?.responseText ?? null;
  const reviewQuerySendbackRemark = act.reviewQuerySendbackRemark ?? act.ReviewQuerySendbackRemark ?? reviewQueries[0]?.sendbackRemark ?? null;
  const reviewQueryResolvedAt = act.reviewQueryResolvedAt ?? act.ReviewQueryResolvedAt ?? reviewQueries[0]?.resolvedAt ?? null;
  const reviewQueryClosedAt = act.reviewQueryClosedAt ?? act.ReviewQueryClosedAt ?? reviewQueries[0]?.closedAt ?? null;
  const activityExecutionQueryNo =
    act.activityExecutionQueryNo ?? act.ActivityExecutionQueryNo ?? reviewQueries[0]?.activityExecutionQueryNo ?? null;

  const mapped = {
    id: act.activityExecutionHdrNo ?? act.ActivityExecutionHdrNo,
    activityExecutionHdrNo: act.activityExecutionHdrNo ?? act.ActivityExecutionHdrNo,
    subjectMstNo: act.subjectMstNo ?? act.SubjectMstNo,
    subjectNumber: visitContext.subjectNumber ?? "",
    dose,
    visitId: visitContext.visitTrackerNo ?? null,
    visitTrackerNo: visitContext.visitTrackerNo ?? act.visitTrackerNo ?? act.VisitTrackerNo ?? null,
    visitLabel: visitContext.visitLabel ?? visitContext.periodLabel ?? visitContext.visitName ?? "",
    activityConfigTimePointNo: act.activityConfigTimePointNo ?? act.ActivityConfigTimePointNo,
    timepoint,
    activity: activityType,
    status: activityStatus ?? hdrStatus,
    reviewStatus: act.reviewStatus ?? act.ReviewStatus ?? "Pending",
    performedBy: act.performedBy ?? act.PerformedBy ?? "",
    performedOn: act.performedOn ?? act.PerformedOn ?? null,
    performedOffset: act.performedOffset ?? act.PerformedOffset ?? "",
    reviewedBy: act.reviewedBy ?? act.ReviewedBy ?? "",
    reviewedOn: act.reviewedOn ?? act.ReviewedOn ?? null,
    reviewedOffset: act.reviewedOffset ?? act.ReviewedOffset ?? "",
    scheduledTime,
    windowStart,
    windowEnd,
    actualTime,
    scanStartTime,
    scanEndTime,
    barcode: barcodeValue,
    executionMethod,
    deviation,
    deviationReason,
    remarks,
    fieldIds,
    crfValues,
    appActivityCrfNo: appActivityCrfNo > 0 ? appActivityCrfNo : null,
    crfVersion,
    crfName,
    apiSeeded: true,
    sampleStatus,
    // query fields — populate when any query exists so each field cell can highlight independently
    ...(reviewQueries.length || reviewQuery ? {
      reviewQueries: reviewQueries.length
        ? reviewQueries
        : [{
            activityExecutionQueryNo,
            fieldKey: reviewQueryFieldKey ?? "",
            fieldLabel: reviewQueryFieldLabel ?? "",
            queryText: reviewQuery,
            status: reviewQueryStatus ?? "raised",
            responseText: reviewQueryResponse ?? "",
            sendbackRemark: reviewQuerySendbackRemark ?? "",
            recordedOnUtc: reviewQueryAt,
            resolvedAt: reviewQueryResolvedAt,
            closedAt: reviewQueryClosedAt
          }],
      reviewQuery,
      reviewQueryAt,
      reviewQueryFieldKey,
      reviewQueryFieldLabel,
      reviewQueryStatus,
      reviewQueryResponse,
      reviewQuerySendbackRemark,
      reviewQueryResolvedAt,
      reviewQueryClosedAt,
      activityExecutionQueryNo,
    } : {}),
    aliquots: (act.aliquots ?? act.Aliquots ?? []).map((a) => ({
      id: a.activityExecutionAliquotNo ?? a.ActivityExecutionAliquotNo,
      activityExecutionAliquotNo: a.activityExecutionAliquotNo ?? a.ActivityExecutionAliquotNo ?? null,
      barcode: a.barcodeValue ?? a.BarcodeValue,
      status: a.status ?? a.Status,
      skipped: (a.status ?? a.Status) === "Skipped",
      skippedAt: (a.status ?? a.Status) === "Skipped" ? new Date().toISOString() : null,
      createdAt: (a.status ?? a.Status) === "Completed" ? new Date().toISOString() : null,
      skipRemark: a.skipRemark ?? a.SkipRemark,
      skippedReason: a.skipRemark ?? a.SkipRemark ?? a.skippedReason ?? a.SkippedReason ?? null,
    })),
  };

  const definition = getCrfDefinitionForActivity(mapped);
  if (definition && Object.keys(crfValues).length) {
    mapped.crfResponses = { [definition.id]: { values: { ...crfValues } } };
  }

  return mapped;
}

export function buildReviewSamplesFromActivities(activities) {
  return (activities ?? [])
    .filter((activity) => activity.barcode || activity.scanStartTime || activity.scanEndTime || activity.actualTime)
    .map((activity) => ({
      id: `review-smp-${activity.id}`,
      activityId: activity.id,
      subjectId: activity.subjectNumber,
      barcode: activity.barcode ?? null,
      centrifugationStart: activity.scanStartTime ?? null,
      centrifugationEnd: activity.scanEndTime ?? null,
      scanStartTime: activity.scanStartTime ?? null,
      scanEndTime: activity.scanEndTime ?? null,
      collectedAt: activity.actualTime ?? null,
      status: activity.sampleStatus ?? "Aliquoted",
    }));
}
