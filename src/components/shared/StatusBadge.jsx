import { jsx } from "react/jsx-runtime";
const activityColors = {
  Ready: "status--ready",
  Upcoming: "status--upcoming",
  Completed: "status--completed",
  Missed: "status--missed",
  Skipped: "status--skipped",
  Deviation: "status--deviation",
  Submitted: "status--submitted",
  Reviewed: "status--reviewed",
  Pending: "status--pending"
};
const subjectColors = {
  Ready: "status--upcoming",
  "In Progress": "status--ready",
  Completed: "status--completed"
};
const sampleColors = {
  Collected: "status--upcoming",
  "Awaiting Centrifugation": "status--upcoming",
  Centrifuging: "status--ready",
  "Ready For Aliquot": "status--ready",
  Aliquoted: "status--completed",
  Stored: "status--completed"
};
const statusLabels = {
  Upcoming: "Pending",
  Collected: "Blood Collected",
  "Awaiting Centrifugation": "Blood Collected",
  Centrifuging: "Centrifugation",
  "Ready For Aliquot": "Centrifugation",
  Stored: "Aliquoted"
};
function StatusBadge({
  status,
  kind = "activity"
}) {
  const map = kind === "subject" ? subjectColors : kind === "sample" ? sampleColors : activityColors;
  const cls = map[status] ?? "status--neutral";
  return /* @__PURE__ */ jsx("span", { className: `status-badge ${cls}`, children: statusLabels[status] ?? status });
}
export {
  StatusBadge
};
