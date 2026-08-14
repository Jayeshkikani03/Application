/** @typedef {{ canView: boolean, canAddEdit: boolean, canInactive: boolean, canReview: boolean }} PageRights */

import {
  PROFILE_RESTRICTED_ROUTES,
  profileAllowsRoute,
} from "@/constants/profileCodes.js";
import { ROUTE_META } from "@/config/appMenuConfig.js";

export function normalizeRoutePath(path) {
  if (!path) return "";
  let s = String(path).trim();
  if (!s) return "";
  if (!s.startsWith("/")) s = `/${s}`;
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

/**
 * @param {Array<{ routePath: string, canView?: boolean, canAddEdit?: boolean, canInactive?: boolean, canReview?: boolean }>} pages
 * @param {string} routePath
 * @returns {PageRights | null}
 */
export function getRightsForRoute(pages, routePath) {
  const target = normalizeRoutePath(routePath).toLowerCase();
  const row = (pages ?? []).find(
    (p) => normalizeRoutePath(p.routePath).toLowerCase() === target
  );
  if (!row) return null;
  return {
    canView: Boolean(row.canView),
    canAddEdit: Boolean(row.canAddEdit),
    canInactive: Boolean(row.canInactive ?? row.canInActive),
    canReview: Boolean(row.canReview),
  };
}

/**
 * Ensures profile-restricted routes (e.g. Bag Preparation for 003) appear in nav
 * even when Operation Master has not been seeded yet.
 */
export function withProfileRestrictedNavItems(nav, profileCode = "") {
  const flatNav = [...(nav?.flatNav ?? [])];
  const existing = new Set(flatNav.map((item) => normalizeRoutePath(item.to).toLowerCase()));

  for (const [path, allowedProfiles] of Object.entries(PROFILE_RESTRICTED_ROUTES)) {
    if (!allowedProfiles.includes(String(profileCode ?? "").trim())) continue;
    const key = normalizeRoutePath(path).toLowerCase();
    if (existing.has(key)) continue;
    const meta = ROUTE_META[path] ?? {};
    flatNav.push({
      to: path,
      label: meta.label ?? path,
      shortLabel: meta.shortLabel ?? meta.label ?? path,
      icon: meta.icon ?? "\u2022",
      forMobile: !(meta.desktopOnly ?? false),
      desktopOnly: meta.desktopOnly ?? false,
      order: 99,
    });
    existing.add(key);
  }

  return {
    ...nav,
    flatNav,
    adminGroup: nav?.adminGroup ?? { children: [] },
  };
}

/**
 * True when the profile may open the route and either:
 * - Role Matrix grants any right, or
 * - the route is profile-restricted and this profile is in the allow-list (Site User 003 for bag prep).
 */
export function routeHasAccess(pages, routePath, profileCode = "") {
  if (!profileAllowsRoute(profileCode, routePath)) {
    return false;
  }

  const target = normalizeRoutePath(routePath);
  const targetKey = target.toLowerCase();

  // Profile-restricted parents (and their child paths) are allowed without Role Matrix rows.
  for (const restrictedPath of Object.keys(PROFILE_RESTRICTED_ROUTES)) {
    const key = normalizeRoutePath(restrictedPath).toLowerCase();
    if (!key) continue;
    if (targetKey !== key && !targetKey.startsWith(`${key}/`)) continue;
    if (profileAllowsRoute(profileCode, restrictedPath)) {
      return true;
    }
  }

  const sorted = [...(pages ?? [])].sort(
    (a, b) => normalizeRoutePath(b.routePath).length - normalizeRoutePath(a.routePath).length
  );

  const pageAllows = (path) => {
    const key = normalizeRoutePath(path).toLowerCase();
    if (!key) return false;
    for (const row of sorted) {
      const apiP = normalizeRoutePath(row.routePath).toLowerCase();
      if (!apiP) continue;
      if (key !== apiP && !key.startsWith(`${apiP}/`)) continue;
      return Boolean(row.canView || row.canAddEdit || row.canInactive || row.canInActive || row.canReview);
    }
    return false;
  };

  // Review users can open filled Activity CRF pages (under /review/crf or Activity Fill open).
  if (
    (
      targetKey.startsWith("/review/crf/")
      || targetKey.startsWith("/activity-fill/open/")
      || targetKey.startsWith("/visit-crf/open/")
    )
    && pageAllows("/review")
  ) {
    return true;
  }

  for (const row of sorted) {
    const apiP = normalizeRoutePath(row.routePath).toLowerCase();
    if (!apiP) continue;
    if (targetKey !== apiP && !targetKey.startsWith(`${apiP}/`)) continue;
    return Boolean(row.canView || row.canAddEdit || row.canInactive || row.canInActive || row.canReview);
  }
  return false;
}

/**
 * @param {{ flatNav: Array, adminGroup: object }} nav
 * @param {Array} permissionPages
 * @param {string} [profileCode]
 */
export function filterNavByPermissions(nav, permissionPages, profileCode = "") {
  const pages = permissionPages ?? [];
  const flatNav = (nav.flatNav ?? []).filter((item) => routeHasAccess(pages, item.to, profileCode));
  const children = (nav.adminGroup?.children ?? []).filter((item) =>
    routeHasAccess(pages, item.to, profileCode)
  );

  return {
    flatNav,
    adminGroup: {
      ...nav.adminGroup,
      children,
    },
    showAdminParent: children.length > 0,
  };
}

/** First route the user may open (menu order: flat nav then admin children). */
export function findFirstAllowedRoute(nav, permissionPages, profileCode = "") {
  const filtered = filterNavByPermissions(nav, permissionPages, profileCode);
  const firstFlat = filtered.flatNav[0]?.to;
  if (firstFlat) return firstFlat;
  const firstAdmin = filtered.adminGroup.children[0]?.to;
  if (firstAdmin) return firstAdmin;
  return null;
}
