import api from "@/shared/api/httpClient.js";

function pick(row, ...keys) {
  for (const key of keys) {
    if (row?.[key] != null && row[key] !== "") return row[key];
  }
  return null;
}

function mapReviewVisit(row) {
  const period = pick(row, "period", "Period");
  const periodLabel = pick(row, "periodLabel", "PeriodLabel");
  const visitLabel = pick(row, "visitLabel", "VisitLabel");
  const timepointsReviewed = pick(row, "timepointsReviewed", "TimepointsReviewed");
  const timepointsTotal = pick(row, "timepointsTotal", "TimepointsTotal");
  const openQueriesCount = pick(row, "openQueriesCount", "OpenQueriesCount");
  return {
    visitTrackerNo: pick(row, "visitTrackerNo", "VisitTrackerNo"),
    subjectMstNo: pick(row, "subjectMstNo", "SubjectMstNo"),
    subjectId: pick(row, "subjectId", "SubjectId"),
    subjectNumber: pick(row, "subjectNumber", "SubjectNumber") ?? "",
    visitName: pick(row, "visitName", "VisitName") ?? "",
    visitLabel: visitLabel || periodLabel || "",
    doseLabel: pick(row, "doseLabel", "DoseLabel", "visitName", "VisitName") ?? "",
    studyVisitScheduleNo: (() => {
      const n = Number(pick(row, "studyVisitScheduleNo", "StudyVisitScheduleNo"));
      return Number.isFinite(n) && n > 0 ? n : 0;
    })(),
    period: period == null || period === "" ? null : Number(period),
    periodLabel: periodLabel || (period ? `Period ${period}` : ""),
    visitStatus: pick(row, "visitStatus", "VisitStatus") ?? "",
    reviewStatus: pick(row, "reviewStatus", "ReviewStatus") ?? "Pending",
    timepointsReviewed: timepointsReviewed == null || timepointsReviewed === "" ? 0 : Number(timepointsReviewed),
    timepointsTotal: timepointsTotal == null || timepointsTotal === "" ? 0 : Number(timepointsTotal),
    openQueriesCount: openQueriesCount == null || openQueriesCount === "" ? 0 : Number(openQueriesCount),
    performedBy: pick(row, "performedBy", "PerformedBy") ?? "",
    performedOn: pick(row, "performedOn", "PerformedOn"),
    performedOffset: pick(row, "performedOffset", "PerformedOffset") ?? "",
    reviewedBy: pick(row, "reviewedBy", "ReviewedBy") ?? "",
    reviewedOn: pick(row, "reviewedOn", "ReviewedOn"),
    reviewedOffset: pick(row, "reviewedOffset", "ReviewedOffset") ?? "",
  };
}

/** GET /Review/sites?projectId={projectId} */
export async function fetchReviewSites({ projectId }) {
  const res = await api.get("/Review/sites", {
    params: { projectId }
  });
  return res.data.data ?? [];
}

/** GET /Review/visits?projectId={projectId}&siteCode={siteCode} */
export async function fetchReviewVisits({ projectId, siteCode }) {
  const res = await api.get("/Review/visits", {
    params: { projectId, siteCode: siteCode || undefined }
  });
  const list = res.data.data ?? [];
  return list.map(mapReviewVisit);
}

/** GET /Review/activities/{visitTrackerNo} */
export async function fetchReviewActivities(visitTrackerNo) {
  const res = await api.get(`/Review/activities/${encodeURIComponent(visitTrackerNo)}`);
  return res.data.data ?? [];
}

/** POST /Review/submit-visit/{visitTrackerNo} */
export async function submitVisitForReviewApi(visitTrackerNo) {
  const res = await api.post(`/Review/submit-visit/${encodeURIComponent(visitTrackerNo)}`);
  return res.data;
}

/** POST /Review/submit-visit-by-dose?subjectMstNo=&visitName=&activityConfigDoseNo= */
export async function submitVisitByDoseApi({ subjectMstNo, visitName, activityConfigDoseNo }) {
  const res = await api.post("/Review/submit-visit-by-dose", null, {
    params: {
      subjectMstNo,
      visitName,
      activityConfigDoseNo: activityConfigDoseNo || undefined
    }
  });
  return res.data;
}

/** POST /Review/review-activities */
export async function reviewActivitiesApi(activityExecutionHdrNos, visitTrackerNo) {
  const res = await api.post("/Review/review-activities", {
    activityExecutionHdrNos,
    visitTrackerNo: visitTrackerNo || undefined
  });
  return res.data;
}

/** POST /Review/query/raise */
export async function raiseReviewQueryApi({
  subjectMstNo,
  activityConfigTimePointNo,
  activityExecutionHdrNo,
  fieldKey,
  fieldLabel,
  queryText,
}) {
  const res = await api.post("/Review/query/raise", {
    subjectMstNo,
    activityConfigTimePointNo: activityConfigTimePointNo || 0,
    activityExecutionHdrNo: activityExecutionHdrNo > 0 ? activityExecutionHdrNo : null,
    fieldKey,
    fieldLabel,
    queryText,
  });
  return res.data;
}

