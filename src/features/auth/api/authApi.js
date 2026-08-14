import api from "@/shared/api/httpClient.js";

// ── Mobile login (native / Capacitor) ────────────────────────────────────
// Sends username+password; API returns a JWT stored in localStorage.

const mobileLoginConfig = {
  maxRedirects: 0,
};

function assertNoRedirect(res) {
  if (res.status >= 300 && res.status < 400) {
    throw new Error(
      "Login was redirected to Gateway SSO. This app uses username/password login only — do not use the WEB gateway flow here."
    );
  }
}

export async function mobileLogin(body) {
  const res = await api.post("/login/mobile", body, mobileLoginConfig);
  assertNoRedirect(res);
  return res.data.data ?? null;
}

export async function getMobileSites(username, projectCode = "") {
  const res = await api.post(
    "/login/mobile/sites",
    { username, projectCode: projectCode || undefined },
    mobileLoginConfig
  );
  assertNoRedirect(res);
  return res.data.data ?? [];
}

export async function getMobileProjects(username) {
  const res = await api.post("/login/mobile/projects", { username }, mobileLoginConfig);
  assertNoRedirect(res);
  return res.data.data ?? [];
}

// ── Shared (both native Bearer and web cookie) ────────────────────────────

export async function getMe() {
  const res = await api.get("/login/me");
  return res.data.data ?? null;
}

export async function logout() {
  const res = await api.post("/login/logout");
  return res.data;
}

/** Distinct project codes available to the current profile. */
export async function getMyProjects() {
  const res = await api.get("/login/my-projects");
  return res.data.data ?? [];
}

/**
 * Reissue the session JWT with a new project and/or site.
 * Web: auth cookie is updated by the API. Native: response includes `token`.
 */
export async function switchSessionContext(body) {
  const res = await api.post("/login/switch-context", body ?? {});
  return res.data.data ?? null;
}

// ── Web / Gateway SSO ─────────────────────────────────────────────────────
// Used when Application is deployed as a web site (not a native app).
// The gateway authenticates, then POSTs back to ApplicationAPI /login/gatewaylogin,
// which sets an HTTP-only cookie and redirects to this app's URL.

export async function getGatewayLoginUrl() {
  const res = await api.get("/login/gatewayloginurl");
  return res.data.data ?? null;
}

/**
 * Returns all active sites for the currently authenticated SiteUser.
 * Returns an empty array for project-wide users.
 */
export async function getMyGatewaySites() {
  const res = await api.get("/login/my-sites");
  return res.data.data ?? [];
}

/** Clears auth cookie without requiring a valid session (used on 401 in web mode). */
export async function logoutBrowser() {
  try {
    await api.post("/login/logout-browser");
  } catch {
    // Session may already be invalid; ignore.
  }
}

export async function validatePassword(password) {
  const res = await api.post("/login/validate-password", { password: password ?? "" });
  const result = res.data?.data ?? {};
  return {
    isValid: result.isValid ?? result.IsValid ?? false,
    message: result.message ?? result.Message ?? "",
  };
}
