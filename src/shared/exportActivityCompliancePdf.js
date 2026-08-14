import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  activityHasCrf,
  getCrfActiveFieldItems,
  getCrfDefinitionForActivity,
  resolveCrfSavedValues,
} from "../services/crfService.js";
import {
  formatDisplayDateTime,
  formatDisplayTime,
  formatWindow,
  resolveActivitySample,
} from "../services/workflowService.js";
import {
  formatActivityTimepointLabel,
} from "../utils/visitDisplay.js";
import { formatDate } from "./format.js";
import { downloadOrShareFile } from "./nativeFileDownload.js";

const EMPTY = "";
const PLACEHOLDER_RE = /^[\s\u2014\-–—]*$/;

function blank(value) {
  const text = value == null ? "" : String(value).trim();
  if (!text || PLACEHOLDER_RE.test(text)) return EMPTY;
  return text;
}

function formatBarcode(activity) {
  return blank(activity?.barcode);
}

function resolveScheduledDisplay(activity, visits) {
  if (activity?.scheduledTime) return activity.scheduledTime;
  if (activity?.activity === "Pre-Dose Blood Collection") return null;
  const visit = visits?.find((item) => item.id === activity?.visitId);
  if (!visit?.doseScheduleConfirmed) return activity?.scheduledTime ?? null;
  return activity?.scheduledTime ?? visit?.plannedDoseTime ?? null;
}

function formatActivityDate(activity, visits) {
  const iso = activity?.actualTime || activity?.scheduledTime || resolveScheduledDisplay(activity, visits);
  if (!iso) return EMPTY;
  return blank(formatDate(iso));
}

function formatScheduled(activity, visits) {
  if (activity?.activity === "Pre-Dose Blood Collection") return EMPTY;
  const iso = resolveScheduledDisplay(activity, visits);
  return iso ? blank(formatDisplayDateTime(iso)) : EMPTY;
}

function formatWindowPeriod(activity) {
  if (activity?.activity === "Pre-Dose Blood Collection") return EMPTY;
  return blank(formatWindow(activity?.windowStart, activity?.windowEnd));
}

function formatActual(activity) {
  return activity?.actualTime ? blank(formatDisplayTime(activity.actualTime)) : EMPTY;
}

function resolveRecordedCentrifugeStart(activity, sample) {
  return sample?.centrifugationStart
    ?? sample?.scanStartTime
    ?? activity?.scanStartTime
    ?? null;
}

function resolveRecordedCentrifugeEnd(activity, sample) {
  // Use only recorded end — do not invent from start + duration for the report.
  return sample?.centrifugationEnd
    ?? sample?.scanEndTime
    ?? activity?.scanEndTime
    ?? null;
}

function formatCentrifugation(activity, sample) {
  const startRaw = resolveRecordedCentrifugeStart(activity, sample);
  const endRaw = resolveRecordedCentrifugeEnd(activity, sample);
  const start = startRaw ? blank(formatDisplayTime(startRaw)) : EMPTY;
  const end = endRaw ? blank(formatDisplayTime(endRaw)) : EMPTY;
  if (!start && !end) return EMPTY;
  const lines = [];
  if (start) lines.push(`Start: ${start}`);
  if (end) lines.push(`End: ${end}`);
  return lines.join("\n");
}

function hasProtocolDeviation(activity) {
  return !!(activity?.deviation || activity?.status === "Deviation");
}

function isActivityRecordDone(activity) {
  if (activity?.actualTime) return true;
  const status = String(activity?.status ?? "").trim();
  return ["Completed", "Deviation", "Skipped"].includes(status);
}

function formatProtocolDeviation(activity) {
  // Only show Yes/No once the timepoint record is done; otherwise leave blank.
  if (!isActivityRecordDone(activity)) return EMPTY;
  return hasProtocolDeviation(activity) ? "Yes" : "No";
}

function formatRemark(activity) {
  return blank(activity?.remarks);
}

