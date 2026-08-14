import api from "@/shared/api/httpClient.js";

export const operationsApi = {
  async getOperations(page, pageSize, search, sortBy, sortDir) {
    const params = {};
    if (page !== undefined) params.page = page;
    if (pageSize !== undefined) params.pageSize = pageSize;
    if (search) params.search = search;
    if (sortBy) params.sortBy = sortBy;
    if (sortDir) params.sortDir = sortDir;
    const res = await api.get("/operations", { params });
    return res.data.data ?? res.data ?? [];
  },

  async getParentOperations() {
    const res = await api.get("/operations/parents");
    return res.data.data ?? res.data ?? [];
  },

  async saveOperation(payload) {
    const res = await api.post("/operations", payload);
    return res.data.data ?? res.data;
  },
};
