let currentAuditActor = "";

/**
 * Keep in-memory audit stamps aligned with the logged-in user.
 * AuthContext updates this when the session user changes.
 */
export function setCurrentAuditActor(displayName) {
  currentAuditActor = String(displayName ?? "").trim();
}

export function getCurrentAuditActor() {
  return currentAuditActor || "System";
}

export function formatAuditPerformedBy(user) {
  if (!user || user === "-") return "-";
  return String(user);
}

export function formatAuthUserDisplayName(user) {
  if (!user) return "";
  const name = String(user.userName ?? "").trim();
  const login = String(user.email ?? user.loginId ?? user.userId ?? "").trim();
  const role = String(user.roleName ?? user.profileCode ?? "").trim();
  if (name && login && role) return `${name} (${login}) (${role})`;
  if (name && role) return `${name} (${role})`;
  if (name) return name;
  if (login) return login;
  return "";
}
