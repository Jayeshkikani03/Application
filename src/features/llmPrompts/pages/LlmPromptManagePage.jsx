import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AdminButton } from "../../../components/shared/AdminButton";
import { ConfigDataTable } from "../../../components/shared/ConfigDataTable";
import { ScrollableSelect } from "../../../components/shared/ScrollableSelect";
import { renderAdminStatusBadge } from "../../../components/shared/adminTableHelpers";
import { SoftAlertToast } from "../../../components/shared/SoftAlertToast";
import { AdminFieldLabel } from "@/components/shared/AdminFieldLabel.jsx";
import { useAdminRecordAudit } from "@/hooks/useAdminRecordAudit.jsx";
import { llmPromptApi } from "../api/llmPromptApi";

export const LLM_TEMPLATE_TYPES = [
  { value: "DoseTimepointConfig", label: "Dose & Timepoint Config" },
];

function templateTypeLabel(value) {
  return LLM_TEMPLATE_TYPES.find((item) => item.value === value)?.label || value || "—";
}

function templateDisplayName(template) {
  return String(template?.templateName || "").trim() || "Untitled prompt";
}

function templateVersionSummary(template) {
  const parts = [];
  if (template?.latestPublishedVersion != null) parts.push(`Published v${template.latestPublishedVersion}`);
  if (template?.draftVersion != null) parts.push(`Draft v${template.draftVersion}`);
  return parts;
}

function nextTemplateCode(templates) {
  let max = 0;
  for (const row of templates ?? []) {
    const parsed = Number.parseInt(String(row.templateCode ?? ""), 10);
    if (Number.isInteger(parsed) && parsed > max) max = parsed;
  }
  return String(max + 1).padStart(4, "0");
}