function resolveAliquotCount(activity, sample, aliquots) {
  const expectedFromLists =
    (Array.isArray(sample?.expectedAliquotBarcodes) && sample.expectedAliquotBarcodes.length) ||
    (Array.isArray(activity?.expectedAliquotBarcodes) && activity.expectedAliquotBarcodes.length) ||
    0;
  const expectedConfigured = Number(activity?.expectedAliquots) || 0;
  const expected = expectedFromLists || expectedConfigured;

  const parentId = sample?.id;
  const completed = parentId
    ? (aliquots ?? []).filter(
        (aliquot) =>
          aliquot.parentSampleId === parentId && (aliquot.createdAt || aliquot.skippedAt)
      ).length
    : 0;

  // Only show aliquot count when at least one aliquot is linked/skipped (work done).
  if (completed === 0) return EMPTY;
  return `${completed}/${expected || completed}`;
}

function formatTimepointCell(activity) {
  const raw =
    activity?.timepointLabel
    || activity?.timepoint
    || formatActivityTimepointLabel(activity)
    || "";
  const text = String(raw ?? "").trim();
  // Keep backend label as-is (including dose in the name). Do not strip.
  return blank(text === "-" ? "" : text);
}

/**
 * Collect CRF field columns only when at least one activity has an attached CRF.
 * Union of fields across per-activity definitions (pinned versions), plus any
 * retired field ids that still have saved values on export rows.
 * @returns {{ id: string, label: string }[]}
 */
export function collectCrfColumns(activities = []) {
  const list = activities ?? [];
  const withCrf = list.filter((activity) => activityHasCrf(activity));
  if (!withCrf.length) return [];

  const columns = [];
  const seen = new Set();

  for (const activity of withCrf) {
    const definition = getCrfDefinitionForActivity(activity);
    for (const item of getCrfActiveFieldItems(definition)) {
      const field = item.field;
      if (!field?.id || seen.has(field.id)) continue;
      seen.add(field.id);
      columns.push({
        id: field.id,
        label: String(field.label ?? field.id).trim() || field.id,
      });
    }
  }

  // Include retired/removed fields that still have stored answers.
  for (const activity of list) {
    const values = activity?.crfValues && typeof activity.crfValues === "object"
      ? activity.crfValues
      : null;
    if (!values) continue;
    for (const [fieldId, raw] of Object.entries(values)) {
      const id = String(fieldId ?? "").trim();
      if (!id || seen.has(id)) continue;
      if (raw === undefined || raw === null || String(raw).trim() === "") continue;
      seen.add(id);
      columns.push({ id, label: id });
    }
  }

  return columns;
}

function buildFixedHeaders(mode, variant = "pk") {
  // IMP (dose): Date, Timepoint, Actual Time, Remark (+ CRF). No Protocol Deviation.
  if (variant === "imp") {
    return [
      "Date",
      "Timepoint",
      "Actual Time",
      "Remark",
    ];
  }

  // Short headers so autoTable does not split words mid-name in narrow cells.
  return [
    "Date",
    "Timepoint",
    "Barcode",
    "Scheduled",
    "Window",
    "Actual",
    "Aliquots",
    "Centrifuge Start/End",
    "Deviation*",
    "Remark",
  ];
}

function buildFixedRow(activity, { visits, samples, aliquots, mode, variant = "pk" }) {
  const sample = resolveActivitySample(samples, activity);

  if (variant === "imp") {
    return [
      formatActivityDate(activity, visits),
      formatTimepointCell(activity),
      formatActual(activity),
      formatRemark(activity),
    ];
  }

  return [
    formatActivityDate(activity, visits),
    formatTimepointCell(activity),
    formatBarcode(activity),
    formatScheduled(activity, visits),
    formatWindowPeriod(activity),
    formatActual(activity),
    resolveAliquotCount(activity, sample, aliquots),
    formatCentrifugation(activity, sample),
    formatProtocolDeviation(activity),
    formatRemark(activity),
  ];
}

function buildCrfCellValues(activity, crfColumns) {
  if (!crfColumns.length) return [];
  if (!activityHasCrf(activity) && !(activity?.crfValues && Object.keys(activity.crfValues).length)) {
    return crfColumns.map(() => EMPTY);
  }
  const definition = getCrfDefinitionForActivity(activity);
  const values = definition
    ? resolveCrfSavedValues(activity, definition)
    : (activity?.crfValues && typeof activity.crfValues === "object" ? activity.crfValues : {});
  return crfColumns.map((col) => {
    const raw = values[col.id] ?? activity?.crfValues?.[col.id];
    if (raw === undefined || raw === null || String(raw).trim() === "") return EMPTY;
    return String(raw);
  });
}

