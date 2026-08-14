export function renderAdminStatusBadge(isActive) {
  return (
    <span className={`status-badge status-badge--compact ${isActive ? "status--completed" : "status--inactive"}`}>
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}
