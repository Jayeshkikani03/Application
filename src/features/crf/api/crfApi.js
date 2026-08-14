import api from "@/shared/api/httpClient.js";

/** GET /Crf — list stored CRF definitions for the project. */
export async function listAppActivityCrfs() {
  const res = await api.get("/Crf");
  return (res.data?.data ?? res.data ?? []).map(normalizeCrfRow);
}

/**
 * GET /Crf/by-activity-type?activityType=
 * Latest active CRF for lab activity type (matches ActivityConfigTimePoint.vActivityType).
 */
export async function fetchCrfByActivityType(activityType) {
  const type = String(activityType ?? "").trim();
  if (!type) return null;
  const res = await api.get("/Crf/by-activity-type", {
    params: { activityType: type },
  });
  return normalizeCrfRow(res.data?.data ?? res.data ?? null);
}

/**
 * GET /Crf/{appActivityCrfNo}
 * Snapshot by PK (includes inactive historical versions).
 */
export async function fetchCrfByNo(appActivityCrfNo) {
  const no = Number(appActivityCrfNo) || 0;
  if (no <= 0) return null;
  const res = await api.get(`/Crf/${no}`);
  return normalizeCrfRow(res.data?.data ?? res.data ?? null);
}

/**
 * GET /Crf/by-nos?nos=1&nos=2
 * Batch load by PK (includes inactive).
 */
export async function fetchCrfByNos(appActivityCrfNos = []) {
  const nos = [...new Set(
    (Array.isArray(appActivityCrfNos) ? appActivityCrfNos : [])
      .map((n) => Number(n) || 0)
      .filter((n) => n > 0)
  )];
  if (!nos.length) return [];
  const res = await api.get("/Crf/by-nos", {
    params: { nosCsv: nos.join(",") },
  });
  const raw = res.data?.data ?? res.data ?? [];
  return (Array.isArray(raw) ? raw : []).map(normalizeCrfRow).filter(Boolean);
}

/** POST /Crf — upsert a versioned CRF snapshot into Application DB. */
export async function saveAppActivityCrf(payload) {
  const res = await api.post("/Crf", {
    appActivityCrfNo: payload.appActivityCrfNo ?? 0,
    activityType: payload.activityType,
    crfTemplateId: payload.crfTemplateId ?? "",
    version: payload.version ?? null,
    crfName: payload.crfName ?? "",
    crfJson: payload.crfJson,
    changeReason: payload.changeReason ?? null,
    isActive: payload.isActive !== false,
  });
  return normalizeCrfRow(res.data?.data ?? res.data ?? null);
}

function normalizeCrfRow(raw) {
  if (!raw) return null;
  const definitionSource = raw.definition ?? raw.Definition ?? null;
  const activityType = String(raw.activityType ?? raw.ActivityType ?? "").trim();
  const crfTemplateId = String(raw.crfTemplateId ?? raw.CrfTemplateId ?? "").trim();
  const crfName = String(raw.crfName ?? raw.CrfName ?? "").trim();
  return {
    appActivityCrfNo: Number(raw.appActivityCrfNo ?? raw.AppActivityCrfNo) || 0,
    projectCode: String(raw.projectCode ?? raw.ProjectCode ?? "").trim(),
    activityType,
    crfTemplateId,
    version: Number(raw.version ?? raw.Version) || 1,
    crfName,
    definition: definitionSource,
    isActive: raw.isActive !== false && raw.IsActive !== false,
  };
}
