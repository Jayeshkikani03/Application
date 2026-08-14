import api from "@/shared/api/httpClient.js";

/**
 * GET /ActivityExecution/start-by-scan?code=
 * Gates: generated barcode → SubjectMst → published schedule (+ PK labels).
 */
export async function startSessionByScan(code) {
  const trimmed = String(code ?? "").trim();
  const res = await api.get("/ActivityExecution/start-by-scan", {
    params: { code: trimmed },
  });
  return normalizeStartPayload(res.data?.data ?? res.data ?? {});
}

/** GET /ActivityExecution/published-schedule */
export async function getPublishedExecutionSchedule() {
  const res = await api.get("/ActivityExecution/published-schedule");
  return normalizeSchedule(res.data?.data ?? res.data ?? {});
}

/**
 * Build the query string for a paged queue read. Empty/zero values are omitted so the
 * backend applies its defaults.
 */
function buildQueueParams({
  page,
  pageSize,
  subjectMstNo,
  dose,
  includeCompleted,
  scanCode,
} = {}) {
  const params = {};
  if (page > 0) params.page = page;
  if (pageSize > 0) params.pageSize = pageSize;
  if (subjectMstNo > 0) params.subjectMstNo = subjectMstNo;
  if (dose > 0) params.dose = dose;
  if (includeCompleted) params.includeCompleted = true;
  const trimmedScan = String(scanCode ?? "").trim();
  if (trimmedScan) params.scanCode = trimmedScan;
  return params;
}

/** GET /ActivityExecution/centrifuge-queue (paged + filtered) */
export async function getCentrifugeQueue(params = {}) {
  const res = await api.get("/ActivityExecution/centrifuge-queue", {
    params: buildQueueParams(params),
  });
  return normalizeQueue(res.data?.data ?? res.data ?? {});
}

/** GET /ActivityExecution/aliquot-queue (paged + filtered) */
export async function getAliquotQueue(params = {}) {
  const res = await api.get("/ActivityExecution/aliquot-queue", {
    params: buildQueueParams(params),
  });
  return normalizeQueue(res.data?.data ?? res.data ?? {});
}

/** GET /ActivityExecution/dashboard-summary — site KPI counts for mobile/tablet home. */
export async function getDashboardSummary() {
  const res = await api.get("/ActivityExecution/dashboard-summary");
  return normalizeDashboardSummary(res.data?.data ?? res.data ?? {});
}

/** POST /ActivityExecution/dose */
export async function saveDoseAdministration(payload) {
  const res = await api.post("/ActivityExecution/dose", payload);
  return normalizeRecord(res.data?.data ?? res.data ?? {});
}

/** POST /ActivityExecution/pk-collect */
export async function savePkCollection(payload) {
  const res = await api.post("/ActivityExecution/pk-collect", payload);
  return normalizeRecord(res.data?.data ?? res.data ?? {});
}

/** POST /ActivityExecution/skip — mark timepoint Skipped (creates hdr if needed) */
export async function saveSkippedApi(payload) {
  const res = await api.post("/ActivityExecution/skip", {
    subjectMstNo: payload.subjectMstNo,
    activityConfigTimePointNo: payload.activityConfigTimePointNo,
    remarks: payload.remarks ?? null,
    scheduledTime: payload.scheduledTime ?? null,
    windowStart: payload.windowStart ?? null,
    windowEnd: payload.windowEnd ?? null,
  });
  return normalizeRecord(res.data?.data ?? res.data ?? {});
}

export async function saveSkippedBulkApi({ skips }) {
  const res = await api.post("/ActivityExecution/skip-bulk", {
    skips
  });
  return (res.data?.data ?? res.data ?? []).map(normalizeRecord);
}

