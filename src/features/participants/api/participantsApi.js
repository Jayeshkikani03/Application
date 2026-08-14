import api from "@/shared/api/httpClient.js";

/** GET /Subjects — SubjectMst rows for the JWT project (site-scoped). */
export async function fetchSubjectsList(params, signal) {
  const res = await api.get("/Subjects", { params: params ?? {}, ...(signal ? { signal } : {}) });
  return res.data.data ?? [];
}

/** GET /Subjects/{subjectMstNo} — demographics + VisitSchedule/VisitTracker timeline. */
export async function fetchSubjectDetail(subjectMstNo) {
  const res = await api.get(`/Subjects/${encodeURIComponent(subjectMstNo)}`);
  return res.data.data ?? null;
}

export async function importSubjectsFromPrms({ siteCode, projectCode }) {
  const payload = { siteCode: String(siteCode || "").trim() };
  const p = String(projectCode || "").trim();
  if (p) payload.projectCode = p;
  const res = await api.post("/Subjects/prms-import", payload);
  return res.data;
}
