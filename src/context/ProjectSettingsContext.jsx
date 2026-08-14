import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext.jsx";
import { setClockSource } from "@/shared/time/siteClock.js";
import {
  getProjectParameterByName,
} from "@/features/projectParameters/api/projectParametersApi.js";
import {
  DEFAULT_CLOCK_SOURCE,
  DEFAULT_SHOW_ACTIVITY_MAPPING_CRF,
  PROJECT_PARAM_CLOCK_SOURCE,
  PROJECT_PARAM_SHOW_ACTIVITY_MAPPING_CRF,
  parseClockSource,
  parseShowActivityMappingCrf,
} from "@/features/projectParameters/constants/projectParameterNames.js";
import {
  setRuntimeShowActivityMappingCrf,
} from "@/features/visitCrfMapping/visitCrfMappingConfig.js";

const ProjectSettingsContext = createContext(null);

const emptySettings = {
  clockSource: DEFAULT_CLOCK_SOURCE,
  clockSourceParameterNo: null,
  showActivityMappingCrf: DEFAULT_SHOW_ACTIVITY_MAPPING_CRF,
  showActivityMappingCrfParameterNo: null,
};

export function ProjectSettingsProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(emptySettings);

  const applySettings = useCallback((next) => {
    setSettings(next);
    setClockSource(next.clockSource);
    setRuntimeShowActivityMappingCrf(next.showActivityMappingCrf);
  }, []);

  const load = useCallback(async () => {
    if (!user) {
      applySettings(emptySettings);
      setLoading(false);
      return;
    }

    const projectCode = String(user.project ?? "").trim();
    setLoading(true);
    try {
      const [clockRow, showCrfRow] = await Promise.all([
        getProjectParameterByName(PROJECT_PARAM_CLOCK_SOURCE, projectCode || undefined),
        getProjectParameterByName(PROJECT_PARAM_SHOW_ACTIVITY_MAPPING_CRF, projectCode || undefined),
      ]);
      applySettings({
        clockSource: parseClockSource(clockRow.parameterValue),
        clockSourceParameterNo: clockRow.projectParameterNo,
        showActivityMappingCrf: parseShowActivityMappingCrf(showCrfRow.parameterValue),
        showActivityMappingCrfParameterNo: showCrfRow.projectParameterNo,
      });
    } catch {
      applySettings(emptySettings);
    } finally {
      setLoading(false);
    }
  }, [user, applySettings]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  const patchLocal = useCallback((partial) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      setClockSource(next.clockSource);
      setRuntimeShowActivityMappingCrf(next.showActivityMappingCrf);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      loading,
      ...settings,
      reload: load,
      patchLocal,
    }),
    [loading, settings, load, patchLocal],
  );

  return (
    <ProjectSettingsContext.Provider value={value}>
      {children}
    </ProjectSettingsContext.Provider>
  );
}

export function useProjectSettings() {
  const ctx = useContext(ProjectSettingsContext);
  if (!ctx) {
    throw new Error("useProjectSettings must be used within ProjectSettingsProvider");
  }
  return ctx;
}
