import api from "@/shared/api/httpClient.js";

export const parametersApi = {
  async getParameters() {
    const res = await api.get("/parameters");
    return res.data.data ?? res.data ?? [];
  },

  async saveParameter(payload) {
    const res = await api.post("/parameters", payload);
    return res.data.data ?? res.data;
  },
};
