import { jsx, jsxs } from "react/jsx-runtime";
import { Fragment, useEffect, useMemo, useState } from "react";
import { formatDisplayTime, formatWindow, resolveActivitySample, resolveCentrifugeEndTime, resolveCentrifugeStartTime } from "../../services/workflowService";
import { getCrfDefinitionForActivity, activityHasCrf, getCrfActiveFieldItems, resolveCrfSavedValues, isActivityReadyForCrf } from "../../services/crfService";
import { formatActivityTimepointLabel, formatDoseDisplayLabel } from "../../utils/visitDisplay";
import {
  getReviewQueryStatus,
  hasOpenReviewQuery,
  isActiveReviewQuery,
  getActiveReviewQueryRemarkText,
  getReviewQueryStageBtnClass,
  getReviewQueryStageCellClass,
  getReviewQueryStageCrfBtnClass,
  getReviewQueryStageForField,
  formatReviewQueryStageLabel,
  matchesReviewQueryField,
  getReviewQueries,
  activityHasRaisedReviewQuery
} from "../../services/reviewQueryService";
import { ScrollableSelect } from "./ScrollableSelect";
import { useViewport } from "../../hooks/useViewport";
import { QueueSampleRow } from "./QueueSampleRow";
import { isExecutionReviewLocked } from "../../features/activityExecution/utils/hdrStatus.js";
import {
  isActivityRemarkableStatus,
  isActivitySkippableStatus,
} from "../../shared/domain/activityStatuses.js";

function isCrfReviewQueryField(fieldKey) {
  return String(fieldKey ?? "").startsWith("crf:");
}

function resolveActivityCrfQueryFieldKey(activity) {
  if (isCrfReviewQueryField(activity?.reviewQueryFieldKey)) {
    return activity.reviewQueryFieldKey;
  }
  const fromQueries = getReviewQueries(activity).find((query) => isCrfReviewQueryField(query.fieldKey));
  if (fromQueries?.fieldKey) return fromQueries.fieldKey;
  if (!activityHasCrf(activity)) return null;
  const definition = getCrfDefinitionForActivity(activity);
  const firstField = getCrfActiveFieldItems(definition)[0]?.field;
  return firstField ? `crf:${firstField.id}` : null;
}

function resolveViewCrfQueryFieldKey(activity) {
  if (isCrfReviewQueryField(activity?.reviewQueryFieldKey)) {
    return activity.reviewQueryFieldKey;
  }
  const fromQueries = getReviewQueries(activity).find((query) => isCrfReviewQueryField(query.fieldKey));
  return fromQueries?.fieldKey ?? null;
}

function methodLabel(activity) {
  return ["pkBarcode", "scan", "aliquotBarcode", "locationBarcode"].includes(activity.executionMethod)
    ? "Scan"
    : "Manual";
}
function ReviewStatus({ activity }) {
  const hasDeviation = !!activity.deviation || activity.status === "Deviation";
  const isSkipped = String(activity.status ?? "").trim() === "Skipped";
  const deviationBadge = hasDeviation
    ? /* @__PURE__ */ jsx("span", { className: "status-badge status--deviation", children: "Deviation" })
    : null;
  const skippedBadge = isSkipped
    ? /* @__PURE__ */ jsx("span", { className: "status-badge status--skipped", children: "Skipped" })
    : null;

  if (activity.reviewStatus === "Reviewed") {
    return /* @__PURE__ */ jsxs("span", {
      className: "activity-grid__status-stack", children: [
        /* @__PURE__ */ jsx("span", { className: "status-badge status--completed", children: "Reviewed" }),
        skippedBadge,
        deviationBadge
      ]
    });
  }
  if (activity.reviewStatus === "Submitted" || activity.reviewStatus === "Pending Review") {
    return /* @__PURE__ */ jsxs("span", {
      className: "activity-grid__status-stack", children: [
        /* @__PURE__ */ jsx("span", { className: "status-badge status--ready", children: "Submitted" }),
        skippedBadge,
        deviationBadge
      ]
    });
  }
  return /* @__PURE__ */ jsx(GridStatus, { activity });
}
function GridStatus({ activity }) {
  if (activity.status === "Missed") return /* @__PURE__ */ jsx("span", { className: "status-badge status--ready", children: "Pending" });
  if (activity.status === "Completed" || activity.status === "Deviation") {
    return /* @__PURE__ */ jsxs("span", {
      className: "activity-grid__status-stack", children: [
      /* @__PURE__ */ jsx("span", { className: "status-badge status--completed", children: "Complete" }),
        activity.deviation && /* @__PURE__ */ jsx("span", { className: "status-badge status--deviation", children: "Deviation" })
      ]
    });
  }
  if (activity.status === "Skipped") return /* @__PURE__ */ jsx("span", { className: "status-badge status--skipped", children: "Skipped" });
  return /* @__PURE__ */ jsx("span", { className: "status-badge status--ready", children: "Pending" });
}
function processingLabel(sample) {
  if (!sample) return "-";
  if (sample.status === "Collected" || sample.status === "Awaiting Centrifugation") return "Blood Collected";
  if (sample.status === "Centrifuging" || sample.status === "Ready For Aliquot") return "Centrifugation";
  if (sample.status === "Stored") return "Aliquoted";
  return sample.status;
}
function processingStatusClass(sample) {
  if (!sample) return "status--neutral";
  if (sample.status === "Aliquoted" || sample.status === "Stored") return "status--completed";
  if (sample.status === "Ready For Aliquot") return "status--upcoming";
  return "status--ready";
}
function SampleStatus({ activity, sample, reviewMode = false }) {
  if (reviewMode) return /* @__PURE__ */ jsx(ReviewStatus, { activity });
  if (!sample) return /* @__PURE__ */ jsx(GridStatus, { activity });
  return /* @__PURE__ */ jsxs("span", {
    className: "activity-grid__status-stack", children: [
    /* @__PURE__ */ jsx("span", { className: `status-badge ${processingStatusClass(sample)}`, children: processingLabel(sample) }),
      activity.deviation && /* @__PURE__ */ jsx("span", { className: "status-badge status--deviation", children: "Deviation" })
    ]
  });
}
function RemarkCell({ text, isExpanded, onToggle }) {
  if (!text) return /* @__PURE__ */ jsx("span", { children: "-" });
  return /* @__PURE__ */ jsx(
    "span",
    {
      className: isExpanded ? "activity-grid__remark-text activity-grid__remark-text--expanded" : "activity-grid__remark-text",
      title: text,
      onClick: onToggle,
      role: "button",
      tabIndex: 0,
      onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") onToggle(); },
      "aria-expanded": isExpanded,
      children: text
    }
  );
}
function formatDisplayDate(iso) {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).trim().replace(/ /g, "-");
}
function formatDisplayDateTime(iso) {
  if (!iso) return "-";
  const parts = new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).replace(",", "");
  return parts.replace(/ /, "-").replace(/ /, "-");
}
function formatInlineCrfValue(field, value) {
  const text = String(value ?? "").trim();
  if (!text) return "\u2014";
  if (field?.unit && field.type === "number") {
    return `${text} ${field.unit}`;
  }
  return text;
}

