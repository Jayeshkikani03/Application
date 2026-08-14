import api from "@/shared/api/httpClient.js";

export const externalApiDetailsApi = {
  async getExternalApiDetails() {
    const res = await api.get("/externalapidetails");
    return res.data.data ?? res.data ?? [];
  },

  async saveExternalApiDetail(payload) {
    const res = await api.post("/externalapidetails", payload);
    return res.data.data ?? res.data;
  },
};
