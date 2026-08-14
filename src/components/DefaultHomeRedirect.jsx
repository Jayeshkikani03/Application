import { Navigate } from "react-router-dom";
import { usePermissions } from "@/context/PermissionContext.jsx";
import { findFirstAllowedRoute } from "@/shared/permissions/permissionModel.js";

export function DefaultHomeRedirect() {
  const { loading, rawPages, navFromOps, profileCode } = usePermissions();

  if (loading) return null;

  const target = findFirstAllowedRoute(navFromOps, rawPages, profileCode) || "/execute";
  return <Navigate to={target} replace />;
}
