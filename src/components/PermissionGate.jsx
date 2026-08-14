import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useState } from "react";
import { usePermissions } from "@/context/PermissionContext.jsx";
import {
  findFirstAllowedRoute,
  normalizeRoutePath,
  routeHasAccess,
} from "@/shared/permissions/permissionModel.js";
import { getUserFacingApiError, isConnectivityError } from "@/shared/api/httpClient.js";
import { ConnectionRetryScreen } from "@/components/ConnectionRetryScreen.jsx";

export function PermissionGate() {
  const location = useLocation();
  const { loading, error, rawPages, navFromOps, profileCode, reload } = usePermissions();
  const [retrying, setRetrying] = useState(false);

  if (loading) {
    return (
      <div className="admin-spinner" style={{ padding: "2rem" }}>
        Loading permissions…
      </div>
    );
  }

  if (error) {
    const message = getUserFacingApiError(
      error,
      "We could not load this page. Please try again."
    );
    return (
      <ConnectionRetryScreen
        title={isConnectivityError(error) ? "No connection" : "Something went wrong"}
        message={message}
        retrying={retrying}
        onRetry={async () => {
          setRetrying(true);
          try {
            await reload();
          } finally {
            setRetrying(false);
          }
        }}
      />
    );
  }

  const currentPath = normalizeRoutePath(location.pathname);
  if (!routeHasAccess(rawPages, currentPath, profileCode)) {
    const fallback = findFirstAllowedRoute(navFromOps, rawPages, profileCode);
    if (fallback && fallback !== currentPath) {
      return <Navigate to={fallback} replace />;
    }
    return (
      <div className="admin-wrap">
        <div className="admin-card admin-error-card">
          <div className="admin-error-title">Access Denied</div>
          <div className="admin-error-msg">You do not have permission to open this page.</div>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