function EditIconButton({ label, title, onClick }) {
  return /* @__PURE__ */ jsx(
    "button",
    {
      type: "button",
      className: "btn btn--sm btn--secondary activity-grid__edit-btn",
      onClick,
      "aria-label": label,
      title: title ?? label,
      children: /* @__PURE__ */ jsx("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ jsx("path", { d: "M11.3 1.7a1.1 1.1 0 0 1 1.6 0l1.4 1.4a1.1 1.1 0 0 1 0 1.6L5.8 12.2 2 13l.8-3.8L11.3 1.7zM9.5 3.5l3 3", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" }) })
    }
  );
}
function AuditIconButton({ label, title, onClick }) {
  return /* @__PURE__ */ jsx(
    "button",
    {
      type: "button",
      className: "btn btn--sm btn--secondary activity-grid__edit-btn activity-grid__audit-btn",
      onClick,
      "aria-label": label,
      title: title ?? label,
      children: /* @__PURE__ */ jsx("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ jsx("path", { d: "M4 2.5h5.2L12 5.3v8.2H4v-11zM9 2.5v3h3M5.8 8h4.4M5.8 10h4.4M5.8 12h2.4", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round" }) })
    }
  );
}
function SubmitReviewNote({ status = "under-review" }) {
  const label = status === "reviewed" ? "Reviewed" : "Under Review";
  const noteClass = [
    "activity-grid__submit-note",
    status === "reviewed" ? "activity-grid__submit-note--reviewed" : "activity-grid__submit-note--under-review"
  ].join(" ");

  return /* @__PURE__ */ jsxs("span", {
    className: noteClass,
    children: [
      /* @__PURE__ */ jsx("svg", {
        width: "14",
        height: "14",
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2.5",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
        children: /* @__PURE__ */ jsx("polyline", { points: "20 6 9 17 4 12" })
      }),
      label
    ]
  });
}
function resolveScheduledDisplay(activity, visits) {
  if (activity.scheduledTime) return activity.scheduledTime;
  if (activity.activity === "Pre-Dose Blood Collection") return null;
  if (activity.actualTime) return activity.scheduledTime;
  const visit = visits?.find((item) => item.id === activity.visitId);
  if (!visit?.doseScheduleConfirmed) return null;
  return activity.scheduledTime ?? visit.plannedDoseTime ?? null;
}

function isPreDoseBloodCollection(activity) {
  return activity.activity === "Pre-Dose Blood Collection";
}

/** Related IMP dose for this visit/dose group has been administered (not still Skipped). */
function isRelatedDoseAdministered(activities, activity) {
  const doseKey = formatDoseDisplayLabel(activity?.dose);
  const doseRow = (activities ?? []).find(
    (item) =>
      item.visitId === activity.visitId
      && item.activity === "IMP Dose Administration"
      && formatDoseDisplayLabel(item.dose) === doseKey
  );
  if (!doseRow) return true;
  return !!doseRow.actualTime && String(doseRow.status ?? "").trim() !== "Skipped";
}

function doseActualEditLabel(activity) {
  return activity.actualTime ? "Edit dose time" : "Set dose time";
}

function formatScanStart(activity, sample) {
  return formatDisplayTime(resolveCentrifugeStartTime(activity, sample));
}

function formatScanEnd(activity, sample) {
  return formatDisplayTime(resolveCentrifugeEndTime(activity, sample));
}

function formatCentrifugeRange(activity, sample) {
  const start = formatScanStart(activity, sample);
  const end = formatScanEnd(activity, sample);
  if (start === "-" && end === "-") return "\u2014";
  if (start === "-") return end;
  if (end === "-") return start;
  return `${start} - ${end}`;
}

function activityHasQueryOnField(activity, fieldKey) {
  return isActiveReviewQuery(activity, fieldKey);
}

function activityHasOpenQueryOnField(activity, fieldKey) {
  return hasOpenReviewQuery(activity, fieldKey);
}

function reviewCellClassName(activity, fieldKey, baseClass = "", { hideClosed = false, tintCell = true } = {}) {
  const stage = getReviewQueryStageForField(activity, fieldKey, { hideClosed });
  const classes = [baseClass, tintCell && stage ? getReviewQueryStageCellClass(stage) : ""]
    .filter(Boolean)
    .join(" ");
  return classes || undefined;
}

function QueryIconButton({ label, title, stage = "", onClick }) {
  const stageClass = stage ? ` ${getReviewQueryStageBtnClass(stage)}` : "";
  return /* @__PURE__ */ jsx(
    "button",
    {
      type: "button",
      className: `btn btn--sm btn--secondary activity-grid__edit-btn activity-grid__query-btn${stageClass}`,
      onClick,
      "aria-label": label,
      title: title ?? label,
      children: /* @__PURE__ */ jsx("svg", {
        width: "14",
        height: "14",
        viewBox: "0 0 16 16",
        fill: "none",
        "aria-hidden": "true",
        children: /* @__PURE__ */ jsx("path", {
          d: "M6.2 5.4a1.8 1.8 0 1 1 3.2 1.2c-.5.5-1.1.7-1.5 1.1-.3.3-.4.7-.4 1.3M8 12.2h.01",
          stroke: "currentColor",
          strokeWidth: "1.4",
          strokeLinecap: "round",
          strokeLinejoin: "round"
        })
      })
    }
  );
}

function ReviewFieldActions({
  activity,
  fieldKey,
  hasAudit = false,
  onOpenAudit,
  reviewActionsEnabled = false,
  onRaiseQuery,
  shouldShowFieldQuery
}) {
  const isDoseActivity = activity?.activity === "IMP Dose Administration";
  const hasOpenQuery = hasOpenReviewQuery(activity, fieldKey);
  const hasQueryHistory = matchesReviewQueryField(activity, fieldKey);
  const queryStage = hasQueryHistory ? getReviewQueryStageForField(activity, fieldKey, { hideClosed: false }) : null;
  const canRaise = reviewActionsEnabled && activity.reviewStatus !== "Reviewed" && !!onRaiseQuery;
  const hasQueryableData = shouldShowFieldQuery ? shouldShowFieldQuery(activity, fieldKey) : true;
  const showQueryIcon = !isDoseActivity && !!onRaiseQuery && hasQueryableData && (canRaise || hasOpenQuery);

  return /* @__PURE__ */ jsxs(Fragment, {
    children: [
      showQueryIcon ? /* @__PURE__ */ jsx(QueryIconButton, {
        label: hasOpenQuery ? `View query on ${fieldKey}` : `Raise query on ${fieldKey}`,
        title: hasOpenQuery
          ? `${formatReviewQueryStageLabel(activity, fieldKey)}: ${getActiveReviewQueryRemarkText(activity, fieldKey) || activity.reviewQuery || ""}`
          : "Raise query",
        stage: queryStage ?? "",
        onClick: () => onRaiseQuery?.(activity.id, fieldKey)
      }) : null,
      hasAudit && onOpenAudit ? /* @__PURE__ */ jsx(AuditIconButton, {
        label: "View audit",
        title: "View audit",
        onClick: onOpenAudit
      }) : null
    ]
  });
}

