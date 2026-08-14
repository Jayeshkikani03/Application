import { HDR_STATUS, mapHdrStatusToLocal, normalizeHdrStatus } from "../../activityExecution/utils/hdrStatus.js";
import { mapReviewApiActivity } from "./mapReviewApiActivity.js";
import { extractDoseNumber, formatDoseDisplayLabel } from "../../../utils/visitDisplay";

function isImpDose(activityType) {
  return activityType === "IMP Dose Administration";
}

function normalizeActivityType(type) {
  const value = String(type ?? "").trim();
  if (!value) return "";
  if (/^pre[-\s]?dose blood collection$/i.test(value)) return "Pre-Dose Blood Collection";
  if (/^post[-\s]?dose blood collection$/i.test(value)) return "Post-Dose Blood Collection";
  if (/^imp dose administration$/i.test(value)) return "IMP Dose Administration";
  return value;
}

function getVisitContext(apiVisits, act) {
  const visitTrackerNo = act.visitTrackerNo ?? act.VisitTrackerNo;
  const visit = visitTrackerNo
    ? apiVisits.find((v) => v.visitTrackerNo === visitTrackerNo)
    : apiVisits.find((v) => v.subjectMstNo === (act.subjectMstNo ?? act.SubjectMstNo));

  return {
    subjectNumber: visit?.subjectNumber ?? "",
    visitName: visit?.doseLabel ?? visit?.DoseLabel ?? visit?.visitName ?? "",
    visitLabel: visit?.visitLabel ?? visit?.periodLabel ?? "",
    periodLabel: visit?.periodLabel ?? "",
    visitTrackerNo: visit?.visitTrackerNo ?? visitTrackerNo ?? null,
    reviewStatus: visit?.reviewStatus ?? null,
  };
}