/** Wrap at word boundaries only — never cut a word mid-name. */
function wrapHeaderLabel(label, maxChars = 18) {
  const text = String(label ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;

  const words = text.split(" ");
  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (!current) {
      // Keep whole word even if longer than maxChars (avoid "Centrifugat" / "ion").
      current = word;
      continue;
    }
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

/** Fit every column on one landscape page width (no horizontal split). */
function buildFittedColumnStyles(columnCount, usableWidth, mode, variant = "pk") {
  // IMP table: few fixed cols + wide CRF cols so long labels read normally.
  if (variant === "imp") {
    const fixedBase = [85, 130, 75, 120];
    const fixedCount = Math.min(fixedBase.length, columnCount);
    const fixedSum = fixedBase.slice(0, fixedCount).reduce((sum, w) => sum + w, 0);
    const crfCount = Math.max(0, columnCount - fixedCount);
    const leftover = Math.max(140, usableWidth - fixedSum);
    const crfWidth = crfCount > 0 ? leftover / crfCount : 0;

    const styles = {};
    for (let i = 0; i < columnCount; i += 1) {
      const isCrf = i >= fixedCount;
      styles[i] = {
        cellWidth: isCrf ? Math.max(120, crfWidth) : fixedBase[i],
        overflow: "linebreak",
        valign: "top",
        halign: isCrf ? "left" : "center",
      };
    }
    return styles;
  }

  // PK/Sample table: give barcode / centrifuge / CRF more room for full header words.
  const weights = [1.0, 1.55, 1.15, 1.05, 0.95, 0.85, 0.9, 1.35, 0.95, 1.0];
  while (weights.length < columnCount) {
    weights.push(1.25);
  }

  const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;
  const styles = {};
  for (let i = 0; i < columnCount; i += 1) {
    styles[i] = {
      cellWidth: Math.max(32, (weights[i] / totalWeight) * usableWidth),
      overflow: "linebreak",
      valign: "top",
      halign: "left",
    };
  }
  return styles;
}

function isImpDoseActivity(activity) {
  return String(activity?.activity ?? "").trim() === "IMP Dose Administration";
}

function doseSortKey(activity) {
  const fromDose = String(activity?.dose ?? activity?.doseLabel ?? "").match(/\d+/);
  if (fromDose) return Number(fromDose[0]) || 0;
  const fromTp = String(activity?.timepointLabel ?? activity?.timepoint ?? "").match(/\bDose[-\s]*(\d+)\b/i);
  return fromTp ? Number(fromTp[1]) || 0 : 0;
}

function sortActivitiesForExport(list) {
  return [...(list ?? [])].sort((a, b) => {
    const doseDiff = doseSortKey(a) - doseSortKey(b);
    if (doseDiff !== 0) return doseDiff;
    const orderDiff = (Number(a.order) || Number(a.timepointOrder) || 0) - (Number(b.order) || Number(b.timepointOrder) || 0);
    if (orderDiff !== 0) return orderDiff;
    return String(a.timepointLabel ?? a.timepoint ?? "").localeCompare(
      String(b.timepointLabel ?? b.timepoint ?? ""),
      undefined,
      { numeric: true, sensitivity: "base" }
    );
  });
}

function splitImpAndPkActivities(activities) {
  const sorted = sortActivitiesForExport(activities);
  const imp = sorted.filter(isImpDoseActivity);
  const pk = sorted.filter((activity) => !isImpDoseActivity(activity));
  return { imp, pk };
}

function buildSectionTableModel(sectionActivities, { visits, samples, aliquots, mode, variant = "pk" }) {
  const crfColumns = collectCrfColumns(sectionActivities);
  const headRaw = [
    ...buildFixedHeaders(mode, variant),
    ...crfColumns.map((c) => c.label),
  ];
  // Wrap only at spaces; IMP CRF headers get more chars per line (wide columns).
  const wrapChars = variant === "imp" ? 36 : 14;
  const head = headRaw.map((label) => wrapHeaderLabel(label, wrapChars));
  const body = sectionActivities.map((activity) => [
    ...buildFixedRow(activity, { visits, samples, aliquots, mode, variant }),
    ...buildCrfCellValues(activity, crfColumns),
  ]);
  return { head, body, colCount: head.length, variant };
}

function drawSectionTable(doc, {
  startY,
  sectionTitle,
  head,
  body,
  mode,
  variant = "pk",
  usableWidth,
  marginX,
  pageWidth,
  footerDateTime,
}) {
  let y = startY;
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomLimit = pageHeight - 48;

  if (y > bottomLimit - 40) {
    doc.addPage();
    y = 28;
  }

  doc.setFont("times", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text(sectionTitle, marginX, y);
  y += 8;

  const bodyFontSize = variant === "imp"
    ? 9
    : head.length > 14 ? 7 : head.length > 11 ? 7.5 : 8;
  const headFontSize = variant === "imp" ? 9 : Math.max(7, bodyFontSize);

  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    theme: "grid",
    tableWidth: usableWidth,
    horizontalPageBreak: false,
    rowPageBreak: "auto",
    showHead: "everyPage",
    styles: {
      font: "times",
      fontSize: bodyFontSize,
      cellPadding: variant === "imp" ? 4 : 2.5,
      valign: "top",
      overflow: "linebreak",
      lineColor: [40, 40, 40],
      lineWidth: 0.35,
      textColor: [0, 0, 0],
      minCellHeight: variant === "imp" ? 18 : 14,
    },
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: [0, 0, 0],
      font: "times",
      fontStyle: "bold",
      fontSize: headFontSize,
      halign: variant === "imp" ? "left" : "center",
      valign: "middle",
      overflow: "linebreak",
      minCellHeight: variant === "imp" ? 28 : 24,
      cellPadding: variant === "imp" ? 4 : 2.5,
    },
    columnStyles: buildFittedColumnStyles(head.length, usableWidth, mode, variant),
    margin: { left: marginX, right: marginX, top: 20, bottom: 40 },
    didDrawPage: (data) => {
      const page = data.pageNumber;
      const footerY = pageHeight - 16;
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.5);
      doc.line(marginX, footerY - 10, pageWidth - marginX, footerY - 10);
      doc.setFont("times", "normal");
      doc.setFontSize(9);
      doc.setTextColor(0, 0, 0);
      doc.text(footerDateTime, marginX, footerY);
      doc.text("Confidential", pageWidth / 2, footerY, { align: "center" });
      doc.text(`Page ${page}`, pageWidth - marginX, footerY, { align: "right" });
    },
  });

  return doc.lastAutoTable?.finalY ?? y;
}

