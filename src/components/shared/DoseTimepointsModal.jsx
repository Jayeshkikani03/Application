import { useEffect, useMemo, useRef, useState } from "react";
import { ConfigDataTable } from "./ConfigDataTable";
import { AdminFieldLabel } from "./AdminFieldLabel.jsx";
import { EditFieldRemarkAttach } from "./EditFieldRemark.jsx";
import { useAdminRecordAudit } from "../../hooks/useAdminRecordAudit.jsx";
import { ACTIVITY_CONFIG_TIMEPOINT_FIELD_TO_COLUMN } from "../../features/activityConfiguration/utils/activityConfigAuditTargets.js";
import {
  buildTimepointFromDraft,
  createTimepointDraftDefaults,
  formatTimepointDuration,
  formatTimepointDurationForInput,
  getTimepointDuplicateError,
  isImpDoseActivityType,
  isScheduleFieldsHiddenForActivityType,
} from "../../services/activityConfigurationService";
import {
  getNextTimepointOrder,
  normalizeTimepointListOrders,
  resolveVisitScheduleNo,
} from "../../features/activityConfiguration/utils/activityConfigurationMappers";
import { getTimepointBaseLabel } from "../../utils/visitDisplay";
import { ScrollableSelect } from "./ScrollableSelect";
import { SoftAlertToast } from "./SoftAlertToast";

const EMPTY_TP_REMARKS = {
  order: "",
  label: "",
  activityType: "",
  visit: "",
  duration: "",
  durationType: "",
  windowPeriodMinus: "",
  windowPeriodPlus: "",
  windowPeriodDurationType: "",
  isActive: "",
};

const EMPTY_TP_DISMISSED = {
  order: false,
  label: false,
  activityType: false,
  visit: false,
  duration: false,
  durationType: false,
  windowPeriodMinus: false,
  windowPeriodPlus: false,
  windowPeriodDurationType: false,
  isActive: false,
};

const TP_FIELD_LABELS = {
  order: "Order",
  label: "Time point name",
  activityType: "Activity type",
  visit: "Visit",
  duration: "Duration",
  durationType: "Duration type",
  windowPeriodMinus: "Window period (-)",
  windowPeriodPlus: "Window period (+)",
  windowPeriodDurationType: "Window period duration type",
  isActive: "Is active",
};

function timepointToDraft(timepoint) {
  return {
    order: String(timepoint.order ?? ""),
    label: timepoint.label,
    visitLabel: timepoint.visitLabel ?? "",
    studyVisitScheduleNo: timepoint.studyVisitScheduleNo ?? "",
    duration: formatTimepointDurationForInput(timepoint.duration),
    durationType: timepoint.durationType ?? "Hour",
    windowPeriodMinus:
      timepoint.windowPeriodMinus === "" || timepoint.windowPeriodMinus == null
        ? ""
        : formatTimepointDurationForInput(timepoint.windowPeriodMinus),
    windowPeriodPlus:
      timepoint.windowPeriodPlus === "" || timepoint.windowPeriodPlus == null
        ? ""
        : formatTimepointDurationForInput(timepoint.windowPeriodPlus),
    windowPeriodDurationType: timepoint.windowPeriodDurationType ?? "Hour",
    activityType: timepoint.activityType ?? "Post-Dose Blood Collection",
    isActive: timepoint.isActive !== false,
  };
}

function formatCell(value) {
  if (value === "" || value === null || value === undefined) return "";
  return value;
}

function formatVisitCell(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "-" || text === "—") return "—";
  return text;
}

function normalizeDraftCompareValue(key, draft) {
  if (key === "isActive") return draft.isActive !== false;
  if (key === "visit") return String(draft.visitLabel ?? "").trim();
  if (key === "label") return String(draft.label ?? "").trim();
  if (key === "order") {
    const n = Number(draft.order);
    return Number.isFinite(n) && n >= 1 ? String(Math.floor(n)) : String(draft.order ?? "").trim();
  }
  if (key === "duration" || key === "windowPeriodMinus" || key === "windowPeriodPlus") {
    const raw = draft[key];
    if (raw === "" || raw == null) return "";
    const n = Number(raw);
    return Number.isFinite(n) ? String(n) : String(raw).trim();
  }
  return String(draft[key] ?? "").trim();
}