function mapRecordToActivity(act, record, visitContext) {
  const activityType = normalizeActivityType(
    act.activityType ?? act.ActivityType ?? record?.activityType ?? ""
  );
  const timepoint = act.timePointLabel ?? act.TimePointLabel ?? "";
  const doseFromTimepoint = extractDoseNumber(timepoint);
  const dose =
    doseFromTimepoint
      ? `Dose ${doseFromTimepoint}`
      : formatDoseDisplayLabel(visitContext.visitName ?? "");
  const imp = isImpDose(activityType);
  const hdrNo = act.activityExecutionHdrNo ?? act.ActivityExecutionHdrNo;

  // Prefer history record queries (refreshed after raise/resolve/sendback/close)
  // over the review-activities payload, which can be stale until re-fetched.
  const mapQueryList = (source) => {
    const list = source?.queries ?? source?.Queries ?? source?.reviewQueries ?? [];
    if (!Array.isArray(list)) return [];
    return list
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
  };

  const recordQueries = mapQueryList(record);
  const actQueries = mapQueryList(act);
  const reviewQueries = recordQueries.length ? recordQueries : actQueries;

  const reviewQuery =
    record?.reviewQuery
    ?? act.reviewQuery
    ?? act.ReviewQuery
    ?? reviewQueries[0]?.queryText
    ?? null;

  const activity = {
    id: hdrNo,
    activityExecutionHdrNo: hdrNo,
    subjectMstNo: act.subjectMstNo ?? act.SubjectMstNo,
    subjectNumber: visitContext.subjectNumber,
    dose,
    visitId: visitContext.visitTrackerNo,
    visitTrackerNo: visitContext.visitTrackerNo,
    visitLabel: visitContext.visitLabel ?? visitContext.periodLabel ?? "",
    activityConfigTimePointNo: act.activityConfigTimePointNo ?? act.ActivityConfigTimePointNo,
    timepoint,
    activity: activityType,
    reviewStatus: act.reviewStatus ?? act.ReviewStatus ?? "Pending",
    performedBy: act.performedBy ?? act.PerformedBy ?? "",
    performedOn: act.performedOn ?? act.PerformedOn ?? null,
    performedOffset: act.performedOffset ?? act.PerformedOffset ?? "",
    reviewedBy: act.reviewedBy ?? act.ReviewedBy ?? "",
    reviewedOn: act.reviewedOn ?? act.ReviewedOn ?? null,
    reviewedOffset: act.reviewedOffset ?? act.ReviewedOffset ?? "",
    apiSeeded: true,
    fieldIds: record?.fieldIds ?? {},
    actualTime: record?.actualTime ?? null,
    scheduledTime: record?.scheduledTime ?? null,
    windowStart: record?.windowStart ?? null,
    windowEnd: record?.windowEnd ?? null,
    deviation: Boolean(record?.deviation),
    deviationReason: record?.deviationReason ?? null,
    remarks: record?.remarks ?? null,
    executionMethod:
      record?.executionMethod ?? (record?.barcodeValue ? "pkBarcode" : "manual"),
    barcode: record?.barcodeValue ?? null,
    scanStartTime: record?.centrifugationStart ?? null,
    scanEndTime: record?.centrifugationEnd ?? null,
    // Prefer history pin (MapHdr), then review-activities payload (Hdr/Dtl pin).
    appActivityCrfNo: (() => {
      const fromRecord = Number(record?.appActivityCrfNo ?? record?.AppActivityCrfNo) || 0;
      if (fromRecord > 0) return fromRecord;
      const fromAct = Number(act.appActivityCrfNo ?? act.AppActivityCrfNo) || 0;
      return fromAct > 0 ? fromAct : null;
    })(),
    crfVersion: (() => {
      const fromRecord = Number(record?.crfVersion ?? record?.CrfVersion);
      if (Number.isFinite(fromRecord) && fromRecord > 0) return fromRecord;
      const fromAct = Number(act.crfVersion ?? act.CrfVersion);
      return Number.isFinite(fromAct) && fromAct > 0 ? fromAct : null;
    })(),
    crfName: String(
      record?.crfName ?? record?.CrfName ?? act.crfName ?? act.CrfName ?? ""
    ).trim() || null,
    // query fields — enables per-cell red/yellow/green highlight via reviewCellClassName
    ...(reviewQueries.length || reviewQuery ? {
      reviewQueries: reviewQueries.length
        ? reviewQueries
        : [{
            activityExecutionQueryNo:
              record?.activityExecutionQueryNo
              ?? act.activityExecutionQueryNo
              ?? act.ActivityExecutionQueryNo
              ?? null,
            fieldKey:
              record?.reviewQueryFieldKey
              ?? act.reviewQueryFieldKey
              ?? act.ReviewQueryFieldKey
              ?? "",
            fieldLabel:
              record?.reviewQueryFieldLabel
              ?? act.reviewQueryFieldLabel
              ?? act.ReviewQueryFieldLabel
              ?? "",
            queryText: reviewQuery,
            status:
              record?.reviewQueryStatus
              ?? act.reviewQueryStatus
              ?? act.ReviewQueryStatus
              ?? "raised",
            responseText:
              record?.reviewQueryResponse
              ?? act.reviewQueryResponse
              ?? act.ReviewQueryResponse
              ?? "",
            sendbackRemark:
              record?.reviewQuerySendbackRemark
              ?? act.reviewQuerySendbackRemark
              ?? act.ReviewQuerySendbackRemark
              ?? "",
            recordedOnUtc:
              record?.reviewQueryAt
              ?? act.reviewQueryAt
              ?? act.ReviewQueryAt
              ?? null,
            resolvedAt:
              record?.reviewQueryResolvedAt
              ?? act.reviewQueryResolvedAt
              ?? act.ReviewQueryResolvedAt
              ?? null,
            closedAt:
              record?.reviewQueryClosedAt
              ?? act.reviewQueryClosedAt
              ?? act.ReviewQueryClosedAt
              ?? null
          }],
      reviewQuery,
      reviewQueryAt:
        record?.reviewQueryAt
        ?? act.reviewQueryAt
        ?? act.ReviewQueryAt
        ?? reviewQueries[0]?.recordedOnUtc
        ?? null,
      reviewQueryFieldKey:
        record?.reviewQueryFieldKey
        ?? act.reviewQueryFieldKey
        ?? act.ReviewQueryFieldKey
        ?? reviewQueries[0]?.fieldKey
        ?? null,
      reviewQueryFieldLabel:
        record?.reviewQueryFieldLabel
        ?? act.reviewQueryFieldLabel
        ?? act.ReviewQueryFieldLabel
        ?? reviewQueries[0]?.fieldLabel
        ?? null,
      reviewQueryStatus:
        record?.reviewQueryStatus
        ?? act.reviewQueryStatus
        ?? act.ReviewQueryStatus
        ?? reviewQueries[0]?.status
        ?? null,
      reviewQueryResponse:
        record?.reviewQueryResponse
        ?? act.reviewQueryResponse
        ?? act.ReviewQueryResponse
        ?? reviewQueries[0]?.responseText
        ?? null,
      reviewQuerySendbackRemark:
        record?.reviewQuerySendbackRemark
        ?? act.reviewQuerySendbackRemark
        ?? act.ReviewQuerySendbackRemark
        ?? reviewQueries[0]?.sendbackRemark
        ?? null,
      reviewQueryResolvedAt:
        record?.reviewQueryResolvedAt
        ?? act.reviewQueryResolvedAt
        ?? act.ReviewQueryResolvedAt
        ?? reviewQueries[0]?.resolvedAt
        ?? null,
      reviewQueryClosedAt:
        record?.reviewQueryClosedAt
        ?? act.reviewQueryClosedAt
        ?? act.ReviewQueryClosedAt
        ?? reviewQueries[0]?.closedAt
        ?? null,
      activityExecutionQueryNo:
        record?.activityExecutionQueryNo
        ?? act.activityExecutionQueryNo
        ?? act.ActivityExecutionQueryNo
        ?? reviewQueries[0]?.activityExecutionQueryNo
        ?? null,
    } : {}),
  };

  const mapped = mapHdrStatusToLocal(record?.status, {
    deviation: activity.deviation,
    isImp: imp,
    hasCentrifugeEnd: Boolean(record?.centrifugationEnd),
  });

  if (mapped.activityStatus) {
    activity.status = mapped.activityStatus;
  } else if (record?.status) {
    activity.status = String(record.status).trim();
  }

  if (!imp && normalizeHdrStatus(record?.status) === HDR_STATUS.Skipped) {
    activity.status = "Skipped";
  }

  return activity;
}


