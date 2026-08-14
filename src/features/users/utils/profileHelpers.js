const DEFAULT_ROLE_CODE_WIDTH = 3;

function parseNumericRoleCode(value) {
  const trimmed = String(value ?? "").trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return {
    numeric: Number.parseInt(trimmed, 10),
    width: trimmed.length,
  };
}

export function getNextRoleCode(profiles = []) {
  let maxNumeric = 0;
  let width = DEFAULT_ROLE_CODE_WIDTH;

  for (const profile of profiles) {
    const parsed = parseNumericRoleCode(profile?.vRole);
    if (!parsed) continue;
    maxNumeric = Math.max(maxNumeric, parsed.numeric);
    width = Math.max(width, parsed.width);
  }

  return String(maxNumeric + 1).padStart(width, "0");
}
