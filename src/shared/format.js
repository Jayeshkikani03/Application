/** App-standard calendar date: `dd-MMM-yyyy` (e.g. `02-Feb-2005`). */
export function formatDate(dateStr) {
  if (dateStr == null || dateStr === "") return "—";
  const d = dateStr instanceof Date ? dateStr : new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "—";
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hourCycle: "h23",
    }).formatToParts(d);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).formatToParts(d);
  }
  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const { day, month, year } = map;
  if (!day || !month || !year) return "—";
  return `${day}-${month}-${year}`;
}
