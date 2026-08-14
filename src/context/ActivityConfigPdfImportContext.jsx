import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { SoftAlertToast } from "../components/shared/SoftAlertToast";
import {
  getPdfImportJobState,
  refreshImportTasks,
  registerPdfImportCompletionListener,
  resetPdfImportNotifications,
  subscribePdfImportJob,
  uploadPdf,
  proceedPdfImport,
  cancelUploadedPdf,
} from "../features/activityConfiguration/services/activityConfigurationPdfImportJob";

const ActivityConfigPdfImportContext = createContext(null);

export function ActivityConfigPdfImportProvider({ children }) {
  const location = useLocation();
  const [jobState, setJobState] = useState(getPdfImportJobState);
  const [toast, setToast] = useState(null);
  const completionListenersRef = useRef(new Set());
  const notifiedTerminalRef = useRef(new Set());
  const previousActiveTaskNoRef = useRef(null);

  useEffect(() => subscribePdfImportJob(setJobState), []);

  // Load PDF import tasks only on Activity Configuration (or when a parse job is already running).
  // Do not hit GET /ActivityConfiguration/import-pdf/tasks on every authenticated page (e.g. /execute).
  useEffect(() => {
    const onActivityConfig = location.pathname.includes("/activity-configuration");
    const hasActiveJob = Boolean(getPdfImportJobState().activeParsingTaskNo);
    if (!onActivityConfig && !hasActiveJob) return undefined;

    refreshImportTasks().catch(() => {
      // load errors are surfaced by page actions
    });
    return undefined;
  }, [location.pathname]);

  useEffect(() => {
    return registerPdfImportCompletionListener((result) => {
      if (result?.importTaskNo) {
        notifiedTerminalRef.current.add(result.importTaskNo);
      }
      setToast({
        title: "PDF import complete",
        message: result.message || "PDF import completed.",
        variant: "success",
      });
      completionListenersRef.current.forEach((listener) => {
        try {
          listener(result);
        } catch {
          // listener errors should not break the import flow
        }
      });
    });
  }, []);

  useEffect(() => {
    const previousActiveTaskNo = previousActiveTaskNoRef.current;
    const currentActiveTaskNo = jobState.activeParsingTaskNo;

    if (previousActiveTaskNo && !currentActiveTaskNo) {
      const terminalTask = (jobState.tasks ?? []).find(
        (task) => task.importTaskNo === previousActiveTaskNo
      );

      if (
        terminalTask?.status === "Failed"
        && !notifiedTerminalRef.current.has(terminalTask.importTaskNo)
      ) {
        notifiedTerminalRef.current.add(terminalTask.importTaskNo);
        setToast({
          title: "PDF import failed",
          message: terminalTask.errorMessage || "PDF import failed.",
          variant: "error",
        });
      }
    }

    previousActiveTaskNoRef.current = currentActiveTaskNo;
  }, [jobState.activeParsingTaskNo, jobState.tasks]);

  const registerCompletionListener = useCallback((listener) => {
    completionListenersRef.current.add(listener);
    return () => {
      completionListenersRef.current.delete(listener);
    };
  }, []);

  const value = useMemo(() => ({
    jobState,
    importTasks: jobState.tasks ?? [],
    isImporting: Boolean(jobState.activeParsingTaskNo),
    stageLabel: jobState.stageLabel,
    refreshing: jobState.refreshing,
    uploadPdf,
    proceedPdfImport,
    cancelUploadedPdf,
    refreshImportTasks,
    registerCompletionListener,
    resetImport: resetPdfImportNotifications,
  }), [jobState, registerCompletionListener]);

  const activeTask = (jobState.tasks ?? []).find(
    (task) => task.importTaskNo === jobState.activeParsingTaskNo
  );

  const showBackgroundBanner = Boolean(jobState.activeParsingTaskNo)
    && !location.pathname.includes("/activity-configuration");

  return (
    <ActivityConfigPdfImportContext.Provider value={value}>
      {children}



      {showBackgroundBanner && (
        <div className="pdf-import-background-banner" role="status" aria-live="polite">
          <i className="fas fa-spinner fa-spin" aria-hidden="true" />
          <span>{jobState.stageLabel || "Parsing PDF..."}</span>
        </div>
      )}

      <SoftAlertToast
        title={toast?.title}
        message={toast?.message}
        variant={toast?.variant ?? "success"}
        autoDismissMs={toast?.variant === "error" ? 12000 : 4500}
        onClose={() => setToast(null)}
      />
    </ActivityConfigPdfImportContext.Provider>
  );
}

export function useActivityConfigPdfImport() {
  const context = useContext(ActivityConfigPdfImportContext);
  if (!context) {
    throw new Error("useActivityConfigPdfImport must be used within ActivityConfigPdfImportProvider");
  }
  return context;
}

export function useOptionalActivityConfigPdfImport() {
  return useContext(ActivityConfigPdfImportContext);
}