/** PATCH /ActivityExecution/update-fields — generic: patch any allowed field(s) without full-record overwrite */
export async function updateFieldsApi({ subjectMstNo, activityConfigTimePointNo, fields, changeReason }) {
  const res = await api.patch("/ActivityExecution/update-fields", {
    subjectMstNo,
    activityConfigTimePointNo,
    fields,            // { ActualTime: "...", Remarks: "...", etc. }
    changeReason: changeReason || "",
  });
  return normalizeRecord(res.data?.data ?? res.data ?? {});
}

/** POST /ActivityExecution/save-crf — persist CRF answers + AppActivityCrfNo link */
export async function saveCrfApi(payload) {
  const res = await api.post("/ActivityExecution/save-crf", {
    subjectMstNo: payload.subjectMstNo,
    activityConfigTimePointNo: payload.activityConfigTimePointNo,
    appVisitCrfMappingNo: payload.appVisitCrfMappingNo ?? null,
    activityExecutionHdrNo: payload.activityExecutionHdrNo ?? null,
    appActivityCrfNo: payload.appActivityCrfNo,
    values: payload.values ?? {},
    changeReason: payload.changeReason ?? "",
    changeReasonsByFieldId: payload.changeReasonsByFieldId ?? null,
    status: payload.status ?? null,
  });
  return normalizeRecord(res.data?.data ?? res.data ?? {});
}

/** POST /ActivityExecution/centrifuge-start */
export async function startCentrifugeApi(payload) {
  const res = await api.post("/ActivityExecution/centrifuge-start", payload);
  return normalizeRecord(res.data?.data ?? res.data ?? {});
}

/** POST /ActivityExecution/centrifuge-end */
export async function endCentrifugeApi(payload) {
  const res = await api.post("/ActivityExecution/centrifuge-end", payload);
  return normalizeRecord(res.data?.data ?? res.data ?? {});
}

/** POST /ActivityExecution/aliquot-link */
export async function linkAliquotApi(payload) {
  const res = await api.post("/ActivityExecution/aliquot-link", {
    subjectMstNo: payload.subjectMstNo,
    activityConfigTimePointNo: payload.activityConfigTimePointNo,
    barcodeValue: payload.barcodeValue,
    storageLocation: payload.storageLocation ?? null,
  });
  return normalizeAliquot(res.data?.data ?? res.data ?? {});
}

/** POST /ActivityExecution/aliquot-skip */
export async function skipAliquotApi(payload) {
  const res = await api.post("/ActivityExecution/aliquot-skip", {
    subjectMstNo: payload.subjectMstNo,
    activityConfigTimePointNo: payload.activityConfigTimePointNo,
    barcodeValue: payload.barcodeValue,
    skipRemark: payload.skipRemark ?? payload.skippedReason ?? "",
  });
  return normalizeAliquot(res.data?.data ?? res.data ?? {});
}