function appendSampleAndAliquots(activity, record, visitContext, samples, aliquots) {
  if (!record) return;

  const imp = isImpDose(activity.activity);
  const mapped = mapHdrStatusToLocal(record.status, {
    deviation: activity.deviation,
    isImp: imp,
    hasCentrifugeEnd: Boolean(record.centrifugationEnd),
  });

  if (imp || (!record.actualTime && !mapped.sampleStatus)) {
    if (normalizeHdrStatus(record.status) === HDR_STATUS.Skipped) return;
    if (!record.actualTime) {
      if ((record.aliquots ?? []).length) {
        activity.aliquots = (record.aliquots ?? []).map((aliquotDto) => {
          const barcode = String(aliquotDto.barcodeValue ?? aliquotDto.barcode ?? "").trim();
          const status = String(aliquotDto.status ?? "Pending").trim();
          const isLinked = status.toLowerCase() === "linked";
          const isSkipped = status.toLowerCase() === "skipped";
          return {
            id: aliquotDto.activityExecutionAliquotNo || `review-alq-${barcode}`,
            activityExecutionAliquotNo: aliquotDto.activityExecutionAliquotNo ?? null,
            barcode,
            status,
            skipped: isSkipped,
            skippedAt: isSkipped ? new Date().toISOString() : null,
            createdAt: isLinked ? new Date().toISOString() : null,
            skipRemark: aliquotDto.skipRemark ?? null,
            skippedReason: aliquotDto.skipRemark ?? null,
          };
        });
      }
      return;
    }
  }

  const sampleId = `review-smp-${activity.id}`;
  activity.sampleId = sampleId;

  let sampleStatus = mapped.sampleStatus || "Aliquoted";
  const hdrNorm = normalizeHdrStatus(record.status);
  if (hdrNorm === HDR_STATUS.BloodCollected && !record.centrifugationStart) {
    sampleStatus = "Awaiting Centrifugation";
  } else if (hdrNorm === HDR_STATUS.Centrifugation) {
    sampleStatus = record.centrifugationEnd ? "Ready For Aliquot" : "Centrifuging";
  } else if (hdrNorm === HDR_STATUS.Aliquoted) {
    sampleStatus = "Aliquoted";
  }

  samples.push({
    id: sampleId,
    activityId: activity.id,
    subjectId: visitContext.subjectNumber,
    barcode: activity.barcode || record.barcodeValue || null,
    visitId: activity.visitId,
    timepoint: activity.timepoint,
    dose: activity.dose,
    collectedAt: record.actualTime ?? null,
    centrifugationStart: record.centrifugationStart ?? null,
    centrifugationEnd: record.centrifugationEnd ?? null,
    scanStartTime: record.centrifugationStart ?? null,
    scanEndTime: record.centrifugationEnd ?? null,
    status: sampleStatus,
    apiSeeded: true,
  });

  for (const aliquotDto of record.aliquots ?? []) {
    const barcode = String(aliquotDto.barcodeValue ?? "").trim();
    if (!barcode) continue;
    const status = String(aliquotDto.status ?? "Pending").trim();
    const isLinked = status.toLowerCase() === "linked";
    const isSkipped = status.toLowerCase() === "skipped";
    aliquots.push({
      id: aliquotDto.activityExecutionAliquotNo || `review-alq-${barcode}`,
      activityExecutionAliquotNo: aliquotDto.activityExecutionAliquotNo,
      parentSampleId: sampleId,
      parentBarcode: activity.barcode,
      barcode,
      status,
      createdAt: isLinked ? new Date().toISOString() : null,
      skippedAt: isSkipped ? new Date().toISOString() : null,
      skippedReason: aliquotDto.skipRemark ?? null,
      skipRemark: aliquotDto.skipRemark ?? null,
      apiSeeded: true,
    });
  }

  activity.aliquots = (record.aliquots ?? []).map((aliquotDto) => {
    const barcode = String(aliquotDto.barcodeValue ?? "").trim();
    const status = String(aliquotDto.status ?? "Pending").trim();
    const isLinked = status.toLowerCase() === "linked";
    const isSkipped = status.toLowerCase() === "skipped";
    return {
      id: aliquotDto.activityExecutionAliquotNo || `review-alq-${barcode}`,
      activityExecutionAliquotNo: aliquotDto.activityExecutionAliquotNo ?? null,
      barcode,
      status,
      skipped: isSkipped,
      skippedAt: isSkipped ? new Date().toISOString() : null,
      createdAt: isLinked ? new Date().toISOString() : null,
      skipRemark: aliquotDto.skipRemark ?? null,
      skippedReason: aliquotDto.skipRemark ?? null,
    };
  });
}