/** POST /Review/query/resolve */
export async function resolveReviewQueryApi({
  subjectMstNo,
  activityConfigTimePointNo,
  activityExecutionHdrNo,
  responseText,
  fieldValue,
  fieldKey,
}) {
  const res = await api.post("/Review/query/resolve", {
    subjectMstNo,
    activityConfigTimePointNo: activityConfigTimePointNo || 0,
    activityExecutionHdrNo: activityExecutionHdrNo > 0 ? activityExecutionHdrNo : null,
    responseText,
    fieldValue,
    fieldKey,
  });
  return res.data;
}

/** POST /Review/query/send-back */
export async function sendbackReviewQueryApi({
  subjectMstNo,
  activityConfigTimePointNo,
  activityExecutionHdrNo,
  remark,
  fieldKey,
}) {
  const res = await api.post("/Review/query/send-back", {
    subjectMstNo,
    activityConfigTimePointNo: activityConfigTimePointNo || 0,
    activityExecutionHdrNo: activityExecutionHdrNo > 0 ? activityExecutionHdrNo : null,
    remark,
    fieldKey,
  });
  return res.data;
}

/** POST /Review/query/close */
export async function closeReviewQueryApi({
  subjectMstNo,
  activityConfigTimePointNo,
  activityExecutionHdrNo,
  fieldKey,
  remark,
}) {
  const res = await api.post("/Review/query/close", {
    subjectMstNo,
    activityConfigTimePointNo: activityConfigTimePointNo || 0,
    activityExecutionHdrNo: activityExecutionHdrNo > 0 ? activityExecutionHdrNo : null,
    fieldKey,
    remark,
  });
  return res.data;
}

/** POST /Review/query/re-raise */
export async function reraiseReviewQueryApi({
  subjectMstNo,
  activityConfigTimePointNo,
  activityExecutionHdrNo,
  queryText,
  fieldKey,
}) {
  const res = await api.post("/Review/query/re-raise", {
    subjectMstNo,
    activityConfigTimePointNo: activityConfigTimePointNo || 0,
    activityExecutionHdrNo: activityExecutionHdrNo > 0 ? activityExecutionHdrNo : null,
    queryText,
    fieldKey,
  });
  return res.data;
}

/** GET /Review/query/audit — rows from dbo.ActivityExecutionQueryEvent */
export async function fetchReviewQueryAuditApi({
  subjectMstNo,
  activityConfigTimePointNo,
  activityExecutionQueryNo
} = {}) {
  const res = await api.get("/Review/query/audit", {
    params: {
      subjectMstNo: subjectMstNo || undefined,
      activityConfigTimePointNo: activityConfigTimePointNo || undefined,
      activityExecutionQueryNo: activityExecutionQueryNo || undefined
    }
  });
  const list = res.data?.data ?? [];
  return (Array.isArray(list) ? list : []).map((row) => ({
    activityExecutionQueryEventNo: Number(row.activityExecutionQueryEventNo ?? row.ActivityExecutionQueryEventNo) || 0,
    activityExecutionQueryNo: Number(row.activityExecutionQueryNo ?? row.ActivityExecutionQueryNo) || 0,
    eventType: String(row.eventType ?? row.EventType ?? "").trim().toLowerCase(),
    detail: row.detail ?? row.Detail ?? "",
    fieldKey: row.fieldKey ?? row.FieldKey ?? "",
    fieldLabel: row.fieldLabel ?? row.FieldLabel ?? "",
    performedBy: row.performedBy ?? row.PerformedBy ?? "",
    recordedOnUtc: row.recordedOnUtc ?? row.RecordedOnUtc ?? null,
    recordedAtOffset: row.recordedAtOffset ?? row.RecordedAtOffset ?? ""
  }));
}

/** Map API query audit events into AuditDetailModal rows. */
export function mapReviewQueryAuditEventsToRows(events = [], { activityId, fieldKey, fieldLabel } = {}) {
  return (events ?? []).map((event, index) => {
    const queryStage = String(event.eventType ?? "").trim().toLowerCase();
    return {
      id: `query-event-${event.activityExecutionQueryEventNo || index}`,
      entityId: activityId,
      auditType: "reviewQuery",
      queryStage,
      fieldKey: event.fieldKey || fieldKey || "",
      label: event.fieldLabel || fieldLabel || "",
      reason: String(event.detail ?? "").trim(),
      details: String(event.detail ?? "").trim(),
      user: String(event.performedBy ?? "").trim() || "-",
      timestamp: event.recordedOnUtc || null,
      recordedAtOffset: event.recordedAtOffset || ""
    };
  });
}

