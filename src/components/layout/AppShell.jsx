import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useViewport } from "../../hooks/useViewport";
import { shouldShowSiteInHeader, canChangeProjectInHeader } from "../../constants/profileCodes";
import { IS_NATIVE } from "../../shared/api/httpClient";
import { getPublicAssetUrl } from "../../config/publicAssetUrl";
import { usePermissions } from "../../context/PermissionContext";
import { useScanNav } from "../../context/ScanNavContext";
import { getLabelForPath } from "../../config/appMenuConfig";
import { Footer } from "./Footer";
import { BrandName } from "../BrandName";

function CameraNavIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function ScanChevronIcon({ open }) {
  // Closed → left (open), open → right (close)
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {open ? (
        <polyline points="9 18 15 12 9 6" />
      ) : (
        <polyline points="15 18 9 12 15 6" />
      )}
    </svg>
  );
}

function BagNavIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8h12l1 12H5L6 8z" />
      <path d="M9 8V7a3 3 0 0 1 6 0v1" />
    </svg>
  );
}

function QueryNavIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    </svg>
  );
}

function NavMenuIcon({ to, icon }) {
  if (to === "/bag-preparation") return <BagNavIcon />;
  if (to === "/queries") return <QueryNavIcon />;
  return icon;
}

// ─── Admin flyout panel ───────────────────────────────────────────────────────

