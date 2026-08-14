import api from "@/shared/api/httpClient.js";

export const llmPromptApi = {
  async getTemplates() {
    const res = await api.get("/llmprompttemplates");
    return res.data.data ?? res.data ?? [];
  },

  async saveDraft(payload) {
    const res = await api.post("/llmprompttemplates", payload);
    return res.data.data ?? res.data;
  },

  async publish(templateNo, changeReason = null) {
    const res = await api.post(`/llmprompttemplates/${Number(templateNo)}/publish`, {
      changeReason,
    });
    return res.data.data ?? res.data;
  },
};
