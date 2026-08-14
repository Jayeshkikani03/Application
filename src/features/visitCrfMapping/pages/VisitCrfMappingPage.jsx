import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConfigDataTable } from "@/components/shared/ConfigDataTable";
import { SoftAlertToast } from "@/components/shared/SoftAlertToast";
import { AdminButton } from "@/components/shared/AdminButton";
import { AdminFieldLabel } from "@/components/shared/AdminFieldLabel.jsx";
import { ScrollableSelect } from "@/components/shared/ScrollableSelect";
import { MultiSelectDropdown } from "@/components/shared/MultiSelectDropdown.jsx";
import { ConfirmModal, PasswordConfirmModal } from "@/components/shared/Modal";
import { validatePassword } from "@/features/auth/api/authApi.js";
import { useAdminRecordAudit } from "@/hooks/useAdminRecordAudit.jsx";
import {
  listEligibleVisitCrfs,
  listVisitCrfMappings,
  listVisitCrfVisitOptions,
  publishVisitCrfMappings,
  saveVisitCrfMappings,
} from "../api/visitCrfMappingApi.js";

/** DB audit column names for AppVisitCrfMapping (must match EF column names). */
const MAPPING_AUDIT_COLUMNS = {
  activityName: "vActivityName",
  visit: "nStudyVisitScheduleNo",
  crf: "vCrfTemplateId",
  isRepeat: "bIsRepeat",
  isActive: "IsActive",
};

function formatAuditUtc(iso) {
  if (!iso) return "—";
  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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
}

function formatOffset(value) {
  const stored = String(value ?? "").trim();
  if (!stored) return "—";
  const match = stored.match(/^([+-]?\d{1,2}):?(\d{2})(?::\d{2})?$/);
  if (!match) return stored;
  const sign = match[1].startsWith("-") ? "-" : "+";
  const hours = match[1].replace(/^[+-]/, "").padStart(2, "0");
  return `${sign}${hours}:${match[2]}`;
}

function ChangeReasonModal({ onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const handleConfirm = () => {
    if (!reason.trim()) {
      setError("Reason is required.");
      return;
    }
    onConfirm(reason.trim());
  };

  return (
    <div className="admin-reason-modal-backdrop">
      <div className="admin-reason-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-reason-modal-title">Reason for Change</div>
        <label className="admin-reason-label" htmlFor="activity-mapping-change-reason">
          Please enter the reason for this change <span style={{ color: "var(--red)" }}>*</span>
        </label>
        <textarea
          id="activity-mapping-change-reason"
          className="admin-reason-textarea"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError("");
          }}
          placeholder="Enter reason..."
          autoFocus
        />
        {error ? <div className="admin-reason-error">{error}</div> : null}
        <div className="admin-reason-actions">
          <AdminButton variant="secondary" onClick={onClose}>Cancel</AdminButton>
          <AdminButton variant="primary" onClick={handleConfirm}>Confirm</AdminButton>
        </div>
      </div>
    </div>
  );
}