function normalizeStartPayload(raw) {
  const subject = raw.subject ?? raw.Subject ?? {};
  const schedule = normalizeSchedule(raw.schedule ?? raw.Schedule ?? {});
  const barcode = String(raw.barcode ?? raw.Barcode ?? subject.siteRandomizationNo ?? "").trim();

  return {
    barcode,
    subject: {
      subjectMstNo: Number(subject.subjectMstNo ?? subject.SubjectMstNo) || 0,
      subjectId: String(subject.subjectId ?? subject.SubjectId ?? "").trim(),
      siteNo: String(subject.siteNo ?? subject.SiteNo ?? "").trim(),
      siteCode: String(subject.siteCode ?? subject.SiteCode ?? "").trim(),
      mySubjectNo: String(subject.mySubjectNo ?? subject.MySubjectNo ?? "").trim(),
      initials: String(subject.initials ?? subject.Initials ?? "").trim(),
      patientStatus: String(subject.patientStatus ?? subject.PatientStatus ?? "").trim(),
      randomizationNo: String(subject.randomizationNo ?? subject.RandomizationNo ?? "").trim(),
      siteRandomizationNo: String(
        subject.siteRandomizationNo ?? subject.SiteRandomizationNo ?? barcode
      ).trim(),
      isScreeningFailure: Boolean(subject.isScreeningFailure ?? subject.IsScreeningFailure),
      visits: (subject.visits ?? subject.Visits ?? []).map((visit) => ({
        studyVisitScheduleNo: Number(visit.studyVisitScheduleNo ?? visit.StudyVisitScheduleNo) || 0,
        visitNo: Number(visit.visitNo ?? visit.VisitNo) || 0,
        studyVisitScheduleDescription: String(
          visit.studyVisitScheduleDescription ?? visit.StudyVisitScheduleDescription ?? ""
        ).trim(),
        visitName: String(visit.visitName ?? visit.VisitName ?? "").trim(),
        prmsVisitStatus: String(visit.prmsVisitStatus ?? visit.PrmsVisitStatus ?? "").trim(),
        isPrmsCompleted: Boolean(visit.isPrmsCompleted ?? visit.IsPrmsCompleted),
        visitDate: visit.visitDate ?? visit.VisitDate ?? null,
        expectingDate: visit.expectingDate ?? visit.ExpectingDate ?? null,
      })),
    },
    schedule,
    history: raw.history || raw.History ? normalizeHistory(raw.history ?? raw.History) : { records: [] },
    visitReviews: (raw.visitReviews ?? raw.VisitReviews ?? []).map((item) => ({
      visitTrackerNo: Number(item.visitTrackerNo ?? item.VisitTrackerNo) || 0,
      visitName: String(item.visitName ?? item.VisitName ?? "").trim(),
      reviewStatus: String(item.reviewStatus ?? item.ReviewStatus ?? "").trim() || null,
      subjectMstNo: Number(subject.subjectMstNo ?? subject.SubjectMstNo) || 0,
    })),
    prmsGate: normalizePrmsGate(raw.prmsGate ?? raw.PrmsGate),
  };
}

function normalizePrmsGate(raw) {
  const gate = raw && typeof raw === "object" ? raw : {};
  const unlockedVisits = (gate.unlockedVisits ?? gate.UnlockedVisits ?? [])
    .map((label) => String(label ?? "").trim())
    .filter(Boolean);
  const lockedVisits = (gate.lockedVisits ?? gate.LockedVisits ?? [])
    .map((label) => String(label ?? "").trim())
    .filter(Boolean);
  const lockedBarcodes = (gate.lockedBarcodes ?? gate.LockedBarcodes ?? [])
    .map((code) => String(code ?? "").trim().toUpperCase())
    .filter(Boolean);
  const message = String(gate.message ?? gate.Message ?? "").trim();
  return {
    unlockedVisits,
    lockedVisits,
    lockedBarcodes,
    message,
  };
}

