import api from "../../../shared/api/httpClient.js";
import { getProjectVisitSchedules } from "../../../shared/api/projectMasterApi.js";
import { mapApiDoseToUi } from "../utils/activityConfigurationMappers.js";

function normalizeAuditedInt(raw, fallback) {
  if (typeof raw === "object" && raw !== null && "value" in raw) {
    return Number(raw.value) || fallback;
  }
  return Number(raw) || fallback;
}

function normalizeConfigurationResponse(data) {
  const payload = data ?? {};
  const doses = payload.doses ?? payload.Doses ?? [];
  const aliquotsRaw = payload.aliquotsPerSeparation ?? payload.AliquotsPerSeparation ?? 3;
  const centrifugeRaw = payload.centrifugeTimeMinutes ?? payload.CentrifugeTimeMinutes ?? 10;
  return {
    projectParameterNo:
      Number(payload.projectParameterNo ?? payload.ProjectParameterNo) || 0,
    centrifugeTimeProjectParameterNo:
      Number(payload.centrifugeTimeProjectParameterNo ?? payload.CentrifugeTimeProjectParameterNo) || 0,
    aliquotsPerSeparation: normalizeAuditedInt(aliquotsRaw, 3),
    centrifugeTimeMinutes: normalizeAuditedInt(centrifugeRaw, 10),
    doses: doses.map(mapApiDoseToUi),
  };
}

function normalizeTimepointsResponse(data, doseNo) {
  const payload = data ?? {};
  return {
    activityConfigDoseNo:
      payload.activityConfigDoseNo ?? payload.ActivityConfigDoseNo ?? doseNo,
    timepoints: payload.timepoints ?? payload.Timepoints ?? [],
  };
}

export async function getActivityConfiguration() {
  const res = await api.get("/ActivityConfiguration");
  return normalizeConfigurationResponse(res.data?.data);
}

export async function saveActivityConfiguration(payload) {
  const res = await api.put("/ActivityConfiguration", payload);
  return normalizeConfigurationResponse(res.data?.data ?? payload);
}

export async function updateAliquotsPerSeparation(
  aliquotsPerSeparation,
  doses,
  changeRemark,
  centrifugeTimeMinutes = 10
) {
  return updateAliquotSettings({
    aliquotsPerSeparation,
    centrifugeTimeMinutes,
    doses,
    aliquotRemark: changeRemark,
  });
}

/**
 * Save aliquot settings modal fields (aliquots per separation + centrifuge time).
 * @param {{ aliquotsPerSeparation: number|string, centrifugeTimeMinutes: number|string, doses?: object[], aliquotRemark?: string, centrifugeRemark?: string }} args
 */
export async function updateAliquotSettings({
  aliquotsPerSeparation,
  centrifugeTimeMinutes,
  doses,
  aliquotRemark,
  centrifugeRemark,
}) {
  const aliquotRemarkText = String(aliquotRemark || "").trim();
  const centrifugeRemarkText = String(centrifugeRemark || "").trim();
  return saveActivityConfiguration({
    aliquotsPerSeparation: aliquotRemarkText
      ? { value: Number(aliquotsPerSeparation) || 3, changeRemark: aliquotRemarkText }
      : Number(aliquotsPerSeparation) || 3,
    centrifugeTimeMinutes: centrifugeRemarkText
      ? { value: Number(centrifugeTimeMinutes) || 10, changeRemark: centrifugeRemarkText }
      : Number(centrifugeTimeMinutes) || 10,
    doses: doses ?? [],
  });
}

export async function getDoseTimepoints(doseNo) {
  const res = await api.get(`/ActivityConfiguration/doses/${Number(doseNo)}/timepoints`);
  return normalizeTimepointsResponse(res.data?.data, doseNo);
}

export async function saveDoseTimepoints(doseNo, timepoints, auditMeta = {}) {
  const body = { timepoints };
  if (auditMeta?.auditReason) body.auditReason = auditMeta.auditReason;
  if (auditMeta?.auditReasonsByAuditedColumn) {
    body.auditReasonsByAuditedColumn = auditMeta.auditReasonsByAuditedColumn;
  }
  const res = await api.put(
    `/ActivityConfiguration/doses/${Number(doseNo)}/timepoints`,
    body
  );
  return normalizeTimepointsResponse(res.data?.data, doseNo);
}

function normalizeVisitOptions(data) {
  return (data ?? [])
    .map((visit) => {
      const studyVisitScheduleNo = visit.studyVisitScheduleNo ?? visit.StudyVisitScheduleNo;
      const studyVisitScheduleDescription =
        visit.studyVisitScheduleDescription
        ?? visit.StudyVisitScheduleDescription
        ?? visit.visitScheduleDesc
        ?? visit.VisitScheduleDesc
        ?? "";

      return {
        studyVisitScheduleNo,
        visitNo: Number(visit.visitNo ?? visit.VisitNo) || 0,
        studyVisitScheduleDescription: String(studyVisitScheduleDescription).trim(),
      };
    })
    .filter((visit) => visit.studyVisitScheduleDescription);
}

export async function getActivityVisitOptions({ dispensingOnly = true } = {}) {
  if (!dispensingOnly) {
    return getAllActivityVisitOptions();
  }

  const res = await api.get("/ActivityConfiguration/visit-options");
  const data = res.data?.data;
  return Array.isArray(data) ? normalizeVisitOptions(data) : [];
}