function AdminFlyoutPanel({ adminGroup, onClose }) {
  const location = useLocation();
  return (
    <aside className="print-suppress app-admin-flyout" aria-label="Admin navigation">
      <div className="app-admin-flyout-title">{adminGroup.label}</div>
      <nav className="app-admin-flyout-nav">
        {adminGroup.children.map((child) => {
          const isActive = location.pathname === child.to || location.pathname.startsWith(`${child.to}/`);
          return (
            <NavLink
              key={child.to}
              to={child.to}
              onClick={onClose}
              className={`app-admin-flyout-link ${isActive ? "app-admin-flyout-link--active" : "app-admin-flyout-link--inactive"}`}
            >
              <span className="esource-sidebar-menu-icon">{child.icon}</span>
              <span>{child.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}

// ─── Header helpers ──────────────────────────────────────────────────────────

function formatUserDisplayName(user) {
  if (!user) return "—";
  return user.userName?.trim() || user.email?.trim() || "—";
}

function formatProfileLabel(user) {
  if (!user) return "—";
  return user.roleName?.trim() || user.profileCode?.trim() || "—";
}

function HeaderProjectSelect({ projects, activeProjectId, onChange, className = "", disabled = false }) {
  return (
    <select
      className={`header-project-select ${className}`.trim()}
      value={activeProjectId}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Select project"
      disabled={disabled}
    >
      {projects.map((p) => (
        <option key={p.id} value={p.id}>{p.code}</option>
      ))}
    </select>
  );
}

function SiteDisplay({ sites, activeSite, onChangeSite, siteFromToken, className = "", disabled = false }) {
  if (!sites || sites.length === 0) {
    return <span className={`header-site-value preserve-case ${className}`.trim()}>{siteFromToken?.trim() || activeSite?.trim() || "—"}</span>;
  }
  if (sites.length === 1) {
    return <span className={`header-site-value preserve-case ${className}`.trim()}>{sites[0].siteCode}</span>;
  }
  return (
    <select
      className={`header-site-select ${className}`.trim()}
      value={activeSite}
      onChange={(e) => onChangeSite(e.target.value)}
      aria-label="Select site"
      disabled={disabled}
    >
      {sites.map((s) => (
        <option key={s.siteCode} value={s.siteCode}>{s.siteCode}</option>
      ))}
    </select>
  );
}

// ─── AppShell ─────────────────────────────────────────────────────────────────

function AppShell() {
  const {
    user,
    logout,
    sites,
    projects,
    activeSite,
    setSite,
    setProject,
    switchingContext,
  } = useAuth();
  const navigate = useNavigate();

  const showSiteInHeader = shouldShowSiteInHeader(user);

  const displayName = formatUserDisplayName(user);
  const profileLabel = formatProfileLabel(user);
  const authProjectCode = user?.project?.trim() || "";
  const authProjectOptions = useMemo(
    () => projects.map((code) => ({ id: code, code })),
    [projects]
  );
  const showAuthProjectSelect = canChangeProjectInHeader(user) && authProjectOptions.length > 1;
  const { isMobileOrTablet } = useViewport();
  const scanNav = useScanNav();
  const { filteredNav, operations, loading: permissionsLoading } = usePermissions();

  const [adminOpen, setAdminOpen] = useState(false);
  const sidebarRef = useRef(null);
  const flyoutRef = useRef(null);

  const location = useLocation();
  const flatNav = filteredNav.flatNav;
  const adminGroup = filteredNav.adminGroup;
  const showAdminParent = filteredNav.showAdminParent;

  const adminChildActive = useMemo(
    () =>
      adminGroup.children.some(
        (child) =>
          location.pathname === child.to || location.pathname.startsWith(`${child.to}/`)
      ),
    [location.pathname, adminGroup.children]
  );

  useEffect(() => {
    setAdminOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!showAdminParent) setAdminOpen(false);
  }, [showAdminParent]);

  // Close flyout when clicking outside sidebar or flyout
  useEffect(() => {
    if (!adminOpen) return;
    const onDocMouseDown = (e) => {
      if (sidebarRef.current?.contains(e.target) || flyoutRef.current?.contains(e.target)) return;
      setAdminOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [adminOpen]);

  const handleLogout = () => {
    logout();
    if (IS_NATIVE) navigate("/login", { replace: true });
  };

  // Bottom nav: only items flagged for mobile menu — Activity centered
  const mobileNavItems = useMemo(() => {
    const items = flatNav.filter((item) => item.forMobile);
    const activityIdx = items.findIndex(
      (item) => item.to === "/execute" || item.to === "/"
    );
    if (activityIdx < 0 || items.length < 3) return items;

    const next = [...items];
    const [activity] = next.splice(activityIdx, 1);
    const mid = Math.floor(next.length / 2);
    next.splice(mid, 0, activity);
    return next;
  }, [flatNav]);

  const sidebarFlatItems = isMobileOrTablet
    ? flatNav.filter((item) => item.forMobile)
    : flatNav;

  const currentPage = useMemo(() => {
    const fromOps = getLabelForPath(location.pathname, operations, "");
    if (fromOps) return fromOps;
    const flatMatch = flatNav.find(
      (item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
    );
    if (flatMatch) return flatMatch.label;
    const adminMatch = adminGroup.children.find(
      (item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
    );
    if (adminMatch) return adminMatch.label;
    return "Home";
  }, [location.pathname, operations, flatNav, adminGroup.children]);

  useEffect(() => {
    document.title = currentPage ? `${currentPage} - eSource` : "eSource";
  }, [currentPage]);

  const logoSrc = getPublicAssetUrl("stslogo.png");

  return (
    <>
      <div className="app-shell">
        {/* ── Desktop top bar ── */}
        <header className="print-suppress esource-topbar">
          <Link className="esource-branding-link" to="/">
            <img alt="eSource logo" className="esource-branding-logo" src={logoSrc} />
            <BrandName as="h1" className="esource-branding-name" />
          </Link>
          <div className="esource-header-titleblock">
            <div className="esource-header-page-title">{currentPage}</div>
            <nav className="esource-header-breadcrumb" aria-label="Breadcrumb">
              <span className="esource-header-crumb">
                <Link className="esource-header-crumb-link" to="/">Home</Link>
              </span>
              <span className="esource-header-crumb-separator">›</span>
              <span className="esource-header-crumb">{currentPage}</span>
            </nav>
          </div>
          <div className="esource-header-actions">
            <div className="esource-header-rightstrip">
              <span className="esource-header-rightitem">
                <span className="esource-header-rightlabel">Project:</span>
                {showAuthProjectSelect ? (
                  <HeaderProjectSelect
                    projects={authProjectOptions}
                    activeProjectId={authProjectCode}
                    onChange={setProject}
                    disabled={switchingContext}
                  />
                ) : authProjectCode ? (
                  <span className="esource-header-rightvalue preserve-case">{authProjectCode}</span>
                ) : (
                  <span className="esource-header-rightvalue">—</span>
                )}
              </span>
              {showSiteInHeader ? (
                <>
                  <span className="esource-header-sep">|</span>
                  <span className="esource-header-rightitem">
                    <span className="esource-header-rightlabel">Site:</span>
                    <SiteDisplay
                      sites={sites}
                      activeSite={activeSite}
                      onChangeSite={setSite}
                      siteFromToken={user?.site}
                      className="esource-header-rightvalue"
                      disabled={switchingContext}
                    />
                  </span>
                </>
              ) : null}
              <span className="esource-header-sep">|</span>
              <span className="esource-header-rightitem esource-header-user-item">
                <span className="esource-header-rightlabel esource-header-rightlabel--name preserve-case">{displayName}</span>
              </span>
              <span className="esource-header-rightitem esource-header-user-item">
                <span className="esource-header-rightlabel">Logged In As</span>
                <span className="esource-header-rightvalue preserve-case">{profileLabel}</span>
              </span>
              <button type="button" className="LogoutButton esource-header-logout" title="LogOut" aria-label="LogOut" onClick={handleLogout}>
                <svg version="1.0" width="30px" height="30px" viewBox="0 0 580.000000 579.000000" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                  <g transform="translate(0.000000,579.000000) scale(0.100000,-0.100000)" fill="#BE0000" stroke="none">
                    <path d="M2680 5759 c-1376 -121 -2463 -1174 -2632 -2549 -16 -135 -16 -525 0 -660 67 -542 278 -1048 614 -1472 104 -132 324 -352 456 -456 391 -310 830 -505 1338 -594 117 -21 161 -23 464 -23 301 0 348 2 461 22 617 109 1150 382 1580 812 456 457 745 1047 824 1682 20 166 20 557 0 716 -101 784 -509 1486 -1133 1952 -406 304 -863 489 -1368 556 -146 19 -462 27 -604 14z m345 -803 c28 -12 65 -39 83 -60 66 -76 62 -9 62 -1094 0 -934 -1 -986 -18 -1026 -59 -133 -225 -189 -352 -120 -53 29 -82 60 -116 124 -18 33 -19 80 -22 999 -3 1078 -5 1034 66 1113 77 85 196 111 297 64z m-874 -670 c0 -158 -1 -289 -3 -290 -39 -23 -136 -108 -207 -181 -185 -192 -310 -434 -357 -695 -23 -127 -23 -353 0 -480 88 -489 443 -895 917 -1050 270 -88 579 -86 855 6 322 108 608 355 767 663 102 198 149 393 149 621 0 279 -73 523 -229 758 -66 100 -198 241 -294 314 l-69 53 0 288 0 288 23 -7 c43 -13 184 -94 282 -163 190 -132 354 -298 481 -487 327 -487 408 -1082 224 -1637 -180 -541 -608 -977 -1144 -1166 -479 -169 -988 -141 -1441 79 -704 342 -1123 1088 -1045 1861 64 631 428 1172 995 1476 44 23 84 42 88 40 5 -1 8 -132 8 -291z" />
                  </g>
                </svg>
              </button>
            </div>
          </div>
        </header>

        {/* ── Mobile top bar ── */}
        <header className="mobile-topbar" data-tour="mobile-topbar">
          <div className="mobile-topbar__left">
            <Link className="mobile-topbar__brandlink" to="/" aria-label="eSource home">
              <img alt="eSource logo" className="mobile-topbar__logo" src={logoSrc} />
            </Link>
            <h1 className="mobile-topbar__page-name preserve-case">{currentPage}</h1>
          </div>
          <div className="mobile-topbar__right">
            <div className="mobile-topbar__session">
              <div className="mobile-topbar__user-row">
                <span className="mobile-topbar__user-name preserve-case">{displayName}</span>
                <span className="mobile-topbar__login-sep">Logged In As</span>
                <span className="mobile-topbar__user-role preserve-case">{profileLabel}</span>
              </div>
              <div className="mobile-topbar__meta-row">
                <span className="mobile-topbar__meta-label">Project:</span>
                {showAuthProjectSelect ? (
                  <HeaderProjectSelect
                    projects={authProjectOptions}
                    activeProjectId={authProjectCode}
                    onChange={setProject}
                    disabled={switchingContext}
                  />
                ) : authProjectCode ? (
                  <span className="mobile-topbar__project-value preserve-case">{authProjectCode}</span>
                ) : (
                  <span className="mobile-topbar__project-value">—</span>
                )}
                {showSiteInHeader ? (
                  <>
                    <span className="mobile-topbar__sep">|</span>
                    <span className="mobile-topbar__meta-label">Site:</span>
                    <SiteDisplay
                      sites={sites}
                      activeSite={activeSite}
                      onChangeSite={setSite}
                      siteFromToken={user?.site}
                      className="mobile-topbar__site-value"
                      disabled={switchingContext}
                    />
                  </>
                ) : null}
              </div>
            </div>
            <button type="button" className="LogoutButton mobile-topbar__logout" title="LogOut" aria-label="LogOut" onClick={handleLogout}>
              <svg version="1.0" width="30px" height="30px" viewBox="0 0 580.000000 579.000000" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                <g transform="translate(0.000000,579.000000) scale(0.100000,-0.100000)" fill="#BE0000" stroke="none">
                  <path d="M2680 5759 c-1376 -121 -2463 -1174 -2632 -2549 -16 -135 -16 -525 0 -660 67 -542 278 -1048 614 -1472 104 -132 324 -352 456 -456 391 -310 830 -505 1338 -594 117 -21 161 -23 464 -23 301 0 348 2 461 22 617 109 1150 382 1580 812 456 457 745 1047 824 1682 20 166 20 557 0 716 -101 784 -509 1486 -1133 1952 -406 304 -863 489 -1368 556 -146 19 -462 27 -604 14z m345 -803 c28 -12 65 -39 83 -60 66 -76 62 -9 62 -1094 0 -934 -1 -986 -18 -1026 -59 -133 -225 -189 -352 -120 -53 29 -82 60 -116 124 -18 33 -19 80 -22 999 -3 1078 -5 1034 66 1113 77 85 196 111 297 64z m-874 -670 c0 -158 -1 -289 -3 -290 -39 -23 -136 -108 -207 -181 -185 -192 -310 -434 -357 -695 -23 -127 -23 -353 0 -480 88 -489 443 -895 917 -1050 270 -88 579 -86 855 6 322 108 608 355 767 663 102 198 149 393 149 621 0 279 -73 523 -229 758 -66 100 -198 241 -294 314 l-69 53 0 288 0 288 23 -7 c43 -13 184 -94 282 -163 190 -132 354 -298 481 -487 327 -487 408 -1082 224 -1637 -180 -541 -608 -977 -1144 -1166 -479 -169 -988 -141 -1441 79 -704 342 -1123 1088 -1045 1861 64 631 428 1172 995 1476 44 23 84 42 88 40 5 -1 8 -132 8 -291z" />
                </g>
              </svg>
            </button>
          </div>
        </header>

        <main className="main-content" data-tour="page-content">
          <Outlet />
        </main>

        {/* ── Mobile / tablet bottom nav — right-side circular scan control ── */}
        <nav
          className={`bottom-nav${scanNav?.available ? " bottom-nav--with-scan" : ""}`}
          aria-label="Primary navigation"
          data-tour="bottom-nav"
        >
          {mobileNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => `bottom-nav__link ${isActive ? "bottom-nav__link--active" : ""}`}
              data-tour={`nav-${String(item.to || "").replace(/^\//, "").replace(/\//g, "-") || "home"}`}
            >
              <span className="bottom-nav__icon"><NavMenuIcon to={item.to} icon={item.icon} /></span>
              <span className="bottom-nav__label">{item.shortLabel}</span>
            </NavLink>
          ))}
          {scanNav?.available ? (
            <div className="bottom-nav__scan" role="group" aria-label="Barcode scan">
              <button
                type="button"
                className="bottom-nav__scan-camera"
                onClick={() => scanNav.openCamera()}
                aria-label="Open camera scan"
                title="Open camera scan"
                data-tour="scan-camera"
              >
                <CameraNavIcon />
              </button>
              <button
                type="button"
                className={`bottom-nav__scan-toggle${scanNav.cardOpen ? " bottom-nav__scan-toggle--open" : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  scanNav.toggleCard();
                }}
                aria-label={scanNav.cardOpen ? "Close scan card" : "Open scan card"}
                aria-expanded={scanNav.cardOpen}
                title={scanNav.cardOpen ? "Close scan card" : "Open scan card"}
                data-tour="scan-toggle"
              >
                <ScanChevronIcon open={scanNav.cardOpen} />
              </button>
            </div>
          ) : null}
        </nav>
      </div>

      {/* ── Desktop sidebar ── */}
      <aside ref={sidebarRef} className="print-suppress esource-sidebar-menu">
        <nav className="esource-sidebar-menu-nav" aria-label="Workflow navigation">
          {/* Regular lab workflow items */}
          {sidebarFlatItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `esource-sidebar-menu-link ${isActive ? "esource-sidebar-menu-link-active" : "esource-sidebar-menu-link-inactive"}`
              }
            >
              <span className="esource-sidebar-menu-icon"><NavMenuIcon to={item.to} icon={item.icon} /></span>
              <span>{item.label}</span>
            </NavLink>
          ))}

          {/* Admin Configuration — only when user has rights to at least one child */}
          {!isMobileOrTablet && showAdminParent && !permissionsLoading && (
            <button
              type="button"
              className={`esource-sidebar-menu-link esource-sidebar-menu-btn ${
                adminChildActive ? "esource-sidebar-menu-link-active" : "esource-sidebar-menu-link-inactive"
              } ${adminOpen ? "esource-sidebar-menu-btn--open" : ""}`}
              onClick={() => setAdminOpen((open) => !open)}
              aria-expanded={adminOpen}
              aria-haspopup="true"
            >
              <span className="esource-sidebar-menu-icon">{adminGroup.icon}</span>
              <span>{adminGroup.label}</span>
            </button>
          )}
        </nav>
      </aside>

      {adminOpen && !isMobileOrTablet && showAdminParent && (
        <div ref={flyoutRef}>
          <AdminFlyoutPanel adminGroup={adminGroup} onClose={() => setAdminOpen(false)} />
        </div>
      )}

      <Footer />
    </>
  );
}

export { AppShell };