function buildSyntheticRecord(act, activity) {
  const apiAliquots = act.aliquots ?? act.Aliquots ?? activity.aliquots ?? [];
  return {
    status: act.status ?? act.Status ?? activity.status,
    actualTime: activity.actualTime,
    barcodeValue: activity.barcode,
    centrifugationStart: activity.scanStartTime,
    centrifugationEnd: activity.scanEndTime,
    aliquots: apiAliquots.map((aliquotDto) => ({
      activityExecutionAliquotNo:
        aliquotDto.activityExecutionAliquotNo ?? aliquotDto.ActivityExecutionAliquotNo,
      barcodeValue: aliquotDto.barcodeValue ?? aliquotDto.BarcodeValue ?? aliquotDto.barcode,
      status: aliquotDto.status ?? aliquotDto.Status ?? "Pending",
      skipRemark: aliquotDto.skipRemark ?? aliquotDto.SkipRemark ?? null,
    })),
  };
}

function indexHistoryRecords(records) {
  const byHdr = new Map();
  const byTp = new Map();

  for (const record of records ?? []) {
    const hdrNo = Number(record.activityExecutionHdrNo ?? record.activityExecutionRecordNo) || 0;
    const tpNo = Number(record.activityConfigTimePointNo) || 0;
    if (hdrNo) byHdr.set(hdrNo, record);
    if (tpNo && !byTp.has(tpNo)) byTp.set(tpNo, record);
  }

  return { byHdr, byTp };
}

