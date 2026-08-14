import {
  cancelActivityConfigurationPdfImport,
  getActivityConfigurationPdfImportTasks,
  proceedActivityConfigurationPdfImport,
  uploadActivityConfigurationPdf,
} from "../api/activityConfigurationApi.js";

export const PDF_IMPORT_WAIT_PROMPT_MS = 90_000;
export const PDF_IMPORT_POLL_MS = 5_000;

export const PDF_IMPORT_STAGE_SCHEDULE = [
  { ms: 0, label: "Uploading PDF..." },
  { ms: 5_000, label: "Sending to parser..." },
  { ms: 20_000, label: "Parsing protocol..." },
  { ms: 45_000, label: "Extracting doses..." },
  { ms: 70_000, label: "Extracting timepoints..." },
  { ms: 90_000, label: "Finalizing parse..." },
  { ms: 120_000, label: "Still parsing..." },
  { ms: 180_000, label: "Still parsing (large PDF)..." },
  { ms: 300_000, label: "Still parsing..." },
];

const idleState = () => ({
  tasks: [],
  activeParsingTaskNo: null,
  stageLabel: "",
  waitPromptOpen: false,
  refreshing: false,
  notifiedTerminalTaskNos: new Set(),
});

let state = idleState();
const listeners = new Set();
let stageTimers = [];
let waitPromptTimer = null;
let pollTimer = null;
const completionListeners = new Set();
let pollInFlight = false;

function emit() {
  listeners.forEach((listener) => listener(state));
}

function clearStageTimers() {
  stageTimers.forEach((id) => window.clearTimeout(id));
  stageTimers = [];
  if (waitPromptTimer) {
    window.clearTimeout(waitPromptTimer);
    waitPromptTimer = null;
  }
}

function getActiveParsingTask() {
  return state.tasks.find((task) => task.importTaskNo === state.activeParsingTaskNo) ?? null;
}

function hasParsingTask() {
  return state.tasks.some((task) => task.status === "Parsing");
}

function setStageLabel(stageLabel) {
  if (!state.activeParsingTaskNo) return;
  state = { ...state, stageLabel };
  emit();
}

function scheduleStagesForActiveTask() {
  clearStageTimers();
  if (!state.activeParsingTaskNo) return;

  for (const stage of PDF_IMPORT_STAGE_SCHEDULE) {
    const timerId = window.setTimeout(() => {
      setStageLabel(stage.label);
    }, stage.ms);
    stageTimers.push(timerId);
  }

  waitPromptTimer = window.setTimeout(() => {
    if (state.activeParsingTaskNo) {
      state = { ...state, waitPromptOpen: true };
      emit();
    }
  }, PDF_IMPORT_WAIT_PROMPT_MS);
}

function syncActiveParsingTask() {
  const parsingTask = state.tasks.find((task) => task.status === "Parsing") ?? null;
  const nextTaskNo = parsingTask?.importTaskNo ?? null;

  if (nextTaskNo === state.activeParsingTaskNo) {
    return;
  }

  state = {
    ...state,
    activeParsingTaskNo: nextTaskNo,
    stageLabel: nextTaskNo ? PDF_IMPORT_STAGE_SCHEDULE[0].label : "",
    waitPromptOpen: false,
  };

  if (nextTaskNo) {
    scheduleStagesForActiveTask();
  } else {
    clearStageTimers();
  }
}

function notifyTerminalTasks(previousTasks, nextTasks) {
  const previousById = new Map(
    previousTasks.map((task) => [task.importTaskNo, task.status])
  );

  for (const task of nextTasks) {
    if (task.status !== "Completed" && task.status !== "Failed") continue;
    if (state.notifiedTerminalTaskNos.has(task.importTaskNo)) continue;

    const previousStatus = previousById.get(task.importTaskNo);
    if (previousStatus !== "Parsing") {
      state.notifiedTerminalTaskNos.add(task.importTaskNo);
      continue;
    }

    state.notifiedTerminalTaskNos.add(task.importTaskNo);

    if (task.status === "Completed") {
      completionListeners.forEach((listener) => {
        try {
          listener({
            importTaskNo: task.importTaskNo,
            message: task.resultMessage ?? "PDF import completed.",
            fileName: task.fileName,
          });
        } catch {
          // listener errors should not break the import flow
        }
      });
    }
  }

  state = { ...state, notifiedTerminalTaskNos: new Set(state.notifiedTerminalTaskNos) };
}

