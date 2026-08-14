import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext.jsx";
import { useProjectSettings } from "@/context/ProjectSettingsContext.jsx";
import { permissionsApi } from "@/features/auth/api/permissionsApi.js";
import { operationsApi } from "@/features/parameters/api/operationsApi.js";
import { buildNavFromOperations } from "@/config/appMenuConfig.js";
import { filterNavByPermissions, withProfileRestrictedNavItems } from "@/shared/permissions/permissionModel.js";

const PermissionContext = createContext(null);

export function PermissionProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const { showActivityMappingCrf } = useProjectSettings();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [profileCode, setProfileCode] = useState("");
  const [rawPages, setRawPages] = useState([]);
  const [operations, setOperations] = useState([]);

  const load = useCallback(async () => {
    if (!user) {
      setRawPages([]);
      setProfileCode("");
      setOperations([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // permissions/me = page rights; operations = Operation Master menu tree (order, parents, icons).
      // Both are required: nav = buildNavFromOperations(operations) then filterNavByPermissions(pages).
      const [permData, opData] = await Promise.all([
        permissionsApi.getMyPermissions(),
        operationsApi.getOperations(),
      ]);
      setProfileCode(String(permData?.profileCode || user.profileCode || "").trim());
      setRawPages(Array.isArray(permData?.pages) ? permData.pages : []);
      const ops = Array.isArray(opData) ? opData : (opData?.items ?? []);
      setOperations(ops);
    } catch (e) {
      setError(e);
      setRawPages([]);
      setProfileCode("");
      setOperations([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      // Refresh rights + menu tree together (same pair as load). Avoid calling refresh on first paint.
      const [permData, opData] = await Promise.all([
        permissionsApi.refreshMyPermissions(),
        operationsApi.getOperations(),
      ]);
      setProfileCode(String(permData?.profileCode || user.profileCode || "").trim());
      setRawPages(Array.isArray(permData?.pages) ? permData.pages : []);
      const ops = Array.isArray(opData) ? opData : (opData?.items ?? []);
      setOperations(ops);
      window.dispatchEvent(new Event("esource:menu-updated"));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  useEffect(() => {
    const onMenuUpdated = () => {
      void load();
    };
    window.addEventListener("esource:menu-updated", onMenuUpdated);
    return () => window.removeEventListener("esource:menu-updated", onMenuUpdated);
  }, [load]);

  const navFromOps = useMemo(
    () => withProfileRestrictedNavItems(buildNavFromOperations(operations), profileCode),
    // Rebuild when project ShowActivityMappingCrf flag changes (includeMenuPath reads runtime flag).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showActivityMappingCrf intentionally forces rebuild
    [operations, profileCode, showActivityMappingCrf]
  );

  const filteredNav = useMemo(
    () => filterNavByPermissions(navFromOps, rawPages, profileCode),
    [navFromOps, rawPages, profileCode]
  );

  const value = useMemo(
    () => ({
      loading,
      error,
      profileCode,
      rawPages,
      operations,
      navFromOps,
      filteredNav,
      refresh,
      reload: load,
    }),
    [loading, error, profileCode, rawPages, operations, navFromOps, filteredNav, refresh, load]
  );

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions() {
  const ctx = useContext(PermissionContext);
  if (!ctx) {
    throw new Error("usePermissions must be used within PermissionProvider");
  }
  return ctx;
}

export function useRoutePermission(routePath) {
  const { rawPages, loading } = usePermissions();
  const rights = useMemo(() => {
    const target = String(routePath || "").trim();
    const row = rawPages.find(
      (p) => String(p.routePath || "").trim().toLowerCase() === target.toLowerCase()
        || normalizePath(p.routePath) === normalizePath(target)
    );
    if (!row) {
      return { canView: false, canAddEdit: false, canInactive: false, canReview: false, canAccess: false };
    }
    const canAccess = Boolean(row.canView || row.canAddEdit || row.canInactive || row.canInActive || row.canReview);
    return {
      canView: Boolean(row.canView),
      canAddEdit: Boolean(row.canAddEdit),
      canInactive: Boolean(row.canInactive ?? row.canInActive),
      canReview: Boolean(row.canReview),
      canAccess,
    };
  }, [rawPages, routePath]);

  return { ...rights, loading };
}

function normalizePath(p) {
  if (!p) return "";
  let s = String(p).trim();
  if (!s.startsWith("/")) s = `/${s}`;
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}
