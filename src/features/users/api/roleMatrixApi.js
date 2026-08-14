import api from "@/shared/api/httpClient.js";

export const roleMatrixApi = {
  async getRoleMatrix(profileCode) {
    const res = await api.get(`/rolematrix/${encodeURIComponent(profileCode)}`);
    return res.data.data ?? res.data ?? [];
  },

  async saveRoleMatrix(payload) {
    const res = await api.post("/rolematrix", payload);
    return res.data.data ?? res.data;
  },
};