function getLatestDoseLabel(doseLabels) {
  if (!doseLabels.length) return "";
  return doseLabels.reduce((latest, current) => {
    const latestNum = parseInt(String(latest).match(/\d+/)?.[0] ?? "0", 10);
    const currentNum = parseInt(String(current).match(/\d+/)?.[0] ?? "0", 10);
    return currentNum > latestNum ? current : latest;
  });
}

function ActivityGridRow({
  activity: a,
  allActivities = [],
  visits,
  samples,
  aliquots,
  compact,
  flatMobileRows,
  isMobile,
  actionableActivityId,
  expandedRemarkId,
  toggleRemark,
  onSkip,
  onRemark,
  onEditActual,
  onEditScanStart,
  isActualEditable,
  onOpenActualAudit,
  onOpenScanStartAudit,
  onOpenRemarkAudit,
  onOpenFieldAudit,
  onOpenAliquot,
  onOpenCrf,
  onEditCrfField,
  onOpenCrfFieldAudit,
  showInlineCrfGrid = false,
  isDesktop = false,
  reviewMode = false,
  reviewActionsEnabled = false,
  isReviewActionEnabled,
  showReviewedBadges = false,
  reviewSelectable = false,
  selectedReviewIds = [],
  onToggleReviewSelection,
  onRaiseQuery: onRaiseQueryProp,
  onOpenQueryAudit: _onOpenQueryAuditProp,
  shouldShowFieldQuery,
  onReview,
  onOpenReviewDetail,
  queriesEnabled = true
}) {
  const hideBarcodeColumn = false;
  const rowReviewActionsEnabled = isReviewActionEnabled ? isReviewActionEnabled(a) : reviewActionsEnabled;
  const onRaiseQuery = queriesEnabled ? onRaiseQueryProp : undefined;
  const isReviewSelected = selectedReviewIds.includes(a.id);
  const sample = resolveActivitySample(samples, a);
  const anyAliquots = sample ? aliquots.filter((aliquot) => aliquot.parentSampleId === sample.id && (aliquot.createdAt || aliquot.skippedAt)) : [];
  const canViewAliquot = reviewMode
    ? !!sample
    : !!sample && (anyAliquots.length > 0 || processingLabel(sample) === "Aliquoted");
  const visibleBarcode = sample?.barcode ?? a.barcode ?? (a.actualTime ? a.barcode : null);
  const visit = visits.find((item) => item.id === a.visitId);
  const isSubmittedLocked = isExecutionReviewLocked(visit?.reviewStatus);
  const canEditFieldAfterSubmit = (fieldKey) =>
    !isSubmittedLocked || (queriesEnabled && activityHasQueryOnField(a, fieldKey));
  const canRemark =
    !!onRemark
    && (!!a.actualTime || isActivityRemarkableStatus(a.status))
    && canEditFieldAfterSubmit("remark");
  const isImpDose = a.activity === "IMP Dose Administration";
  const isSkipped = String(a.status ?? "").trim() === "Skipped";
  // Skipped dose: always allow edit.
  // Skipped pre-dose: allow (comes before dose).
  // Skipped post-dose PK: only after dose time is set.
  const canUnskipSkipped = isSkipped && (
    isImpDose
    || isPreDoseBloodCollection(a)
    || isRelatedDoseAdministered(allActivities, a)
  );
  const canEditActual =
    !!onEditActual
    && (!isActualEditable || isActualEditable(a))
    && (!!a.actualTime || isImpDose || canUnskipSkipped)
    && canEditFieldAfterSubmit("actual");
  const scanStartValue = resolveCentrifugeStartTime(a, sample);
  const canEditScanStart =
    !!onEditScanStart
    && !!sample
    && !!scanStartValue
    && canEditFieldAfterSubmit("scanStart");
  // Show audit icon when: (1) the activity is a real DB record (activityConfigTimePointNo > 0) with data, OR
  // (2) fieldIds has the specific DtlNo key (populated after API load or after a write operation).
  const isRealDbRecord = Number(a.activityConfigTimePointNo) > 0;
  const scanEndValue = resolveCentrifugeEndTime(a, sample);
  const scheduledDisplayIso = resolveScheduledDisplay(a, visits);
  const hasActualAudit = !!(a.fieldIds?.["ActualTime"] || (isRealDbRecord && a.actualTime));
  const hasScanStartAudit = !!(a.fieldIds?.["CentrifugationStart"] || (isRealDbRecord && (scanStartValue || a.centrifugationStart)));
  const hasScanEndAudit = !!(a.fieldIds?.["CentrifugationEnd"] || (isRealDbRecord && (scanEndValue || a.centrifugationEnd)));
  const hasRemarkAudit = !!(a.fieldIds?.["Remarks"] || (isRealDbRecord && a.remarks));
  // Method / Barcode / Scheduled / Window are schedule or collect metadata — only useful after a real collection
  // (not Skipped, not Pending/Upcoming with no actual time).
  const isCollectedForFieldAudit =
    !!a.actualTime && String(a.status ?? "").trim() !== "Skipped";
  const hasMethodAudit = isCollectedForFieldAudit && !!(
    a.fieldIds?.["ExecutionMethod"] || (isRealDbRecord && (a.executionMethod || a.actualTime))
  );
  const hasBarcodeAudit = isCollectedForFieldAudit && !!(
    a.fieldIds?.["BarcodeValue"] || (isRealDbRecord && visibleBarcode)
  );
  const hasScheduledAudit = isCollectedForFieldAudit && !!(
    a.fieldIds?.["ScheduledTime"]
    || (isRealDbRecord && (scheduledDisplayIso || a.scheduledTime || (isImpDose && a.actualTime)))
  );
  const hasWindowAudit = isCollectedForFieldAudit && !!(
    a.fieldIds?.["WindowStart"]
    || a.fieldIds?.["WindowEnd"]
    || (isRealDbRecord && (a.windowStart || a.windowEnd))
  );
  const openFieldAudit = (fieldName, title) => {
    if (typeof onOpenFieldAudit === "function") onOpenFieldAudit(a.id, fieldName, title);
  };
  const timepointReadyForCrf = isActivityReadyForCrf(a);
  // Skipped/Missed timepoints never get a CRF (nothing was collected).
  const crfDisabledByStatus = ["Skipped", "Missed"].includes(String(a.status ?? ""));
  const canOpenCrf = !!onOpenCrf && activityHasCrf(a) && (reviewMode || !crfDisabledByStatus);
  const canSelectForReview = reviewSelectable
    && rowReviewActionsEnabled
    && a.reviewStatus !== "Reviewed"
    && !activityHasRaisedReviewQuery(a);
  const crfDefinition = activityHasCrf(a) ? getCrfDefinitionForActivity(a) : null;
  const crfFields = getCrfActiveFieldItems(crfDefinition)
    .map((item) => item.field)
    .filter(Boolean);
  // Card layout (mobile/tablet): show CRF fields inline. Desktop table keeps "Open CRF".
  const showCrfInline = !isDesktop && crfFields.length > 0 && (reviewMode || !crfDisabledByStatus);
  const crfSavedValues = crfDefinition
    ? resolveCrfSavedValues(a, crfDefinition)
    : {};
  const crfQueryFieldKey = queriesEnabled ? resolveViewCrfQueryFieldKey(a) : null;
  const crfViewFieldKey = queriesEnabled ? resolveActivityCrfQueryFieldKey(a) : null;
  const crfQueryFieldId = crfViewFieldKey?.startsWith("crf:") ? crfViewFieldKey.slice(4) : null;
  const hasCrfFieldAudit = !!crfQueryFieldId && !!a.fieldIds?.[crfQueryFieldId];
  const isActionable = !actionableActivityId || a.id === actionableActivityId;
  const rowStatusClass = a.status.toLowerCase().replace(/\s/g, "-");
  const rowClassName = `activity-grid__row activity-grid__row--${rowStatusClass}${isImpDose ? " activity-grid__row--imp-dose" : ""}`;
  const showDoseDesktopColumns = isImpDose && isDesktop;
  const hideDoseCardFields = isImpDose && !isDesktop;
  const doseScheduledDisplay = () => {
    const iso = resolveScheduledDisplay(a, visits) ?? a.scheduledTime ?? a.actualTime;
    return iso ? formatDisplayDate(iso) : "\u2014";
  };
  const reviewViewCellClass = [
    "activity-grid__review-view",
    queriesEnabled && isDesktop && crfQueryFieldKey
      ? getReviewQueryStageCellClass(
          getReviewQueryStageForField(a, crfQueryFieldKey, { hideClosed: !reviewMode })
        )
      : ""
  ].filter(Boolean).join(" ");
  const activityActionsCellClass = [
    "activity-grid__actions",
    queriesEnabled && isDesktop && !reviewMode && crfQueryFieldKey
      ? getReviewQueryStageCellClass(
          getReviewQueryStageForField(a, crfQueryFieldKey, { hideClosed: true })
        )
      : ""
  ].filter(Boolean).join(" ");
  const tintedCellClass = (fieldKey, baseClass = "", hideClosed = !reviewMode) => (
    queriesEnabled
      ? reviewCellClassName(a, fieldKey, baseClass, { hideClosed })
      : (baseClass || undefined)
  );

  const rowContent = /* @__PURE__ */ jsxs(Fragment, {
    children: [
    (!hideDoseCardFields || showDoseDesktopColumns) && /* @__PURE__ */ jsxs("span", {
      "data-label": "Method",
      children: [
        hasMethodAudit && onOpenFieldAudit && !showDoseDesktopColumns && /* @__PURE__ */ jsx("span", {
          className: "activity-grid__label-actions",
          children: /* @__PURE__ */ jsx(AuditIconButton, {
            label: "View method audit",
            title: "View method audit",
            onClick: () => openFieldAudit("ExecutionMethod")
          })
        }),
        /* @__PURE__ */ jsx("span", { className: "activity-grid__value-wrapper", children: showDoseDesktopColumns ? "\u2014" : methodLabel(a) })
      ]
    }),
    (!hideDoseCardFields || showDoseDesktopColumns) && !hideBarcodeColumn && /* @__PURE__ */ jsxs("span", {
      "data-label": "Barcode",
      className: "mono",
      children: [
        hasBarcodeAudit && onOpenFieldAudit && !showDoseDesktopColumns && /* @__PURE__ */ jsx("span", {
          className: "activity-grid__label-actions",
          children: /* @__PURE__ */ jsx(AuditIconButton, {
            label: "View barcode audit",
            title: "View barcode audit",
            onClick: () => openFieldAudit("BarcodeValue")
          })
        }),
        /* @__PURE__ */ jsx("span", { className: "activity-grid__value-wrapper", children: showDoseDesktopColumns ? "\u2014" : visibleBarcode ?? "-" })
      ]
    }),
    (!hideDoseCardFields || showDoseDesktopColumns) && /* @__PURE__ */ jsxs("span", {
      "data-label": "Scheduled Time",
      children: [
        hasScheduledAudit && onOpenFieldAudit && !isPreDoseBloodCollection(a) && /* @__PURE__ */ jsx("span", {
          className: "activity-grid__label-actions",
          children: /* @__PURE__ */ jsx(AuditIconButton, {
            label: isImpDose ? "View dose date/time audit" : "View scheduled time audit",
            title: isImpDose ? "View dose date/time audit" : "View scheduled time audit",
            onClick: () => openFieldAudit(isImpDose ? "DoseDateTime" : "ScheduledTime")
          })
        }),
        /* @__PURE__ */ jsx("span", {
          className: "activity-grid__value-wrapper",
          children: showDoseDesktopColumns ? doseScheduledDisplay() : isPreDoseBloodCollection(a) ? "\u2014" : formatDisplayDateTime(resolveScheduledDisplay(a, visits))
        })
      ]
    }),
    (!hideDoseCardFields || showDoseDesktopColumns) && /* @__PURE__ */ jsxs("span", {
      "data-label": "Window Period",
      children: [
        hasWindowAudit && onOpenFieldAudit && !showDoseDesktopColumns && !isPreDoseBloodCollection(a) && /* @__PURE__ */ jsx("span", {
          className: "activity-grid__label-actions",
          children: /* @__PURE__ */ jsx(AuditIconButton, {
            label: "View window period audit",
            title: "View window period audit",
            onClick: () => openFieldAudit("WindowPeriod")
          })
        }),
        /* @__PURE__ */ jsx("span", {
          className: "activity-grid__value-wrapper",
          children: showDoseDesktopColumns ? "\u2014" : isPreDoseBloodCollection(a) ? "\u2014" : formatWindow(a.windowStart, a.windowEnd)
        })
      ]
    }),
    hideDoseCardFields && /* @__PURE__ */ jsx("span", { "data-label": "Date", children: /* @__PURE__ */ jsx("span", { className: "activity-grid__value-wrapper", children: formatDisplayDate(a.actualTime) }) }),
    /* @__PURE__ */ jsxs("span", {
      "data-label": "Actual Time",
      className: tintedCellClass("actual", "activity-grid__actual"),
      children: [
        /* @__PURE__ */ jsxs("span", {
          className: "activity-grid__label-actions",
          children: [
            !reviewMode && canEditActual && /* @__PURE__ */ jsx(EditIconButton, {
              label: isImpDose ? doseActualEditLabel(a) : (a.actualTime ? "Edit actual time" : "Set actual time"),
              onClick: () => onEditActual(a.id)
            }),
            reviewMode ? /* @__PURE__ */ jsx(ReviewFieldActions, {
              activity: a,
              fieldKey: "actual",
              hasAudit: hasActualAudit,
              onOpenAudit: isImpDose && onOpenFieldAudit
                ? () => openFieldAudit("DoseDateTime")
                : (onOpenActualAudit ? () => onOpenActualAudit(a.id) : void 0),
              reviewActionsEnabled: rowReviewActionsEnabled,
              onRaiseQuery,
              shouldShowFieldQuery
            }) : /* @__PURE__ */ jsxs(Fragment, {
              children: [
                hasActualAudit && (isImpDose && onOpenFieldAudit
                  ? /* @__PURE__ */ jsx(AuditIconButton, {
                      label: "View dose date/time audit",
                      title: "View dose date/time audit",
                      onClick: () => openFieldAudit("DoseDateTime")
                    })
                  : onOpenActualAudit && /* @__PURE__ */ jsx(AuditIconButton, {
                      label: "View actual time audit",
                      title: "View actual time audit",
                      onClick: () => onOpenActualAudit(a.id)
                    }))
              ]
            })
          ]
        }),
        /* @__PURE__ */ jsx("div", {
          className: "activity-grid__value-wrapper",
          children: /* @__PURE__ */ jsx("span", { children: formatDisplayTime(a.actualTime) })
        })
      ]
    }),
    /* @__PURE__ */ jsx("span", { "data-label": "Status", children: /* @__PURE__ */ jsx(SampleStatus, { activity: a, sample, reviewMode }) }),
    (!hideDoseCardFields || showDoseDesktopColumns) && /* @__PURE__ */ jsxs("span", {
      "data-label": "Deviation / Remark",
      className: tintedCellClass(
        "remark",
        `activity-grid__remark${a.remarks ? "" : " activity-grid__remark--empty"}`
      ),
      children: [
        /* @__PURE__ */ jsxs("span", {
          className: "activity-grid__label-actions",
          children: [
            !reviewMode && canRemark && /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--sm btn--secondary activity-grid__edit-btn", onClick: () => onRemark(a.id), "aria-label": "Edit remark", title: "Edit remark", children: /* @__PURE__ */ jsx("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ jsx("path", { d: "M11.3 1.7a1.1 1.1 0 0 1 1.6 0l1.4 1.4a1.1 1.1 0 0 1 0 1.6L5.8 12.2 2 13l.8-3.8L11.3 1.7zM9.5 3.5l3 3", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" }) }) }),
            reviewMode ? /* @__PURE__ */ jsx(ReviewFieldActions, {
              activity: a,
              fieldKey: "remark",
              hasAudit: hasRemarkAudit,
              onOpenAudit: onOpenRemarkAudit ? () => onOpenRemarkAudit(a.id) : void 0,
              reviewActionsEnabled: rowReviewActionsEnabled,
              onRaiseQuery,
              shouldShowFieldQuery
            }) : /* @__PURE__ */ jsxs(Fragment, {
              children: [
                hasRemarkAudit && onOpenRemarkAudit && /* @__PURE__ */ jsx(AuditIconButton, {
                  label: "View remark audit",
                  title: "View remark audit",
                  onClick: () => onOpenRemarkAudit(a.id)
                })
              ]
            })
          ]
        }),
        /* @__PURE__ */ jsx("div", {
          className: "activity-grid__value-wrapper",
          children: /* @__PURE__ */ jsx(RemarkCell, { text: a.remarks ?? null, isExpanded: expandedRemarkId === a.id, onToggle: () => toggleRemark(a.id) })
        })
      ]
    }),
    (!hideDoseCardFields || showDoseDesktopColumns) && !reviewMode && /* @__PURE__ */ jsxs("span", {
      "data-label": "Centrifuge Start Time",
      className: tintedCellClass("scanStart", "activity-grid__scan-time"),
      children: showDoseDesktopColumns
        ? /* @__PURE__ */ jsx("span", { className: "activity-grid__value-wrapper", children: "\u2014" })
        : [
          /* @__PURE__ */ jsxs("span", {
            className: "activity-grid__label-actions",
            children: [
              canEditScanStart && /* @__PURE__ */ jsx(EditIconButton, {
                label: "Edit start time",
                title: "Edit start time",
                onClick: () => onEditScanStart(a.id)
              }),
              hasScanStartAudit && onOpenScanStartAudit && /* @__PURE__ */ jsx(AuditIconButton, {
                label: "View start time audit",
                title: "View start time audit",
                onClick: () => onOpenScanStartAudit(a.id)
              })
            ]
          }),
          /* @__PURE__ */ jsx("div", {
            className: "activity-grid__value-wrapper",
            children: /* @__PURE__ */ jsx("span", { children: formatScanStart(a, sample) })
          })
        ]
    }),
    (!hideDoseCardFields || showDoseDesktopColumns) && !reviewMode && /* @__PURE__ */ jsxs("span", {
      "data-label": "Centrifuge End Time",
      className: "activity-grid__scan-time",
      children: showDoseDesktopColumns
        ? /* @__PURE__ */ jsx("span", { className: "activity-grid__value-wrapper", children: "\u2014" })
        : [
          hasScanEndAudit && onOpenFieldAudit && /* @__PURE__ */ jsx("span", {
            className: "activity-grid__label-actions",
            children: /* @__PURE__ */ jsx(AuditIconButton, {
              label: "View centrifuge end audit",
              title: "View centrifuge end audit",
              onClick: () => openFieldAudit("CentrifugationEnd")
            })
          }),
          /* @__PURE__ */ jsxs("div", {
            className: "activity-grid__value-wrapper",
            children: [
              /* @__PURE__ */ jsx("span", { children: formatScanEnd(a, sample) })
            ]
          })
        ]
    }),
    (!hideDoseCardFields || showDoseDesktopColumns) && reviewMode && /* @__PURE__ */ jsxs("span", {
      "data-label": "Centrifuge Start Time",
      className: tintedCellClass("scanStart", "activity-grid__scan-time"),
      children: showDoseDesktopColumns
        ? /* @__PURE__ */ jsx("span", { className: "activity-grid__value-wrapper", children: "\u2014" })
        : [
          /* @__PURE__ */ jsx("span", {
            className: "activity-grid__label-actions",
            children: /* @__PURE__ */ jsx(ReviewFieldActions, {
              activity: a,
              fieldKey: "scanStart",
              hasAudit: hasScanStartAudit,
              onOpenAudit: onOpenScanStartAudit ? () => onOpenScanStartAudit(a.id) : void 0,
              reviewActionsEnabled: rowReviewActionsEnabled,
              onRaiseQuery,
              shouldShowFieldQuery
            })
          }),
          /* @__PURE__ */ jsx("div", {
            className: "activity-grid__value-wrapper",
            children: /* @__PURE__ */ jsx("span", { children: formatScanStart(a, sample) })
          })
        ]
    }),
    (!hideDoseCardFields || showDoseDesktopColumns) && reviewMode && /* @__PURE__ */ jsxs("span", {
      "data-label": "Centrifuge End Time",
      className: "activity-grid__scan-time",
      children: showDoseDesktopColumns
        ? /* @__PURE__ */ jsx("span", { className: "activity-grid__value-wrapper", children: "\u2014" })
        : [
          hasScanEndAudit && onOpenFieldAudit && /* @__PURE__ */ jsx("span", {
            className: "activity-grid__label-actions",
            children: /* @__PURE__ */ jsx(AuditIconButton, {
              label: "View centrifuge end audit",
              title: "View centrifuge end audit",
              onClick: () => openFieldAudit("CentrifugationEnd")
            })
          }),
          /* @__PURE__ */ jsx("div", {
            className: "activity-grid__value-wrapper",
            children: /* @__PURE__ */ jsx("span", { children: formatScanEnd(a, sample) })
          })
        ]
    }),
    showCrfInline && crfFields.map((field, index) => {
      const queryFieldKey = `crf:${field.id}`;
      const fieldValue = crfSavedValues[field.id];
      const fieldLabel = field.label || field.id;
      const hasFieldAudit = !!(
        a.fieldIds?.[field.id]
        || a.fieldIds?.[field.label]
        || a.fieldIds?.[`crf:${field.id}`]
        || (isRealDbRecord && String(fieldValue ?? "").trim())
      );
      const canEditCrfField =
        !!onEditCrfField
        && !reviewMode
        && timepointReadyForCrf
        && canEditFieldAfterSubmit(queryFieldKey);
      return /* @__PURE__ */ jsxs("span", {
        "data-label": fieldLabel,
        "data-required": field.required ? "true" : undefined,
        className: [
          "activity-grid__crf-field",
          "activity-grid__crf-field--labeled",
          `activity-grid__crf-field--${index}`,
          field.type === "time" ? "activity-grid__scan-time" : "",
          queriesEnabled ? reviewCellClassName(a, queryFieldKey, "", { hideClosed: !reviewMode }) : undefined
        ].filter(Boolean).join(" "),
        children: [
          /* @__PURE__ */ jsxs("span", {
            className: "activity-grid__mobile-data-label",
            children: [
              fieldLabel,
              field.required
                ? /* @__PURE__ */ jsx("span", { className: "crf-form__required", "aria-hidden": true, children: " *" })
                : null
            ]
          }),
          /* @__PURE__ */ jsxs("span", {
            className: "activity-grid__label-actions",
            children: [
              canEditCrfField ? /* @__PURE__ */ jsx(EditIconButton, {
                label: String(fieldValue ?? "").trim() ? `Edit ${field.label}` : `Add ${field.label}`,
                onClick: () => onEditCrfField(a.id, field.id)
              }) : null,
              reviewMode ? /* @__PURE__ */ jsx(ReviewFieldActions, {
                activity: a,
                fieldKey: queryFieldKey,
                hasAudit: hasFieldAudit,
                onOpenAudit: onOpenCrfFieldAudit
                  ? () => onOpenCrfFieldAudit(a.id, field.id)
                  : void 0,
                reviewActionsEnabled: rowReviewActionsEnabled,
                onRaiseQuery,
                shouldShowFieldQuery
              }) : /* @__PURE__ */ jsxs(Fragment, {
                children: [
                  hasFieldAudit && onOpenCrfFieldAudit ? /* @__PURE__ */ jsx("button", {
                    type: "button",
                    className: "btn btn--sm btn--secondary activity-grid__edit-btn activity-grid__audit-btn",
                    onClick: () => onOpenCrfFieldAudit(a.id, field.id),
                    "aria-label": `View ${field.label} audit`,
                    title: `View ${field.label} audit`,
                    children: /* @__PURE__ */ jsx("svg", {
                      width: "14",
                      height: "14",
                      viewBox: "0 0 16 16",
                      fill: "none",
                      "aria-hidden": "true",
                      children: /* @__PURE__ */ jsx("path", {
                        d: "M4 2.5h5.2L12 5.3v8.2H4v-11zM9 2.5v3h3M5.8 8h4.4M5.8 10h4.4M5.8 12h2.4",
                        stroke: "currentColor",
                        strokeWidth: "1.3",
                        strokeLinecap: "round",
                        strokeLinejoin: "round"
                      })
                    })
                  }) : null
                ]
              })
            ]
          }),
          /* @__PURE__ */ jsx("div", {
            className: "activity-grid__value-wrapper",
            children: /* @__PURE__ */ jsx("span", { children: formatInlineCrfValue(field, fieldValue) })
          })
        ]
      }, field.id);
    }),
      reviewMode && !compact && /* @__PURE__ */ jsx("span", {
        "data-label": "View",
        className: reviewViewCellClass,
        children: /* @__PURE__ */ jsx("div", {
          className: "activity-grid__value-wrapper activity-grid__review-view__content",
          children: onOpenReviewDetail
            ? /* @__PURE__ */ jsx("button", {
                type: "button",
                className: "btn btn--secondary activity-grid__review-view-btn",
                onClick: () => onOpenReviewDetail?.(a.id),
                children: "View Detail"
              })
            : /* @__PURE__ */ jsx("span", { children: "\u2014" })
        })
      }),
      !compact && !reviewMode && /* @__PURE__ */ jsxs("span", {
        className: activityActionsCellClass, "data-label": "Actions", children: [
          !reviewMode && canOpenCrf && isDesktop && /* @__PURE__ */ jsx("button", {
            type: "button",
            className: [
              "btn btn--sm btn--secondary",
              (() => {
                if (!queriesEnabled) return "";
                const crfStage = a.reviewQueryFieldKey?.startsWith("crf:")
                  ? getReviewQueryStageForField(a, a.reviewQueryFieldKey, { hideClosed: true })
                  : null;
                return crfStage ? getReviewQueryStageCrfBtnClass(crfStage) : "";
              })()
            ].filter(Boolean).join(" "),
            onClick: () => onOpenCrf(a.id),
            title: queriesEnabled && getReviewQueryStageForField(a, a.reviewQueryFieldKey, { hideClosed: true })
              ? `${formatReviewQueryStageLabel(a)}: ${a.reviewQuery}`
              : undefined,
            children: isSubmittedLocked && !(queriesEnabled && activityHasQueryOnField(a, a.reviewQueryFieldKey))
              ? "View CRF"
              : "Open CRF"
          }),
          !reviewMode && canViewAliquot && onOpenAliquot && /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--sm btn--primary", onClick: () => onOpenAliquot(sample.id), children: "View Aliquot" }),
          !reviewMode && isActionable && !isSubmittedLocked && onSkip && isActivitySkippableStatus(a.status) && /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--sm btn--ghost", onClick: () => onSkip(a.id), "data-tour": "grid-skip", children: "Skip" })
        ]
      })
    ]
  });

  if (isMobile && !flatMobileRows) {
    return /* @__PURE__ */ jsx(
      QueueSampleRow,
      {
        timepoint: formatActivityTimepointLabel(a),
        barcode: visibleBarcode ?? "-",
        flat: flatMobileRows,
        className: rowClassName,
        children: rowContent
      },
      a.id
    );
  }

  return /* @__PURE__ */ jsxs("div", {
    className: rowClassName, children: [
      reviewSelectable && !compact && /* @__PURE__ */ jsx("span", {
        className: "activity-grid__select",
        "data-label": "Select",
        children: canSelectForReview
          ? /* @__PURE__ */ jsx("input", {
              type: "checkbox",
              checked: isReviewSelected,
              onChange: () => onToggleReviewSelection?.(a.id),
              "aria-label": `Select ${formatActivityTimepointLabel(a)}`
            })
          : /* @__PURE__ */ jsx("span", { children: "\u2014" })
      }),
    /* @__PURE__ */ jsx("span", { "data-label": "Timepoint", children: formatActivityTimepointLabel(a) }),
      rowContent
    ]
  }, a.id);
}

function ActivityGrid({
  activities,
  visits = [],
  samples = [],
  aliquots = [],
  actionableActivityId,
  onSkip,
  onRemark,
  onEditActual,
  onEditScanStart,
  isActualEditable,
  onOpenActualAudit,
  onOpenScanStartAudit,
  onOpenRemarkAudit,
  onOpenFieldAudit,
  onOpenAliquot,
  onOpenCrf,
  onEditCrfField,
  onOpenCrfFieldAudit,
  compact,
  hideFilters,
  flatMobileRows = false,
  defaultDoseFilter,
  reviewMode = false,
  reviewActionsEnabled = false,
  isReviewActionEnabled,
  showReviewedBadges = false,
  reviewSelectable = false,
  selectedReviewIds = [],
  onToggleReviewSelection,
  onToggleReviewSelectAll,
  onRaiseQuery,
  onOpenQueryAudit,
  shouldShowFieldQuery,
  onReview,
  onOpenReviewDetail,
  queriesEnabled = true,
  canSubmitDose,
  onSubmitDose,
  getDoseReviewStatus,
  onDoseFilterChange,
  hideMobileSubmit = false,
  showInlineCrfGrid = false
}) {
  const { isMobile, isDesktop } = useViewport();
  const doses = useMemo(() => [...new Set(activities.map((a) => formatDoseDisplayLabel(a.dose)).filter(Boolean))], [activities]);
  const latestDose = useMemo(() => getLatestDoseLabel(doses), [doses]);

  const [doseFilter, setDoseFilter] = useState(defaultDoseFilter || "");
  const [prevDefaultDoseFilter, setPrevDefaultDoseFilter] = useState(defaultDoseFilter);

  if (defaultDoseFilter !== prevDefaultDoseFilter) {
    setDoseFilter(defaultDoseFilter || "");
    setPrevDefaultDoseFilter(defaultDoseFilter);
  }

  const [timepointFilter, setTimepointFilter] = useState("all");
  const [expandedRemarkId, setExpandedRemarkId] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const toggleRemark = (id) => setExpandedRemarkId((prev) => (prev === id ? null : id));

  const updateDoseFilter = (nextDose) => {
    setDoseFilter(nextDose);
    onDoseFilterChange?.(nextDose);
  };

  useEffect(() => {
    if (!doses.length) return;
    if (!doses.includes(doseFilter)) {
      updateDoseFilter(latestDose);
    }
  }, [doses, doseFilter, latestDose]);

  useEffect(() => {
    onDoseFilterChange?.(doseFilter);
  }, [doseFilter, onDoseFilterChange]);

  // Only show timepoints relevant to the selected dose
  const relevantActivities = useMemo(
    () => activities.filter((a) => formatDoseDisplayLabel(a.dose) === doseFilter),
    [activities, doseFilter]
  );

  const timepoints = useMemo(() => [...new Set(relevantActivities.map((a) => a.timepoint))], [relevantActivities]);

  const filteredActivities = useMemo(
    () => hideFilters ? activities : (timepointFilter === "all" ? relevantActivities : relevantActivities.filter((a) => a.timepoint === timepointFilter)),
    [activities, relevantActivities, timepointFilter, hideFilters]
  );

  useEffect(() => {
    if (timepointFilter !== "all" && !timepoints.includes(timepointFilter)) {
      setTimepointFilter("all");
    }
  }, [timepointFilter, timepoints]);

  useEffect(() => {
    setPage(1);
  }, [doseFilter, timepointFilter, pageSize, activities.length]);

  const totalPages = Math.max(1, Math.ceil(filteredActivities.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredActivities.length);
  const visibleActivities = filteredActivities.slice(startIndex, endIndex);
  const selectableReviewIds = useMemo(
    () => (reviewSelectable
      ? filteredActivities.filter((activity) => {
          const enabled = isReviewActionEnabled ? isReviewActionEnabled(activity) : reviewActionsEnabled;
          return enabled
            && activity.reviewStatus !== "Reviewed"
            && !activityHasRaisedReviewQuery(activity);
        }).map((activity) => activity.id)
      : []),
    [filteredActivities, isReviewActionEnabled, reviewActionsEnabled, reviewSelectable]
  );
  const allSelectableSelected = selectableReviewIds.length > 0
    && selectableReviewIds.every((id) => selectedReviewIds.includes(id));
  const showPagination = filteredActivities.length > pageSize;

  if (activities.length === 0) return /* @__PURE__ */ jsx("p", { className: "empty-state", children: "No activities found." });

  return /* @__PURE__ */ jsxs("div", {
      "data-tour": "activity-grid",
    className: `activity-grid ${compact ? "activity-grid--compact" : ""}${flatMobileRows ? " activity-grid--flat-rows" : ""}${reviewMode ? " activity-grid--review" : ""}`, children: [
      !hideFilters && /* @__PURE__ */ jsxs("div", {
        style: { display: "flex", flexDirection: "column", gap: "4px", marginBottom: "12px" }, children: [
      /* Desktop Select Filter Dropdowns */
      /* @__PURE__ */ jsxs("div", {
          className: "activity-grid__desktop-filters", children: [
            doses.length > 0 && /* @__PURE__ */ jsxs("div", {
              className: "activity-grid__select-field", children: [
          /* @__PURE__ */ jsx("span", { children: "Filter by Dose" }),
          /* @__PURE__ */ jsx(ScrollableSelect, {
                value: doseFilter,
                onChange: updateDoseFilter,
                options: doses,
                allowEmpty: false
              })
              ]
            }),
        /* @__PURE__ */ jsxs("div", {
              className: "activity-grid__select-field", children: [
          /* @__PURE__ */ jsx("span", { children: "Timepoint Filter" }),
          /* @__PURE__ */ jsx(ScrollableSelect, {
                value: timepointFilter,
                onChange: setTimepointFilter,
                allowEmpty: false,
                options: [
                  { value: "all", label: "All Timepoints" },
                  ...timepoints.map((timepoint) => {
                    const activity = relevantActivities.find((item) => item.timepoint === timepoint);
                    return {
                      value: timepoint,
                      label: formatActivityTimepointLabel(activity ?? { timepoint })
                    };
                  })
                ]
              })
              ]
            }),
            !hideMobileSubmit && !reviewMode && onSubmitDose && doseFilter && (() => {
              const reviewStatus = getDoseReviewStatus?.(doseFilter);
              if (reviewStatus) {
                return /* @__PURE__ */ jsx("div", {
                  className: "activity-grid__submit-field",
                  children: /* @__PURE__ */ jsx(SubmitReviewNote, { status: reviewStatus })
                });
              }
              if (!canSubmitDose?.(doseFilter)) return null;
              return /* @__PURE__ */ jsx("div", {
                className: "activity-grid__submit-field",
                children: /* @__PURE__ */ jsx("button", {
                  type: "button",
                  className: "btn btn--primary btn--sm",
                  onClick: () => onSubmitDose(doseFilter),
                  children: "Submit"
                })
              });
            })()
          ]
        }),

          /* Mobile Scrollable Button Bar Filters */
          doses.length > 0 && /* @__PURE__ */ jsxs("div", {
            className: "activity-grid__filter", role: "group", "aria-label": "Filter by dose", "data-tour": "dose-filter", style: { margin: 0, paddingBottom: 0, borderBottom: "none" }, children: [
              doses.map((dose) => /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  className: `activity-grid__filter-btn ${doseFilter === dose ? "activity-grid__filter-btn--active" : ""}`,
                  onClick: () => updateDoseFilter(dose),
                  children: dose
                },
                dose
              ))
            ]
          }),
      /* @__PURE__ */ jsxs("div", {
            className: "activity-grid__filter", role: "group", "aria-label": "Filter by timepoint", "data-tour": "timepoint-filter", style: { margin: 0 }, children: [
        /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                className: `activity-grid__filter-btn ${timepointFilter === "all" ? "activity-grid__filter-btn--active" : ""}`,
                onClick: () => setTimepointFilter("all"),
                children: "All Timepoints"
              }
            ),
              timepoints.map((timepoint) => {
                const activity = relevantActivities.find((item) => item.timepoint === timepoint);
                return /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    className: `activity-grid__filter-btn ${timepointFilter === timepoint ? "activity-grid__filter-btn--active" : ""}`,
                    onClick: () => setTimepointFilter(timepoint),
                    children: formatActivityTimepointLabel(activity ?? { timepoint })
                  },
                  timepoint
                );
              })
            ]
          }),
          !(hideMobileSubmit || flatMobileRows) && !reviewMode && onSubmitDose && doseFilter && (() => {
            const reviewStatus = getDoseReviewStatus?.(doseFilter);
            if (reviewStatus) {
              return /* @__PURE__ */ jsx("div", {
                className: "activity-grid__filter activity-grid__filter--submit",
                children: /* @__PURE__ */ jsx(SubmitReviewNote, { status: reviewStatus })
              });
            }
            if (!canSubmitDose?.(doseFilter)) return null;
            return /* @__PURE__ */ jsx("div", {
              className: "activity-grid__filter activity-grid__filter--submit",
              children: /* @__PURE__ */ jsx("button", {
                type: "button",
                className: "btn btn--primary btn--sm",
                onClick: () => onSubmitDose(doseFilter),
                children: "Submit"
              })
            });
          })()
        ]
      }),
    /* @__PURE__ */ jsxs("div", {
        className: "activity-grid__head", children: [
      reviewSelectable && !compact && /* @__PURE__ */ jsx("span", {
        className: "activity-grid__select",
        children: reviewActionsEnabled && selectableReviewIds.length
          ? /* @__PURE__ */ jsx("input", {
              type: "checkbox",
              checked: allSelectableSelected,
              onChange: (event) => onToggleReviewSelectAll?.(event.target.checked, selectableReviewIds),
              "aria-label": "Select all records for review"
            })
          : null
      }),
      /* @__PURE__ */ jsx("span", { children: "Timepoint" }),
      /* @__PURE__ */ jsx("span", { children: "Method" }),
      /* @__PURE__ */ jsx("span", { children: "Barcode" }),
      /* @__PURE__ */ jsx("span", { children: "Scheduled Time" }),
      /* @__PURE__ */ jsx("span", { children: "Window Period" }),
      /* @__PURE__ */ jsx("span", { children: "Actual Time" }),
      /* @__PURE__ */ jsx("span", { children: "Status" }),
      /* @__PURE__ */ jsx("span", { className: reviewMode ? "activity-grid__head-remark" : undefined, children: "Deviation / Remark" }),
      /* @__PURE__ */ jsx("span", { className: "activity-grid__head-centrifuge", children: "Centrifuge Start Time" }),
      /* @__PURE__ */ jsx("span", { className: "activity-grid__head-centrifuge", children: "Centrifuge End Time" }),
          reviewMode && !compact && /* @__PURE__ */ jsx("span", { children: "View" }),
          !compact && !reviewMode && /* @__PURE__ */ jsx("span", { children: "Actions" })
        ]
      }),
      filteredActivities.length === 0 ? /* @__PURE__ */ jsx("p", { className: "empty-state empty-state--compact", children: "No activities for this timepoint." }) : visibleActivities.map((a) => /* @__PURE__ */ jsx(
        ActivityGridRow,
        {
          activity: a,
          allActivities: activities,
          visits,
          samples,
          aliquots,
          compact,
          flatMobileRows,
          isMobile,
          actionableActivityId,
          expandedRemarkId,
          toggleRemark,
          onSkip,
          onRemark,
          onEditActual,
          onEditScanStart,
          isActualEditable,
          onOpenActualAudit,
          onOpenScanStartAudit,
          onOpenRemarkAudit,
          onOpenFieldAudit,
          onOpenAliquot,
          onOpenCrf,
          onEditCrfField,
          onOpenCrfFieldAudit,
          showInlineCrfGrid,
          isDesktop,
          reviewMode,
          reviewActionsEnabled,
          isReviewActionEnabled,
          showReviewedBadges,
          reviewSelectable,
          selectedReviewIds,
          onToggleReviewSelection,
          onRaiseQuery,
          onOpenQueryAudit,
          shouldShowFieldQuery,
          onReview,
          onOpenReviewDetail,
          queriesEnabled
        },
        a.id
      )),
      showPagination && /* @__PURE__ */ jsxs("div", {
        className: "table-pagination config-data-table__pagination activity-grid__pagination", children: [
      /* @__PURE__ */ jsxs("div", {
          className: "config-data-table__pagination-meta", children: [
        /* @__PURE__ */ jsxs("span", { children: ["Showing ", startIndex + 1, "\u2013", endIndex, " of ", filteredActivities.length] }),
        /* @__PURE__ */ jsx("label", {
            className: "config-data-table__page-size", children: /* @__PURE__ */ jsx(ScrollableSelect, {
              className: "scrollable-select--compact",
              value: pageSize,
              onChange: (nextValue) => setPageSize(Number(nextValue)),
              options: [10, 20, 50].map((option) => ({
                value: option,
                label: `${option} / page`
              })),
              allowEmpty: false,
              ariaLabel: "Rows per page"
            })
          })
          ]
        }),
      /* @__PURE__ */ jsxs("div", {
          className: "table-pagination__pager config-data-table__pager", children: [
        /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--secondary btn--sm", disabled: safePage <= 1, onClick: () => setPage((current) => Math.max(1, current - 1)), children: "Prev" }),
        /* @__PURE__ */ jsxs("span", { children: [safePage, " / ", totalPages] }),
        /* @__PURE__ */ jsx("button", { type: "button", className: "btn btn--secondary btn--sm", disabled: safePage >= totalPages, onClick: () => setPage((current) => Math.min(totalPages, current + 1)), children: "Next" })
          ]
        })
        ]
      })
    ]
  });
}
export {
  ActivityGrid
};