function findOtherActivitiesUsingCrf(mappings, crfTemplateId, excludeActivityName) {
  const templateId = String(crfTemplateId || "").trim().toLowerCase();
  const exclude = String(excludeActivityName || "").trim().toLowerCase();
  if (!templateId) return [];
  const names = new Set();
  for (const row of mappings || []) {
    if (row.isActive === false) continue;
    const tid = String(row.crfTemplateId || "").trim().toLowerCase();
    if (tid !== templateId) continue;
    const name = String(row.activityName || "").trim();
    if (!name) continue;
    if (exclude && name.toLowerCase() === exclude) continue;
    names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Resolve CRF display fields for confirm dialogs (name, template number, version). */
function resolveCrfDisplayInfo(crfTemplateId, { eligible = [], mappings = [], fallbackName = "" } = {}) {
  const templateId = String(crfTemplateId || "").trim();
  const needle = templateId.toLowerCase();
  const fromEligible = eligible.find(
    (c) => String(c.crfTemplateId || "").trim().toLowerCase() === needle
  );
  const fromMapping = mappings.find(
    (m) => String(m.crfTemplateId || "").trim().toLowerCase() === needle
  );
  const name = String(
    fromEligible?.crfName
    || fromMapping?.crfName
    || fallbackName
    || ""
  ).trim();
  const versionRaw = fromEligible?.version ?? fromMapping?.version ?? fromMapping?.crfVersion;
  const versionNum = Number(versionRaw);
  const version = Number.isFinite(versionNum) && versionNum > 0 ? versionNum : null;
  return {
    name: name || "—",
    number: templateId || "—",
    version: version != null ? `v${version}` : "—",
  };
}

function buildSharedCrfConfirmDetails(crfInfo, alsoUsedBy) {
  return [
    { label: "CRF Name", value: crfInfo.name },
    { label: "CRF Number", value: crfInfo.number },
    { label: "Version", value: crfInfo.version },
    { label: "Also used by", value: alsoUsedBy },
  ];
}

export default function VisitCrfMappingPage() {
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [mappings, setMappings] = useState([]);
  const [visits, setVisits] = useState([]);
  const [eligible, setEligible] = useState([]);

  const [activityName, setActivityName] = useState("");
  const [editingActivityName, setEditingActivityName] = useState("");
  const [editingMappingNo, setEditingMappingNo] = useState(null);
  const [viewingPublished, setViewingPublished] = useState(false);
  const [selectedVisitNos, setSelectedVisitNos] = useState([]);
  const [selectedCrfTemplateId, setSelectedCrfTemplateId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isRepeat, setIsRepeat] = useState(false);
  const [filterActivityName, setFilterActivityName] = useState("");
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [selectedPublishNames, setSelectedPublishNames] = useState(() => new Set());
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [pendingPublishNames, setPendingPublishNames] = useState([]);
  const [confirmSharedCrf, setConfirmSharedCrf] = useState(false);
  const [sharedCrfConfirm, setSharedCrfConfirm] = useState(null);

  const { openFieldAudit, auditModal, canAudit } = useAdminRecordAudit(
    editingMappingNo && Number(editingMappingNo) > 0 ? editingMappingNo : null,
    "AppVisitCrfMapping"
  );

  const visitAuditValueMap = useMemo(() => {
    const map = {};
    for (const visit of visits) {
      const no = String(visit.studyVisitScheduleNo ?? "").trim();
      if (!no) continue;
      map[no] = visit.label || `Visit ${no}`;
    }
    return map;
  }, [visits]);

  const showToast = (message, variant = "success") => setToast({ message, variant });
  const detailsLocked = viewingPublished || saving || publishing;
  const activeToggleLocked = saving || publishing;

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [mapRows, visitRows, crfRows] = await Promise.all([
        listVisitCrfMappings(),
        listVisitCrfVisitOptions(),
        listEligibleVisitCrfs(),
      ]);
      setMappings(mapRows);
      setVisits(visitRows);
      setEligible(crfRows);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Failed to load activity mappings.";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const visitOptions = useMemo(
    () => visits.map((v) => ({
      value: String(v.studyVisitScheduleNo),
      label: v.label || `Visit ${v.studyVisitScheduleNo}`,
    })),
    [visits]
  );

  const crfSelectOptions = useMemo(
    () => eligible.map((crf) => ({
      value: crf.crfTemplateId,
      label: `${crf.crfName || crf.crfTemplateId} (${crf.crfTemplateId} · v${crf.version})`,
    })),
    [eligible]
  );

  const activityFilterOptions = useMemo(() => {
    const names = [...new Set(mappings.map((m) => m.activityName).filter(Boolean))];
    return [
      { value: "", label: "All activities" },
      ...names.sort((a, b) => a.localeCompare(b)).map((n) => ({ value: n, label: n })),
    ];
  }, [mappings]);

  const filteredRows = useMemo(() => {
    const name = filterActivityName.trim().toLowerCase();
    if (!name) return mappings;
    return mappings.filter((m) => (m.activityName || "").toLowerCase() === name);
  }, [mappings, filterActivityName]);

  const isUpdateMode = useMemo(() => {
    const edit = editingActivityName.trim().toLowerCase();
    const current = activityName.trim().toLowerCase();
    return Boolean(edit && current && edit === current);
  }, [editingActivityName, activityName]);

  const isExistingActivityMapping = useMemo(() => {
    const name = activityName.trim().toLowerCase();
    if (!name) return false;
    // Name is only taken while an active mapping exists (inactive predecessors allow succession).
    return mappings.some(
      (m) =>
        m.isActive !== false
        && (m.activityName || "").trim().toLowerCase() === name
    );
  }, [mappings, activityName]);

  const publishableActivityNames = useMemo(() => {
    const names = new Set();
    for (const row of mappings) {
      if (row.isActive === false || row.isPublished) continue;
      const name = String(row.activityName || "").trim();
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [mappings]);

  const selectedPublishableCount = useMemo(
    () => [...selectedPublishNames].filter((n) => publishableActivityNames.includes(n)).length,
    [selectedPublishNames, publishableActivityNames]
  );

  const toggleVisit = (visitValue) => {
    if (detailsLocked) return;
    const id = String(visitValue);
    setSelectedVisitNos((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  };

  const handleClear = () => {
    setActivityName("");
    setEditingActivityName("");
    setEditingMappingNo(null);
    setViewingPublished(false);
    setSelectedVisitNos([]);
    setSelectedCrfTemplateId("");
    setIsActive(true);
    setIsRepeat(false);
  };

  const handleEditRow = (row) => {
    const name = row.activityName || "";
    // Same generation: same activity name + CRF template + published flag + active flag.
    // Avoid locking a new unpublished successor because an inactive published predecessor exists.
    const rowsForGeneration = mappings.filter(
      (m) =>
        m.activityName === name
        && (m.crfTemplateId || "") === (row.crfTemplateId || "")
        && Boolean(m.isPublished) === Boolean(row.isPublished)
        && (m.isActive !== false) === (row.isActive !== false)
    );
    const published = row.isPublished === true;
    setActivityName(name);
    setEditingActivityName(name);
    setEditingMappingNo(Number(row.appVisitCrfMappingNo) || null);
    setViewingPublished(published);
    setSelectedCrfTemplateId(row.crfTemplateId || "");
    setIsActive(row.isActive !== false);
    setIsRepeat(row.isRepeat === true);
    setSelectedVisitNos([...new Set(rowsForGeneration.map((m) => String(m.studyVisitScheduleNo)))]);
  };

  const togglePublishSelection = (activityNameValue, checked) => {
    const name = String(activityNameValue || "").trim();
    if (!name) return;
    setSelectedPublishNames((prev) => {
      const next = new Set(prev);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  };

  const toggleSelectAllPublishable = () => {
    setSelectedPublishNames((prev) => {
      const allSelected =
        publishableActivityNames.length > 0
        && publishableActivityNames.every((n) => prev.has(n));
      return allSelected ? new Set() : new Set(publishableActivityNames);
    });
  };

  const beginPublish = (activityNames) => {
    const names = [...new Set(
      (activityNames || [])
        .map((n) => String(n || "").trim())
        .filter(Boolean)
    )];
    if (names.length === 0) {
      showToast("Select at least one unpublished activity to publish.", "warning");
      return;
    }

    const sharedMessages = [];
    for (const name of names) {
      const row =
        mappings.find(
          (m) =>
            (m.activityName || "").trim().toLowerCase() === name.toLowerCase()
            && m.isActive !== false
            && !m.isPublished
        )
        || mappings.find(
          (m) =>
            (m.activityName || "").trim().toLowerCase() === name.toLowerCase()
            && m.isActive !== false
        );
      const templateId = row?.crfTemplateId || "";
      const others = findOtherActivitiesUsingCrf(mappings, templateId, name);
      if (others.length > 0) {
        const crfInfo = resolveCrfDisplayInfo(templateId, {
          eligible,
          mappings,
          fallbackName: row?.crfName,
        });
        sharedMessages.push({
          activityName: name,
          crfInfo,
          alsoUsedBy: others.join(", "),
        });
      }
    }

    if (sharedMessages.length > 0) {
      const first = sharedMessages[0];
      const details = buildSharedCrfConfirmDetails(first.crfInfo, first.alsoUsedBy);
      if (sharedMessages.length > 1) {
        details.push({
          label: "Other mappings",
          value: sharedMessages
            .slice(1)
            .map((item) => `${item.activityName}: ${item.crfInfo.name} (${item.crfInfo.number} · ${item.crfInfo.version}) → ${item.alsoUsedBy}`)
            .join("; "),
        });
      }
      setSharedCrfConfirm({
        mode: "publish",
        activityNames: names,
        message: "This CRF is already used by another activity. Publish anyway?",
        details,
      });
      return;
    }

    setConfirmSharedCrf(false);
    setPendingPublishNames(names);
    setPublishModalOpen(true);
  };

  const handlePublishSelectedClick = () => {
    beginPublish([...selectedPublishNames]);
  };

  const runSave = async (changeReason, { confirmedSharedCrf = false } = {}) => {
    const name = activityName.trim();
    const isUpdate = isUpdateMode || viewingPublished;

    if (!isUpdate && isExistingActivityMapping) {
      showToast("Activity name already exists. Open the existing row to edit, or choose a different name.", "warning");
      return;
    }

    if (viewingPublished) {
      // Published: only Is Active may change — skip shared-CRF confirm.
    } else if (!confirmedSharedCrf) {
      const others = findOtherActivitiesUsingCrf(mappings, selectedCrfTemplateId, name);
      if (others.length > 0) {
        const crfInfo = resolveCrfDisplayInfo(selectedCrfTemplateId, {
          eligible,
          mappings,
        });
        setSharedCrfConfirm({
          mode: "save",
          changeReason,
          message: "This CRF is already used by another activity. Save anyway?",
          details: buildSharedCrfConfirmDetails(crfInfo, others.join(", ")),
        });
        return;
      }
    }

    setShowReasonModal(false);
    setSaving(true);
    try {
      await saveVisitCrfMappings({
        activityName: name,
        studyVisitScheduleNos: selectedVisitNos.map((n) => Number(n) || 0),
        crfTemplateId: selectedCrfTemplateId,
        isActive,
        isRepeat,
        isUpdate,
        changeReason,
      });
      showToast("Activity mapping saved successfully.", "success");
      handleClear();
      await loadAll();
    } catch (err) {
      showToast(err?.response?.data?.message || err?.message || "Save failed.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveClick = (e) => {
    e.preventDefault();
    if (!activityName.trim()) {
      showToast("Activity name is required.", "warning");
      return;
    }
    if (!selectedVisitNos.length) {
      showToast("Select at least one visit.", "warning");
      return;
    }
    if (!selectedCrfTemplateId) {
      showToast("Select a CRF.", "warning");
      return;
    }
    if (!isUpdateMode && isExistingActivityMapping) {
      showToast("Activity name already exists. Open the existing row to edit, or choose a different name.", "warning");
      return;
    }
    if (isUpdateMode || viewingPublished) {
      setShowReasonModal(true);
      return;
    }
    void runSave(null);
  };

  const handleSaveConfirm = (changeReason) => {
    void runSave(changeReason);
  };

  const handleSharedCrfConfirm = () => {
    const pending = sharedCrfConfirm;
    setSharedCrfConfirm(null);
    if (!pending) return;
    if (pending.mode === "save") {
      void runSave(pending.changeReason ?? null, { confirmedSharedCrf: true });
      return;
    }
    if (pending.mode === "publish") {
      setConfirmSharedCrf(true);
      setPendingPublishNames(pending.activityNames || []);
      setPublishModalOpen(true);
    }
  };

  const handlePublishConfirm = async (password) => {
    const names = pendingPublishNames.length > 0
      ? pendingPublishNames
      : [...selectedPublishNames];
    try {
      setPublishing(true);
      await publishVisitCrfMappings({
        activityNames: names,
        password,
        confirmSharedCrf,
      });
      setSelectedPublishNames(new Set());
      setPendingPublishNames([]);
      setConfirmSharedCrf(false);
      showToast(`Published ${names.length} activity mapping(s).`, "success");
      await loadAll();
      if (names.some((n) => n.toLowerCase() === activityName.trim().toLowerCase())) {
        setViewingPublished(true);
      }
    } catch (err) {
      showToast(err?.response?.data?.message || err?.message || "Publish failed.", "error");
    } finally {
      setPublishing(false);
    }
  };

  const columns = useMemo(
    () => [
      {
        key: "publishSelect",
        label: (
          <input
            type="checkbox"
            aria-label="Select all unpublished activities"
            checked={
              publishableActivityNames.length > 0
              && publishableActivityNames.every((n) => selectedPublishNames.has(n))
            }
            onChange={toggleSelectAllPublishable}
            onClick={(e) => e.stopPropagation()}
          />
        ),
        align: "center",
        searchable: false,
        render: (row) => {
          const name = String(row.activityName || "").trim();
          const canSelect = row.isActive !== false && !row.isPublished && !!name;
          return (
            <input
              type="checkbox"
              aria-label={`Select ${name || "activity"} for publish`}
              disabled={!canSelect}
              checked={canSelect && selectedPublishNames.has(name)}
              onChange={(e) => {
                e.stopPropagation();
                togglePublishSelection(name, e.target.checked);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          );
        },
      },
      {
        key: "activityName",
        label: "Activity Name",
        render: (row) => <span className="config-data-table__strong">{row.activityName}</span>,
        searchValue: (row) => row.activityName ?? "",
      },
      {
        key: "visitLabel",
        label: "Visit",
        searchValue: (row) => row.visitLabel ?? "",
      },
      {
        key: "crfName",
        label: "CRF",
        searchValue: (row) => {
          const version = Number(row.version) || 0;
          const versionText = version > 0 ? ` v${version}` : "";
          return `${row.crfName ?? ""} ${row.crfTemplateId ?? ""}${versionText}`;
        },
        render: (row) => {
          const name = String(row.crfName || "").trim();
          const templateId = String(row.crfTemplateId || "").trim();
          const version = Number(row.version) || 0;
          const versionText = version > 0 ? ` · v${version}` : "";
          if (!name && !templateId) return "—";
          if (!templateId) {
            return version > 0 ? `${name} (v${version})` : name;
          }
          if (!name || name === templateId) {
            return version > 0 ? `${templateId} (v${version})` : templateId;
          }
          const title = `${name} (${templateId}${versionText})`;
          return (
            <span className="config-data-table__wrap" title={title}>
              {name}{" "}
              <span className="admin-muted">({templateId}{versionText})</span>
            </span>
          );
        },
      },
      {
        key: "isRepeat",
        label: "Repeat",
        align: "center",
        searchValue: (row) => (row.isRepeat ? "Yes" : "No"),
        render: (row) => (
          <span className={`status-badge status-badge--compact ${row.isRepeat ? "status--upcoming" : "status--inactive"}`}>
            {row.isRepeat ? "Yes" : "No"}
          </span>
        ),
      },
      {
        key: "isPublished",
        label: "Status",
        align: "center",
        searchValue: (row) => {
          if (row.isPublished) return "Published";
          return row.isActive === false ? "Inactive" : "Draft";
        },
        render: (row) => {
          if (row.isPublished) {
            return (
              <span className="status-badge status-badge--compact status--completed">
                Published
              </span>
            );
          }
          return (
            <span className={`status-badge status-badge--compact ${row.isActive === false ? "status--inactive" : "status--upcoming"}`}>
              {row.isActive === false ? "Inactive" : "Draft"}
            </span>
          );
        },
      },
      {
        key: "recordedSign",
        label: "Performed By",
        render: (row) => {
          const value = row.recordedSign?.trim() || "—";
          return <span className="config-data-table__wrap" title={value}>{value}</span>;
        },
        searchValue: (row) => row.recordedSign ?? "",
      },
      {
        key: "recordedOnUtc",
        label: "Performed On (UTC)",
        align: "center",
        render: (row) => formatAuditUtc(row.recordedOnUtc),
        searchValue: (row) => formatAuditUtc(row.recordedOnUtc),
      },
      {
        key: "recordedAtOffset",
        label: "Performed On (Offset)",
        align: "center",
        render: (row) => formatOffset(row.recordedAtOffset),
        searchValue: (row) => formatOffset(row.recordedAtOffset),
      },
    ],
    [publishableActivityNames, selectedPublishNames]
  );

  if (loading) {
    return (
      <div className="admin-wrap admin-wrap--visit-crf-mapping">
        <div className="admin-card admin-spinner">
          <i className="fas fa-spinner fa-spin" style={{ marginRight: "0.5rem" }} /> Loading activity mappings...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-wrap admin-wrap--visit-crf-mapping">
        <div className="admin-card admin-error-card">
          <div className="admin-error-title">Failed to Load Data</div>
          <div className="admin-error-msg">{error}</div>
          <AdminButton variant="primary" style={{ marginTop: "1rem" }} onClick={loadAll}>
            Retry
          </AdminButton>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-wrap admin-wrap--visit-crf-mapping">
      <SoftAlertToast
        title={toast?.variant === "error" ? "Error" : toast?.variant === "warning" ? "Warning" : "Success"}
        message={toast?.message}
        variant={toast?.variant ?? "success"}
        onClose={() => setToast(null)}
      />

      {showReasonModal ? (
        <ChangeReasonModal
          onClose={() => setShowReasonModal(false)}
          onConfirm={handleSaveConfirm}
        />
      ) : null}

      <ConfirmModal
        open={Boolean(sharedCrfConfirm)}
        title="CRF already in use"
        message={sharedCrfConfirm?.message || ""}
        details={sharedCrfConfirm?.details}
        confirmLabel="Continue"
        onClose={() => setSharedCrfConfirm(null)}
        onConfirm={handleSharedCrfConfirm}
      />

      <PasswordConfirmModal
        open={publishModalOpen}
        title="Publish Activity Mapping"
        message={`Enter your password to publish ${pendingPublishNames.length || selectedPublishableCount} activity mapping(s) for site use.`}
        confirmLabel="Publish"
        onClose={() => {
          setPublishModalOpen(false);
          setPendingPublishNames([]);
          setConfirmSharedCrf(false);
        }}
        onValidatePassword={validatePassword}
        onConfirm={handlePublishConfirm}
      />

      {auditModal}

      <div className="admin-card admin-card--config-form">
        <form onSubmit={handleSaveClick}>
          <div className="admin-form-grid admin-form-grid--activity-mapping">
            <div className="admin-form-field admin-form-field--activity-name">
              <AdminFieldLabel
                htmlFor="activity-mapping-name"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit(MAPPING_AUDIT_COLUMNS.activityName, "Activity Name")}
                auditTitle="Audit history for activity name"
              >
                Activity Name
              </AdminFieldLabel>
              <input
                id="activity-mapping-name"
                type="text"
                className="admin-input"
                value={activityName}
                onChange={(e) => setActivityName(e.target.value)}
                placeholder="Enter activity name..."
                disabled={detailsLocked}
              />
            </div>
            <div className="admin-form-field admin-form-field--activity-visits">
              <AdminFieldLabel
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit(MAPPING_AUDIT_COLUMNS.visit, "Visit", {
                  valueMap: visitAuditValueMap,
                })}
                auditTitle="Audit history for visit"
              >
                Visits
              </AdminFieldLabel>
              <MultiSelectDropdown
                label="Visits"
                options={visitOptions}
                selectedValues={selectedVisitNos}
                onChange={toggleVisit}
                onSelectAll={() => {
                  if (detailsLocked) return;
                  setSelectedVisitNos(visitOptions.map((o) => o.value));
                }}
                onClear={() => {
                  if (detailsLocked) return;
                  setSelectedVisitNos([]);
                }}
                placeholder="Select visits..."
                disabled={detailsLocked}
                getOptionLabel={(o) => o.label}
                getOptionValue={(o) => o.value}
              />
            </div>
            <div className="admin-form-field admin-form-field--activity-crf">
              <AdminFieldLabel
                htmlFor="activity-mapping-crf"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit(MAPPING_AUDIT_COLUMNS.crf, "CRF")}
                auditTitle="Audit history for CRF"
              >
                CRF
              </AdminFieldLabel>
              {eligible.length === 0 ? (
                <div className="admin-muted">
                  No eligible CRFs. Export CRFs to eSource without an activity type first.
                </div>
              ) : (
                <ScrollableSelect
                  id="activity-mapping-crf"
                  ariaLabel="Select CRF"
                  value={selectedCrfTemplateId}
                  onChange={setSelectedCrfTemplateId}
                  options={crfSelectOptions}
                  placeholder="Select CRF..."
                  allowEmpty
                  disabled={detailsLocked}
                />
              )}
            </div>
            <div className="admin-form-field admin-form-field--activity-flags">
              <AdminFieldLabel>Flags</AdminFieldLabel>
              <div className="admin-checkbox-row activity-mapping-flags">
                <div className="admin-checkbox-wrapper admin-checkbox-wrapper--with-audit activity-mapping-flags__item">
                  <input
                    id="activity-mapping-active"
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    disabled={activeToggleLocked}
                  />
                  <AdminFieldLabel
                    htmlFor="activity-mapping-active"
                    variant="checkbox"
                    showAudit={canAudit}
                    onOpenAudit={() => openFieldAudit(MAPPING_AUDIT_COLUMNS.isActive, "Is Active")}
                    auditTitle="Audit history for Is Active"
                  >
                    Is Active
                  </AdminFieldLabel>
                </div>
                <div className="admin-checkbox-wrapper admin-checkbox-wrapper--with-audit activity-mapping-flags__item">
                  <input
                    id="activity-mapping-repeat"
                    type="checkbox"
                    checked={isRepeat}
                    onChange={(e) => setIsRepeat(e.target.checked)}
                    disabled={detailsLocked}
                  />
                  <AdminFieldLabel
                    htmlFor="activity-mapping-repeat"
                    variant="checkbox"
                    showAudit={canAudit}
                    onOpenAudit={() => openFieldAudit(MAPPING_AUDIT_COLUMNS.isRepeat, "Repeat")}
                    auditTitle="Audit history for Repeat"
                  >
                    Repeat
                  </AdminFieldLabel>
                </div>
              </div>
            </div>
          </div>

          <div className="admin-button-row">
            <AdminButton type="submit" variant="primary" disabled={saving || publishing}>
              {isUpdateMode || viewingPublished
                ? (saving ? "Updating..." : "Update")
                : (saving ? "Saving..." : "Save")}
            </AdminButton>
            <AdminButton type="button" variant="secondary" onClick={handleClear} disabled={saving || publishing}>
              Clear
            </AdminButton>
            <AdminButton type="button" variant="secondary" onClick={() => navigate("/execute")}>
              Close
            </AdminButton>
          </div>
        </form>
      </div>

      <div className="admin-card admin-card--config-table">
        <ConfigDataTable
          columns={columns}
          rows={filteredRows}
          emptyMessage="No activity mappings found."
          variant="visit-crf-mapping"
          getRowKey={(row) => row.appVisitCrfMappingNo}
          getRowClassName={(row) => {
            const classes = [];
            if (row.isActive === false) classes.push("config-data-table__row--inactive");
            if (row.isPublished) classes.push("config-data-table__row--published");
            return classes.join(" ");
          }}
          selectedRowKey={editingMappingNo}
          onRowClick={handleEditRow}
          searchable
          searchPlaceholder="Search activity, visit, CRF, or performed by..."
          paginated
          defaultPageSize={10}
          toolbarExtra={(
            <div className="activity-mapping-toolbar-extra">
              <div className="admin-form-field">
                <ScrollableSelect
                  ariaLabel="Filter by activity"
                  value={filterActivityName}
                  onChange={setFilterActivityName}
                  options={activityFilterOptions}
                  placeholder="Filter by activity..."
                  allowEmpty
                />
              </div>
              <AdminButton
                type="button"
                variant="primary"
                onClick={handlePublishSelectedClick}
                disabled={selectedPublishableCount === 0 || saving || publishing}
              >
                {publishing ? "Publishing..." : "Publish"}
              </AdminButton>
            </div>
          )}
        />
      </div>
    </div>
  );
}
