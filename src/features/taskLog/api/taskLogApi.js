import api from "@/shared/api/httpClient.js";

export const taskLogApi = {
  async getTaskLogs({ taskName, status, take = 500 } = {}) {
    const params = {};
    if (taskName) params.taskName = taskName;
    if (status && status !== "all") params.status = status;
    if (take) params.take = take;

    const res = await api.get("/TaskLog", { params });
    return res.data.data ?? res.data ?? [];
  },

  async getTaskNames() {
    const res = await api.get("/TaskLog/task-names");
    return res.data.data ?? res.data ?? [];
  },
};

export default taskLogApi;
