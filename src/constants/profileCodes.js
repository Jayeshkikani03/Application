/** JWT authMode values from ApplicationAPI LoginService.AuthModes. */
import { IS_NATIVE } from "@/shared/api/httpClient.js";

export const AUTH_MODES = {
  mobile: "mobile",
  gateway: "gateway",
};

/** Matches ApplicationAPI ProfileCodes.SiteUser / ProfileMst.vRole for Site User. */
export const SITE_USER_PROFILE_CODE = "003";

/**
 * Routes visible only to listed profile codes (ProfileMst.vRole / JWT ProfileCode).
 * Enforced in nav + PermissionGate regardless of Role Matrix grants for other profiles.
 */
export const PROFILE_RESTRICTED_ROUTES = {};

export function normalizeProfileCode(profileCode) {
  return String(profileCode ?? "").trim();
}

export function isSiteUserProfile(profileCode) {
  return normalizeProfileCode(profileCode) === SITE_USER_PROFILE_CODE;
}

/** False when the route is profile-restricted and the current profile is not allowed. */
export function profileAllowsRoute(profileCode, routePath) {
  const path = String(routePath ?? "").trim();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const trimmed = normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;

  // Exact match, or a child of a profile-restricted parent (e.g. /bag-preparation/export-log).
  for (const [restrictedPath, allowed] of Object.entries(PROFILE_RESTRICTED_ROUTES)) {
    if (trimmed !== restrictedPath && !trimmed.startsWith(`${restrictedPath}/`)) continue;
    return allowed.includes(normalizeProfileCode(profileCode));
  }
  return true;
}

function resolveAuthMode(user) {
  if (user?.authMode?.trim()) return user.authMode.trim();
  return IS_NATIVE ? AUTH_MODES.mobile : AUTH_MODES.gateway;
}

/** Gateway SSO: project is fixed. Mobile login: project can change when 2+ projects. */
export function canChangeProjectInHeader(user) {
  if (!user?.project?.trim()) return false;
  return resolveAuthMode(user) === AUTH_MODES.mobile;
}

/**
 * Site selector in header is shown only when the logged-in profile matches
 * dbo.ParameterList Login.MobileSiteUserProfileCode (API sets user.showSiteInHeader).
 * Applies to gateway and mobile logins, site users and project users.
 */
export function shouldShowSiteInHeader(user) {
  return user?.showSiteInHeader === true;
}

/**
 * Queries page Resolve — from dbo.ParameterList Query.ResolveRoleIds (API sets user.canResolveQuery).
 */
export function canResolveQuery(user) {
  return user?.canResolveQuery === true;
}

/**
 * Queries page Close / Send Back — from dbo.ParameterList Query.CloseRoleIds (API sets user.canCloseQuery).
 */
export function canCloseQuery(user) {
  return user?.canCloseQuery === true;
}
