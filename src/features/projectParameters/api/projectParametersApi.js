import api from "@/shared/api/httpClient.js";

/** @param {unknown} data */
function mapProjectParameterValueDto(data) {
  if (!data || typeof data !== "object") {
    return { parameterValue: null, projectParameterNo: null };
  }
  const rawNo = data.projectParameterNo ?? data.ProjectParameterNo;
  let projectParameterNo = null;
  if (rawNo != null && rawNo !== "") {
    const n = Number(rawNo);
    if (Number.isFinite(n) && n > 0) {
      projectParameterNo = Math.floor(n);
    }
  }
  const v = data.parameterValue ?? data.ParameterValue;
  const trimmed = v == null || String(v).trim() === "" ? null : String(v).trim();
  return { parameterValue: trimmed, projectParameterNo };
}

/** @param {unknown} data */
function mapProjectParameterDto(data) {
  if (!data || typeof data !== "object") return null;
  const rawNo = data.projectParameterNo ?? data.ProjectParameterNo;
  const n = Number(rawNo);
  return {
    projectParameterNo: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
    projectCode: String(data.projectCode ?? data.ProjectCode ?? "").trim(),
    parameterName: String(data.parameterName ?? data.ParameterName ?? "").trim(),
    parameterValue: String(data.parameterValue ?? data.ParameterValue ?? "").trim(),
    isActive: data.isActive !== false && data.IsActive !== false,
  };
}

/**
 * GET /ProjectParameters?projectCode=
 * @param {string} [explicitProjectCode]
 */
export async function listProjectParameters(explicitProjectCode) {
  const pc = explicitProjectCode != null ? String(explicitProjectCode).trim() : "";
  const res = await api.get("/ProjectParameters", {
    params: pc ? { projectCode: pc } : undefined,
  });
  const raw = res.data?.data ?? res.data ?? [];
  return (Array.isArray(raw) ? raw : []).map(mapProjectParameterDto).filter(Boolean);
}

/**
 * GET /ProjectParameters/by-name/{parameterName}?projectCode=
 * @param {string} parameterName
 * @param {string} [explicitProjectCode]
 */
export async function getProjectParameterByName(parameterName, explicitProjectCode) {
  const pc = explicitProjectCode != null ? String(explicitProjectCode).trim() : "";
  const res = await api.get(`/ProjectParameters/by-name/${encodeURIComponent(parameterName)}`, {
    params: pc ? { projectCode: pc } : undefined,
  });
  return mapProjectParameterValueDto(res.data?.data ?? res.data);
}

/**
 * PUT /ProjectParameters/by-name/{parameterName}?projectCode=
 * @param {string} parameterName
 * @param {{ parameterValue: string, isActive?: boolean, changeReason?: string }} payload
 * @param {string} [explicitProjectCode]
 */
export async function putProjectParameterByName(parameterName, payload, explicitProjectCode) {
  const pc = explicitProjectCode != null ? String(explicitProjectCode).trim() : "";
  const body = {
    parameterValue: String(payload?.parameterValue ?? "").trim(),
    isActive: payload?.isActive !== false,
  };
  if (payload?.changeReason) {
    body.changeReason = String(payload.changeReason).trim();
  }
  const res = await api.put(
    `/ProjectParameters/by-name/${encodeURIComponent(parameterName)}`,
    body,
    { params: pc ? { projectCode: pc } : undefined },
  );
  return mapProjectParameterDto(res.data?.data ?? res.data);
}
