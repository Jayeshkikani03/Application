import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  getMe,
  getGatewayLoginUrl,
  getMyGatewaySites,
  getMyProjects,
  logout as apiLogout,
  logoutBrowser,
  switchSessionContext,
} from "@/features/auth/api/authApi.js";
import {
  IS_NATIVE,
  clearStoredToken,
  getStoredToken,
  getConnectivityErrorMessage,
  getUserFacingApiError,
  isConnectivityError,
  setStoredToken,
  setUnauthorizedHandler,
} from "@/shared/api/httpClient.js";
import { canChangeProjectInHeader, shouldShowSiteInHeader } from "@/constants/profileCodes.js";
import {
  formatAuthUserDisplayName,
  setCurrentAuditActor,
} from "@/shared/audit/auditActor.js";
import { clearSiteClock, setSiteClockFromSite } from "@/shared/time/siteClock.js";

const AuthContext = createContext(null);

async function redirectToGateway() {
  try {
    const data = await getGatewayLoginUrl();
    if (data?.loginUrl) {
      window.location.replace(data.loginUrl);
      return;
    }
  } catch {
    // Fall through to login page if gateway URL is unreachable.
  }
  const base = import.meta.env.BASE_URL || "/";
  const loginPath = base.endsWith("/") ? `${base}login` : `${base}/login`;
  window.location.replace(loginPath);
}

async function loadGatewaySites(user) {
  if (!user || !shouldShowSiteInHeader(user)) return [];
  try {
    return await getMyGatewaySites();
  } catch {
    return [];
  }
}

async function loadGatewayProjects() {
  try {
    return await getMyProjects();
  } catch {
    return [];
  }
}

function resolveActiveSite(user, siteList) {
  return user?.site?.trim() || siteList[0]?.siteCode?.trim() || "";
}