/** Parse "+0.500 H", "+20 Min", etc. from timepoint labels. */
function parseOffsetMinutesFromTimepoint(timepoint) {
  const tp = String(timepoint ?? "").replace(/\([^)]*\)/g, "").trim();
  if (!tp || /^pre[-\s]?dose$/i.test(tp)) return null;

  const hourMatch = tp.match(/^\+?\s*(-?\d+(?:\.\d+)?)\s*H\b/i);
  if (hourMatch) return Math.round(Number(hourMatch[1]) * 60);

  const minMatch = tp.match(/^\+?\s*(-?\d+(?:\.\d+)?)\s*Min\b/i);
  if (minMatch) return Math.round(Number(minMatch[1]));

  return null;
}

function toLocalIsoMinutes(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 19);
}

/**
 * Skipped post-dose rows often lack ScheduledTime/Window in ActivityExecutionDtl.
 * Derive them from the IMP dose actual time + timepoint offset (same as Activity page).
 */
function fillScheduledWindowsFromDose(activities) {
  const byVisit = new Map();
  for (const activity of activities) {
    const key = activity.visitId ?? activity.visitTrackerNo ?? activity.dose ?? "";
    if (!byVisit.has(key)) byVisit.set(key, []);
    byVisit.get(key).push(activity);
  }

  for (const group of byVisit.values()) {
    const doseActivity = group.find((item) => isImpDose(item.activity));
    const doseTime = doseActivity?.actualTime ?? doseActivity?.scheduledTime ?? null;
    if (!doseTime) continue;

    const refDate = new Date(doseTime);
    if (Number.isNaN(refDate.getTime())) continue;

    for (const activity of group) {
      if (isImpDose(activity.activity)) continue;
      if (/^pre[-\s]?dose blood collection$/i.test(String(activity.activity ?? ""))) continue;

      const offsetMinutes =
        activity.pkOffsetMinutes ?? parseOffsetMinutesFromTimepoint(activity.timepoint);
      if (offsetMinutes == null) continue;

      const scheduledMs = refDate.getTime() + offsetMinutes * 60000;
      const scheduledTime = toLocalIsoMinutes(new Date(scheduledMs));
      const windowStart = toLocalIsoMinutes(new Date(scheduledMs - 3 * 60000));
      const windowEnd = toLocalIsoMinutes(new Date(scheduledMs + 3 * 60000));

      if (!activity.scheduledTime) activity.scheduledTime = scheduledTime;
      if (!activity.windowStart) activity.windowStart = windowStart;
      if (!activity.windowEnd) activity.windowEnd = windowEnd;
    }
  }

  return activities;
}

/**
 * Build review grid rows from execution history (same source as Activity page)
 * merged with review visit metadata.
 */
