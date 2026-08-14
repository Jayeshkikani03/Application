import api from "@/shared/api/httpClient.js";

export const llmProviderConfigApi = {
  async getConfigs() {
    const res = await api.get("/llmproviderconfigs");
    return res.data.data ?? res.data ?? [];
  },

  async saveConfig(payload) {
    const res = await api.post("/llmproviderconfigs", payload);
    return res.data.data ?? res.data;
  },

  async publish(configNo, changeReason = null) {
    const res = await api.post(`/llmproviderconfigs/${Number(configNo)}/publish`, {
      changeReason,
    });
    return res.data.data ?? res.data;
  },
};