function formatPeriodDisplay(periodOrVisit) {
  // Use saved period name as-is from DB/schedule (e.g. "1", "2") — do not prefix "Period ".
  const label = blank(
    periodOrVisit?.periodLabel
    || periodOrVisit?.periodCode
    || periodOrVisit?.code
  );
  if (label) return label;

  // Schedule period rows use `label` for the period name.
  const scheduleLabel = blank(periodOrVisit?.label);
  if (
    scheduleLabel
    && (
      /^\d+$/.test(scheduleLabel)
      || /period/i.test(scheduleLabel)
      || periodOrVisit?.doses
      || periodOrVisit?.period != null
    )
  ) {
    return scheduleLabel;
  }

  const num = Number(periodOrVisit?.period);
  if (Number.isFinite(num) && num > 0) return String(num);
  return EMPTY;
}

function resolveActivityNameFromTp(tp) {
  const type = String(tp?.activity ?? tp?.activityType ?? "").trim();
  if (type) return type;
  const label = String(tp?.label ?? "");
  if (/pre-dose/i.test(label)) return "Pre-Dose Blood Collection";
  if (/imp dose/i.test(label)) return "IMP Dose Administration";
  return "Post-Dose Blood Collection";
}

/**
 * Build full-schedule export rows (all periods / doses / timepoints), overlaying
 * any recorded activity data. PRMS-locked doses are included as blank rows.
 */