function normalizeSchedule(raw) {
  const periods = (raw.periods ?? raw.Periods ?? []).map((period) => {
    const periodNumber = Number(period.period ?? period.Period) || 0;
    const doses = (period.doses ?? period.Doses ?? []).map((dose) => {
      const doseNo = Number(dose.activityConfigDoseNo ?? dose.ActivityConfigDoseNo) || 0;
      const timepoints = (dose.timepoints ?? dose.Timepoints ?? []).map((tp) => {
        const tpNo = Number(tp.activityConfigTimePointNo ?? tp.ActivityConfigTimePointNo) || 0;
        const activityType = String(tp.activityType ?? tp.ActivityType ?? "").trim();
        const offset = tp.offsetMinutes ?? tp.OffsetMinutes ?? null;
        const pkBarcode = String(tp.pkBarcode ?? tp.PkBarcode ?? "").trim() || null;
        const aliquotBarcodes = (tp.aliquotBarcodes ?? tp.AliquotBarcodes ?? [])
          .map((code) => String(code ?? "").trim())
          .filter(Boolean);
        return {
          id: String(tp.id ?? tp.Id ?? `tp-${tpNo}`),
          activityConfigTimePointNo: tpNo,
          label: String(tp.label ?? tp.Label ?? "").trim(),
          order: Number(tp.order ?? tp.Order) || 0,
          activityType,
          duration: Number(tp.duration ?? tp.Duration) || 0,
          durationType: String(tp.durationType ?? tp.DurationType ?? "Hour"),
          offsetMinutes: offset == null ? null : Number(offset),
          isActive: tp.isActive !== false && tp.IsActive !== false,
          generatesPkLabel: tp.generatesPkLabel !== false && tp.GeneratesPkLabel !== false,
          pkBarcode,
          aliquotBarcodes,
        };
      });

      return {
        id: String(dose.id ?? dose.Id ?? `dose-${doseNo}`),
        activityConfigDoseNo: doseNo,
        label: String(dose.label ?? dose.Label ?? "").trim(),
        order: Number(dose.order ?? dose.Order) || 0,
        period: Number(dose.period ?? dose.Period ?? periodNumber) || periodNumber,
        isPublished: dose.isPublished !== false && dose.IsPublished !== false,
        isActive: dose.isActive !== false && dose.IsActive !== false,
        visitNo: Number(dose.visitNo ?? dose.VisitNo) || 0,
        studyVisitScheduleNo: Number(dose.studyVisitScheduleNo ?? dose.StudyVisitScheduleNo) || 0,
        studyVisitLabel: String(
          dose.studyVisitLabel ?? dose.StudyVisitLabel ?? ""
        ).trim(),
        timepoints,
      };
    });

    return {
      id: String(period.periodId ?? period.PeriodId ?? `period-${periodNumber}`),
      period: periodNumber,
      code: String(period.code ?? period.Code ?? String(periodNumber).padStart(2, "0")),
      label: String(period.label ?? period.Label ?? String(periodNumber)),
      doses,
    };
  });

  return {
    projectCode: String(raw.projectCode ?? raw.ProjectCode ?? "").trim(),
    aliquotsPerSeparation:
      Number(raw.aliquotsPerSeparation ?? raw.AliquotsPerSeparation) || 3,
    periods,
  };
}

function normalizeAliquot(raw) {
  const status = String(raw.status ?? raw.Status ?? "Pending").trim() || "Pending";
  const isLinked =
    Boolean(raw.isLinked ?? raw.IsLinked) ||
    status.toLowerCase() === "linked";
  return {
    activityExecutionAliquotNo:
      Number(raw.activityExecutionAliquotNo ?? raw.ActivityExecutionAliquotNo) || 0,
    activityExecutionHdrNo:
      Number(
        raw.activityExecutionHdrNo ??
        raw.ActivityExecutionHdrNo ??
        raw.activityExecutionRecordNo ??
        raw.ActivityExecutionRecordNo
      ) || 0,
    barcodeValue: String(raw.barcodeValue ?? raw.BarcodeValue ?? "").trim(),
    slotOrder: Number(raw.slotOrder ?? raw.SlotOrder) || 0,
    status,
    skipRemark: raw.skipRemark ?? raw.SkipRemark ?? null,
    storageLocation: raw.storageLocation ?? raw.StorageLocation ?? null,
    // UI legacy: createdAt set when linked
    createdAt: isLinked ? new Date().toISOString() : null,
    skippedAt: status.toLowerCase() === "skipped" ? new Date().toISOString() : null,
    skippedReason: raw.skipRemark ?? raw.SkipRemark ?? null,
  };
}