export async function getActivityConfigurationFormOptions() {
  const res = await api.get("/ActivityConfiguration/form-options");
  const payload = res.data?.data ?? {};
  return {
    projectCode: String(payload.projectCode ?? payload.ProjectCode ?? ""),
    activityTypes: Array.isArray(payload.activityTypes ?? payload.ActivityTypes)
      ? (payload.activityTypes ?? payload.ActivityTypes).map(String)
      : [],
    durationTypes: Array.isArray(payload.durationTypes ?? payload.DurationTypes)
      ? (payload.durationTypes ?? payload.DurationTypes).map(String)
      : [],
  };
}

export async function getAllActivityVisitOptions() {
  const visits = await getProjectVisitSchedules();
  return normalizeVisitOptions(visits);
}

export async function publishActivityDoses(doseNos, password) {
  const res = await api.post("/ActivityConfiguration/publish", {
    doseNos: (doseNos ?? []).map((doseNo) => Number(doseNo)).filter((doseNo) => doseNo > 0),
    password: password ?? "",
  });
  return normalizeConfigurationResponse(res.data?.data);
}

/**
 * TaskLog rows for timepoint exports (Export Log popup).
 */
export async function getTimepointExportLogs() {
  const res = await api.get("/ActivityConfiguration/export-timepoints/logs");
  const data = res.data?.data;
  return Array.isArray(data)
    ? data.map((row) => ({
      id: Number(row.id ?? row.Id) || 0,
      doseNames: String(row.doseNames ?? row.DoseNames ?? "").trim() || "—",
      doseNos: Array.isArray(row.doseNos ?? row.DoseNos)
        ? (row.doseNos ?? row.DoseNos).map((n) => Number(n)).filter((n) => n > 0)
        : [],
      status: String(row.status ?? row.Status ?? "").trim() || "—",
      performedBy: row.performedBy ?? row.PerformedBy ?? null,
      performedOnUtc: row.performedOnUtc ?? row.PerformedOnUtc ?? null,
      offset: row.offset ?? row.Offset ?? null,
      body: row.body ?? row.Body ?? null,
      message: row.message ?? row.Message ?? null,
    }))
    : [];
}

/**
 * Re-export timepoints for a log row (updates the same TaskLog when taskLogNo is set).
 */
export async function exportActivityTimepoints(doseNos = [], taskLogNo = null) {
  const normalizedDoseNos = (doseNos ?? [])
    .map((doseNo) => Number(doseNo))
    .filter((doseNo) => doseNo > 0);
  const payload = { doseNos: normalizedDoseNos };
  const logNo = Number(taskLogNo);
  if (Number.isFinite(logNo) && logNo > 0) {
    payload.taskLogNo = logNo;
  }
  const res = await api.post("/ActivityConfiguration/export-timepoints", payload);
  const data = res.data?.data ?? {};
  return {
    projectCode: String(data.projectCode ?? data.ProjectCode ?? ""),
    periodCount: Number(data.periodCount ?? data.PeriodCount) || 0,
    timepointCount: Number(data.timepointCount ?? data.TimepointCount) || 0,
    destinationUrl: String(data.destinationUrl ?? data.DestinationUrl ?? ""),
    success: Boolean(data.success ?? data.Success ?? true),
  };
}

export async function deletePdfImportedDose(doseNo) {
  const res = await api.delete(`/ActivityConfiguration/doses/${Number(doseNo)}`);
  return normalizeConfigurationResponse(res.data?.data);
}

function normalizePdfImportTask(data) {
  const payload = data ?? {};
  return {
    importTaskNo: payload.importTaskNo ?? payload.ImportTaskNo ?? 0,
    projectCode: payload.projectCode ?? payload.ProjectCode ?? "",
    fileName: payload.fileName ?? payload.FileName ?? "",
    status: payload.status ?? payload.Status ?? "",
    resultMessage: payload.resultMessage ?? payload.ResultMessage ?? null,
    errorMessage: payload.errorMessage ?? payload.ErrorMessage ?? null,
    recordedSign: payload.recordedSign ?? payload.RecordedSign ?? null,
    recordedOnUtc: payload.recordedOnUtc ?? payload.RecordedOnUtc ?? null,
    recordedAtOffset: payload.recordedAtOffset ?? payload.RecordedAtOffset ?? null,
    llmPromptTemplateNo: payload.llmPromptTemplateNo ?? payload.LlmPromptTemplateNo ?? null,
    promptVersion: payload.promptVersion ?? payload.PromptVersion ?? null,
    templateName: payload.templateName ?? payload.TemplateName ?? null,
    modelName: payload.modelName ?? payload.ModelName ?? null,
    apiUrl: payload.apiUrl ?? payload.ApiUrl ?? null,
    requestPayload: payload.requestPayload ?? payload.RequestPayload ?? null,
    responsePayload: payload.responsePayload ?? payload.ResponsePayload ?? null,
    durationMs: payload.durationMs ?? payload.DurationMs ?? null,
  };
}

export async function uploadActivityConfigurationPdf(file, { signal } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await api.post("/ActivityConfiguration/import-pdf/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    signal,
  });
  return normalizePdfImportTask(res.data?.data);
}

export async function proceedActivityConfigurationPdfImport(taskNo, password, { signal } = {}) {
  const res = await api.post(`/ActivityConfiguration/import-pdf/${Number(taskNo)}/proceed`, {
    password: password ?? "",
  }, { signal });
  return normalizePdfImportTask(res.data?.data);
}

export async function getActivityConfigurationPdfImportTasks() {
  const res = await api.get("/ActivityConfiguration/import-pdf/tasks");
  const data = res.data?.data;
  return Array.isArray(data) ? data.map(normalizePdfImportTask) : [];
}

export async function cancelActivityConfigurationPdfImport(taskNo) {
  await api.delete(`/ActivityConfiguration/import-pdf/${Number(taskNo)}`);
}

export function formatPdfImportResultMessage(message) {
  return message?.trim() || "PDF import completed.";
}