export function expandExportDatasetFromSchedule({
  subject = null,
  periods = [],
  existingActivities = [],
  existingVisits = [],
} = {}) {
  const periodList = Array.isArray(periods) ? periods.filter(Boolean) : [];
  if (!periodList.length) {
    return {
      activities: [...(existingActivities ?? [])],
      visits: [...(existingVisits ?? [])],
    };
  }

  const subjectId = subject?.id ?? existingActivities[0]?.subjectId ?? null;
  const subjectMstNo = subject?.subjectMstNo ?? existingActivities[0]?.subjectMstNo ?? null;
  const subjectNumber =
    blank(subject?.subjectNumber)
    || blank(existingActivities[0]?.subjectNumber)
    || "";
  const projectId = subject?.projectId ?? existingActivities[0]?.projectId ?? null;

  const byTpNo = new Map();
  for (const activity of existingActivities ?? []) {
    const tpNo = Number(activity?.activityConfigTimePointNo) || 0;
    if (tpNo > 0) byTpNo.set(tpNo, activity);
  }

  const visitByDoseNo = new Map();
  for (const visit of existingVisits ?? []) {
    const doseNo = Number(visit?.activityConfigDoseNo) || 0;
    if (doseNo > 0) visitByDoseNo.set(doseNo, visit);
  }

  const visits = [];
  const activities = [];
  const usedTpNos = new Set();

  const sortedPeriods = [...periodList].sort(
    (a, b) => (Number(a.period) || 0) - (Number(b.period) || 0)
  );

  for (const period of sortedPeriods) {
    const periodNum = Number(period.period) || 0;
    const periodCode = blank(period.code) || String(periodNum).padStart(2, "0");
    const periodLabel = formatPeriodDisplay({
      periodLabel: period.label,
      periodCode: period.code,
      period: periodNum,
    }) || (periodNum ? String(periodNum) : "");

    const doses = [...(period.doses ?? [])].sort(
      (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)
    );

    for (const dose of doses) {
      const doseNo = Number(dose.activityConfigDoseNo) || 0;
      const doseLabel = blank(dose.label) || (doseNo ? `Dose ${doseNo}` : "");
      const existingVisit = doseNo ? visitByDoseNo.get(doseNo) : null;
      const visitId =
        existingVisit?.id
        ?? `export-visit-${subjectId || "sub"}-${doseNo || doseLabel || visits.length + 1}`;

      const visit = {
        ...(existingVisit ?? {}),
        id: visitId,
        subjectId: subjectId ?? existingVisit?.subjectId,
        doseLabel: blank(existingVisit?.doseLabel) || doseLabel,
        label:
          blank(existingVisit?.label)
          || blank(dose.studyVisitLabel)
          || doseLabel,
        studyVisitLabel:
          blank(existingVisit?.studyVisitLabel)
          || blank(dose.studyVisitLabel)
          || "",
        periodLabel,
        periodCode,
        period: periodNum,
        activityConfigDoseNo: doseNo || existingVisit?.activityConfigDoseNo,
        studyVisitScheduleNo:
          Number(existingVisit?.studyVisitScheduleNo)
          || Number(dose.studyVisitScheduleNo)
          || 0,
        projectId: projectId ?? existingVisit?.projectId,
      };
      visits.push(visit);

      const timepoints = [...(dose.timepoints ?? [])].sort(
        (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)
      );

      for (const tp of timepoints) {
        const tpNo = Number(tp.activityConfigTimePointNo) || 0;
        const activityName = resolveActivityNameFromTp(tp);
        const imp = activityName === "IMP Dose Administration";
        const timepointLabel = blank(tp.label) || (imp ? doseLabel : "");
        const existing = tpNo ? byTpNo.get(tpNo) : null;
        if (tpNo) usedTpNos.add(tpNo);

        const shell = {
          id: existing?.id ?? `export-act-${subjectId || "sub"}-${tpNo || activities.length + 1}`,
          subjectId: subjectId ?? existing?.subjectId,
          subjectMstNo: subjectMstNo ?? existing?.subjectMstNo,
          visitId,
          projectId: projectId ?? existing?.projectId,
          subjectNumber: subjectNumber || existing?.subjectNumber || "",
          visitLabel: visit.label || doseLabel,
          dose: doseLabel,
          timepoint: timepointLabel,
          timepointLabel,
          activity: activityName,
          executionMethod: imp ? "manual" : "pkBarcode",
          scheduledTime: null,
          windowStart: null,
          windowEnd: null,
          actualTime: null,
          status: "Upcoming",
          barcode: imp ? null : (blank(tp.pkBarcode) || null),
          sampleId: null,
          pkOffsetMinutes: imp ? null : (tp.offset ?? tp.offsetMinutes ?? 0),
          timepointOrder: Number(tp.order) || 0,
          expectedAliquots: imp
            ? 0
            : ((tp.aliquotBarcodes ?? []).length || Number(existing?.expectedAliquots) || 0),
          expectedAliquotBarcodes: imp ? [] : [...(tp.aliquotBarcodes ?? [])],
          activityConfigTimePointNo: tpNo || existing?.activityConfigTimePointNo,
          activityConfigDoseNo: doseNo || existing?.activityConfigDoseNo,
          periodLabel,
          periodCode,
          period: periodNum,
        };

        if (existing) {
          activities.push({
            ...shell,
            ...existing,
            visitId,
            dose: blank(existing.dose) || doseLabel,
            timepoint: blank(existing.timepoint) || timepointLabel,
            timepointLabel: blank(existing.timepointLabel) || timepointLabel,
            activity: blank(existing.activity) || activityName,
            periodLabel,
            periodCode,
            period: periodNum,
            activityConfigTimePointNo: tpNo || existing.activityConfigTimePointNo,
            activityConfigDoseNo: doseNo || existing.activityConfigDoseNo,
          });
        } else {
          activities.push(shell);
        }
      }
    }
  }

  // Keep any recorded rows that are not on the published schedule (rare).
  for (const activity of existingActivities ?? []) {
    const tpNo = Number(activity?.activityConfigTimePointNo) || 0;
    if (tpNo && usedTpNos.has(tpNo)) continue;
    if (!tpNo && activities.some((row) => row.id === activity.id)) continue;
    activities.push(activity);
  }

  return { activities, visits };
}