function normalizeRecord(raw) {
  const activityExecutionHdrNo = Number(
    raw.activityExecutionHdrNo ??
    raw.ActivityExecutionHdrNo ??
    raw.activityExecutionRecordNo ??
    raw.ActivityExecutionRecordNo
  ) || 0;

  return {
    id: activityExecutionHdrNo,
    activityExecutionHdrNo,
    activityExecutionRecordNo: activityExecutionHdrNo,
    subjectMstNo: Number(raw.subjectMstNo ?? raw.SubjectMstNo) || 0,
    siteRandomizationNo: String(
      raw.siteRandomizationNo ?? raw.SiteRandomizationNo ?? ""
    ).trim(),
    activityConfigTimePointNo:
      Number(raw.activityConfigTimePointNo ?? raw.ActivityConfigTimePointNo) || 0,
    appVisitCrfMappingNo: (() => {
      const n = Number(raw.appVisitCrfMappingNo ?? raw.AppVisitCrfMappingNo);
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
    activityConfigDoseNo: Number(raw.activityConfigDoseNo ?? raw.ActivityConfigDoseNo) || 0,
    doseLabel: String(raw.doseLabel ?? raw.DoseLabel ?? "").trim() || null,
    timePointLabel: String(raw.timePointLabel ?? raw.TimePointLabel ?? "").trim() || null,
    activityType: String(raw.activityType ?? raw.ActivityType ?? "").trim(),
    barcodeValue: String(raw.barcodeValue ?? raw.BarcodeValue ?? "").trim() || null,
    scheduledTime: raw.scheduledTime ?? raw.ScheduledTime ?? null,
    windowStart: raw.windowStart ?? raw.WindowStart ?? null,
    windowEnd: raw.windowEnd ?? raw.WindowEnd ?? null,
    actualTime: raw.actualTime ?? raw.ActualTime ?? null,
    status: String(raw.status ?? raw.Status ?? "").trim(),
    reviewStatus: String(raw.reviewStatus ?? raw.ReviewStatus ?? "").trim() || null,
    deviation: Boolean(raw.deviation ?? raw.Deviation),
    deviationReason: raw.deviationReason ?? raw.DeviationReason ?? null,
    remarks: raw.remarks ?? raw.Remarks ?? null,
    changeReason: raw.changeReason ?? raw.ChangeReason ?? null,
    centrifugationStart: raw.centrifugationStart ?? raw.CentrifugationStart ?? null,
    centrifugationEnd: raw.centrifugationEnd ?? raw.CentrifugationEnd ?? null,
    expectedAliquots: Number(raw.expectedAliquots ?? raw.ExpectedAliquots) || 0,
    expectedAliquotBarcodes: (raw.expectedAliquotBarcodes ?? raw.ExpectedAliquotBarcodes ?? [])
      .map((code) => String(code ?? "").trim())
      .filter(Boolean),
    executionMethod: raw.executionMethod ?? raw.ExecutionMethod ?? null,
    reviewQuery: raw.reviewQuery ?? raw.ReviewQuery ?? null,
    reviewQueryAt: raw.reviewQueryAt ?? raw.ReviewQueryAt ?? null,
    reviewQueryFieldKey: raw.reviewQueryFieldKey ?? raw.ReviewQueryFieldKey ?? null,
    reviewQueryFieldLabel: raw.reviewQueryFieldLabel ?? raw.ReviewQueryFieldLabel ?? null,
    reviewQueryStatus: raw.reviewQueryStatus ?? raw.ReviewQueryStatus ?? null,
    reviewQueryResponse: raw.reviewQueryResponse ?? raw.ReviewQueryResponse ?? null,
    reviewQuerySendbackRemark: raw.reviewQuerySendbackRemark ?? raw.ReviewQuerySendbackRemark ?? null,
    reviewQueryResolvedAt: raw.reviewQueryResolvedAt ?? raw.ReviewQueryResolvedAt ?? null,
    reviewQueryClosedAt: raw.reviewQueryClosedAt ?? raw.ReviewQueryClosedAt ?? null,
    activityExecutionQueryNo:
      Number(raw.activityExecutionQueryNo ?? raw.ActivityExecutionQueryNo) || null,
    reviewQueries: (() => {
      const list = raw.queries ?? raw.Queries ?? raw.reviewQueries ?? raw.ReviewQueries ?? [];
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
    })(),
    aliquots: (raw.aliquots ?? raw.Aliquots ?? []).map(normalizeAliquot),
    appActivityCrfNo: (() => {
      const n = Number(raw.appActivityCrfNo ?? raw.AppActivityCrfNo);
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
    crfVersion: (() => {
      const n = Number(raw.crfVersion ?? raw.CrfVersion);
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
    crfName: String(raw.crfName ?? raw.CrfName ?? "").trim() || null,
    crfValues: (() => {
      const source = raw.crfValues ?? raw.CrfValues ?? {};
      const result = {};
      for (const key of Object.keys(source)) {
        if (!key) continue;
        result[key] = source[key] ?? "";
      }
      return result;
    })(),
    fieldIds: (() => {
      const source = raw.fieldIds ?? raw.FieldIds ?? {};
      const result = {};
      for (const key of Object.keys(source)) {
        if (!key) continue;
        const pascalKey = key.charAt(0).toUpperCase() + key.slice(1);
        result[pascalKey] = source[key];
        result[key] = source[key]; // preserve original too
      }
      return result;
    })(),
  };
}

export function normalizeHistory(raw) {
  return {
    subjectMstNo: Number(raw.subjectMstNo ?? raw.SubjectMstNo) || 0,
    records: (raw.records ?? raw.Records ?? []).map(normalizeRecord),
  };
}

/** GET /ActivityExecution/history?subjectMstNo= */
export async function fetchExecutionHistory(subjectMstNo) {
  const res = await api.get("/ActivityExecution/history", {
    params: { subjectMstNo },
  });
  return normalizeHistory(res.data?.data ?? res.data ?? {});
}

function normalizeQueueSubjectOption(raw) {
  return {
    subjectMstNo: Number(raw.subjectMstNo ?? raw.SubjectMstNo) || 0,
    siteRandomizationNo: String(
      raw.siteRandomizationNo ?? raw.SiteRandomizationNo ?? ""
    ).trim(),
  };
}

function normalizeQueueDoseOption(raw) {
  return {
    activityConfigDoseNo: Number(raw.activityConfigDoseNo ?? raw.ActivityConfigDoseNo) || 0,
    label: String(raw.label ?? raw.Label ?? "").trim(),
  };
}

function normalizeQueue(raw) {
  return {
    projectCode: String(raw.projectCode ?? raw.ProjectCode ?? "").trim(),
    records: (raw.records ?? raw.Records ?? []).map(normalizeRecord),
    page: Number(raw.page ?? raw.Page) || 1,
    pageSize: Number(raw.pageSize ?? raw.PageSize) || 0,
    totalCount: Number(raw.totalCount ?? raw.TotalCount) || 0,
    pendingCount: Number(raw.pendingCount ?? raw.PendingCount) || 0,
    subjectOptions: (raw.subjectOptions ?? raw.SubjectOptions ?? []).map(
      normalizeQueueSubjectOption
    ),
    doseOptions: (raw.doseOptions ?? raw.DoseOptions ?? []).map(normalizeQueueDoseOption),
  };
}

function normalizeDashboardSummary(raw) {
  return {
    projectCode: String(raw.projectCode ?? raw.ProjectCode ?? "").trim(),
    siteCode: String(raw.siteCode ?? raw.SiteCode ?? "").trim() || null,
    pendingBloodCollection: Number(raw.pendingBloodCollection ?? raw.PendingBloodCollection) || 0,
    pendingCentrifuge: Number(raw.pendingCentrifuge ?? raw.PendingCentrifuge) || 0,
    pendingAliquot: Number(raw.pendingAliquot ?? raw.PendingAliquot) || 0,
    openQueries: Number(raw.openQueries ?? raw.OpenQueries) || 0,
    pendingBags: Number(raw.pendingBags ?? raw.PendingBags) || 0,
  };
}