function ensurePolling() {
  if (pollTimer || !hasParsingTask()) return;

  pollTimer = window.setInterval(() => {
    refreshImportTasks().catch(() => {
      // polling errors are non-fatal
    });
  }, PDF_IMPORT_POLL_MS);
}

function stopPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function stopPollingIfIdle() {
  if (hasParsingTask()) return;
  stopPolling();
}

export function subscribePdfImportJob(listener) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function registerPdfImportCompletionListener(listener) {
  completionListeners.add(listener);
  return () => completionListeners.delete(listener);
}

export function getPdfImportJobState() {
  return state;
}

export function isPdfImportRunning() {
  return hasParsingTask();
}

export function dismissPdfImportWaitPrompt() {
  if (!state.waitPromptOpen) return;
  state = { ...state, waitPromptOpen: false };
  emit();
}

export async function refreshImportTasks() {
  if (pollInFlight) return state.tasks;
  pollInFlight = true;

  try {
    const previousTasks = state.tasks;
    state = { ...state, refreshing: true };
    emit();

    const tasks = await getActivityConfigurationPdfImportTasks();
    notifyTerminalTasks(previousTasks, tasks);

    state = {
      ...state,
      tasks,
      refreshing: false,
    };
    syncActiveParsingTask();
    emit();

    if (hasParsingTask()) {
      ensurePolling();
    } else {
      stopPollingIfIdle();
    }

    return tasks;
  } finally {
    pollInFlight = false;
    if (state.refreshing) {
      state = { ...state, refreshing: false };
      emit();
    }
  }
}

export function isPdfImportAbortError(error) {
  const code = String(error?.code || "").toUpperCase();
  const name = String(error?.name || "");
  return code === "ERR_CANCELED"
    || name === "CanceledError"
    || name === "AbortError"
    || /aborted|canceled|cancelled/i.test(String(error?.message || ""));
}

export async function uploadPdf(file, { signal } = {}) {
  const task = await uploadActivityConfigurationPdf(file, { signal });
  state = {
    ...state,
    tasks: [task, ...state.tasks.filter((row) => row.importTaskNo !== task.importTaskNo)],
  };
  emit();
  return task;
}

export async function proceedPdfImport(taskNo, password, { signal } = {}) {
  const task = await proceedActivityConfigurationPdfImport(taskNo, password, { signal });
  state = {
    ...state,
    tasks: state.tasks.map((row) => (row.importTaskNo === task.importTaskNo ? task : row)),
    activeParsingTaskNo: task.importTaskNo,
    stageLabel: PDF_IMPORT_STAGE_SCHEDULE[0].label,
    waitPromptOpen: false,
  };
  scheduleStagesForActiveTask();
  emit();
  ensurePolling();
  await refreshImportTasks();
  return task;
}

export async function cancelUploadedPdf(taskNo) {
  clearStageTimers();
  stopPolling();
  const wasActive = state.activeParsingTaskNo === taskNo;
  try {
    await cancelActivityConfigurationPdfImport(taskNo);
  } finally {
    state = {
      ...state,
      activeParsingTaskNo: wasActive ? null : state.activeParsingTaskNo,
      stageLabel: wasActive ? "" : state.stageLabel,
      waitPromptOpen: false,
      tasks: state.tasks.map((row) => (
        row.importTaskNo === taskNo
          ? { ...row, status: "Cancelled", resultMessage: "Import was cancelled.", errorMessage: null }
          : row
      )),
    };
    emit();
  }
  await refreshImportTasks();
}

export function resetPdfImportNotifications() {
  state = {
    ...state,
    notifiedTerminalTaskNos: new Set(),
  };
  emit();
}

export function cancelPdfImportJob() {
  dismissPdfImportWaitPrompt();
}

export function resetPdfImportJob() {
  resetPdfImportNotifications();
}

export async function startPdfImportJob(file) {
  return uploadPdf(file);
}