function ChangeReasonModal({ onClose, onConfirm, title = "Reason for Change" }) {
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
        <div className="admin-reason-modal-title">{title}</div>
        <label className="admin-reason-label" htmlFor="llm-prompt-change-reason">
          Please enter the reason for this change <span style={{ color: "var(--red)" }}>*</span>
        </label>
        <textarea
          id="llm-prompt-change-reason"
          className="admin-reason-textarea"
          value={reason}
          onChange={(e) => { setReason(e.target.value); setError(""); }}
          placeholder="Enter reason..."
          autoFocus
        />
        {error && <div className="admin-reason-error">{error}</div>}
        <div className="admin-reason-actions">
          <AdminButton variant="secondary" onClick={onClose}>Cancel</AdminButton>
          <AdminButton variant="primary" onClick={handleConfirm}>Confirm</AdminButton>
        </div>
      </div>
    </div>
  );
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatPerformedOnUtc(value) {
  if (!value) return "—";
  const raw = String(value).trim();
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/
  );
  if (match) {
    return `${match[3]}-${MONTH_SHORT[Number(match[2]) - 1] || match[2]}-${match[1]} ${match[4]}:${match[5]}`;
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
  const match = stored.match(/^([+-])(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return stored;
  return `${match[1]}${String(match[2]).padStart(2, "0")}:${match[3]}`;
}

function PromptRowMenu({ disabled = false, isActive = true, viewLabel = "View version detail", onView, onPublish, onToggleActive }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    const menuEl = menuRef.current;
    if (!rect) return;
    const menuWidth = menuEl?.offsetWidth || 160;
    const menuHeight = menuEl?.offsetHeight || 0;
    const gap = 4;
    const viewportPad = 8;
    let left = rect.left;
    left = Math.max(viewportPad, Math.min(left, window.innerWidth - menuWidth - viewportPad));
    let top = rect.bottom + gap;
    if (menuHeight > 0 && top + menuHeight > window.innerHeight - viewportPad) {
      top = Math.max(viewportPad, rect.top - menuHeight - gap);
    }
    setPosition({ top, left });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (event) => {
      if (containerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [open]);

  const runAction = (fn) => {
    setOpen(false);
    fn?.();
  };

  const dropdown = open ? (
    <div
      ref={menuRef}
      className="query-actions-menu__dropdown"
      style={{ top: position.top, left: position.left }}
      role="menu"
    >
      <button type="button" role="menuitem" className="query-actions-menu__item" disabled={disabled} onClick={() => runAction(onView)}>
        {viewLabel}
      </button>
      <button type="button" role="menuitem" className="query-actions-menu__item" disabled={disabled} onClick={() => runAction(onPublish)}>
        Publish
      </button>
      <button type="button" role="menuitem" className="query-actions-menu__item" disabled={disabled} onClick={() => runAction(onToggleActive)}>
        {isActive === false ? "Active" : "Inactive"}
      </button>
    </div>
  ) : null;

  return (
    <div className="query-actions-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--sm btn--ghost query-actions-menu__trigger"
        aria-label="More actions"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          if (open) {
            setOpen(false);
            return;
          }
          updatePosition();
          setOpen(true);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="8" cy="3" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="8" cy="13" r="1.4" />
        </svg>
      </button>
      {dropdown ? createPortal(dropdown, document.body) : null}
    </div>
  );
}

function VersionBadge({ version, status }) {
  if (version == null) {
    return <span className="llm-prompt-version-empty">{status === "Draft" ? "—" : "Not published"}</span>;
  }
  const isPublished = status === "Published";
  return (
    <span className={`status-badge status-badge--compact ${isPublished ? "status--completed" : "status--upcoming"}`}>
      {isPublished ? "Published" : "Draft"} v{version}
    </span>
  );
}

export function VersionHistoryModal({ template, onClose }) {
  const versions = Array.isArray(template?.versions) ? template.versions : [];
  const [selectedNo, setSelectedNo] = useState(versions[0]?.llmPromptVersionNo ?? null);
  const selected = versions.find((row) => row.llmPromptVersionNo === selectedNo) ?? versions[0] ?? null;
  const versionSummary = templateVersionSummary(template);

  if (!template) return null;

  return createPortal(
    <div className="admin-reason-modal-backdrop" role="presentation">
      <div
        className="admin-reason-modal llm-prompt-version-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="llm-prompt-version-title"
      >
        <div className="llm-prompt-version-modal__head">
          <div>
            <div className="admin-reason-modal-title" id="llm-prompt-version-title">
              {templateDisplayName(template)}
            </div>
            <div className="llm-prompt-version-modal__head-meta">
              {versionSummary.length ? versionSummary.map((label) => (
                <span key={label} className="llm-prompt-version-modal__head-chip">{label}</span>
              )) : (
                <span className="llm-prompt-version-empty">No versions yet</span>
              )}
            </div>
          </div>
        </div>
        <div className="llm-prompt-version-modal__layout">
          <div className="llm-prompt-version-modal__list">
            {versions.length === 0 ? (
              <p className="llm-prompt-version-empty">No versions yet.</p>
            ) : versions.map((row) => (
              <button
                key={row.llmPromptVersionNo}
                type="button"
                className={`llm-prompt-version-modal__item${row.llmPromptVersionNo === selected?.llmPromptVersionNo ? " is-selected" : ""}`}
                onClick={() => setSelectedNo(row.llmPromptVersionNo)}
              >
                <span className="config-data-table__strong">v{row.version}</span>
                <VersionBadge version={row.version} status={row.status} />
                <span className="llm-prompt-version-modal__item-date">
                  {formatPerformedOnUtc(row.status === "Published" ? row.publishedOnUtc : row.recordedOnUtc)}
                </span>
              </button>
            ))}
          </div>
          <div className="llm-prompt-version-modal__detail">
            {selected ? (
              <>
                <dl className="llm-prompt-version-modal__audit">
                  <div>
                    <dt>Performed By</dt>
                    <dd>{selected.recordedSign || "—"}</dd>
                  </div>
                  <div>
                    <dt>Performed On (UTC)</dt>
                    <dd>{formatPerformedOnUtc(selected.recordedOnUtc)}</dd>
                  </div>
                  <div>
                    <dt>Performed On (Offset)</dt>
                    <dd>{formatOffset(selected.recordedAtOffset)}</dd>
                  </div>
                </dl>
                {selected.promptText?.trim() ? (
                  <pre className="llm-prompt-version-modal__body">{selected.promptText}</pre>
                ) : (
                  <p className="llm-prompt-version-modal__empty">No prompt text saved for this version.</p>
                )}
              </>
            ) : (
              <p className="llm-prompt-version-empty">Select a version.</p>
            )}
          </div>
        </div>
        <div className="admin-reason-actions">
          <AdminButton variant="secondary" onClick={onClose}>Close</AdminButton>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function LlmPromptManagePage() {
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [busyRowNo, setBusyRowNo] = useState(null);
  const [reasonMode, setReasonMode] = useState(null);

  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [templateCode, setTemplateCode] = useState("");
  const [templateType, setTemplateType] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [description, setDescription] = useState("");
  const [promptText, setPromptText] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [originalRecord, setOriginalRecord] = useState(null);
  const [viewingTemplate, setViewingTemplate] = useState(null);

  const showToast = (message, variant = "success") => setToast({ message, variant });
  const { openFieldAudit, openRecordAudit, auditModal, canAudit } = useAdminRecordAudit(
    editingId,
    "LlmPromptTemplate",
  );

  const applyTemplate = (row) => {
    if (!row) return;
    setTemplateCode(row.templateCode || "");
    setTemplateType(row.templateType || "");
    setTemplateName(row.templateName || "");
    setDescription(row.description || "");
    setPromptText(row.draftPromptText ?? "");
    setIsActive(row.isActive !== false);
    setEditingId(row.llmPromptTemplateNo);
    setOriginalRecord(row);
  };

  const resetForm = (list = templates) => {
    setTemplateCode(nextTemplateCode(list));
    setTemplateType("");
    setTemplateName("");
    setDescription("");
    setPromptText("");
    setIsActive(true);
    setEditingId(null);
    setOriginalRecord(null);
  };

  const loadTemplates = async (keepSelectedNo) => {
    try {
      setLoading(true);
      setError(null);
      const data = await llmPromptApi.getTemplates();
      const list = Array.isArray(data) ? data : [];
      setTemplates(list);
      if (keepSelectedNo === null) {
        resetForm(list);
      } else if (keepSelectedNo) {
        const selected = list.find((t) => t.llmPromptTemplateNo === keepSelectedNo);
        if (selected) applyTemplate(selected);
        else resetForm(list);
      } else if (editingId) {
        const selected = list.find((t) => t.llmPromptTemplateNo === editingId);
        if (selected) applyTemplate(selected);
      }
      return list;
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Failed to load prompt templates.";
      setError(msg);
      showToast(msg, "error");
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTemplates(null); }, []);

  const hasChanges = useMemo(() => {
    if (!editingId || !originalRecord) return true;
    return (
      templateType !== (originalRecord.templateType || "") ||
      templateName !== (originalRecord.templateName || "") ||
      description !== (originalRecord.description || "") ||
      promptText !== (originalRecord.draftPromptText ?? "") ||
      isActive !== (originalRecord.isActive !== false)
    );
  }, [templateType, templateName, description, promptText, isActive, editingId, originalRecord]);

  const submitSave = async (changeReason = null, override = null) => {
    const payloadRow = override ?? {
      llmPromptTemplateNo: editingId || 0,
      templateCode,
      templateType,
      templateName,
      description,
      promptText,
      isActive,
    };
    if (!String(payloadRow.templateType || "").trim()) {
      showToast("Template Type is required.", "warning");
      return;
    }
    if (!String(payloadRow.templateName || "").trim()) {
      showToast("Template Name is required.", "warning");
      return;
    }
    if (!override && !String(payloadRow.promptText || "").trim()) {
      showToast("Prompt is required.", "warning");
      return;
    }
    if (!payloadRow.llmPromptTemplateNo) {
      const existing = templates.find(
        (row) => String(row.templateType || "").toLowerCase() === String(payloadRow.templateType).trim().toLowerCase()
      );
      if (existing) {
        showToast(
          `${templateTypeLabel(payloadRow.templateType)} already exists. Click that row to edit.`,
          "warning"
        );
        return;
      }
    }
    try {
      setIsSaving(true);
      const saved = await llmPromptApi.saveDraft({
        llmPromptTemplateNo: payloadRow.llmPromptTemplateNo || 0,
        templateType: String(payloadRow.templateType || "").trim(),
        templateName: String(payloadRow.templateName).trim(),
        description: String(payloadRow.description || "").trim() || null,
        promptText: payloadRow.promptText ?? "",
        isActive: payloadRow.isActive !== false,
        changeReason,
      });
      showToast(payloadRow.llmPromptTemplateNo ? "Prompt saved" : "Prompt created", "success");
      const savedNo = saved?.llmPromptTemplateNo || payloadRow.llmPromptTemplateNo || null;
      await loadTemplates(override ? (editingId || undefined) : savedNo);
    } catch (err) {
      showToast(err?.response?.data?.message || err?.message || "Failed to save prompt.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const submitPublish = async (templateNo, changeReason = null) => {
    if (!templateNo) {
      showToast("Save the template first, then publish.", "warning");
      return;
    }
    try {
      setBusyRowNo(templateNo);
      await llmPromptApi.publish(templateNo, changeReason);
      showToast("Prompt published successfully", "success");
      await loadTemplates();
    } catch (err) {
      showToast(err?.response?.data?.message || err?.message || "Failed to publish prompt.", "error");
    } finally {
      setBusyRowNo(null);
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    if (!templateType.trim()) { showToast("Template Type is required.", "warning"); return; }
    if (!templateName.trim()) { showToast("Template Name is required.", "warning"); return; }
    if (!promptText.trim()) { showToast("Prompt is required.", "warning"); return; }
    if (editingId) setReasonMode({ type: "save" });
    else submitSave();
  };

  const handleGridPublish = (row) => {
    const draftText = (row.draftPromptText || "").trim();
    if (!draftText) {
      showToast("Draft prompt is empty. Save prompt text first.", "warning");
      return;
    }
    setReasonMode({ type: "publish", templateNo: row.llmPromptTemplateNo });
  };

  const handleGridToggleActive = (row) => {
    setReasonMode({ type: "toggle", row });
  };

  const confirmReason = (reason) => {
    const mode = reasonMode;
    setReasonMode(null);
    if (!mode) return;
    if (mode.type === "save") submitSave(reason);
    else if (mode.type === "publish") submitPublish(mode.templateNo, reason);
    else if (mode.type === "toggle") {
      const row = mode.row;
      submitSave(reason, {
        llmPromptTemplateNo: row.llmPromptTemplateNo,
        templateCode: row.templateCode,
        templateType: row.templateType,
        templateName: row.templateName,
        description: row.description,
        promptText: row.draftPromptText ?? "",
        isActive: row.isActive === false,
      });
    }
  };

  const columns = useMemo(
    () => [
      {
        key: "actions",
        label: "Action",
        align: "center",
        stopRowClick: true,
        render: (row) => (
          <PromptRowMenu
            disabled={busyRowNo === row.llmPromptTemplateNo || isSaving}
            isActive={row.isActive !== false}
            viewLabel="View version detail"
            onView={() => setViewingTemplate(row)}
            onPublish={() => handleGridPublish(row)}
            onToggleActive={() => handleGridToggleActive(row)}
          />
        ),
      },
      {
        key: "templateCode",
        label: "Template Code",
        render: (row) => <span className="config-data-table__mono">{row.templateCode || "—"}</span>,
        searchValue: (row) => row.templateCode ?? "",
      },
      {
        key: "templateType",
        label: "Template Type",
        render: (row) => templateTypeLabel(row.templateType),
        searchValue: (row) => `${row.templateType ?? ""} ${templateTypeLabel(row.templateType)}`,
      },
      {
        key: "templateName",
        label: "Template Name",
        render: (row) => <span className="config-data-table__strong">{row.templateName || "—"}</span>,
        searchValue: (row) => `${row.templateName ?? ""} ${row.description ?? ""}`,
      },
      {
        key: "description",
        label: "Description",
        render: (row) => (
          <span className="config-data-table__wrap" title={row.description || ""}>
            {row.description || "—"}
          </span>
        ),
        searchValue: (row) => row.description ?? "",
      },
      {
        key: "latestPublishedVersion",
        label: "Published",
        align: "center",
        render: (row) => (
          row.latestPublishedVersion != null
            ? <VersionBadge version={row.latestPublishedVersion} status="Published" />
            : <span className="llm-prompt-version-empty">Not published</span>
        ),
        searchValue: (row) => (row.latestPublishedVersion != null ? `published v${row.latestPublishedVersion}` : "not published"),
      },
      {
        key: "draftVersion",
        label: "Draft",
        align: "center",
        render: (row) => (
          row.draftVersion != null
            ? <VersionBadge version={row.draftVersion} status="Draft" />
            : "—"
        ),
        searchValue: (row) => (row.draftVersion != null ? `draft v${row.draftVersion}` : ""),
      },
      {
        key: "isActive",
        label: "Status",
        align: "center",
        searchValue: (row) => (row.isActive ? "Active" : "Inactive"),
        render: (row) => renderAdminStatusBadge(row.isActive),
      },
    ],
    [busyRowNo, isSaving]
  );

  if (loading && templates.length === 0) {
    return (
      <div className="admin-wrap admin-wrap--llm-prompts">
        <div className="admin-card admin-spinner">
          <i className="fas fa-spinner fa-spin" style={{ marginRight: "0.5rem" }} /> Loading prompt templates...
        </div>
      </div>
    );
  }

  if (error && templates.length === 0) {
    return (
      <div className="admin-wrap admin-wrap--llm-prompts">
        <div className="admin-card admin-error-card">
          <div className="admin-error-title">Failed to Load Data</div>
          <div className="admin-error-msg">{error}</div>
          <AdminButton variant="primary" style={{ marginTop: "1rem" }} onClick={() => loadTemplates(null)}>
            Retry Connection
          </AdminButton>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-wrap admin-wrap--llm-prompts">
      <SoftAlertToast
        title={toast?.variant === "error" ? "Error" : toast?.variant === "warning" ? "Warning" : "Success"}
        message={toast?.message}
        variant={toast?.variant ?? "success"}
        onClose={() => setToast(null)}
      />

      {reasonMode && (
        <ChangeReasonModal
          title={reasonMode.type === "publish" ? "Reason for Publish" : "Reason for Change"}
          onClose={() => setReasonMode(null)}
          onConfirm={confirmReason}
        />
      )}
      {viewingTemplate ? (
        <VersionHistoryModal
          template={viewingTemplate}
          onClose={() => setViewingTemplate(null)}
        />
      ) : null}
      {auditModal}

      <div className="admin-card admin-card--config-form">
        <form onSubmit={handleSave}>
          <div className="admin-form-grid admin-form-grid--llm-prompt">
            <div className="admin-form-field">
              <AdminFieldLabel htmlFor="llm-template-code">Template Code</AdminFieldLabel>
              <input
                id="llm-template-code"
                type="text"
                className="admin-input"
                value={templateCode}
                disabled
                tabIndex={-1}
                title="Auto generated"
              />
            </div>
            <div className="admin-form-field">
              <AdminFieldLabel htmlFor="llm-template-type">
                Template Type <span style={{ color: "var(--red)" }}>*</span>
              </AdminFieldLabel>
              <ScrollableSelect
                id="llm-template-type"
                value={templateType}
                allowEmpty
                placeholder="Select..."
                options={LLM_TEMPLATE_TYPES}
                onChange={(nextValue) => {
                  const nextType = String(nextValue || "");
                  if (!nextType) {
                    setTemplateType("");
                    return;
                  }
                  const existing = templates.find((row) => row.templateType === nextType);
                  if (existing && existing.llmPromptTemplateNo !== editingId) {
                    showToast(
                      `${templateTypeLabel(nextType)} already exists. Click that row to edit.`,
                      "warning"
                    );
                    return;
                  }
                  setTemplateType(nextType);
                }}
              />
            </div>
            <div className="admin-form-field">
              <AdminFieldLabel
                htmlFor="llm-template-name"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("vTemplateName", "Template Name")}
                auditTitle="Audit history for template name"
              >
                Template Name <span style={{ color: "var(--red)" }}>*</span>
              </AdminFieldLabel>
              <input
                id="llm-template-name"
                type="text"
                className="admin-input"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Template name"
              />
            </div>
            <div className="admin-form-field">
              <AdminFieldLabel htmlFor="llm-template-desc">Description</AdminFieldLabel>
              <input
                id="llm-template-desc"
                type="text"
                className="admin-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description"
              />
            </div>
          </div>

          <div className="admin-form-grid admin-form-grid--full llm-prompt-form__block">
            <div className="admin-form-field">
              <AdminFieldLabel htmlFor="llm-prompt-text">
                Prompt <span style={{ color: "var(--red)" }}>*</span>
              </AdminFieldLabel>
              <textarea
                id="llm-prompt-text"
                className="admin-input llm-prompt-textarea"
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder="Enter prompt text..."
              />
            </div>
          </div>

          <div className="admin-button-row">
            <AdminButton type="submit" variant="primary" disabled={(editingId && !hasChanges) || isSaving}>
              {isSaving ? "Saving..." : "Save Draft"}
            </AdminButton>
            {canAudit ? (
              <AdminButton type="button" variant="secondary" onClick={openRecordAudit}>
                <i className="fas fa-clipboard-list" /> Audit
              </AdminButton>
            ) : null}
            <AdminButton type="button" variant="secondary" onClick={() => resetForm(templates)}>Clear</AdminButton>
            <AdminButton type="button" variant="secondary" onClick={() => navigate("/execute")}>Close</AdminButton>
          </div>
        </form>
      </div>

      <div className="admin-card admin-card--config-table">
        <ConfigDataTable
          columns={columns}
          rows={templates}
          emptyMessage="No prompt templates found."
          variant="admin-llm-prompts"
          getRowKey={(row) => row.llmPromptTemplateNo}
          getRowClassName={(row) => (row.isActive ? "" : "config-data-table__row--inactive")}
          onRowClick={applyTemplate}
          selectedRowKey={editingId}
          searchable
          searchPlaceholder="Search template name or code..."
          paginated
          defaultPageSize={10}
        />
      </div>
    </div>
  );
}
