import api from "@/shared/api/httpClient.js";

/** @param {unknown} body */
function unwrap(body) {
  if (body && typeof body === "object" && "data" in body) return body.data;
  return body;
}

/**
 * Field-level history from dbo.AuditHdr / dbo.AuditDtl.
 * @param {{ tableName: string, recordId: string, fieldName?: string }} params
 */
export async function getAuditDirectHistory(params) {
  const res = await api.get("/Audit/direct-history", { params });
  return unwrap(res.data);
}

/** @param {{ tableName: string, recordId: string, fieldName?: string }} params */
export async function getAuditFieldHistory(params) {
  return getAuditDirectHistory(params);
}

/**
 * @param {Array<{ tableName: string, recordId: string, fieldNames?: string[] }>} targets
 */
export async function getAuditFieldHistoryBatch(targets) {
  const list = Array.isArray(targets) ? targets : [];
  const res = await api.post("/Audit/direct-history/batch", { targets: list });
  return unwrap(res.data);
}

/**
 * Project-wide recent audit trail.
 * @param {{ limit?: number }} [params]
 */
export async function getAuditTrail(params = {}) {
  const res = await api.get("/Audit/trail", { params });
  return unwrap(res.data);
}
