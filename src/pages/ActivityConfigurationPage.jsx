import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLocation, useNavigate } from "react-router-dom";

import { ConfigDataTable } from "../components/shared/ConfigDataTable";

import { DoseTimepointsModal } from "../components/shared/DoseTimepointsModal";

import { PasswordConfirmModal, ConfirmModal } from "../components/shared/Modal";

import { ScrollableSelect } from "../components/shared/ScrollableSelect";

import { SoftAlertToast } from "../components/shared/SoftAlertToast";

import { AdminFieldLabel } from "../components/shared/AdminFieldLabel.jsx";
import { EditFieldRemarkAttach } from "../components/shared/EditFieldRemark.jsx";
import { AuditHistoryModal } from "../components/shared/AuditHistoryModal.jsx";
import { DbAuditHistoryTableBody } from "../components/shared/DbAuditHistoryTableBody.jsx";
import { useAdminRecordAudit } from "../hooks/useAdminRecordAudit.jsx";

import { useAuth } from "../context/AuthContext";
import { useActivityConfigPdfImport } from "../context/ActivityConfigPdfImportContext";
import { useViewport } from "../hooks/useViewport";

import { PdfImportPanel } from "../features/activityConfiguration/components/PdfImportPanel.jsx";
import { PdfImportAuditModal } from "../features/activityConfiguration/components/PdfImportAuditModal.jsx";
import { TimepointExportLogModal } from "../features/activityConfiguration/components/TimepointExportLogModal.jsx";
import {
  getActivityConfiguration,
  saveActivityConfiguration,
  updateAliquotSettings,
  getDoseTimepoints,
  saveDoseTimepoints,
  getActivityVisitOptions,
  getAllActivityVisitOptions,
  getActivityConfigurationFormOptions,
  publishActivityDoses,
  getTimepointExportLogs,
  exportActivityTimepoints,
  deletePdfImportedDose,
} from "../features/activityConfiguration/api/activityConfigurationApi.js";
import { isPdfImportAbortError } from "../features/activityConfiguration/services/activityConfigurationPdfImportJob.js";
import { validatePassword } from "../features/auth/api/authApi.js";
import {
  dosesToLegacyPeriods,
  getNextDoseOrder,
  mapApiTimepointToUi,
  normalizeTimepointListOrders,
  mapUiDoseToApi,
  mapUiTimepointToApi,
  validateTimepointsApiPayload,
  resolveVisitDescription,
  resolveDoseNo,
  upsertDoseInList,
  visitOptionsToSelectOptions,
} from "../features/activityConfiguration/utils/activityConfigurationMappers.js";
import {
  ACTIVITY_CONFIG_DOSE_FIELD_TO_COLUMN,
  mapUiAuditEntriesToReasonsByAuditedColumn,
} from "../features/activityConfiguration/utils/activityConfigAuditTargets.js";

import {
  getDoseDuplicateError,
  normalizeDoseLabel,
  resolveDoseOrder,
  normalizeTimepointLabelForDose,
} from "../services/activityConfigurationService";



const EMPTY_DOSE_FORM = {
  order: "",
  label: "",
  studyVisitScheduleNo: "",
  periodLabel: "",
  isActive: true,
};