export function buildReviewGridFromHistory({
  reviewActivities = [],
  history = { records: [] },
  apiVisits = [],
  selectedVisitIds = [],
}) {
  const selectedVisitSet = new Set(selectedVisitIds.map((id) => Number(id) || 0));
  const { byHdr, byTp } = indexHistoryRecords(history.records);

  const activities = [];
  const samples = [];
  const aliquots = [];

  for (const act of reviewActivities) {
    const visitTrackerNo = Number(act.visitTrackerNo ?? act.VisitTrackerNo) || 0;
    if (selectedVisitSet.size && visitTrackerNo && !selectedVisitSet.has(visitTrackerNo)) {
      continue;
    }

    const hdrNo = Number(act.activityExecutionHdrNo ?? act.ActivityExecutionHdrNo) || 0;
    const tpNo = Number(act.activityConfigTimePointNo ?? act.ActivityConfigTimePointNo) || 0;
    const visitContext = getVisitContext(apiVisits, act);
    const record = (hdrNo && byHdr.get(hdrNo)) ?? (tpNo && byTp.get(tpNo)) ?? null;
    const activity = record
      ? mapRecordToActivity(act, record, visitContext)
      : mapReviewApiActivity(act, visitContext);

    const crfMeta = mapReviewApiActivity(act, visitContext);
    if (crfMeta.crfResponses) activity.crfResponses = crfMeta.crfResponses;
    if (crfMeta.crfValues) activity.crfValues = crfMeta.crfValues;
    // Prefer review-activities Dtl identity map so field audit can load from DB.
    if (crfMeta.fieldIds && Object.keys(crfMeta.fieldIds).length) {
      activity.fieldIds = { ...(activity.fieldIds ?? {}), ...crfMeta.fieldIds };
    }
    // Always keep the saved CRF pin (history or review-activities). Without this,
    // mapRecordToActivity path opened latest-by-type in Review while Execution showed the pin.
    const pinFromMeta = Number(crfMeta.appActivityCrfNo) || 0;
    const pinFromRecord = Number(record?.appActivityCrfNo) || 0;
    const pinFromActivity = Number(activity.appActivityCrfNo) || 0;
    const resolvedPin = pinFromMeta || pinFromRecord || pinFromActivity;
    if (resolvedPin > 0) {
      activity.appActivityCrfNo = resolvedPin;
    }
    if (crfMeta.crfVersion != null) activity.crfVersion = crfMeta.crfVersion;
    else if (record?.crfVersion != null && activity.crfVersion == null) {
      activity.crfVersion = record.crfVersion;
    }
    if (crfMeta.crfName) activity.crfName = crfMeta.crfName;
    else if (record?.crfName && !activity.crfName) activity.crfName = record.crfName;

    // Prefer Dtl schedule values from review payload when history omitted them.
    if (!activity.scheduledTime && crfMeta.scheduledTime) activity.scheduledTime = crfMeta.scheduledTime;
    if (!activity.windowStart && crfMeta.windowStart) activity.windowStart = crfMeta.windowStart;
    if (!activity.windowEnd && crfMeta.windowEnd) activity.windowEnd = crfMeta.windowEnd;
    if (!activity.visitLabel && crfMeta.visitLabel) activity.visitLabel = crfMeta.visitLabel;
    if (!activity.performedBy && crfMeta.performedBy) activity.performedBy = crfMeta.performedBy;
    if (!activity.performedOn && crfMeta.performedOn) activity.performedOn = crfMeta.performedOn;
    if (!activity.performedOffset && crfMeta.performedOffset) activity.performedOffset = crfMeta.performedOffset;
    if (!activity.reviewedBy && crfMeta.reviewedBy) activity.reviewedBy = crfMeta.reviewedBy;
    if (!activity.reviewedOn && crfMeta.reviewedOn) activity.reviewedOn = crfMeta.reviewedOn;
    if (!activity.reviewedOffset && crfMeta.reviewedOffset) activity.reviewedOffset = crfMeta.reviewedOffset;

    activities.push(activity);
    if (!isImpDose(activity.activity)) {
      const sampleRecord = record ?? buildSyntheticRecord(act, activity);
      appendSampleAndAliquots(activity, sampleRecord, visitContext, samples, aliquots);
    }
  }

  fillScheduledWindowsFromDose(activities);

  const visits = selectedVisitIds
    .map((visitTrackerNo) => {
      const visit = apiVisits.find((v) => v.visitTrackerNo === visitTrackerNo);
      if (!visit) return null;
      const visitActivities = activities.filter(
        (item) =>
          item.visitId === visit.visitTrackerNo || item.visitTrackerNo === visit.visitTrackerNo
      );
      const doseFromActivities =
        visitActivities.map((item) => formatDoseDisplayLabel(item.dose)).find((label) => label && label !== "-")
        ?? formatDoseDisplayLabel(visit.visitName);
      return {
        id: visit.visitTrackerNo,
        subjectId: String(visit.subjectMstNo),
        dose: doseFromActivities,
        doseLabel: doseFromActivities,
        visitLabel: visit.visitLabel || visit.periodLabel || "",
        periodLabel: visit.periodLabel || "",
        name: visit.visitLabel || visit.periodLabel || "",
        label: visit.visitLabel || visit.periodLabel || "",
        doseScheduleConfirmed: true,
        reviewStatus: visit.reviewStatus,
        actualDoseTime:
          visitActivities.find((item) => isImpDose(item.activity))?.actualTime ?? null,
      };
    })
    .filter(Boolean);

  return { activities, samples, aliquots, visits };
}
