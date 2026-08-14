import api from "@/shared/api/httpClient.js";

function unwrap(res) {
  return res?.data?.data ?? res?.data ?? null;
}

function mapBagPrepRow(row) {
  if (!row || typeof row !== "object") return null;
  return {
    bagPreparationNo: Number(row.bagPreparationNo ?? row.BagPreparationNo) || 0,
    bagBarcode: String(row.bagBarcode ?? row.BagBarcode ?? "").trim(),
    siteCode: String(row.siteCode ?? row.SiteCode ?? "").trim(),
    subjectCode: String(row.subjectCode ?? row.SubjectCode ?? "").trim(),
    period: String(row.period ?? row.Period ?? row.doseNo ?? row.DoseNo ?? "").trim(),
    batchNumber: String(row.batchNumber ?? row.BatchNumber ?? "").trim(),
    aliquotBarcodes: String(row.aliquotBarcodes ?? row.AliquotBarcodes ?? "").trim(),
    status: String(row.status ?? row.Status ?? "Pending").trim() || "Pending",
    missingRemark: row.missingRemark ?? row.MissingRemark ?? null,
    isActive: row.isActive !== false && row.IsActive !== false,
    recordedSign: row.recordedSign ?? row.RecordedSign ?? "",
    recordedOnUtc: row.recordedOnUtc ?? row.RecordedOnUtc ?? null,
    recordedAtOffset: row.recordedAtOffset ?? row.RecordedAtOffset ?? "",
  };
}

/** GET /BagPreparations */
export async function fetchBagPreparations() {
  const res = await api.get("/BagPreparations");
  const payload = unwrap(res);
  const rows = Array.isArray(payload) ? payload : [];
  return rows.map(mapBagPrepRow).filter(Boolean);
}

/** GET /BagPreparations/form-options */
export async function fetchBagPrepFormOptions() {
  const res = await api.get("/BagPreparations/form-options");
  const payload = unwrap(res) ?? {};
  const periods = (payload.periods ?? payload.Periods ?? []).map((p) => ({
    period: Number(p.period ?? p.Period) || 0,
    periodId: String(p.periodId ?? p.PeriodId ?? ""),
    code: String(p.code ?? p.Code ?? ""),
    label: String(p.label ?? p.Label ?? ""),
    timePointNos: (p.timePointNos ?? p.TimePointNos ?? []).map((n) => Number(n) || 0).filter((n) => n > 0),
  }));
  const batches = (payload.batches ?? payload.Batches ?? []).map((b) => ({
    id: String(b.id ?? b.Id ?? b.batchNo ?? b.BatchNo ?? ""),
    batchNo: Number(b.batchNo ?? b.BatchNo) || 0,
    label: String(b.label ?? b.Label ?? ""),
  }));
  return {
    projectCode: String(payload.projectCode ?? payload.ProjectCode ?? ""),
    aliquotsPerSeparation: Number(payload.aliquotsPerSeparation ?? payload.AliquotsPerSeparation) || 3,
    periods,
    batches,
  };
}

/** GET /BagPreparations/eligible-participants */
export async function fetchEligibleBagPrepParticipants(siteCode) {
  const res = await api.get("/BagPreparations/eligible-participants", {
    params: siteCode ? { siteCode } : undefined,
  });
  const payload = unwrap(res);
  const rows = Array.isArray(payload) ? payload : [];
  return rows.map((row) => ({
    subjectMstNo: Number(row.subjectMstNo ?? row.SubjectMstNo) || 0,
    participantNo: String(row.participantNo ?? row.ParticipantNo ?? "").trim(),
    siteCode: String(row.siteCode ?? row.SiteCode ?? "").trim(),
    initials: String(row.initials ?? row.Initials ?? "").trim(),
    readyPeriods: (row.readyPeriods ?? row.ReadyPeriods ?? []).map((period) => ({
      period: Number(period.period ?? period.Period) || 0,
      periodId: String(period.periodId ?? period.PeriodId ?? ""),
      code: String(period.code ?? period.Code ?? ""),
      label: String(period.label ?? period.Label ?? ""),
      timePointNos: (period.timePointNos ?? period.TimePointNos ?? [])
        .map((n) => Number(n) || 0)
        .filter((n) => n > 0),
    })),
  })).filter((row) => row.subjectMstNo > 0 && row.participantNo);
}

/** GET /BagPreparations/expected-aliquots */
export async function fetchExpectedAliquots({
  participantNo,
  siteCode,
  periodId,
  period,
  batchNo,
  requireReady = true,
}) {
  const res = await api.get("/BagPreparations/expected-aliquots", {
    params: {
      participantNo,
      siteCode,
      periodId,
      period,
      batchNo,
      requireReady,
    },
  });
  const payload = unwrap(res);
  const rows = Array.isArray(payload) ? payload : [];
  return rows.map((row, idx) => ({
    index: Number(row.index ?? row.Index ?? idx) || idx,
    activityConfigTimePointNo: Number(row.activityConfigTimePointNo ?? row.ActivityConfigTimePointNo) || 0,
    timepoint: String(row.timepoint ?? row.Timepoint ?? ""),
    code: String(row.expectedCode ?? row.ExpectedCode ?? "").trim().toUpperCase(),
    label: row.label ?? row.Label ?? "",
    status: String(row.status ?? row.Status ?? "").trim(),
    isSkipped: row.isSkipped === true || row.IsSkipped === true,
  }));
}

