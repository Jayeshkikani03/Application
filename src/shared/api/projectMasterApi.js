import api from "./httpClient.js";

export async function getProjectSites() {
  const res = await api.get("/ProjectMaster/sites");
  return res.data.data ?? [];
}

export async function getProjectVisitSchedules() {
  const res = await api.get("/ProjectMaster/visit-schedules");
  return res.data.data ?? [];
}