function mergeProjectCodes(apiProjects, currentUser) {
  const seen = new Set();
  const merged = [];
  for (const code of [...(apiProjects ?? []), currentUser?.project]) {
    const trimmed = String(code ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
  }
  return merged.sort((a, b) => a.localeCompare(b));
}

function applySwitchResult(result, { setUser, setActiveSiteState }) {
  const nextUser = result?.user ?? null;
  if (IS_NATIVE && result?.token) {
    setStoredToken(result.token);
  }
  setUser(nextUser);
  setActiveSiteState(resolveActiveSite(nextUser, []));
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState([]);
  const [projects, setProjects] = useState([]);
  const [activeSite, setActiveSiteState] = useState("");
  const [switchingContext, setSwitchingContext] = useState(false);
  /** Set when getMe fails due to network/API down — keep token; show Retry (no reload loop). */
  const [sessionError, setSessionError] = useState(null);

  const clearSessionState = useCallback(() => {
    setUser(null);
    setSites([]);
    setProjects([]);
    setActiveSiteState("");
    setSessionError(null);
    clearSiteClock();
  }, []);

  const logout = useCallback(() => {
    if (IS_NATIVE) {
      clearStoredToken();
      clearSessionState();
      apiLogout().catch(() => {});
    } else {
      sessionStorage.setItem("esource_logged_out", "1");
      clearSessionState();
      apiLogout().catch(() => {});
      logoutBrowser().catch(() => {});
      const base = import.meta.env.BASE_URL || "/";
      window.location.replace(base || "/");
    }
  }, [clearSessionState]);

  const hydrateSessionContext = useCallback(async (currentUser) => {
    const [siteList, projectList] = await Promise.all([
      loadGatewaySites(currentUser),
      loadGatewayProjects(),
    ]);
    setSites(siteList);
    setProjects(mergeProjectCodes(projectList, currentUser));
    setActiveSiteState(resolveActiveSite(currentUser, siteList));
  }, []);

  const applySessionUser = useCallback(
    async (currentUser) => {
      setUser(currentUser);
      setSessionError(null);
      if (currentUser) {
        await hydrateSessionContext(currentUser);
      } else {
        setSites([]);
        setProjects([]);
        setActiveSiteState("");
        clearSiteClock();
      }
    },
    [hydrateSessionContext]
  );

  const login = useCallback(
    async (token, nextUser) => {
      setStoredToken(token);
      await applySessionUser(nextUser ?? null);
    },
    [applySessionUser]
  );

  const retrySession = useCallback(async () => {
    setLoading(true);
    setSessionError(null);
    try {
      if (IS_NATIVE && !getStoredToken()) {
        setLoading(false);
        return;
      }
      const currentUser = await getMe();
      await applySessionUser(currentUser);
    } catch (err) {
      if (isConnectivityError(err)) {
        setSessionError({
          kind: "connectivity",
          message: getConnectivityErrorMessage(err),
        });
      } else if (err?.response?.status === 401) {
        if (IS_NATIVE) {
          clearStoredToken();
          clearSessionState();
        } else {
          clearSessionState();
          await redirectToGateway();
        }
      } else {
        setSessionError({
          kind: "unknown",
          message: getUserFacingApiError(
            err,
            "We could not restore your session. Please try again."
          ),
        });
      }
    } finally {
      setLoading(false);
    }
  }, [applySessionUser, clearSessionState]);

  const setSite = useCallback(
    async (siteCode) => {
      const normalized = String(siteCode ?? "").trim();
      if (!normalized || normalized === activeSite || switchingContext) {
        return;
      }

      setSwitchingContext(true);
      try {
        const result = await switchSessionContext({ siteCode: normalized });
        applySwitchResult(result, { setUser, setActiveSiteState });
        const siteList = await loadGatewaySites(result?.user ?? null);
        setSites(siteList);
        setActiveSiteState(resolveActiveSite(result?.user ?? null, siteList));
      } finally {
        setSwitchingContext(false);
      }
    },
    [activeSite, switchingContext]
  );

  const setProject = useCallback(
    async (projectCode) => {
      const normalized = String(projectCode ?? "").trim();
      const currentProject = user?.project?.trim() ?? "";
      if (!normalized || normalized === currentProject || switchingContext) {
        return;
      }
      if (!canChangeProjectInHeader(user)) {
        return;
      }

      setSwitchingContext(true);
      try {
        const result = await switchSessionContext({ projectCode: normalized });
        applySwitchResult(result, { setUser, setActiveSiteState });
        const [siteList, projectList] = await Promise.all([
          loadGatewaySites(result?.user ?? null),
          loadGatewayProjects(),
        ]);
        setSites(siteList);
        setProjects(mergeProjectCodes(projectList, result?.user ?? null));
        setActiveSiteState(resolveActiveSite(result?.user ?? null, siteList));
      } finally {
        setSwitchingContext(false);
      }
    },
    [switchingContext, user]
  );

  const handleUnauthorized = useCallback(async () => {
    if (IS_NATIVE) {
      clearStoredToken();
      clearSessionState();
      if (typeof window !== "undefined" && !window.location.pathname.endsWith("/login")) {
        const base = import.meta.env.BASE_URL || "/";
        const loginPath = base.endsWith("/") ? `${base}login` : `${base}/login`;
        window.location.replace(loginPath);
      }
    } else {
      clearSessionState();
      await logoutBrowser();
      await redirectToGateway();
    }
  }, [clearSessionState]);

  useEffect(() => {
    setUnauthorizedHandler(handleUnauthorized);
    return () => setUnauthorizedHandler(null);
  }, [handleUnauthorized]);

  useEffect(() => {
    let active = true;

    if (!IS_NATIVE && sessionStorage.getItem("esource_logged_out")) {
      sessionStorage.removeItem("esource_logged_out");
      redirectToGateway();
      return () => {
        active = false;
      };
    }

    if (IS_NATIVE && !getStoredToken()) {
      setLoading(false);
      return () => {
        active = false;
      };
    }

    getMe()
      .then(async (currentUser) => {
        if (!active) return;
        setSessionError(null);
        setUser(currentUser);
        if (currentUser) {
          await hydrateSessionContext(currentUser);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        // Network / API down: keep token and show Retry — do not treat as logout
        // (that caused mobile users to reload the app again and again).
        if (isConnectivityError(err)) {
          setSessionError({
            kind: "connectivity",
            message: getConnectivityErrorMessage(err),
          });
          setLoading(false);
          return;
        }
        if (err?.response?.status === 401) {
          if (IS_NATIVE) {
            clearStoredToken();
            setUser(null);
            setLoading(false);
          } else {
            redirectToGateway();
          }
          return;
        }
        setSessionError({
          kind: "unknown",
          message: getUserFacingApiError(
            err,
            "We could not restore your session. Please try again."
          ),
        });
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [hydrateSessionContext]);

  useEffect(() => {
    setCurrentAuditActor(formatAuthUserDisplayName(user));
  }, [user]);

  // Bind scan autofetch clock to active site → country UTC offset (24h wall clock).
  useEffect(() => {
    const code = String(activeSite || user?.site || "").trim().toLowerCase();
    if (!code || !sites?.length) {
      clearSiteClock();
      return;
    }
    const match = sites.find(
      (s) => String(s?.siteCode ?? s?.SiteCode ?? "").trim().toLowerCase() === code
    );
    if (match) {
      setSiteClockFromSite(match);
    } else {
      clearSiteClock();
    }
  }, [activeSite, sites, user?.site]);

  const value = useMemo(
    () => ({
      user,
      loading,
      sites,
      projects,
      activeSite,
      switchingContext,
      sessionError,
      retrySession,
      login,
      logout,
      setSite,
      setProject,
      isAuthenticated: Boolean(user),
    }),
    [
      user,
      loading,
      sites,
      projects,
      activeSite,
      switchingContext,
      sessionError,
      retrySession,
      login,
      logout,
      setSite,
      setProject,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