export default function ActivityConfigurationPage() {

  const navigate = useNavigate();
  const location = useLocation();
  const { isMobileOrTablet } = useViewport();
  const { user } = useAuth();
  const authProjectCode = user?.project?.trim() ?? "";
  const projectCode = authProjectCode;
  const projectId = authProjectCode;

  const [doses, setDoses] = useState([]);
  const [visitOptions, setVisitOptions] = useState([]);
  const [timepointVisitOptions, setTimepointVisitOptions] = useState([]);
  const [formOptions, setFormOptions] = useState({ activityTypes: [], durationTypes: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [timepointsLoading, setTimepointsLoading] = useState(false);

  const [aliquotsPerSeparation, setAliquotsPerSeparation] = useState("3");
  const [centrifugeTimeMinutes, setCentrifugeTimeMinutes] = useState("10");
  const [projectParameterNo, setProjectParameterNo] = useState(0);
  const [centrifugeTimeProjectParameterNo, setCentrifugeTimeProjectParameterNo] = useState(0);

  const [doseForm, setDoseForm] = useState(EMPTY_DOSE_FORM);

  const [editingDoseId, setEditingDoseId] = useState(null);
  const [editDoseBaseline, setEditDoseBaseline] = useState(null);
  /** When true, upper form shows a published dose read-only (with audit history). */
  const [viewingPublishedDose, setViewingPublishedDose] = useState(false);
  const [remarkLabel, setRemarkLabel] = useState("");
  const [remarkVisit, setRemarkVisit] = useState("");
  const [remarkPeriod, setRemarkPeriod] = useState("");
  const [remarkIsActive, setRemarkIsActive] = useState("");
  const [labelRemarkDismissed, setLabelRemarkDismissed] = useState(false);
  const [visitRemarkDismissed, setVisitRemarkDismissed] = useState(false);
  const [periodRemarkDismissed, setPeriodRemarkDismissed] = useState(false);
  const [isActiveRemarkDismissed, setIsActiveRemarkDismissed] = useState(false);

  const [message, setMessage] = useState(null);

  const { openFieldAudit, auditModal, canAudit } = useAdminRecordAudit(
    editingDoseId && Number(editingDoseId) > 0 ? editingDoseId : null,
    "ActivityConfigDose"
  );

  const remarkToast = (msg) => setMessage({ type: "error", text: msg });

  const [timepointModalDose, setTimepointModalDose] = useState(null);

  const [aliquotSettingsOpen, setAliquotSettingsOpen] = useState(false);
  const [aliquotSettingsDraft, setAliquotSettingsDraft] = useState("3");
  const [centrifugeTimeDraft, setCentrifugeTimeDraft] = useState("10");
  const [aliquotAuditOpen, setAliquotAuditOpen] = useState(false);
  const [centrifugeAuditOpen, setCentrifugeAuditOpen] = useState(false);
  const [aliquotChangeReason, setAliquotChangeReason] = useState("");
  const [centrifugeChangeReason, setCentrifugeChangeReason] = useState("");
  const [aliquotRemarkDismissed, setAliquotRemarkDismissed] = useState(false);
  const [centrifugeRemarkDismissed, setCentrifugeRemarkDismissed] = useState(false);
  const [aliquotSettingsError, setAliquotSettingsError] = useState("");

  const [selectedDoseIds, setSelectedDoseIds] = useState(() => new Set());
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [exportLogOpen, setExportLogOpen] = useState(false);
  const [exportLogs, setExportLogs] = useState([]);
  const [exportLogsLoading, setExportLogsLoading] = useState(false);
  const [exportingLogId, setExportingLogId] = useState(null);
  const [exportingNewLog, setExportingNewLog] = useState(false);
  const [activeConfigTab, setActiveConfigTab] = useState("ai");
  const [pdfPendingFile, setPdfPendingFile] = useState(null);
  const [pdfProceedModalOpen, setPdfProceedModalOpen] = useState(false);
  const [pdfActionTaskNo, setPdfActionTaskNo] = useState(null);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfCancelling, setPdfCancelling] = useState(false);
  const pdfAbortRef = useRef(null);
  const [pdfImportAuditOpen, setPdfImportAuditOpen] = useState(false);
  const [pdfImportAuditLoading, setPdfImportAuditLoading] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({
    open: false,
    title: "",
    message: "",
    confirmLabel: "Confirm",
    onConfirm: null,
  });

  const showConfirm = (title, message, onConfirm, confirmLabel = "Confirm") => {
    setConfirmConfig({
      open: true,
      title,
      message,
      confirmLabel,
      onConfirm,
    });
  };
  const {
    isImporting: pdfImporting,
    stageLabel: pdfImportStageLabel,
    importTasks: pdfImportTasks,
    refreshing: pdfImportRefreshing,
    uploadPdf,
    proceedPdfImport,
    cancelUploadedPdf,
    refreshImportTasks,
    registerCompletionListener,
  } = useActivityConfigPdfImport();



  const visitSelectOptions = useMemo(
    () => visitOptionsToSelectOptions(visitOptions),
    [visitOptions]
  );

  const legacyPeriods = useMemo(() => dosesToLegacyPeriods(doses), [doses]);

  const nextDoseOrder = useMemo(() => getNextDoseOrder(doses), [doses]);

  const loadConfiguration = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) {
      setLoading(true);
    }
    try {
      const [config, visits, options] = await Promise.all([
        getActivityConfiguration(),
        getActivityVisitOptions(),
        getActivityConfigurationFormOptions(),
      ]);
      setVisitOptions(visits);
      setFormOptions({
        activityTypes: options.activityTypes ?? [],
        durationTypes: options.durationTypes ?? [],
      });
      setAliquotsPerSeparation(String(config.aliquotsPerSeparation ?? 3));
      setCentrifugeTimeMinutes(String(config.centrifugeTimeMinutes ?? 10));
      setProjectParameterNo(Number(config.projectParameterNo) || 0);
      setCentrifugeTimeProjectParameterNo(Number(config.centrifugeTimeProjectParameterNo) || 0);
      const mappedDoses = config.doses ?? [];
      setDoses(mappedDoses);
      return { config, visits, doses: mappedDoses };
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Failed to load activity configuration." });
      setDoses([]);
      throw error;
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => registerCompletionListener(async () => {
    await loadConfiguration({ showLoading: false });
  }), [registerCompletionListener, loadConfiguration]);

  useEffect(() => {
    if (activeConfigTab !== "ai") return;
    refreshImportTasks().catch(() => {});
  }, [activeConfigTab, refreshImportTasks]);


  useEffect(() => {
    loadConfiguration().catch(() => {});
  }, [loadConfiguration, authProjectCode, location.key]);



  useEffect(() => {

    if (editingDoseId || doseForm.label) return;

    const defaultVisit = visitSelectOptions[0]?.value ?? "";

    setDoseForm((current) => ({

      ...current,

      order: String(nextDoseOrder),

      studyVisitScheduleNo: current.studyVisitScheduleNo || defaultVisit,

    }));

  }, [nextDoseOrder, editingDoseId, doseForm.label, visitSelectOptions]);



  const doseRows = useMemo(() => [...doses].sort((left, right) => (left.order ?? 0) - (right.order ?? 0)), [doses]);

  const doseHasTimepoints = useCallback((dose) => {
    const count = Number(dose?.timePointCount);
    if (Number.isFinite(count) && count > 0) return true;
    return Array.isArray(dose?.timepoints) && dose.timepoints.some((tp) => tp?.isActive !== false);
  }, []);

  const publishableDoseRows = useMemo(
    () => doseRows.filter((dose) => dose.isActive !== false && !dose.isPublished),
    [doseRows]
  );

  /** Unpublished + active + has at least one time point (eligible to select for publish). */
  const selectablePublishDoseRows = useMemo(
    () => publishableDoseRows.filter((dose) => doseHasTimepoints(dose)),
    [publishableDoseRows, doseHasTimepoints]
  );

  /** Published + active + has time points (eligible for new export from Export Log). */
  const publishedExportableDoses = useMemo(
    () =>
      doseRows
        .filter(
          (dose) =>
            dose.isPublished
            && dose.isActive !== false
            && doseHasTimepoints(dose)
        )
        .map((dose) => ({
          doseNo: resolveDoseNo(dose),
          label: normalizeDoseLabel(dose.label) || `Dose ${resolveDoseNo(dose)}`,
        }))
        .filter((dose) => dose.doseNo > 0),
    [doseRows, doseHasTimepoints]
  );

  const selectedPublishableCount = useMemo(
    () => selectablePublishDoseRows.filter((dose) => selectedDoseIds.has(resolveDoseNo(dose))).length,
    [selectablePublishDoseRows, selectedDoseIds]
  );

  const selectedPdfDraftDoses = useMemo(
    () =>
      selectablePublishDoseRows.filter(
        (dose) => selectedDoseIds.has(resolveDoseNo(dose)) && dose.createdBySource === "Pdf"
      ),
    [selectablePublishDoseRows, selectedDoseIds]
  );

  const selectedPdfDraftCount = selectedPdfDraftDoses.length;

  useEffect(() => {
    setSelectedDoseIds((current) => {
      const validIds = new Set(
        selectablePublishDoseRows.map((dose) => resolveDoseNo(dose)).filter((doseNo) => doseNo > 0)
      );
      const next = new Set();
      for (const doseNo of current) {
        if (validIds.has(doseNo)) {
          next.add(doseNo);
        }
      }
      return next.size === current.size ? current : next;
    });
  }, [selectablePublishDoseRows]);

  const labelDirty = Boolean(
    editingDoseId
    && editDoseBaseline
    && String(doseForm.label ?? "").trim() !== String(editDoseBaseline.label ?? "").trim()
  );
  const visitDirty = Boolean(
    editingDoseId
    && editDoseBaseline
    && String(doseForm.studyVisitScheduleNo ?? "") !== String(editDoseBaseline.studyVisitScheduleNo ?? "")
  );
  const periodDirty = Boolean(
    editingDoseId
    && editDoseBaseline
    && String(Number(doseForm.periodLabel) || 1) !== String(Number(editDoseBaseline.periodLabel) || 1)
  );
  const isActiveDirty = Boolean(
    editingDoseId
    && editDoseBaseline
    && (doseForm.isActive !== false) !== (editDoseBaseline.isActive !== false)
  );

  useEffect(() => {
    if (!labelDirty) {
      setRemarkLabel("");
      setLabelRemarkDismissed(false);
    }
  }, [labelDirty]);
  useEffect(() => {
    if (!visitDirty) {
      setRemarkVisit("");
      setVisitRemarkDismissed(false);
    }
  }, [visitDirty]);
  useEffect(() => {
    if (!periodDirty) {
      setRemarkPeriod("");
      setPeriodRemarkDismissed(false);
    }
  }, [periodDirty]);
  useEffect(() => {
    if (!isActiveDirty) {
      setRemarkIsActive("");
      setIsActiveRemarkDismissed(false);
    }
  }, [isActiveDirty]);

  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /** Backend already stores UTC — format only, do not shift timezones. Output: DD-MMM-YYYY HH:MM */
  const formatAuditUtc = (iso) => {
    if (!iso) return "—";
    const raw = String(iso).trim();
    const match = raw.match(
      /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/
    );
    if (match) {
      const day = match[3];
      const month = MONTH_SHORT[Number(match[2]) - 1] || match[2];
      const year = match[1];
      const hour = match[4];
      const minute = match[5];
      return `${day}-${month}-${year} ${hour}:${minute}`;
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return "—";
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const mmm = MONTH_SHORT[date.getUTCMonth()];
    const yyyy = date.getUTCFullYear();
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mm = String(date.getUTCMinutes()).padStart(2, "0");
    return `${dd}-${mmm}-${yyyy} ${hh}:${mm}`;
  };

  /** Keep stored offset as Â±HH:MM only (drop seconds). */
  const formatDoseRecordedAtOffset = (dose) => {
    const stored = String(dose?.recordedAtOffset ?? "").trim();
    if (!stored) return "—";
    const match = stored.match(/^([+-])(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) return stored;
    return `${match[1]}${String(match[2]).padStart(2, "0")}:${match[3]}`;
  };



  const refreshDoseTimepoints = useCallback(async (doseNo) => {
    const result = await getDoseTimepoints(doseNo);
    const mapped = normalizeTimepointListOrders(
      (result.timepoints ?? []).map(mapApiTimepointToUi)
    );
    return mapped;
  }, []);

  const persistDoses = async (nextDoses, successMessage, configOptions = {}, remarksMeta = null) => {
    if (saving) return;

    try {
      setSaving(true);
      const doseId = remarksMeta ? Number(remarksMeta.doseId) || 0 : 0;
      const fieldRemarks = remarksMeta?.fieldRemarks ?? {};
      const auditReasonsByAuditedColumn = mapUiAuditEntriesToReasonsByAuditedColumn(
        Object.entries(fieldRemarks).map(([field, reason]) => ({ field, reason })),
        ACTIVITY_CONFIG_DOSE_FIELD_TO_COLUMN
      );
      const payload = {
        aliquotsPerSeparation: Number(configOptions.aliquotsPerSeparation ?? aliquotsPerSeparation) || 3,
        centrifugeTimeMinutes: Number(configOptions.centrifugeTimeMinutes ?? centrifugeTimeMinutes) || 10,
        doses: nextDoses.map((dose) => {
          const id = resolveDoseNo(dose);
          const remarks = doseId > 0 && id === doseId ? fieldRemarks : {};
          return mapUiDoseToApi(dose, visitOptions, remarks);
        }),
        ...(auditReasonsByAuditedColumn
          ? {
              auditReasonsByAuditedColumn,
              auditReason: Object.values(fieldRemarks).find((r) => String(r || "").trim()) || undefined,
            }
          : {}),
      };
      await saveActivityConfiguration(payload);
      await loadConfiguration({ showLoading: false });
      if (successMessage) {
        setMessage({ type: "ok", text: successMessage });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Failed to save activity configuration." });
      throw error;
    } finally {
      setSaving(false);
    }
  };



  const handleSaveAliquotSettings = async () => {
    if (!projectId) {
      setMessage({ type: "error", text: "Project is not available." });
      return;
    }

    const parsedAliquots = Number(aliquotSettingsDraft);
    if (!Number.isFinite(parsedAliquots) || parsedAliquots < 1) {
      setAliquotSettingsError("Aliquots per separation must be 1 or greater.");
      return;
    }

    const parsedCentrifuge = Number(centrifugeTimeDraft);
    if (!Number.isFinite(parsedCentrifuge) || parsedCentrifuge < 1) {
      setAliquotSettingsError("Centrifuge time must be 1 minute or greater.");
      return;
    }

    const normalizedAliquots = String(Math.floor(parsedAliquots));
    const normalizedCentrifuge = String(Math.floor(parsedCentrifuge));
    const aliquotsChanged = normalizedAliquots !== aliquotsPerSeparation;
    const centrifugeChanged = normalizedCentrifuge !== centrifugeTimeMinutes;
    // Defaults are shown before any ProjectParameter row exists — still persist on first Save.
    const aliquotsNeedsPersist = aliquotsChanged || projectParameterNo <= 0;
    const centrifugeNeedsPersist = centrifugeChanged || centrifugeTimeProjectParameterNo <= 0;

    if (!aliquotsNeedsPersist && !centrifugeNeedsPersist) {
      setMessage({ type: "ok", text: "No changes to save." });
      setAliquotSettingsOpen(false);
      return;
    }

    if (aliquotsChanged && (!String(aliquotChangeReason || "").trim() || !aliquotRemarkDismissed)) {
      setMessage({ type: "error", text: "Confirm a reason for Aliquots Per Separation before saving." });
      return;
    }

    if (centrifugeChanged && (!String(centrifugeChangeReason || "").trim() || !centrifugeRemarkDismissed)) {
      setMessage({ type: "error", text: "Confirm a reason for Centrifuge Time before saving." });
      return;
    }

    try {
      setSaving(true);
      const currentConfig = await getActivityConfiguration();
      const source = (currentConfig.doses ?? []).length > 0 ? currentConfig.doses : doses;
      const dosesForSave = source.map((dose) => mapUiDoseToApi(dose, visitOptions));

      await updateAliquotSettings({
        aliquotsPerSeparation: parsedAliquots,
        centrifugeTimeMinutes: parsedCentrifuge,
        doses: dosesForSave,
        aliquotRemark: aliquotsChanged ? String(aliquotChangeReason).trim() : "",
        centrifugeRemark: centrifugeChanged ? String(centrifugeChangeReason).trim() : "",
      });
      await loadConfiguration({ showLoading: false });
      setMessage({
        type: "ok",
        text: "Activity settings saved.",
      });
      setAliquotChangeReason("");
      setCentrifugeChangeReason("");
      setAliquotRemarkDismissed(false);
      setCentrifugeRemarkDismissed(false);
      setAliquotSettingsError("");
      setAliquotSettingsOpen(false);
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Failed to save aliquot settings." });
    } finally {
      setSaving(false);
    }
  };

  const openAliquotSettings = () => {
    setAliquotSettingsDraft(aliquotsPerSeparation);
    setCentrifugeTimeDraft(centrifugeTimeMinutes);
    setAliquotChangeReason("");
    setCentrifugeChangeReason("");
    setAliquotRemarkDismissed(false);
    setCentrifugeRemarkDismissed(false);
    setAliquotSettingsError("");
    setAliquotSettingsOpen(true);
  };

  const closeAliquotSettings = () => {
    setAliquotSettingsOpen(false);
    setAliquotSettingsDraft(aliquotsPerSeparation);
    setCentrifugeTimeDraft(centrifugeTimeMinutes);
    setAliquotChangeReason("");
    setCentrifugeChangeReason("");
    setAliquotRemarkDismissed(false);
    setCentrifugeRemarkDismissed(false);
    setAliquotSettingsError("");
  };

  const aliquotValueChanged = aliquotSettingsDraft !== aliquotsPerSeparation;
  const centrifugeValueChanged = centrifugeTimeDraft !== centrifugeTimeMinutes;

  useEffect(() => {
    if (!aliquotValueChanged) {
      setAliquotChangeReason("");
      setAliquotRemarkDismissed(false);
    }
  }, [aliquotValueChanged]);

  useEffect(() => {
    if (!centrifugeValueChanged) {
      setCentrifugeChangeReason("");
      setCentrifugeRemarkDismissed(false);
    }
  }, [centrifugeValueChanged]);
  const resetDoseRemarks = () => {
    setEditDoseBaseline(null);
    setRemarkLabel("");
    setRemarkVisit("");
    setRemarkPeriod("");
    setRemarkIsActive("");
    setLabelRemarkDismissed(false);
    setVisitRemarkDismissed(false);
    setPeriodRemarkDismissed(false);
    setIsActiveRemarkDismissed(false);
  };

  const clearDoseForm = (doseList) => {
    const list = Array.isArray(doseList) ? doseList : doses;
    setDoseForm({
      ...EMPTY_DOSE_FORM,
      order: String(getNextDoseOrder(list)),
      studyVisitScheduleNo: visitSelectOptions[0]?.value ?? "",
    });
    setEditingDoseId(null);
    setViewingPublishedDose(false);
    resetDoseRemarks();
  };



  const handleClose = () => {

    clearDoseForm();

    navigate("/execute");

  };



  const handleSaveDose = async () => {

    const label = doseForm.label.trim();

    if (!label) {

      setMessage({ type: "error", text: "Dose name is required." });

      return;

    }

    if (editingDoseId) {
      const existing = doses.find((dose) => dose.id === editingDoseId);
      if (existing?.isPublished || viewingPublishedDose) {
        setMessage({ type: "error", text: "Published doses cannot be edited." });
        return;
      }

      const requireRemark = (dirty, dismissed, remark, fieldLabel) => {
        if (!dirty) return true;
        if (!String(remark || "").trim() || !dismissed) {
          setMessage({ type: "error", text: `Confirm a reason for ${fieldLabel} before saving.` });
          return false;
        }
        return true;
      };
      if (!requireRemark(labelDirty, labelRemarkDismissed, remarkLabel, "Dose Name")) return;
      if (!requireRemark(visitDirty, visitRemarkDismissed, remarkVisit, "Visit")) return;
      if (!requireRemark(periodDirty, periodRemarkDismissed, remarkPeriod, "Period")) return;
      if (!requireRemark(isActiveDirty, isActiveRemarkDismissed, remarkIsActive, "Is Active")) return;
    }

    const normalizedLabel = normalizeDoseLabel(label);
    const studyVisitScheduleNo = Number(doseForm.studyVisitScheduleNo);
    const resolvedVisit = resolveVisitDescription(visitOptions, studyVisitScheduleNo);

    if (!studyVisitScheduleNo || !resolvedVisit) {

      setMessage({ type: "error", text: "Visit is required." });

      return;

    }

    const requestedOrder = resolveDoseOrder(normalizedLabel, doseForm.order);
    const period = Number(doseForm.periodLabel) || 1;

    const duplicateError = getDoseDuplicateError(legacyPeriods, {

      label: normalizedLabel,

      order: requestedOrder,

      excludeId: editingDoseId,

    });

    if (duplicateError) {

      setMessage({ type: "error", text: duplicateError });

      return;

    }

    let updatedDose;

    if (editingDoseId) {

      const existing = doses.find((dose) => dose.id === editingDoseId);

      if (!existing) return;

      const labelChanged = existing.label !== normalizedLabel;
      const updatedTimepoints = labelChanged
        ? (existing.timepoints ?? []).map((tp) => ({
            ...tp,
            label: normalizeTimepointLabelForDose(tp.label, normalizedLabel),
          }))
        : existing.timepoints;

      updatedDose = {

        ...existing,

        label: normalizedLabel,

        visitLabel: resolvedVisit,

        studyVisitScheduleNo,

        studyVisitScheduleDescription: resolvedVisit,

        period,

        periodLabel: String(period),

        periodId: `period-${period}`,

        isActive: doseForm.isActive,

        order: requestedOrder,

        timepoints: updatedTimepoints,

      };

    } else {

      updatedDose = {

        id: 0,

        activityConfigDoseNo: 0,

        label: normalizedLabel,

        visitLabel: resolvedVisit,

        studyVisitScheduleNo,

        studyVisitScheduleDescription: resolvedVisit,

        period,

        periodLabel: String(period),

        periodId: `period-${period}`,

        isActive: true,

        order: requestedOrder,

        timePointCount: 0,

        timepoints: [],

      };

    }

    const nextDoses = upsertDoseInList(doses, updatedDose, editingDoseId);

    const successMessage = editingDoseId
      ? doseForm.isActive
        ? "Dose updated."
        : "Dose marked inactive."
      : "Dose saved.";

    try {
      const remarksMeta = editingDoseId
        ? {
            doseId: Number(editingDoseId) || 0,
            fieldRemarks: {
              ...(labelDirty ? { label: String(remarkLabel).trim() } : {}),
              ...(visitDirty ? { visit: String(remarkVisit).trim() } : {}),
              ...(periodDirty ? { period: String(remarkPeriod).trim() } : {}),
              ...(isActiveDirty ? { isActive: String(remarkIsActive).trim() } : {}),
            },
          }
        : null;
      await persistDoses(nextDoses, successMessage, {}, remarksMeta);
      clearDoseForm(nextDoses);
    } catch {
      // error toast handled in persistDoses
    }

  };



  const loadDoseIntoForm = (dose, { publishedView = false } = {}) => {
    setEditingDoseId(dose.id);
    setViewingPublishedDose(publishedView);

    const formSnapshot = {
      order: String(dose.order ?? ""),
      label: dose.label,
      studyVisitScheduleNo: String(dose.studyVisitScheduleNo ?? ""),
      periodLabel: dose.periodLabel ?? String(dose.period ?? ""),
      isActive: dose.isActive !== false,
    };
    setDoseForm(formSnapshot);
    setEditDoseBaseline(
      publishedView
        ? null
        : {
            label: formSnapshot.label,
            studyVisitScheduleNo: formSnapshot.studyVisitScheduleNo,
            periodLabel: formSnapshot.periodLabel,
            isActive: formSnapshot.isActive,
          }
    );
    setRemarkLabel("");
    setRemarkVisit("");
    setRemarkPeriod("");
    setRemarkIsActive("");
    setLabelRemarkDismissed(false);
    setVisitRemarkDismissed(false);
    setPeriodRemarkDismissed(false);
    setIsActiveRemarkDismissed(false);
  };

  const handleEditDose = (dose) => {
    if (dose.isPublished) {
      loadDoseIntoForm(dose, { publishedView: true });
      return;
    }

    loadDoseIntoForm(dose, { publishedView: false });
  };



  const handleOpenTimepoints = async (dose) => {
    let resolvedDose = dose;
    let doseNo = resolveDoseNo(resolvedDose);

    if (!doseNo) {
      try {
        const { doses: latestDoses } = await loadConfiguration({ showLoading: false });
        resolvedDose =
          latestDoses.find(
            (item) =>
              item.label === dose.label
              && Number(item.order) === Number(dose.order)
          ) ?? latestDoses.find((item) => item.label === dose.label) ?? dose;
        doseNo = resolveDoseNo(resolvedDose);
      } catch {
        // loadConfiguration already surfaced the error toast
      }
    }

    if (!doseNo) {
      setMessage({
        type: "error",
        text: "Dose number is missing. Save the dose, refresh the page, and restart the API if this continues.",
      });
      return;
    }

    setTimepointModalDose(resolvedDose);

    setTimepointsLoading(true);

    try {

      const [mapped, allVisits] = await Promise.all([
        refreshDoseTimepoints(doseNo),
        getAllActivityVisitOptions(),
      ]);

      setTimepointVisitOptions(allVisits);

      setTimepointModalDose({

        ...resolvedDose,

        timepoints: mapped,

      });

    } catch (error) {

      setMessage({ type: "error", text: error.message || "Failed to load time points." });

      setTimepointModalDose(null);

      setTimepointVisitOptions([]);

    } finally {

      setTimepointsLoading(false);

    }

  };



  const handleSaveTimepoints = async (timepoints) => {

    if (!timepointModalDose || saving) return;

    if (timepointModalDose.isPublished) {
      setMessage({ type: "error", text: "Published doses cannot be updated." });
      return;
    }

    const doseNo = resolveDoseNo(timepointModalDose);

    if (!doseNo) {
      setMessage({ type: "error", text: "Dose number is missing. Save the dose and refresh the page." });
      return;
    }

    try {

      setSaving(true);

      const apiTimepoints = timepoints.map((timepoint, index) =>
        mapUiTimepointToApi(
          timepoint,
          timepointModalDose,
          timepointVisitOptions,
          index,
          timepoint._fieldRemarks || {}
        )
      );

      validateTimepointsApiPayload(apiTimepoints);

      await saveDoseTimepoints(doseNo, apiTimepoints);

      const { doses: refreshedDoses } = await loadConfiguration({ showLoading: false });
      const mapped = await refreshDoseTimepoints(doseNo);
      const refreshedDose = refreshedDoses.find(
        (dose) => resolveDoseNo(dose) === doseNo
      );

      setTimepointModalDose(
        refreshedDose
          ? { ...refreshedDose, timepoints: mapped }
          : { ...timepointModalDose, timepoints: mapped }
      );

      setMessage({ type: "ok", text: "Timepoints saved." });

    } catch (error) {

      setMessage({ type: "error", text: error.message || "Failed to save time points." });

      throw error;

    } finally {

      setSaving(false);

    }

  };

  const toggleDoseSelection = useCallback((dose) => {
    const doseNo = resolveDoseNo(dose);
    if (!doseNo || dose.isPublished || dose.isActive === false) return;
    if (!doseHasTimepoints(dose)) return;

    setSelectedDoseIds((current) => {
      const next = new Set(current);
      if (next.has(doseNo)) {
        next.delete(doseNo);
      } else {
        next.add(doseNo);
      }
      return next;
    });
  }, [doseHasTimepoints]);

  const toggleSelectAllPublishable = useCallback(() => {
    setSelectedDoseIds((current) => {
      const publishableIds = selectablePublishDoseRows
        .map((dose) => resolveDoseNo(dose))
        .filter((doseNo) => doseNo > 0);
      const allSelected = publishableIds.length > 0
        && publishableIds.every((doseNo) => current.has(doseNo));
      return allSelected ? new Set() : new Set(publishableIds);
    });
  }, [selectablePublishDoseRows]);

  const handlePublishClick = () => {
    if (selectedPublishableCount === 0) {
      setMessage({
        type: "error",
        text: "Select at least one unpublished dose that has time points configured.",
      });
      return;
    }
    setPublishModalOpen(true);
  };

  const handlePublishConfirm = async (password) => {
    const doseNos = selectablePublishDoseRows
      .map((dose) => resolveDoseNo(dose))
      .filter((doseNo) => doseNo > 0 && selectedDoseIds.has(doseNo));
    try {
      setSaving(true);
      await publishActivityDoses(doseNos, password);
      setSelectedDoseIds(new Set());
      await loadConfiguration({ showLoading: false });
      setMessage({
        type: "ok",
        text: `Published ${doseNos.length} dose(s) and exported timepoints.`,
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Failed to publish selected doses." });
      loadConfiguration({ showLoading: false }).catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  const refreshExportLogs = async () => {
    setExportLogsLoading(true);
    try {
      const rows = await getTimepointExportLogs();
      setExportLogs(rows);
    } catch (error) {
      setExportLogs([]);
      throw error;
    } finally {
      setExportLogsLoading(false);
    }
  };

  const handleOpenExportLog = async () => {
    if (isMobileOrTablet) {
      navigate("/activity-configuration/export-log");
      return;
    }
    setExportLogOpen(true);
    try {
      await refreshExportLogs();
    } catch (error) {
      setMessage({
        type: "error",
        text: error.message || "Failed to load export log.",
      });
    }
  };

  const handleReexportLog = async (row) => {
    const doseNos = Array.isArray(row?.doseNos) ? row.doseNos : [];
    if (!row?.id || doseNos.length === 0) {
      setMessage({
        type: "error",
        text: "This log has no dose numbers to re-export.",
      });
      return;
    }

    setExportingLogId(row.id);
    try {
      const result = await exportActivityTimepoints(doseNos, row.id);
      await refreshExportLogs();
      setMessage({
        type: "ok",
        text: `Re-exported ${result.timepointCount} timepoint(s) for ${row.doseNames || "selected doses"}.`,
      });
    } catch (error) {
      try {
        await refreshExportLogs();
      } catch {
        // keep prior rows if refresh fails
      }
      setMessage({
        type: "error",
        text: error.message || "Failed to re-export timepoints.",
      });
    } finally {
      setExportingLogId(null);
    }
  };

  const handleNewExportFromLog = async (doseNos) => {
    const normalized = (doseNos ?? [])
      .map((doseNo) => Number(doseNo))
      .filter((doseNo) => doseNo > 0);
    if (normalized.length === 0) {
      setMessage({ type: "error", text: "Select a published dose to export." });
      return;
    }

    const labels = publishedExportableDoses
      .filter((dose) => normalized.includes(dose.doseNo))
      .map((dose) => dose.label)
      .join(", ");

    setExportingNewLog(true);
    try {
      // No taskLogNo â†’ insert a new TaskLog row.
      const result = await exportActivityTimepoints(normalized);
      await refreshExportLogs();
      setMessage({
        type: "ok",
        text: `Exported ${result.timepointCount} timepoint(s) for ${labels || "selected dose(s)"}.`,
      });
    } catch (error) {
      try {
        await refreshExportLogs();
      } catch {
        // keep prior rows if refresh fails
      }
      setMessage({
        type: "error",
        text: error.message || "Failed to export timepoints.",
      });
    } finally {
      setExportingNewLog(false);
    }
  };

  const handlePdfUploadRequest = (file) => {
    if (!file) return;
    setPdfPendingFile(file);
    setPdfProceedModalOpen(true);
  };

  const handlePdfProceedConfirm = async (password) => {
    if (!pdfPendingFile) return;
    const controller = new AbortController();
    pdfAbortRef.current = controller;
    setPdfActionTaskNo("pending");
    setPdfUploading(true);
    try {
      const uploaded = await uploadPdf(pdfPendingFile, { signal: controller.signal });
      const taskNo = uploaded?.importTaskNo;
      if (!taskNo) {
        throw new Error("No PDF selected to proceed.");
      }
      if (controller.signal.aborted) {
        await cancelUploadedPdf(taskNo);
        return;
      }
      setPdfActionTaskNo(taskNo);
      await proceedPdfImport(taskNo, password, { signal: controller.signal });
      setPdfProceedModalOpen(false);
      setPdfPendingFile(null);
      setMessage({ type: "ok", text: "PDF import started." });
    } catch (error) {
      if (isPdfImportAbortError(error)) {
        setMessage({ type: "ok", text: "PDF request cancelled." });
        return;
      }
      setMessage({
        type: "error",
        text: error?.response?.data?.message || error.message || "Failed to start PDF import.",
      });
      throw error;
    } finally {
      if (pdfAbortRef.current === controller) {
        pdfAbortRef.current = null;
      }
      setPdfUploading(false);
      setPdfActionTaskNo(null);
    }
  };

  const executePdfCancelRequest = async () => {
    if (pdfCancelling) return;
    setPdfCancelling(true);
    try {
      pdfAbortRef.current?.abort();
      let taskNo = Number(pdfActionTaskNo) > 0 ? Number(pdfActionTaskNo) : 0;
      if (!taskNo) {
        taskNo = pdfImportTasks.find((task) => task.status === "Parsing")?.importTaskNo || 0;
      }
      if (taskNo) {
        await cancelUploadedPdf(taskNo);
      }
      setPdfProceedModalOpen(false);
      setPdfPendingFile(null);
      setPdfUploading(false);
      setPdfActionTaskNo(null);
      setMessage({ type: "ok", text: "PDF request cancelled. You can start a new upload." });
    } catch (error) {
      if (!isPdfImportAbortError(error)) {
        setMessage({
          type: "error",
          text: error?.response?.data?.message || error.message || "Failed to cancel PDF request.",
        });
      }
    } finally {
      setPdfCancelling(false);
    }
  };

  const handlePdfCancelRequest = () => {
    if (pdfCancelling) return;
    showConfirm(
      "Cancel PDF Request",
      "Are you sure you want to cancel this PDF request? You can start a new upload after it is cancelled.",
      executePdfCancelRequest,
      "OK"
    );
  };

  const handlePdfProceedModalClose = () => {
    if (pdfCancelling) return;
    if (pdfUploading) {
      handlePdfCancelRequest();
      return;
    }
    setPdfProceedModalOpen(false);
    setPdfPendingFile(null);
  };

  const handleOpenPdfImportAudit = async () => {
    setPdfImportAuditLoading(true);
    try {
      await refreshImportTasks();
      setPdfImportAuditOpen(true);
    } catch (error) {
      setMessage({
        type: "error",
        text: error?.response?.data?.message || error.message || "Failed to load PDF import audit.",
      });
      setPdfImportAuditOpen(true);
    } finally {
      setPdfImportAuditLoading(false);
    }
  };

  const handlePdfRemoveClick = (task) => {
    if (!task?.importTaskNo) return;
    const isParsing = task.status === "Parsing";
    const title = isParsing ? "Cancel PDF Import" : "Cancel PDF Upload";
    const message = isParsing
      ? `Are you sure you want to cancel the running PDF import for "${task.fileName}"?`
      : `Are you sure you want to cancel and remove the uploaded PDF "${task.fileName}" from the queue?`;

    showConfirm(title, message, async () => {
      setPdfActionTaskNo(task.importTaskNo);
      try {
        await cancelUploadedPdf(task.importTaskNo);
        setMessage({ type: "ok", text: isParsing ? "PDF import cancelled." : "Uploaded PDF cancelled." });
      } catch (error) {
        setMessage({
          type: "error",
          text: error?.response?.data?.message || error.message || (isParsing ? "Failed to cancel PDF import." : "Failed to cancel uploaded PDF."),
        });
      } finally {
        setPdfActionTaskNo(null);
      }
    });
  };

  const handleRemovePdfDose = (dose) => {
    const doseNo = resolveDoseNo(dose);
    if (!doseNo) return;

    showConfirm(
      "Remove PDF Dose",
      `Are you sure you want to remove the PDF-imported dose "${normalizeDoseLabel(dose.label)}"?`,
      async () => {
        setSaving(true);
        try {
          const refreshed = await deletePdfImportedDose(doseNo);
          setDoses(refreshed.doses ?? []);
          setAliquotsPerSeparation(String(refreshed.aliquotsPerSeparation ?? aliquotsPerSeparation));
          setCentrifugeTimeMinutes(String(refreshed.centrifugeTimeMinutes ?? centrifugeTimeMinutes));
          setProjectParameterNo(Number(refreshed.projectParameterNo) || 0);
          setCentrifugeTimeProjectParameterNo(Number(refreshed.centrifugeTimeProjectParameterNo) || 0);
          setMessage({ type: "ok", text: "PDF-imported dose removed." });
        } catch (error) {
          setMessage({
            type: "error",
            text: error?.response?.data?.message || error.message || "Failed to remove dose.",
          });
        } finally {
          setSaving(false);
        }
      }
    );
  };

  const handleRemoveSelectedPdfDoses = () => {
    if (selectedPdfDraftCount === 0) return;

    const names = selectedPdfDraftDoses.map((d) => `"${normalizeDoseLabel(d.label)}"`).join(", ");

    showConfirm(
      "Remove Selected PDF Doses",
      `Are you sure you want to remove ${selectedPdfDraftCount} selected PDF-imported dose(s) (${names})?`,
      async () => {
        setSaving(true);
        try {
          let finalRefreshed = null;
          for (const dose of selectedPdfDraftDoses) {
            const doseNo = resolveDoseNo(dose);
            if (doseNo) {
              finalRefreshed = await deletePdfImportedDose(doseNo);
            }
          }
          if (finalRefreshed) {
            setDoses(finalRefreshed.doses ?? []);
            setAliquotsPerSeparation(String(finalRefreshed.aliquotsPerSeparation ?? aliquotsPerSeparation));
            setCentrifugeTimeMinutes(String(finalRefreshed.centrifugeTimeMinutes ?? centrifugeTimeMinutes));
            setProjectParameterNo(Number(finalRefreshed.projectParameterNo) || 0);
            setCentrifugeTimeProjectParameterNo(Number(finalRefreshed.centrifugeTimeProjectParameterNo) || 0);
          }
          setSelectedDoseIds((current) => {
            const next = new Set(current);
            selectedPdfDraftDoses.forEach((d) => next.delete(resolveDoseNo(d)));
            return next;
          });
          setMessage({ type: "ok", text: "Selected PDF-imported dose(s) removed." });
        } catch (error) {
          setMessage({
            type: "error",
            text: error?.response?.data?.message || error.message || "Failed to remove selected doses.",
          });
          loadConfiguration({ showLoading: false }).catch(() => {});
        } finally {
          setSaving(false);
        }
      }
    );
  };



  const doseColumns = useMemo(

    () => [
      {
        key: "select",
        label: (
          <input
            type="checkbox"
            checked={
              selectablePublishDoseRows.length > 0
              && selectablePublishDoseRows.every((dose) => selectedDoseIds.has(resolveDoseNo(dose)))
            }
            onChange={toggleSelectAllPublishable}
            aria-label="Select all publishable doses with time points"
            disabled={selectablePublishDoseRows.length === 0}
          />
        ),
        align: "center",
        stopRowClick: true,
        render: (dose) => {
          const doseNo = resolveDoseNo(dose);
          const missingTimepoints = !doseHasTimepoints(dose);
          const disabled =
            dose.isPublished
            || dose.isActive === false
            || !doseNo
            || missingTimepoints;
          return (
            <input
              type="checkbox"
              checked={!disabled && selectedDoseIds.has(doseNo)}
              onChange={() => toggleDoseSelection(dose)}
              aria-label={
                missingTimepoints && !dose.isPublished && dose.isActive !== false
                  ? `${dose.label} has no time points — add time points before publish`
                  : `Select ${dose.label}`
              }
              title={
                missingTimepoints && !dose.isPublished && dose.isActive !== false
                  ? "Add time points before this dose can be selected for publish"
                  : undefined
              }
              disabled={disabled}
            />
          );
        },
      },
      {
        key: "actions",
        label: "Actions",
        align: "center",
        stopRowClick: true,
        render: (dose) => {
          const isLocked = dose.isPublished === true;
          const isInactive = dose.isActive === false;
          return (
            <span className="activity-config-table__actions">
              <button
                type="button"
                className="btn btn--sm btn--primary activity-config-table__add-btn"
                onClick={() => handleOpenTimepoints(dose)}
                aria-label={
                  isLocked || isInactive
                    ? `View timepoints for ${dose.label}`
                    : `Add timepoints for ${dose.label}`
                }
                title={isLocked || isInactive ? "View timepoints" : "Add timepoints"}
              >
                +
              </button>
              <button
                type="button"
                className="btn btn--sm btn--secondary"
                onClick={() => handleEditDose(dose)}
                title={
                  isLocked
                    ? "View published dose and audit history"
                    : isInactive
                      ? "Edit inactive dose (e.g. reactivate)"
                      : "Edit dose"
                }
              >
                {isLocked ? "View" : "Edit"}
              </button>
            </span>
          );
        },
      },
      {
        key: "label",
        label: "Dose name",
        render: (dose) => {
          const label = normalizeDoseLabel(dose.label);
          return <span className="config-data-table__truncate" title={label}>{label}</span>;
        },
        searchValue: (dose) => normalizeDoseLabel(dose.label),
      },
      {
        key: "visitLabel",
        label: "Visit",
        render: (dose) => {
          const label = dose.visitLabel || "—";
          return <span className="config-data-table__truncate" title={label}>{label}</span>;
        },
        searchValue: (dose) => dose.visitLabel ?? "",
      },
      {
        key: "periodLabel",
        label: "Period",
        align: "center",
        render: (dose) => dose.periodLabel || "—",
        searchValue: (dose) => dose.periodLabel ?? "",
      },
      {
        key: "isActive",
        label: "Status",
        align: "center",
        searchValue: (dose) => {
          if (dose.isPublished) return "Published";
          return dose.isActive === false ? "Inactive" : "Draft";
        },
        render: (dose) => {
          if (dose.isPublished) {
            return (
              <span className="status-badge status-badge--compact status--completed">
                Published
              </span>
            );
          }

          return (
            <span className={`status-badge status-badge--compact ${dose.isActive === false ? "status--inactive" : "status--upcoming"}`}>
              {dose.isActive === false ? "Inactive" : "Draft"}
            </span>
          );
        },
      },
      {
        key: "createdBySource",
        label: "Source",
        align: "center",
        render: (dose) => {
          const isPdf = dose.createdBySource === "Pdf";
          return (
            <span className={`status-badge status-badge--compact ${isPdf ? "status--pdf" : "status--inactive"}`}>
              {isPdf ? "PDF" : "Manual"}
            </span>
          );
        },
        searchValue: (dose) => (dose.createdBySource === "Pdf" ? "PDF" : "Manual"),
      },
      {
        key: "recordedSign",
        label: "Performed By",
        render: (dose) => {
          const value = dose.recordedSign?.trim() || "—";
          return <span className="config-data-table__wrap" title={value}>{value}</span>;
        },
        searchValue: (dose) => dose.recordedSign ?? "",
      },
      {
        key: "recordedOnUtc",
        label: "Performed On (UTC)",
        align: "center",
        render: (dose) => formatAuditUtc(dose.recordedOnUtc),
        searchValue: (dose) => formatAuditUtc(dose.recordedOnUtc),
      },
      {
        key: "recordedAtOffset",
        label: "Performed On (Offset)",
        align: "center",
        render: (dose) => formatDoseRecordedAtOffset(dose),
        searchValue: (dose) => formatDoseRecordedAtOffset(dose),
      },

    ],

    [selectablePublishDoseRows, selectedDoseIds, toggleDoseSelection, toggleSelectAllPublishable, doseHasTimepoints]

  );



  return (

    <div className="page page--activity-config">

      <SoftAlertToast

        title={message?.type === "error" ? "Error" : "Success"}

        message={message?.text}

        variant={message?.type === "error" ? "error" : "success"}

        onClose={() => setMessage(null)}

      />

      {auditModal}

      <div className="activity-config-tabs review-page-tabs">
        <div className="review-page-tabs__nav" role="tablist" aria-label="Activity configuration sections">
          <button
            type="button"
            role="tab"
            id="activity-config-tab-ai"
            aria-selected={activeConfigTab === "ai"}
            aria-controls="activity-config-panel-ai"
            className={`review-page-tabs__tab${activeConfigTab === "ai" ? " review-page-tabs__tab--active" : ""}`}
            onClick={() => setActiveConfigTab("ai")}
          >
            Auto Activity Config With AI
          </button>
          <button
            type="button"
            role="tab"
            id="activity-config-tab-manual"
            aria-selected={activeConfigTab === "manual"}
            aria-controls="activity-config-panel-manual"
            className={`review-page-tabs__tab${activeConfigTab === "manual" ? " review-page-tabs__tab--active" : ""}`}
            onClick={() => setActiveConfigTab("manual")}
          >
            Manual
          </button>
        </div>

        {activeConfigTab === "ai" ? (
          <div
            className="review-page-tabs__panel activity-config-tabs__panel"
            role="tabpanel"
            id="activity-config-panel-ai"
            aria-labelledby="activity-config-tab-ai"
          >
            <PdfImportPanel
              uploading={pdfUploading}
              parsing={pdfImporting}
              cancelling={pdfCancelling}
              stageLabel={pdfImportStageLabel}
              auditLoading={pdfImportAuditLoading}
              onRequestProceed={handlePdfUploadRequest}
              onOpenAudit={handleOpenPdfImportAudit}
              onCancelRequest={handlePdfCancelRequest}
            />
          </div>
        ) : (
          <div
            className="review-page-tabs__panel activity-config-tabs__panel"
            role="tabpanel"
            id="activity-config-panel-manual"
            aria-labelledby="activity-config-tab-manual"
          >

      <section className="card activity-config-dose-form">

        <div className="activity-config-dose-form__grid">

          <label className="field">

            <span>Order <span className="field__required">*</span></span>

            <input
              type="number"
              min="1"
              value={doseForm.order}
              disabled
              readOnly
              className="field--disabled"
              title="Order is assigned automatically"
              aria-disabled="true"
              placeholder="e.g. 1"
            />

          </label>

          <div className="field field--with-audit">
            <AdminFieldLabel
              showAudit={canAudit}
              onOpenAudit={() => openFieldAudit(ACTIVITY_CONFIG_DOSE_FIELD_TO_COLUMN.label, "Dose name")}
              showReopenX={Boolean(!viewingPublishedDose && editingDoseId && labelDirty && labelRemarkDismissed && String(remarkLabel || "").trim())}
              remarkText={remarkLabel}
              onReopenRemark={() => setLabelRemarkDismissed(false)}
            >
              Dose Name <span className="field__required">*</span>
            </AdminFieldLabel>
            <input
              value={doseForm.label}
              disabled={viewingPublishedDose}
              readOnly={viewingPublishedDose}
              className={viewingPublishedDose ? "field--disabled" : undefined}
              onChange={(event) => {
                if (viewingPublishedDose) return;
                const nextLabel = event.target.value;
                setDoseForm((current) => ({
                  ...current,
                  label: nextLabel,
                  order: String(resolveDoseOrder(nextLabel, current.order || nextDoseOrder)),
                }));
                setLabelRemarkDismissed(false);
              }}
              placeholder="e.g. Dose 1"
            />
            {!viewingPublishedDose && editingDoseId && labelDirty && !labelRemarkDismissed ? (
              <EditFieldRemarkAttach
                show
                floating
                value={remarkLabel}
                onChange={setRemarkLabel}
                onConfirm={() => setLabelRemarkDismissed(true)}
                toast={remarkToast}
              />
            ) : null}
          </div>

          <div className="field field--with-audit">
            <AdminFieldLabel
              showAudit={canAudit}
              onOpenAudit={() => openFieldAudit(ACTIVITY_CONFIG_DOSE_FIELD_TO_COLUMN.visit, "Visit")}
              showReopenX={Boolean(!viewingPublishedDose && editingDoseId && visitDirty && visitRemarkDismissed && String(remarkVisit || "").trim())}
              remarkText={remarkVisit}
              onReopenRemark={() => setVisitRemarkDismissed(false)}
            >
              Visit <span className="field__required">*</span>
            </AdminFieldLabel>
            <ScrollableSelect
              value={doseForm.studyVisitScheduleNo}
              disabled={viewingPublishedDose}
              onChange={(nextValue) => {
                if (viewingPublishedDose) return;
                setDoseForm((current) => ({ ...current, studyVisitScheduleNo: nextValue }));
                setVisitRemarkDismissed(false);
              }}
              options={visitSelectOptions}
              placeholder="Select visit"
            />
            {!viewingPublishedDose && editingDoseId && visitDirty && !visitRemarkDismissed ? (
              <EditFieldRemarkAttach
                show
                floating
                value={remarkVisit}
                onChange={setRemarkVisit}
                onConfirm={() => setVisitRemarkDismissed(true)}
                toast={remarkToast}
              />
            ) : null}
          </div>

          <div className="field field--with-audit">
            <AdminFieldLabel
              showAudit={canAudit}
              onOpenAudit={() => openFieldAudit(ACTIVITY_CONFIG_DOSE_FIELD_TO_COLUMN.period, "Period")}
              showReopenX={Boolean(!viewingPublishedDose && editingDoseId && periodDirty && periodRemarkDismissed && String(remarkPeriod || "").trim())}
              remarkText={remarkPeriod}
              onReopenRemark={() => setPeriodRemarkDismissed(false)}
            >
              Period <span className="field__required">*</span>
            </AdminFieldLabel>
            <input
              value={doseForm.periodLabel}
              disabled={viewingPublishedDose}
              readOnly={viewingPublishedDose}
              className={viewingPublishedDose ? "field--disabled" : undefined}
              onChange={(event) => {
                if (viewingPublishedDose) return;
                setDoseForm((current) => ({ ...current, periodLabel: event.target.value }));
                setPeriodRemarkDismissed(false);
              }}
              placeholder="e.g. 1"
            />
            {!viewingPublishedDose && editingDoseId && periodDirty && !periodRemarkDismissed ? (
              <EditFieldRemarkAttach
                show
                floating
                value={remarkPeriod}
                onChange={setRemarkPeriod}
                onConfirm={() => setPeriodRemarkDismissed(true)}
                toast={remarkToast}
              />
            ) : null}
          </div>

          <div className="field field--checkbox field--with-audit field--with-audit-stack">
            <div className="field--checkbox-row">
              <input
                type="checkbox"
                id="dose-is-active"
                checked={editingDoseId ? doseForm.isActive : true}
                disabled={viewingPublishedDose || !editingDoseId}
                className={viewingPublishedDose || !editingDoseId ? "field--disabled" : undefined}
                title={
                  viewingPublishedDose
                    ? "Published doses cannot be changed"
                    : editingDoseId
                      ? "Set dose active or inactive"
                      : "Is Active is available when editing an existing dose"
                }
                onChange={(event) => {
                  if (viewingPublishedDose || !editingDoseId) return;
                  setDoseForm((current) => ({ ...current, isActive: event.target.checked }));
                  setIsActiveRemarkDismissed(false);
                }}
              />
              <AdminFieldLabel
                htmlFor="dose-is-active"
                variant="checkbox"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit(ACTIVITY_CONFIG_DOSE_FIELD_TO_COLUMN.isActive, "Is Active")}
                showReopenX={Boolean(!viewingPublishedDose && editingDoseId && isActiveDirty && isActiveRemarkDismissed && String(remarkIsActive || "").trim())}
                remarkText={remarkIsActive}
                onReopenRemark={() => setIsActiveRemarkDismissed(false)}
              >
                Is Active
              </AdminFieldLabel>
            </div>
            {!viewingPublishedDose && editingDoseId && isActiveDirty && !isActiveRemarkDismissed ? (
              <EditFieldRemarkAttach
                show
                floating
                value={remarkIsActive}
                onChange={setRemarkIsActive}
                onConfirm={() => setIsActiveRemarkDismissed(true)}
                toast={remarkToast}
              />
            ) : null}
          </div>

        </div>

        <div className="activity-config-dose-form__actions activity-config-dose-form__actions--center">

          {!viewingPublishedDose && (
            <button type="button" className="btn btn--primary" onClick={handleSaveDose}>
              Save
            </button>
          )}

          <button type="button" className="btn btn--secondary" onClick={clearDoseForm}>

            Clear

          </button>

          <button type="button" className="btn btn--ghost" onClick={handleClose}>

            Close

          </button>

        </div>

      </section>
          </div>
        )}

      <section className="card activity-config-dose-table">
        {loading ? (
          <p className="empty-state">Loading activity configuration...</p>
        ) : (
        <ConfigDataTable
          columns={doseColumns}
          rows={doseRows}
          emptyMessage="No doses configured. Use the form above to add a dose."
          variant="dose"
          getRowKey={(dose) => dose.id}
          getRowClassName={(dose) => {
            const classes = [];
            if (dose.isActive === false) classes.push("config-data-table__row--inactive");
            if (dose.isPublished) classes.push("config-data-table__row--published");
            return classes.join(" ");
          }}
          searchable
          paginated
          searchPlaceholder="Search doses..."
          defaultPageSize={10}
          toolbarExtra={(
            <>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={openAliquotSettings}
                disabled={saving || loading}
              >
                Activity Settings
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={handleOpenExportLog}
                disabled={saving || loading}
              >
                Export Log
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handlePublishClick}
                disabled={saving || selectedPublishableCount === 0}
              >
                Publish{selectedPublishableCount > 0 ? ` (${selectedPublishableCount})` : ""}
              </button>
              {selectedPdfDraftCount > 0 && (
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={handleRemoveSelectedPdfDoses}
                  disabled={saving}
                >
                  Remove ({selectedPdfDraftCount})
                </button>
              )}
            </>
          )}
        />
        )}

      </section>
      </div>

      {aliquotSettingsOpen && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal activity-config-aliquot-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="activity-config-aliquot-settings-title"
          >
            <div className="barcode-preview-modal__head">
              <h3 className="modal__title" id="activity-config-aliquot-settings-title">
                Activity Settings
              </h3>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={closeAliquotSettings}
                aria-label="Close activity settings"
              >
                Close
              </button>
            </div>

            <div className="activity-config-aliquot-modal__grid">
              <div className="field field--with-audit">
                <AdminFieldLabel
                  showAudit={projectParameterNo > 0}
                  onOpenAudit={() => setAliquotAuditOpen(true)}
                  auditTitle="Aliquots Per Separation Audit"
                  showReopenX={Boolean(aliquotValueChanged && aliquotRemarkDismissed)}
                  remarkText={aliquotChangeReason}
                  onReopenRemark={() => setAliquotRemarkDismissed(false)}
                >
                  Aliquots Per Separation <span className="field__required">*</span>
                </AdminFieldLabel>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={aliquotSettingsDraft}
                  onChange={(event) => {
                    setAliquotSettingsDraft(event.target.value);
                    setAliquotRemarkDismissed(false);
                    setAliquotSettingsError("");
                  }}
                  placeholder="e.g. 3"
                  autoFocus
                />
                {aliquotValueChanged && !aliquotRemarkDismissed ? (
                  <EditFieldRemarkAttach
                    show
                    floating
                    value={aliquotChangeReason}
                    onChange={setAliquotChangeReason}
                    onConfirm={() => setAliquotRemarkDismissed(true)}
                    toast={remarkToast}
                  />
                ) : null}
              </div>

              <div className="field field--with-audit">
                <AdminFieldLabel
                  showAudit={centrifugeTimeProjectParameterNo > 0}
                  onOpenAudit={() => setCentrifugeAuditOpen(true)}
                  auditTitle="Centrifuge Time Audit"
                  showReopenX={Boolean(centrifugeValueChanged && centrifugeRemarkDismissed)}
                  remarkText={centrifugeChangeReason}
                  onReopenRemark={() => setCentrifugeRemarkDismissed(false)}
                >
                  Centrifuge Time (minutes) <span className="field__required">*</span>
                </AdminFieldLabel>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={centrifugeTimeDraft}
                  onChange={(event) => {
                    setCentrifugeTimeDraft(event.target.value);
                    setCentrifugeRemarkDismissed(false);
                    setAliquotSettingsError("");
                  }}
                  placeholder="e.g. 10"
                />
                {centrifugeValueChanged && !centrifugeRemarkDismissed ? (
                  <EditFieldRemarkAttach
                    show
                    floating
                    value={centrifugeChangeReason}
                    onChange={setCentrifugeChangeReason}
                    onConfirm={() => setCentrifugeRemarkDismissed(true)}
                    toast={remarkToast}
                  />
                ) : null}
              </div>
            </div>

            {aliquotSettingsError && (
              <p className="modal__error">{aliquotSettingsError}</p>
            )}

            <div className="modal__actions modal__actions--center">
              <button type="button" className="btn btn--ghost" onClick={closeAliquotSettings}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={handleSaveAliquotSettings}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {aliquotAuditOpen && (
        <AuditHistoryModal open onClose={() => setAliquotAuditOpen(false)} title="Aliquots Per Separation Audit">
          {projectParameterNo > 0 ? (
            <DbAuditHistoryTableBody
              tableName="ProjectParameter"
              recordId={String(projectParameterNo)}
              fieldName="vParameterValue"
              emptyMessage="No aliquot setting changes recorded for this project."
            />
          ) : (
            <p className="empty-state">No aliquot setting changes recorded for this project.</p>
          )}
        </AuditHistoryModal>
      )}

      {centrifugeAuditOpen && (
        <AuditHistoryModal open onClose={() => setCentrifugeAuditOpen(false)} title="Centrifuge Time Audit">
          {centrifugeTimeProjectParameterNo > 0 ? (
            <DbAuditHistoryTableBody
              tableName="ProjectParameter"
              recordId={String(centrifugeTimeProjectParameterNo)}
              fieldName="vParameterValue"
              emptyMessage="No centrifuge time changes recorded for this project."
            />
          ) : (
            <p className="empty-state">No centrifuge time changes recorded for this project.</p>
          )}
        </AuditHistoryModal>
      )}

      <PdfImportAuditModal
        open={pdfImportAuditOpen}
        onClose={() => setPdfImportAuditOpen(false)}
        tasks={pdfImportTasks}
        refreshing={pdfImportRefreshing || pdfImportAuditLoading}
      />

      <DoseTimepointsModal
        open={!!timepointModalDose}
        dose={timepointModalDose}
        visitOptions={timepointVisitOptions}
        activityTypes={formOptions.activityTypes}
        durationTypes={formOptions.durationTypes}
        projectCode={projectCode}
        loading={timepointsLoading}
        readOnly={
          timepointModalDose?.isPublished === true
          || timepointModalDose?.isActive === false
        }
        onClose={() => {
          setTimepointModalDose(null);
          setTimepointVisitOptions([]);
        }}
        onSaveTimepoints={handleSaveTimepoints}
      />

      <PasswordConfirmModal
        open={publishModalOpen}
        title="Publish Doses"
        message={`Enter your password to publish ${selectedPublishableCount} selected dose(s) and export their timepoints.`}
        confirmLabel="Publish"
        onClose={() => setPublishModalOpen(false)}
        onValidatePassword={validatePassword}
        onConfirm={handlePublishConfirm}
      />

      <PasswordConfirmModal
        open={pdfProceedModalOpen}
        title="Proceed with PDF import"
        message={`Enter your password to parse and import ${pdfPendingFile?.name || "this PDF"}.`}
        confirmLabel="Proceed"
        onClose={handlePdfProceedModalClose}
        onValidatePassword={validatePassword}
        onConfirm={handlePdfProceedConfirm}
      />

      <ConfirmModal
        open={confirmConfig.open}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onClose={() => setConfirmConfig((current) => ({ ...current, open: false }))}
        onConfirm={confirmConfig.onConfirm}
        confirmLabel={confirmConfig.confirmLabel || "Confirm"}
      />

      <TimepointExportLogModal
        open={exportLogOpen}
        onClose={() => {
          setExportLogOpen(false);
          setExportingLogId(null);
          setExportingNewLog(false);
        }}
        logs={exportLogs}
        loading={exportLogsLoading}
        exportingId={exportingLogId}
        onExport={handleReexportLog}
        publishedDoses={publishedExportableDoses}
        exportingNew={exportingNewLog}
        onExportNew={handleNewExportFromLog}
      />

    </div>

  );

}


