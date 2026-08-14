import { jsx, jsxs } from "react/jsx-runtime";
import { formatTimepointWithDose } from "../../utils/visitDisplay";
import { StatusBadge } from "./StatusBadge";

function getAliquotStatus(aliquot) {
  if (aliquot.skippedAt) return "Skipped";
  if (aliquot.createdAt) return "Completed";
  return "Upcoming";
}

function formatSampleTraceLabel(sample, visits = []) {
  const visit = visits.find((v) => v.id === sample.visitId);
  const doseStr = sample.dose ?? (visit ? (visit.doseLabel ?? visit.dose ?? "") : "");
  const timepointDisplay = formatTimepointWithDose(sample.timepointLabel ?? sample.timepoint, doseStr);
  return `${timepointDisplay} (${sample.barcode})`;
}

function SampleTraceTree({
  samples,
  aliquots,
  visits = [],
  subjectId,
  visitId,
  timepoint,
  hideAliquoted = false,
  excludeBloodCollected = false,
  activeParentBarcode
}) {
  const filtered = samples.filter(
    (s) =>
      (!subjectId || s.subjectId === subjectId) &&
      (!visitId || s.visitId === visitId) &&
      (!timepoint || s.timepoint === timepoint) &&
      (!hideAliquoted || s.status !== "Aliquoted") &&
      (!excludeBloodCollected || (s.status !== "Collected" && s.status !== "Awaiting Centrifugation"))
  );
  const scopedAliquots = subjectId ? aliquots.filter((a) => a.subjectId === subjectId) : aliquots;
  if (filtered.length === 0) {
    return /* @__PURE__ */ jsx("p", { className: "empty-state", children: "No samples collected yet." });
  }
  return /* @__PURE__ */ jsx("div", { className: "trace-tree", children: filtered.map((sample) => {
    const children = scopedAliquots.filter((a) => a.parentSampleId === sample.id);
    const isOpen = activeParentBarcode ? sample.barcode === activeParentBarcode : false;
    return /* @__PURE__ */ jsxs("details", { className: "trace-tree__node", open: isOpen || undefined, children: [
      /* @__PURE__ */ jsxs("summary", {
        className: `trace-tree__parent ${isOpen ? "trace-tree__parent--active" : ""}`,
        children: [
          /* @__PURE__ */ jsx("strong", { children: formatSampleTraceLabel(sample, visits) }),
          /* @__PURE__ */ jsx(StatusBadge, { status: sample.status, kind: "sample" })
        ]
      }),
      children.length > 0 && /* @__PURE__ */ jsx("div", { className: "trace-tree__children", children: children.map((alq) => {
        const status = getAliquotStatus(alq);
        return /* @__PURE__ */ jsxs("div", { className: "trace-tree__child", children: [
          /* @__PURE__ */ jsx("span", { className: "trace-tree__branch", children: "\u2514" }),
          /* @__PURE__ */ jsxs("div", { className: "trace-tree__child-main", children: [
            /* @__PURE__ */ jsxs("div", { className: "trace-tree__child-line", children: [
              /* @__PURE__ */ jsx("strong", { children: alq.barcode }),
              /* @__PURE__ */ jsx(StatusBadge, { status }),
              alq.storageLocation && /* @__PURE__ */ jsx("span", { className: "trace-tree__loc", children: alq.storageLocation })
            ] }),
            status === "Skipped" && alq.skippedReason && /* @__PURE__ */ jsxs("small", { className: "trace-tree__reason", children: [
              "Skip Remark: ",
              alq.skippedReason
            ] })
          ] })
        ] }, alq.id);
      }) })
    ] }, sample.id);
  }) });
}
export {
  SampleTraceTree
};