function baselineCompareValue(key, baseline) {
  if (!baseline) return null;
  if (key === "visit") return String(baseline.visitLabel ?? "").trim();
  if (key === "isActive") return baseline.isActive !== false;
  if (key === "order") {
    const n = Number(baseline.order);
    return Number.isFinite(n) && n >= 1 ? String(Math.floor(n)) : String(baseline.order ?? "").trim();
  }
  if (key === "duration" || key === "windowPeriodMinus" || key === "windowPeriodPlus") {
    const raw = baseline[key];
    if (raw === "" || raw == null) return "";
    const n = Number(raw);
    return Number.isFinite(n) ? String(n) : String(raw).trim();
  }
  return String(baseline[key] ?? "").trim();
}

export function DoseTimepointsModal({
  open,
  dose,
  visitOptions = [],
  activityTypes = [],
  durationTypes = [],
  projectCode = "",
  loading = false,
  readOnly = false,
  onClose,
  onSaveTimepoints,
}) {
  const [timepoints, setTimepoints] = useState([]);
  const defaultActivityType = activityTypes[0] || "Post-Dose Blood Collection";
  const defaultDurationType = durationTypes[0] || "Hour";
  const [draft, setDraft] = useState(() =>
    createTimepointDraftDefaults(undefined, undefined, {
      activityType: defaultActivityType,
      durationType: defaultDurationType,
    })
  );
  const [editingId, setEditingId] = useState(null);
  const [editBaseline, setEditBaseline] = useState(null);
  const [remarks, setRemarks] = useState(EMPTY_TP_REMARKS);
  const [dismissed, setDismissed] = useState(EMPTY_TP_DISMISSED);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const formPanelRef = useRef(null);

  const tpNo = Number(editingId) || 0;
  const { openFieldAudit, auditModal, canAudit } = useAdminRecordAudit(
    tpNo > 0 ? tpNo : null,
    "ActivityConfigTimePoint"
  );

  const showToast = (message, variant = "warning") => {
    setToast({ message, variant });
  };

  const remarkToast = (message) => showToast(message, "warning");

  const clearToast = () => setToast(null);

  const doseVisitLabel = dose?.visitLabel ?? "";

  const normalizedVisitOptions = useMemo(() => {
    return (visitOptions ?? [])
      .map((visit) => {
        if (typeof visit === "string") {
          return { studyVisitScheduleDescription: visit, studyVisitScheduleNo: null };
        }

        const studyVisitScheduleDescription =
          visit.studyVisitScheduleDescription
          ?? visit.StudyVisitScheduleDescription
          ?? visit.visitScheduleDesc
          ?? visit.VisitScheduleDesc
          ?? "";

        return {
          studyVisitScheduleNo: visit.studyVisitScheduleNo ?? visit.StudyVisitScheduleNo ?? null,
          studyVisitScheduleDescription: String(studyVisitScheduleDescription).trim(),
        };
      })
      .filter((visit) => visit.studyVisitScheduleDescription);
  }, [visitOptions]);

  const visitSelectLabels = useMemo(() => {
    const labels = normalizedVisitOptions.map(
      (visit) => visit.studyVisitScheduleDescription ?? visit.StudyVisitScheduleDescription
    );
    const fromTimepoints = (timepoints ?? [])
      .map((timepoint) => timepoint.visitLabel ?? timepoint.studyVisitScheduleDescription)
      .filter(Boolean);

    return [...new Set([...labels, ...fromTimepoints])];
  }, [normalizedVisitOptions, timepoints]);

  const defaultVisitLabel =
    doseVisitLabel || visitSelectLabels[0] || "";
  const defaultVisitScheduleNo = resolveVisitScheduleNo(
    normalizedVisitOptions,
    defaultVisitLabel,
    dose?.studyVisitScheduleNo ?? 0
  );

  const resetRemarks = () => {
    setEditBaseline(null);
    setRemarks(EMPTY_TP_REMARKS);
    setDismissed(EMPTY_TP_DISMISSED);
  };

  useEffect(() => {
    if (!open || !dose || loading) return;
    const normalizedTimepoints = normalizeTimepointListOrders(dose.timepoints ?? []);
    setTimepoints(normalizedTimepoints);
    setDraft({
      ...createTimepointDraftDefaults(dose.label, defaultVisitLabel, {
        activityType: defaultActivityType,
        durationType: defaultDurationType,
      }),
      studyVisitScheduleNo: defaultVisitScheduleNo,
      order: String(getNextTimepointOrder(normalizedTimepoints)),
    });
    setEditingId(null);
    resetRemarks();
    clearToast();
  }, [open, dose, defaultVisitLabel, defaultVisitScheduleNo, loading]);

  const dirtyByField = useMemo(() => {
    if (!editingId || !editBaseline) {
      return Object.fromEntries(Object.keys(EMPTY_TP_REMARKS).map((k) => [k, false]));
    }
    return Object.fromEntries(
      Object.keys(EMPTY_TP_REMARKS).map((key) => [
        key,
        normalizeDraftCompareValue(key, draft) !== baselineCompareValue(key, editBaseline),
      ])
    );
  }, [editingId, editBaseline, draft]);

  useEffect(() => {
    setRemarks((current) => {
      let next = current;
      for (const key of Object.keys(EMPTY_TP_REMARKS)) {
        if (!dirtyByField[key] && current[key]) {
          if (next === current) next = { ...current };
          next[key] = "";
        }
      }
      return next;
    });
    setDismissed((current) => {
      let next = current;
      for (const key of Object.keys(EMPTY_TP_REMARKS)) {
        if (!dirtyByField[key] && current[key]) {
          if (next === current) next = { ...current };
          next[key] = false;
        }
      }
      return next;
    });
  }, [
    dirtyByField.order,
    dirtyByField.label,
    dirtyByField.activityType,
    dirtyByField.visit,
    dirtyByField.duration,
    dirtyByField.durationType,
    dirtyByField.windowPeriodMinus,
    dirtyByField.windowPeriodPlus,
    dirtyByField.windowPeriodDurationType,
    dirtyByField.isActive,
  ]);

  const clearDraft = () => {
    setDraft({
      ...createTimepointDraftDefaults(dose.label, defaultVisitLabel, {
        activityType: defaultActivityType,
        durationType: defaultDurationType,
      }),
      studyVisitScheduleNo: defaultVisitScheduleNo,
      order: String(getNextTimepointOrder(timepoints)),
    });
    setEditingId(null);
    resetRemarks();
    clearToast();
  };

  const updateDraft = (patch) => {
    if (readOnly) return;
    setDraft((current) => ({ ...current, ...patch }));
    const keys = Object.keys(patch);
    if (keys.includes("visitLabel") || keys.includes("studyVisitScheduleNo")) {
      setDismissed((current) => ({ ...current, visit: false }));
    }
    for (const key of keys) {
      if (key in EMPTY_TP_DISMISSED) {
        setDismissed((current) => ({ ...current, [key]: false }));
      }
    }
  };

  const handleSave = async () => {
    if (readOnly) return;

    const baseLabel = String(draft.label ?? "").trim();
    if (!baseLabel) {
      showToast("Time point name is required.", "warning");
      return;
    }
    if (!String(draft.activityType ?? "").trim()) {
      showToast("Activity type is required.", "warning");
      return;
    }
    if (!String(draft.visitLabel ?? "").trim()) {
      showToast("Visit is required.", "warning");
      return;
    }

    const requestedOrder = editingId
      ? Number(draft.order) || 1
      : getNextTimepointOrder(timepoints);
    if (editingId) {
      const orderNum = Number(draft.order);
      if (!Number.isFinite(orderNum) || orderNum < 1 || !Number.isInteger(orderNum)) {
        showToast("Order must be a whole number starting at 1.", "warning");
        return;
      }
    }

    const duplicateError = getTimepointDuplicateError(timepoints, dose.label, {
      baseLabel,
      order: requestedOrder,
      excludeId: editingId,
    });
    if (duplicateError) {
      showToast(duplicateError, "warning");
      return;
    }

    let fieldRemarks = {};
    if (editingId) {
      for (const key of Object.keys(EMPTY_TP_REMARKS)) {
        if (!dirtyByField[key]) continue;
        const text = String(remarks[key] || "").trim();
        if (!text || !dismissed[key]) {
          showToast(`Confirm a reason for ${TP_FIELD_LABELS[key]} before saving.`, "warning");
          setDismissed((current) => ({ ...current, [key]: false }));
          return;
        }
        fieldRemarks[key] = text;
      }
    }

    const existing = editingId ? timepoints.find((item) => item.id === editingId) : null;
    const nextTimepoint = buildTimepointFromDraft(
      {
        ...draft,
        order: requestedOrder,
        isActive: editingId ? draft.isActive !== false : true,
      },
      dose.label,
      existing,
      { manual: true }
    );
    if (editingId && Object.keys(fieldRemarks).length > 0) {
      nextTimepoint._fieldRemarks = fieldRemarks;
    }

    let nextList = editingId
      ? timepoints.map((item) => (item.id === editingId ? nextTimepoint : item))
      : [...timepoints, nextTimepoint];

    nextList = normalizeTimepointListOrders(nextList);

    setTimepoints(nextList);
    clearDraft();
    clearToast();

    try {
      setSaving(true);
      await Promise.resolve(onSaveTimepoints(nextList));
    } catch (saveError) {
      showToast(saveError?.message || "Failed to save time points.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (timepoint) => {
    setEditingId(timepoint.id);
    const draftSnapshot = timepointToDraft(timepoint);
    setDraft(draftSnapshot);
    // View-only (published / inactive dose): load fields for display + audit, no edit baseline.
    setEditBaseline(readOnly ? null : draftSnapshot);
    setRemarks(EMPTY_TP_REMARKS);
    setDismissed(EMPTY_TP_DISMISSED);
    clearToast();
    formPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const handleDismiss = () => {
    onClose();
  };

  const isImpDoseForm = isImpDoseActivityType(draft.activityType);
  const hideScheduleFields = isScheduleFieldsHiddenForActivityType(draft.activityType);
  const formLocked = Boolean(readOnly);

  const renderRemarkField = (fieldKey, columnKey, labelNode, control) => {
    const dirty = Boolean(!formLocked && editingId && dirtyByField[fieldKey]);
    const isDismissed = dismissed[fieldKey];
    const remarkText = remarks[fieldKey];
    const fieldLabel = TP_FIELD_LABELS[fieldKey] || fieldKey;
    const auditColumn = ACTIVITY_CONFIG_TIMEPOINT_FIELD_TO_COLUMN[columnKey] ?? columnKey;

    return (
      <div className="field field--with-audit">
        <AdminFieldLabel
          showAudit={canAudit}
          onOpenAudit={() => openFieldAudit(auditColumn, fieldLabel)}
          showReopenX={Boolean(!formLocked && editingId && dirty && isDismissed && String(remarkText || "").trim())}
          remarkText={remarkText}
          onReopenRemark={() => setDismissed((current) => ({ ...current, [fieldKey]: false }))}
        >
          {labelNode}
        </AdminFieldLabel>
        {control}
        {!formLocked && editingId && dirty && !isDismissed ? (
          <EditFieldRemarkAttach
            show
            floating
            value={remarkText}
            onChange={(value) => setRemarks((current) => ({ ...current, [fieldKey]: value }))}
            onConfirm={() => setDismissed((current) => ({ ...current, [fieldKey]: true }))}
            toast={remarkToast}
          />
        ) : null}
      </div>
    );
  };

  const timepointColumns = useMemo(
    () => [
      { key: "order", label: "Order", align: "center" },
      {
        key: "label",
        label: "Time point name",
        render: (timepoint) => (
          <span className="config-data-table__truncate" title={timepoint.label}>
            {timepoint.label}
          </span>
        ),
      },
      {
        key: "activityType",
        label: "Activity type",
        render: (timepoint) => (
          <span className="config-data-table__truncate" title={timepoint.activityType}>
            {formatCell(timepoint.activityType)}
          </span>
        ),
      },
      {
        key: "visitLabel",
        label: "Visit",
        render: (timepoint) => (
          <span className="config-data-table__truncate" title={formatVisitCell(timepoint.visitLabel)}>
            {formatVisitCell(timepoint.visitLabel)}
          </span>
        ),
      },
      {
        key: "duration",
        label: "Duration",
        align: "center",
        render: (timepoint) =>
          isScheduleFieldsHiddenForActivityType(timepoint.activityType)
            ? ""
            : formatTimepointDuration(timepoint.duration),
      },
      {
        key: "durationType",
        label: "Duration type",
        align: "center",
        render: (timepoint) =>
          isScheduleFieldsHiddenForActivityType(timepoint.activityType)
            ? ""
            : formatCell(timepoint.durationType),
      },
      {
        key: "windowPeriodMinus",
        label: "Window (-)",
        align: "center",
        render: (timepoint) =>
          isScheduleFieldsHiddenForActivityType(timepoint.activityType)
            ? ""
            : formatTimepointDuration(timepoint.windowPeriodMinus),
      },
      {
        key: "windowPeriodPlus",
        label: "Window (+)",
        align: "center",
        render: (timepoint) =>
          isScheduleFieldsHiddenForActivityType(timepoint.activityType)
            ? ""
            : formatTimepointDuration(timepoint.windowPeriodPlus),
      },
      {
        key: "windowPeriodDurationType",
        label: "Window type",
        align: "center",
        render: (timepoint) =>
          isScheduleFieldsHiddenForActivityType(timepoint.activityType)
            ? ""
            : formatCell(timepoint.windowPeriodDurationType),
      },
      {
        key: "isActive",
        label: "Status",
        align: "center",
        render: (timepoint) => (
          <span className={`status-badge status-badge--compact ${timepoint.isActive === false ? "status--inactive" : "status--completed"}`}>
            {timepoint.isActive === false ? "Inactive" : "Active"}
          </span>
        ),
      },
    ],
    []
  );

  if (!open || !dose) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal modal--wide activity-config-timepoints-modal activity-config-timepoints-modal--extended"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {auditModal}
        <SoftAlertToast
          title={
            toast?.variant === "error"
              ? "Error"
              : toast?.variant === "success" || toast?.variant === "ok"
                ? "Success"
                : "Alert"
          }
          message={toast?.message}
          variant={toast?.variant || "warning"}
          onClose={clearToast}
        />
        <h3 className="modal__title activity-config-timepoints-modal__title">
          Time points — {dose.label}
          {readOnly ? " (view only)" : ""}
        </h3>

        {loading ? (
          <p className="empty-state">Loading time points...</p>
        ) : (
        <>
        {(editingId || !formLocked) && (
        <div
          ref={formPanelRef}
          className={`activity-config-timepoints-modal__form-panel${editingId ? " activity-config-timepoints-modal__form-panel--editing" : ""}`}
        >
          {editingId && (
            <p className="activity-config-timepoints-modal__edit-banner">
              {formLocked ? "Viewing" : "Editing"}:{" "}
              <strong>{getTimepointBaseLabel(draft.label) || "Time point"}</strong>
            </p>
          )}

          <div
            className={`activity-config-timepoints-modal__form activity-config-timepoints-modal__form--extended${
              hideScheduleFields ? " activity-config-timepoints-modal__form--imp-dose" : ""
            }`}
          >
            {editingId && !formLocked
              ? renderRemarkField(
                  "order",
                  "order",
                  <>Order <span className="field__required">*</span></>,
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={draft.order}
                    onChange={(event) => updateDraft({ order: event.target.value })}
                    title="Display order for this time point"
                  />
                )
              : editingId && formLocked
                ? renderRemarkField(
                    "order",
                    "order",
                    <>Order <span className="field__required">*</span></>,
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={draft.order}
                      disabled
                      readOnly
                      className="field--disabled"
                      title="Published / locked time points cannot be changed"
                    />
                  )
              : (
                <label className="field">
                  <span>Order <span className="field__required">*</span></span>
                  <input
                    type="number"
                    min="1"
                    value={draft.order}
                    readOnly
                    className="field--disabled"
                    aria-readonly="true"
                    title="Order is assigned automatically when adding a time point"
                  />
                </label>
              )}
            {renderRemarkField(
              "label",
              "label",
              <>Time point name <span className="field__required">*</span></>,
              <input
                value={draft.label}
                disabled={formLocked}
                readOnly={formLocked}
                className={formLocked ? "field--disabled" : undefined}
                onChange={(event) => updateDraft({ label: event.target.value })}
                placeholder={isImpDoseForm ? "e.g. Dose 1" : "e.g. Pre-Dose"}
              />
            )}
            {renderRemarkField(
              "activityType",
              "activityType",
              <>Activity type <span className="field__required">*</span></>,
              <ScrollableSelect
                value={draft.activityType}
                disabled={formLocked}
                onChange={(nextValue) => updateDraft({ activityType: nextValue })}
                options={activityTypes}
                allowEmpty={false}
              />
            )}
            {renderRemarkField(
              "visit",
              "visit",
              <>Visit <span className="field__required">*</span></>,
              <ScrollableSelect
                value={draft.visitLabel}
                disabled={formLocked}
                onChange={(nextValue) => {
                  const studyVisitScheduleNo = resolveVisitScheduleNo(
                    normalizedVisitOptions,
                    nextValue,
                    dose?.studyVisitScheduleNo ?? 0
                  );
                  updateDraft({ visitLabel: nextValue, studyVisitScheduleNo });
                }}
                options={visitSelectLabels}
                placeholder="Select visit"
                allowEmpty={false}
                searchable
              />
            )}
            {!hideScheduleFields && (
              <>
            {renderRemarkField(
              "duration",
              "duration",
              "Duration",
              <input
                type="number"
                step="any"
                value={draft.duration}
                disabled={formLocked}
                readOnly={formLocked}
                className={formLocked ? "field--disabled" : undefined}
                onChange={(event) => updateDraft({ duration: event.target.value })}
              />
            )}
            {renderRemarkField(
              "durationType",
              "durationType",
              "Duration type",
              <ScrollableSelect
                value={draft.durationType}
                disabled={formLocked}
                onChange={(nextValue) => updateDraft({ durationType: nextValue })}
                options={durationTypes}
                allowEmpty={false}
              />
            )}
            {renderRemarkField(
              "windowPeriodMinus",
              "windowPeriodMinus",
              "Window period (-)",
              <input
                type="number"
                step="any"
                value={draft.windowPeriodMinus}
                disabled={formLocked}
                readOnly={formLocked}
                className={formLocked ? "field--disabled" : undefined}
                onChange={(event) => updateDraft({ windowPeriodMinus: event.target.value })}
              />
            )}
            {renderRemarkField(
              "windowPeriodPlus",
              "windowPeriodPlus",
              "Window period (+)",
              <input
                type="number"
                step="any"
                value={draft.windowPeriodPlus}
                disabled={formLocked}
                readOnly={formLocked}
                className={formLocked ? "field--disabled" : undefined}
                onChange={(event) => updateDraft({ windowPeriodPlus: event.target.value })}
              />
            )}
            {renderRemarkField(
              "windowPeriodDurationType",
              "windowPeriodDurationType",
              "Window period duration type",
              <ScrollableSelect
                value={draft.windowPeriodDurationType}
                disabled={formLocked}
                onChange={(nextValue) => updateDraft({ windowPeriodDurationType: nextValue })}
                options={durationTypes}
                allowEmpty={false}
              />
            )}
              </>
            )}
            <div className="field field--checkbox field--with-audit field--with-audit-stack activity-config-timepoints-modal__active-field">
              <div className="field--checkbox-row">
              <input
                type="checkbox"
                id="timepoint-is-active"
                checked={editingId ? draft.isActive !== false : true}
                disabled={formLocked || !editingId}
                className={formLocked || !editingId ? "field--disabled" : undefined}
                title={
                  formLocked
                    ? "Published / locked time points cannot be changed"
                    : editingId
                      ? "Set time point active or inactive"
                      : "Is active is available when editing an existing time point"
                }
                onChange={(event) => {
                  if (formLocked || !editingId) return;
                  updateDraft({ isActive: event.target.checked });
                }}
              />
              <AdminFieldLabel
                htmlFor="timepoint-is-active"
                variant="checkbox"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit(ACTIVITY_CONFIG_TIMEPOINT_FIELD_TO_COLUMN.isActive, "Is active")}
                showReopenX={Boolean(
                  !formLocked
                  && editingId
                  && dirtyByField.isActive
                  && dismissed.isActive
                  && String(remarks.isActive || "").trim()
                )}
                remarkText={remarks.isActive}
                onReopenRemark={() => setDismissed((current) => ({ ...current, isActive: false }))}
              >
                Is active
              </AdminFieldLabel>
              </div>
              {!formLocked && editingId && dirtyByField.isActive && !dismissed.isActive ? (
                <EditFieldRemarkAttach
                  show
                  floating
                  value={remarks.isActive}
                  onChange={(value) => setRemarks((current) => ({ ...current, isActive: value }))}
                  onConfirm={() => setDismissed((current) => ({ ...current, isActive: true }))}
                  toast={remarkToast}
                />
              ) : null}
            </div>
          </div>
        </div>
        )}

        <div className="activity-config-timepoints-modal__table-region">
          <ConfigDataTable
            columns={timepointColumns}
            rows={timepoints}
            emptyMessage="No time points configured for this dose."
            variant="timepoint-extended"
            getRowKey={(timepoint) => timepoint.id}
            getRowClassName={(timepoint) => (timepoint.isActive === false ? "config-data-table__row--inactive" : "")}
            onRowClick={handleEdit}
            selectedRowKey={editingId}
            paginated
            defaultPageSize={10}
          />
        </div>

        <div className="modal__actions modal__actions--center activity-config-timepoints-modal__actions">
          {!formLocked && (
            <button type="button" className="btn btn--primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          )}
          {!formLocked && (
            <button type="button" className="btn btn--secondary" onClick={clearDraft} disabled={saving}>
              Clear
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={handleDismiss} disabled={saving}>
            Close
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