function resolvePeriodMeta(activity, visits) {
  const visit = (visits ?? []).find(
    (item) =>
      String(item.id ?? "") === String(activity?.visitId ?? "")
      || (
        activity?.activityConfigDoseNo
        && Number(item.activityConfigDoseNo) === Number(activity.activityConfigDoseNo)
      )
  );
  const periodNum =
    Number(activity?.period)
    || Number(visit?.period)
    || Number(String(activity?.periodCode ?? visit?.periodCode ?? "").replace(/\D/g, ""))
    || 0;
  const periodLabel =
    formatPeriodDisplay(activity)
    || formatPeriodDisplay(visit)
    || (periodNum ? String(periodNum) : "");
  const sortKey = periodNum || periodLabel.toLowerCase();
  return { periodLabel: periodLabel || "—", sortKey, periodNum };
}

function groupActivitiesByPeriod(activities, visits) {
  const groups = new Map();
  for (const activity of activities ?? []) {
    const meta = resolvePeriodMeta(activity, visits);
    const key = `${meta.periodNum || 0}::${meta.periodLabel.toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, {
        periodLabel: meta.periodLabel,
        periodNum: meta.periodNum,
        sortKey: meta.sortKey,
        activities: [],
      });
    }
    groups.get(key).activities.push(activity);
  }

  return [...groups.values()].sort((a, b) => {
    const numDiff = (a.periodNum || 0) - (b.periodNum || 0);
    if (numDiff !== 0) return numDiff;
    return String(a.periodLabel).localeCompare(String(b.periodLabel), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function drawPeriodHeader(doc, {
  title,
  projectText,
  siteText,
  participantText,
  periodText,
  marginX,
  usableWidth,
  pageWidth,
}) {
  doc.setFont("times", "bold");
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.text(title, pageWidth / 2, 26, { align: "center" });

  autoTable(doc, {
    startY: 34,
    body: [[
      `Project: ${projectText}`,
      `Site: ${siteText}`,
      `Participant: ${participantText}`,
      `Period: ${periodText}`,
    ]],
    theme: "grid",
    styles: {
      font: "times",
      fontSize: 10,
      cellPadding: 5,
      valign: "middle",
      overflow: "linebreak",
      lineColor: [0, 0, 0],
      lineWidth: 0.5,
      textColor: [0, 0, 0],
    },
    margin: { left: marginX, right: marginX },
    tableWidth: usableWidth,
  });

  return (doc.lastAutoTable?.finalY ?? 56) + 12;
}

/**
 * @param {object} args
 * @param {object} args.meta
 * @param {object[]} args.activities
 * @param {object[]} [args.visits]
 * @param {object[]} [args.samples]
 * @param {object[]} [args.aliquots]
 * @param {"execution"|"review"} [args.mode]
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export async function exportActivityCompliancePdf({
  meta = {},
  activities = [],
  visits = [],
  samples = [],
  aliquots = [],
  mode = "execution",
} = {}) {
  const list = Array.isArray(activities) ? activities.filter(Boolean) : [];
  if (!list.length) {
    return { ok: false, message: "No activities available to export." };
  }

  const periodGroups = groupActivitiesByPeriod(list, visits);
  if (!periodGroups.length) {
    return { ok: false, message: "No activities available to export." };
  }

  const title = "SAMPLE COLLECTION RECORD";
  const generatedAt = new Date();
  const footerDate = formatDate(generatedAt);
  const footerTime = generatedAt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const footerDateTime = `DateTime: ${footerDate} ${footerTime}`;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;
  const usableWidth = pageWidth - marginX * 2;

  const projectText = blank(meta.project);
  const siteText = blank(meta.site);
  const participantText = blank(meta.participant);

  for (let periodIndex = 0; periodIndex < periodGroups.length; periodIndex += 1) {
    const group = periodGroups[periodIndex];
    if (periodIndex > 0) {
      doc.addPage();
    }

    let nextY = drawPeriodHeader(doc, {
      title,
      projectText,
      siteText,
      participantText,
      periodText: group.periodLabel,
      marginX,
      usableWidth,
      pageWidth,
    });

    const { imp, pk } = splitImpAndPkActivities(group.activities);
    const sections = [];
    if (imp.length) {
      sections.push({
        title: "1. IMP Dose Administration",
        ...buildSectionTableModel(imp, { visits, samples, aliquots, mode, variant: "imp" }),
      });
    }
    if (pk.length) {
      sections.push({
        title: "2. Sample Collection",
        ...buildSectionTableModel(pk, { visits, samples, aliquots, mode, variant: "pk" }),
      });
    }

    for (const section of sections) {
      nextY = drawSectionTable(doc, {
        startY: nextY + 6,
        sectionTitle: section.title,
        head: section.head,
        body: section.body,
        mode,
        variant: section.variant || "pk",
        usableWidth,
        marginX,
        pageWidth,
        footerDateTime,
      }) + 14;
    }
  }

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    const pageHeight = doc.internal.pageSize.getHeight();
    const footerY = pageHeight - 16;
    doc.setFillColor(255, 255, 255);
    doc.rect(pageWidth - marginX - 100, footerY - 9, 100, 12, "F");
    doc.setFont("times", "normal");
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(`Page ${page} of ${totalPages}`, pageWidth - marginX, footerY, {
      align: "right",
    });
  }

  const participantSlug = String(meta.participant ?? "export")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "export";
  const stamp = generatedAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "");
  const prefix = mode === "review" ? "eSource_SampleCollection_Review" : "eSource_SampleCollection";
  const fileName = `${prefix}_${participantSlug}_${stamp}.pdf`;
  // jsPDF doc.save() uses <a download>, which Android WebView ignores — use native save.
  const base64Data = String(doc.output("datauristring") || "").split(",")[1] || "";
  if (!base64Data) {
    return { ok: false, message: "Failed to generate PDF data." };
  }

  const saved = await downloadOrShareFile({
    fileName,
    mimeType: "application/pdf",
    base64Data,
  });
  if (!saved.ok) {
    return { ok: false, message: saved.message || "Failed to export PDF." };
  }

  return {
    ok: true,
    message: saved.message || `PDF exported: ${fileName}`,
    saved: Boolean(saved.saved),
    shared: Boolean(saved.shared),
  };
}
