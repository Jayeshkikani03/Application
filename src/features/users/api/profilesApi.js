import api from "@/shared/api/httpClient.js";

export const profilesApi = {
  async getProfiles() {
    const res = await api.get("/profiles");
    return res.data.data ?? res.data ?? [];
  },

  async saveProfile(payload) {
    const res = await api.post("/profiles", payload);
    return res.data.data ?? res.data;
  },
};
