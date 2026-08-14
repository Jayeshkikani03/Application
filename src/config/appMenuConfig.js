import {
  isActivityMappingCrfVisible,
  isVisitCrfMappingPath,
} from "@/features/visitCrfMapping/visitCrfMappingConfig.js";

/** Parent group name in Operation Master for admin flyout children (seed / fallback only). */
export const ADMIN_PARENT_NAME = "Admin Configuration";

function includeMenuPath(path) {
  if (!path) return false;
  if (!isActivityMappingCrfVisible() && isVisitCrfMappingPath(path)) return false;
  return true;
}

/** Normalize route paths for comparison (case / trailing slash). */
export function normalizeRoutePath(path) {
  let s = String(path ?? "").trim().toLowerCase();
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

/**
 * Paths that open the same screen (legacy + current names).
 * If any path in a group is already in Operation Master, hide the whole group in the Path dropdown.
 */
export const ROUTE_PATH_ALIAS_GROUPS = [
  ["/activity-mapping", "/visit-crf-mapping"],
  ["/activity-fill", "/visit-crf"],
  ["/activity-fill/open", "/visit-crf/open", "/review/crf"],
];

/** All normalized path strings that share a screen with `path` (at least itself). */
export function getRoutePathAliases(path) {
  const n = normalizeRoutePath(path);
  if (!n) return [];
  for (const group of ROUTE_PATH_ALIAS_GROUPS) {
    const normalizedGroup = group.map(normalizeRoutePath);
    if (normalizedGroup.includes(n)) return normalizedGroup;
  }
  return [n];
}

/** True when `candidatePath` (or an alias) is already assigned, excluding optional `ownPath` aliases. */
export function isRoutePathAssigned(candidatePath, mappedPaths, ownPath = null) {
  const candidateAliases = new Set(getRoutePathAliases(candidatePath));
  if (candidateAliases.size === 0) return false;
  const ownAliases = new Set(getRoutePathAliases(ownPath));
  for (const mapped of mappedPaths) {
    const mappedAliases = getRoutePathAliases(mapped);
    for (const a of mappedAliases) {
      if (!candidateAliases.has(a)) continue;
      if (ownAliases.has(a)) continue;
      return true;
    }
  }
  return false;
}
/**
 * Route metadata — icons and mobile flags (not display names).
 * Display labels come from Operation Master `menuGroup` when available.
 */
export const ROUTE_META = {
  "/execute": { label: "Activity Execution", shortLabel: "Activity", icon: "\u25B6", desktopOnly: false },
  "/centrifugation": { label: "Centrifuge", shortLabel: "Centrifuge", icon: "\u21BB", desktopOnly: false },
  "/aliquots": { label: "Aliquot Creation", shortLabel: "Aliquot", icon: "\u2387", desktopOnly: false },
  "/bag-preparation": { label: "Bag Preparation", shortLabel: "Bag", icon: "\u2610", desktopOnly: false },
  "/review": { label: "Review", shortLabel: "Review", icon: "\u2713", desktopOnly: true },
  "/review/crf": { label: "Activity CRF", shortLabel: "Activity CRF", icon: "\u270E", desktopOnly: true },
  "/queries": { label: "Queries", shortLabel: "Queries", icon: "\u003F", desktopOnly: false },
  "/subjects": { label: "Participants", shortLabel: "Participants", icon: "\u{1F465}", desktopOnly: true },
  "/barcode-generation": { label: "Barcode Generation", shortLabel: "Generate", icon: "\u25A3", desktopOnly: true },
  "/activity-configuration": { label: "Activity Configuration", shortLabel: "Config", icon: "\u2699", desktopOnly: true },
  "/activity-mapping": { label: "Activity Mapping", shortLabel: "Activity Map", icon: "\u2399", desktopOnly: true },
  "/activity-fill": { label: "Activity Mapping", shortLabel: "Activity Map", icon: "\u270E", desktopOnly: false },
  "/activity-fill/open": { label: "Activity Mapping CRF", shortLabel: "Activity CRF", icon: "\u270E", desktopOnly: false },
  "/visit-crf-mapping": { label: "Activity Mapping", shortLabel: "Activity Map", icon: "\u2399", desktopOnly: true },
  "/visit-crf": { label: "Activity Mapping", shortLabel: "Activity Map", icon: "\u270E", desktopOnly: false },
  "/visit-crf/open": { label: "Activity Mapping CRF", shortLabel: "Activity CRF", icon: "\u270E", desktopOnly: false },
  "/admin/parameters": { label: "Parameter Configuration", icon: "\u2630" },
  "/admin/project-parameters": { label: "Project Parameters", icon: "\u2699" },
  "/admin/profiles": { label: "Profile Configuration", icon: "\u{1F4CB}" },
  "/admin/role-matrix": { label: "Role Matrix", icon: "\u{1F6E1}" },
  "/admin/operation-master": { label: "Operation Master", icon: "\u2638" },
  "/admin/external-apis": { label: "External API Configuration", icon: "\u{1F310}" },
  "/admin/llm-config": { label: "LLM Provider Config", icon: "\u{1F511}" },
  "/admin/llm-prompts": { label: "LLM Prompt Management", icon: "\u{1F4DD}" },
  "/admin/task-logs": { label: "Task Logs", icon: "\u{1F4CB}" },
  "/admin/apk": { label: "APK Distribution", icon: "\u{1F4F1}", desktopOnly: true },
};

export const APP_ROUTE_CATALOG = Object.entries(ROUTE_META)
  .filter(([path]) => includeMenuPath(path))
  .map(([path, meta]) => ({
    path,
    label: meta.label,
  }));

/**
 * Default Operation Master structure:
 * - Top level (no parent): Activity Execution, Centrifuge, Aliquot Creation, Review
 * - Under Admin Configuration: Barcode Generation, Activity Configuration + admin pages
 */
export const DEFAULT_MENU_SEED = {
  topLevel: [
    { menuGroup: "Activity Execution", path: "/execute", order: 1, forMobile: true },
    { menuGroup: "Centrifuge", path: "/centrifugation", order: 2, forMobile: true },
    { menuGroup: "Aliquot Creation", path: "/aliquots", order: 3, forMobile: true },
    { menuGroup: "Bag Preparation", path: "/bag-preparation", order: 4, forMobile: true },
    { menuGroup: "Review", path: "/review", order: 5, forMobile: false },
    { menuGroup: "Queries", path: "/queries", order: 6, forMobile: true },
    { menuGroup: "Participants", path: "/subjects", order: 7, forMobile: false },
    { menuGroup: "Activity Mapping", path: "/activity-fill", order: 8, forMobile: true },
  ].filter((item) => includeMenuPath(item.path)),
  adminGroup: {
    menuGroup: ADMIN_PARENT_NAME,
    order: 9,
    children: [
      { menuGroup: "Barcode Generation", path: "/barcode-generation", order: 1, forMobile: false },
      { menuGroup: "Activity Configuration", path: "/activity-configuration", order: 2, forMobile: false },
      { menuGroup: "Activity Mapping", path: "/activity-mapping", order: 3, forMobile: false },
      { menuGroup: "Parameter Configuration", path: "/admin/parameters", order: 4, forMobile: false },
      { menuGroup: "Project Parameters", path: "/admin/project-parameters", order: 5, forMobile: false },
      { menuGroup: "Profile Configuration", path: "/admin/profiles", order: 6, forMobile: false },
      { menuGroup: "Role Matrix", path: "/admin/role-matrix", order: 7, forMobile: false },
      { menuGroup: "Operation Master", path: "/admin/operation-master", order: 8, forMobile: false },
      { menuGroup: "External API Configuration", path: "/admin/external-apis", order: 9, forMobile: false },
      { menuGroup: "LLM Provider Config", path: "/admin/llm-config", order: 10, forMobile: false },
      { menuGroup: "LLM Prompt Management", path: "/admin/llm-prompts", order: 11, forMobile: false },
      { menuGroup: "Task Logs", path: "/admin/task-logs", order: 12, forMobile: false },
      { menuGroup: "APK Distribution", path: "/admin/apk", order: 13, forMobile: false },
    ].filter((item) => includeMenuPath(item.path)),
  },
};

const ADMIN_CHILD_PATHS = new Set(
  DEFAULT_MENU_SEED.adminGroup.children.map((item) => item.path)
);

const FALLBACK_FLAT_NAV = DEFAULT_MENU_SEED.topLevel.map((item) => ({
  to: item.path,
  ...ROUTE_META[item.path],
  label: item.menuGroup || ROUTE_META[item.path]?.label,
  // Bottom nav needs short names; keep full menuGroup on `label` for sidebar.
  shortLabel: ROUTE_META[item.path]?.shortLabel || item.menuGroup || ROUTE_META[item.path]?.label,
  forMobile: item.forMobile ?? !(ROUTE_META[item.path]?.desktopOnly ?? false),
  desktopOnly: !(item.forMobile ?? !(ROUTE_META[item.path]?.desktopOnly ?? false)),
}));

const FALLBACK_ADMIN_GROUP = {
  id: "admin",
  label: ADMIN_PARENT_NAME,
  shortLabel: "Admin",
  icon: "\u{1F6E0}",
  children: DEFAULT_MENU_SEED.adminGroup.children.map((item) => ({
    to: item.path,
    label: item.menuGroup || ROUTE_META[item.path]?.label,
    icon: ROUTE_META[item.path]?.icon ?? "\u2022",
  })),
};

function operationToNavItem(op) {
  const path = op.path?.trim();
  if (!path) return null;
  const meta = ROUTE_META[path] ?? {};
  const displayName = String(op.menuGroup ?? "").trim();
  // Prefer ROUTE_META.desktopOnly so mobile bottom bar stays in sync with catalog.
  const forMobile =
    meta.desktopOnly != null ? !meta.desktopOnly : (op.forMobile ?? true);
  return {
    to: path,
    // Match WEB: Operation Master menuGroup / page name wins over static ROUTE_META.
    label: displayName || meta.label || path,
    // Mobile bottom bar always uses compact catalog shortLabel when available.
    shortLabel: meta.shortLabel || displayName || meta.label || path,
    icon: meta.icon ?? "\u2022",
    desktopOnly: !forMobile,
    forMobile,
    order: op.order ?? 0,
  };
}

/** Resolve Admin parent even if its Menu Group / Page Name was renamed in Operation Master. */
function resolveAdminParentRecord(allOps) {
  const byName = allOps.find(
    (o) => o.isParent && o.menuGroup?.trim().toLowerCase() === ADMIN_PARENT_NAME.toLowerCase()
  );
  if (byName) return byName;

  let best = null;
  let bestCount = 0;
  for (const parent of allOps.filter((o) => o.isParent)) {
    const count = allOps.filter(
      (o) =>
        !o.isParent
        && Number(o.parentGroup) === Number(parent.operationMasterNo)
        && ADMIN_CHILD_PATHS.has(String(o.path ?? "").trim())
    ).length;
    if (count > bestCount) {
      best = parent;
      bestCount = count;
    }
  }
  return best;
}

/** Build sidebar nav from Operation Master rows (active, for-menu only). */
export function buildNavFromOperations(operations) {
  const allOps = operations ?? [];
  const ops = allOps.filter((o) => o.isActive && !o.notForMenu);
  if (ops.length === 0) {
    return {
      flatNav: FALLBACK_FLAT_NAV.filter((item) => includeMenuPath(item.to)),
      adminGroup: {
        ...FALLBACK_ADMIN_GROUP,
        children: FALLBACK_ADMIN_GROUP.children.filter((item) => includeMenuPath(item.to)),
      },
    };
  }

  const adminParentRecord = resolveAdminParentRecord(allOps);

  const flatNav = ops
    .filter((o) => !o.isParent && !o.parentGroup)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(operationToNavItem)
    .filter((item) => item && includeMenuPath(item.to));

  const adminChildren = adminParentRecord
    ? ops
      .filter((o) => !o.isParent && Number(o.parentGroup) === Number(adminParentRecord.operationMasterNo))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(operationToNavItem)
      .filter((item) => item && includeMenuPath(item.to))
    : ops
      .filter((o) => {
        const path = o.path?.trim();
        return path && FALLBACK_ADMIN_GROUP.children.some((c) => c.to === path);
      })
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(operationToNavItem)
      .filter((item) => item && includeMenuPath(item.to));

  const adminLabel = String(adminParentRecord?.menuGroup ?? "").trim() || ADMIN_PARENT_NAME;
  const adminGroup = {
    id: "admin",
    label: adminLabel,
    shortLabel: adminLabel,
    icon: "\u{1F6E0}",
    children: (adminChildren.length > 0 ? adminChildren : FALLBACK_ADMIN_GROUP.children)
      .filter((item) => includeMenuPath(item.to)),
  };

  return {
    flatNav: (flatNav.length > 0 ? flatNav : FALLBACK_FLAT_NAV).filter((item) => includeMenuPath(item.to)),
    adminGroup,
  };
}

/**
 * Page header / document title from Operation Master (same precedence as WEB).
 * Falls back to ROUTE_META, then a default label.
 */
export function getLabelForPath(pathname, operations = [], fallback = "Home") {
  if (!pathname) return fallback;
  const target = String(pathname).toLowerCase();

  const exact = (operations ?? []).find(
    (o) =>
      !o.isParent
      && o.path
      && String(o.path).trim().toLowerCase() === target
  );
  if (exact?.menuGroup) return String(exact.menuGroup).trim();

  const bestDb = (operations ?? [])
    .filter((o) => {
      if (o.isParent || !o.path) return false;
      const path = String(o.path).trim().toLowerCase();
      return path && !path.includes(":") && (target === path || target.startsWith(`${path}/`));
    })
    .sort((a, b) => String(b.path).length - String(a.path).length)[0];
  if (bestDb?.menuGroup) return String(bestDb.menuGroup).trim();

  const staticExact = ROUTE_META[pathname];
  if (staticExact?.label) return staticExact.label;

  const bestStaticPath = Object.keys(ROUTE_META)
    .filter((path) => target === path || target.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (bestStaticPath) return ROUTE_META[bestStaticPath].label;

  return fallback;
}

/** Collect every path defined in the default seed catalog. */
export function getDefaultSeedPaths() {
  const paths = DEFAULT_MENU_SEED.topLevel.map((i) => i.path);
  paths.push(...DEFAULT_MENU_SEED.adminGroup.children.map((i) => i.path));
  return paths;
}
