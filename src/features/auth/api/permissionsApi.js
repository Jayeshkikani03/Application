import api from "@/shared/api/httpClient.js";

export const permissionsApi = {
  async getMyPermissions() {
    const res = await api.get("/permissions/me");
    return res.data.data ?? res.data;
  },

  async refreshMyPermissions() {
    const res = await api.get("/permissions/refresh");
    return res.data.data ?? res.data;
  },
};