/** POST /BagPreparations/validate-barcode */
export async function validateBagPrepBarcode(payload) {
  const res = await api.post("/BagPreparations/validate-barcode", payload);
  const data = unwrap(res) ?? {};
  const batchNo = Number(data.batchNo ?? data.BatchNo) || 0;
  return {
    valid: data.valid === true || data.Valid === true,
    message: String(data.message ?? data.Message ?? ""),
    label: data.label ?? data.Label ?? "",
    code: String(data.code ?? data.Code ?? "").trim().toUpperCase(),
    kind: String(data.kind ?? data.Kind ?? "").trim().toLowerCase(),
    participantNo: String(data.participantNo ?? data.ParticipantNo ?? "").trim(),
    siteCode: String(data.siteCode ?? data.SiteCode ?? "").trim(),
    period: String(data.period ?? data.Period ?? "").trim(),
    periodId: String(data.periodId ?? data.PeriodId ?? "").trim(),
    batchNo: batchNo > 0 ? batchNo : null,
  };
}

/** POST /BagPreparations */
export async function createBagPreparation(payload) {
  const res = await api.post("/BagPreparations", payload);
  return mapBagPrepRow(unwrap(res));
}

/** PUT /BagPreparations/{id} */
export async function updateBagPreparation(id, payload) {
  const res = await api.put(`/BagPreparations/${encodeURIComponent(id)}`, payload);
  return mapBagPrepRow(unwrap(res));
}

/** PUT /BagPreparations/{id}/status */
export async function updateBagPreparationStatus(id, status, changeReason, missingRemark) {
  const res = await api.put(`/BagPreparations/${encodeURIComponent(id)}/status`, {
    status,
    changeReason: changeReason || undefined,
    missingRemark: missingRemark || undefined,
  });
  return mapBagPrepRow(unwrap(res));
}

/** DELETE /BagPreparations/{id} */
export async function inactivateBagPreparation(id, changeReason) {
  const res = await api.delete(`/BagPreparations/${encodeURIComponent(id)}`, {
    params: changeReason ? { changeReason } : {},
  });
  return mapBagPrepRow(unwrap(res));
}

/** POST /BagPreparations/{id}/reactivate */
export async function reactivateBagPreparation(id, changeReason) {
  const res = await api.post(
    `/BagPreparations/${encodeURIComponent(id)}/reactivate`,
    null,
    { params: changeReason ? { changeReason } : {} }
  );
  return mapBagPrepRow(unwrap(res));
}

/**
 * Push slim Dispatched bag JSON to the receiving app (ExternalApiDetail PushDispatchedBags).
 * POST /BagPreparations/export-dispatched
 * @param {number[]} [bagPreparationNos]
 * @param {number|null} [taskLogNo] when set, updates that TaskLog row
 */
export async function exportDispatchedBags(bagPreparationNos, taskLogNo = null) {
  const ids = (bagPreparationNos ?? [])
    .map((n) => Number(n))
    .filter((n) => n > 0);
  const body = { bagPreparationNos: ids };
  const logNo = Number(taskLogNo);
  if (Number.isFinite(logNo) && logNo > 0) {
    body.taskLogNo = logNo;
  }
  const res = await api.post("/BagPreparations/export-dispatched", body);
  const payload = unwrap(res) ?? {};
  return {
    projectCode: String(payload.projectCode ?? payload.ProjectCode ?? ""),
    bagCount: Number(payload.bagCount ?? payload.BagCount) || 0,
    destinationUrl: String(payload.destinationUrl ?? payload.DestinationUrl ?? ""),
    success: Boolean(payload.success ?? payload.Success ?? true),
  };
}

/** GET /BagPreparations/export-dispatched/logs */
export async function getBagExportLogs() {
  const res = await api.get("/BagPreparations/export-dispatched/logs");
  const data = unwrap(res);
  return Array.isArray(data)
    ? data.map((row) => {
      const body = row.body ?? row.Body ?? null;
      const fromApi = String(row.participantNames ?? row.ParticipantNames ?? "").trim();
      return {
        id: Number(row.id ?? row.Id) || 0,
        bagNames: String(row.bagNames ?? row.BagNames ?? "").trim() || "—",
        participantNames: fromApi || extractParticipantNamesFromBody(body),
        bagPreparationNos: Array.isArray(row.bagPreparationNos ?? row.BagPreparationNos)
          ? (row.bagPreparationNos ?? row.BagPreparationNos).map((n) => Number(n)).filter((n) => n > 0)
          : [],
        status: String(row.status ?? row.Status ?? "").trim() || "—",
        performedBy: row.performedBy ?? row.PerformedBy ?? null,
        performedOnUtc: row.performedOnUtc ?? row.PerformedOnUtc ?? null,
        offset: row.offset ?? row.Offset ?? null,
        body,
        message: row.message ?? row.Message ?? null,
      };
    })
    : [];
}

/** Pull subjectCode values from TaskLog body JSON when API field is empty. */
function extractParticipantNamesFromBody(body) {
  if (!body) return "";
  try {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    const model = parsed?.model ?? parsed?.Model;
    const items = Array.isArray(model) ? model : [];
    const names = new Set();
    for (const item of items) {
      const bags = item?.bags ?? item?.Bags ?? [];
      if (!Array.isArray(bags)) continue;
      for (const bag of bags) {
        const code = String(bag?.subjectCode ?? bag?.SubjectCode ?? "").trim();
        if (code) names.add(code);
      }
    }
    return [...names]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .join(", ");
  } catch {
    return "";
  }
}
