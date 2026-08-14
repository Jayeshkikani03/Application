import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AdminButton } from "../../../components/shared/AdminButton";
import { ConfigDataTable } from "../../../components/shared/ConfigDataTable";
import { renderAdminStatusBadge } from "../../../components/shared/adminTableHelpers";
import { SoftAlertToast } from "../../../components/shared/SoftAlertToast";
import { AdminFieldLabel } from "@/components/shared/AdminFieldLabel.jsx";
import { useAdminRecordAudit } from "@/hooks/useAdminRecordAudit.jsx";
import { llmProviderConfigApi } from "../api/llmProviderConfigApi";

const MASKED_KEY = "********";
const DEFAULT_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";

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
        <label className="admin-reason-label" htmlFor="llm-config-change-reason">
          Please enter the reason for this change <span style={{ color: "var(--red)" }}>*</span>
        </label>
        <textarea
          id="llm-config-change-reason"
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

function ConfigRowMenu({ disabled = false, isActive = true, isPublished = false, onPublish, onToggleActive }) {
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

  const dropdown = open ? (
    <div
      ref={menuRef}
      className="query-actions-menu__dropdown"
      style={{ top: position.top, left: position.left }}
      role="menu"
    >
      <button
        type="button"
        role="menuitem"
        className="query-actions-menu__item"
        disabled={disabled || isPublished}
        onClick={() => {
          setOpen(false);
          onPublish?.();
        }}
      >
        Publish
      </button>
      <button
        type="button"
        role="menuitem"
        className="query-actions-menu__item"
        disabled={disabled}
        onClick={() => {
          setOpen(false);
          onToggleActive?.();
        }}
      >
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

export default function LlmProviderConfigPage() {
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [busyRowNo, setBusyRowNo] = useState(null);
  const [reasonMode, setReasonMode] = useState(null);

  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [providerName, setProviderName] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("");
  const [temperature, setTemperature] = useState("");
  const [maxOutputTokens, setMaxOutputTokens] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [originalRecord, setOriginalRecord] = useState(null);
  const [hasExistingKey, setHasExistingKey] = useState(false);

  const showToast = (message, variant = "success") => setToast({ message, variant });
  const { openFieldAudit, openRecordAudit, auditModal, canAudit } = useAdminRecordAudit(
    editingId,
    "LlmProviderConfig",
    { excludeFields: ["vApiKey"] },
  );

  const resetForm = () => {
    setProviderName("");
    setApiUrl("");
    setApiKey("");
    setModelName("");
    setTemperature("");
    setMaxOutputTokens("");
    setEditingId(null);
    setOriginalRecord(null);
    setHasExistingKey(false);
  };

  const applyConfig = (row) => {
    if (!row) return;
    setProviderName(row.providerName || "");
    setApiUrl(row.apiUrl || "");
    setApiKey(row.hasApiKey ? MASKED_KEY : "");
    setModelName(row.modelName || "");
    setTemperature(row.temperature ?? "");
    setMaxOutputTokens(row.maxOutputTokens != null ? String(row.maxOutputTokens) : "");
    setEditingId(row.llmProviderConfigNo);
    setOriginalRecord(row);
    setHasExistingKey(Boolean(row.hasApiKey));
  };

  const loadConfigs = async (keepSelectedNo) => {
    try {
      setLoading(true);
      setError(null);
      const data = await llmProviderConfigApi.getConfigs();
      const list = Array.isArray(data) ? data : [];
      setConfigs(list);
      if (keepSelectedNo === null) {
        resetForm();
      } else if (keepSelectedNo) {
        const selected = list.find((row) => row.llmProviderConfigNo === keepSelectedNo);
        if (selected) applyConfig(selected);
        else resetForm();
      } else if (editingId) {
        const selected = list.find((row) => row.llmProviderConfigNo === editingId);
        if (selected) applyConfig(selected);
      }
      return list;
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Failed to load LLM provider configs.";
      setError(msg);
      showToast(msg, "error");
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadConfigs(null); }, []);

  const hasChanges = useMemo(() => {
    if (!editingId || !originalRecord) return true;
    const keyChanged = apiKey && apiKey !== MASKED_KEY;
    return (
      providerName !== (originalRecord.providerName || "") ||
      apiUrl !== (originalRecord.apiUrl || "") ||
      modelName !== (originalRecord.modelName || "") ||
      temperature !== (originalRecord.temperature ?? "") ||
      maxOutputTokens !== (originalRecord.maxOutputTokens != null ? String(originalRecord.maxOutputTokens) : "") ||
      keyChanged
    );
  }, [providerName, apiUrl, apiKey, modelName, temperature, maxOutputTokens, editingId, originalRecord]);

  const submitSave = async (changeReason = null, override = null) => {
    const payloadRow = override ?? {
      llmProviderConfigNo: editingId || 0,
      providerName,
      apiUrl,
      apiKey,
      modelName,
      temperature,
      maxOutputTokens,
      isActive: originalRecord?.isActive !== false,
      hasExistingKey,
    };

    if (!String(payloadRow.providerName || "").trim()) {
      showToast("Provider Name is required.", "warning");
      return;
    }
    if (!String(payloadRow.modelName || "").trim()) {
      showToast("Model Name is required.", "warning");
      return;
    }
    if (!String(payloadRow.apiUrl || "").trim()) {
      showToast("API URL is required.", "warning");
      return;
    }

    const tokens = String(payloadRow.maxOutputTokens ?? "").trim() === ""
      ? null
      : Number(payloadRow.maxOutputTokens);
    if (String(payloadRow.maxOutputTokens ?? "").trim() !== "" && !Number.isFinite(tokens)) {
      showToast("Max Output Tokens must be a number.", "warning");
      return;
    }

    const keyToSend = !payloadRow.apiKey || payloadRow.apiKey === MASKED_KEY ? "" : String(payloadRow.apiKey).trim();
    if (!payloadRow.llmProviderConfigNo && !keyToSend) {
      showToast("API Key is required.", "warning");
      return;
    }

    try {
      if (override) setBusyRowNo(payloadRow.llmProviderConfigNo);
      else setIsSaving(true);
      const saved = await llmProviderConfigApi.saveConfig({
        llmProviderConfigNo: payloadRow.llmProviderConfigNo || 0,
        providerName: String(payloadRow.providerName).trim(),
        apiUrl: String(payloadRow.apiUrl).trim(),
        apiKey: keyToSend,
        modelName: String(payloadRow.modelName).trim(),
        temperature: String(payloadRow.temperature || "").trim() || null,
        maxOutputTokens: tokens,
        isActive: payloadRow.isActive !== false,
        changeReason,
      });
      showToast(payloadRow.llmProviderConfigNo ? "LLM config updated successfully" : "LLM config created successfully", "success");
      const savedNo = saved?.llmProviderConfigNo || payloadRow.llmProviderConfigNo || null;
      await loadConfigs(override ? (editingId || undefined) : savedNo);
    } catch (err) {
      showToast(err?.response?.data?.message || err?.message || "Failed to save LLM config.", "error");
    } finally {
      setIsSaving(false);
      setBusyRowNo(null);
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    if (!providerName.trim()) { showToast("Provider Name is required.", "warning"); return; }
    if (!modelName.trim()) { showToast("Model Name is required.", "warning"); return; }
    if (!apiUrl.trim()) { showToast("API URL is required.", "warning"); return; }
    if (!editingId && (!apiKey.trim() || apiKey === MASKED_KEY)) {
      showToast("API Key is required.", "warning");
      return;
    }
    if (editingId) setReasonMode({ type: "save" });
    else submitSave();
  };

  const submitPublish = async (configNo, changeReason = null) => {
    if (!configNo) {
      showToast("Save the configuration first, then publish.", "warning");
      return;
    }
    try {
      setBusyRowNo(configNo);
      await llmProviderConfigApi.publish(configNo, changeReason);
      showToast("LLM config published. Only this config is in use.", "success");
      await loadConfigs();
    } catch (err) {
      showToast(err?.response?.data?.message || err?.message || "Failed to publish LLM config.", "error");
    } finally {
      setBusyRowNo(null);
    }
  };

  const handleGridPublish = (row) => {
    if (!row?.hasApiKey || !String(row.apiUrl || "").trim() || !String(row.modelName || "").trim()) {
      showToast("API URL, API Key, and Model Name are required before publish.", "warning");
      return;
    }
    setReasonMode({ type: "publish", configNo: row.llmProviderConfigNo });
  };

  const confirmReason = (reason) => {
    const mode = reasonMode;
    setReasonMode(null);
    if (!mode) return;
    if (mode.type === "save") submitSave(reason);
    else if (mode.type === "publish") submitPublish(mode.configNo, reason);
    else if (mode.type === "toggle") {
      const row = mode.row;
      submitSave(reason, {
        llmProviderConfigNo: row.llmProviderConfigNo,
        providerName: row.providerName,
        apiUrl: row.apiUrl,
        apiKey: "",
        modelName: row.modelName,
        temperature: row.temperature ?? "",
        maxOutputTokens: row.maxOutputTokens != null ? String(row.maxOutputTokens) : "",
        isActive: row.isActive === false,
        hasExistingKey: Boolean(row.hasApiKey),
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
          <ConfigRowMenu
            disabled={busyRowNo === row.llmProviderConfigNo || isSaving}
            isActive={row.isActive !== false}
            isPublished={String(row.status || "").toLowerCase() === "published"}
            onPublish={() => handleGridPublish(row)}
            onToggleActive={() => setReasonMode({ type: "toggle", row })}
          />
        ),
      },
      {
        key: "providerName",
        label: "Provider",
        render: (row) => <span className="config-data-table__strong">{row.providerName}</span>,
        searchValue: (row) => row.providerName ?? "",
      },
      {
        key: "modelName",
        label: "Model",
        searchValue: (row) => row.modelName ?? "",
      },
      {
        key: "apiUrl",
        label: "API URL",
        render: (row) => (
          <span className="config-data-table__wrap config-data-table__mono">{row.apiUrl || "—"}</span>
        ),
        searchValue: (row) => row.apiUrl ?? "",
      },
      {
        key: "apiKey",
        label: "API Key",
        render: (row) => (row.hasApiKey ? MASKED_KEY : "—"),
      },
      {
        key: "status",
        label: "Published",
        align: "center",
        searchValue: (row) => row.status ?? "",
        render: (row) => {
          const published = String(row.status || "").toLowerCase() === "published";
          return (
            <span className={`status-badge status-badge--compact ${published ? "status--completed" : "status--upcoming"}`}>
              {published ? "Published" : "Draft"}
            </span>
          );
        },
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

  if (loading && configs.length === 0) {
    return (
      <div className="admin-wrap admin-wrap--llm-config">
        <div className="admin-card admin-spinner">
          <i className="fas fa-spinner fa-spin" style={{ marginRight: "0.5rem" }} /> Loading LLM provider configs...
        </div>
      </div>
    );
  }

  if (error && configs.length === 0) {
    return (
      <div className="admin-wrap admin-wrap--llm-config">
        <div className="admin-card admin-error-card">
          <div className="admin-error-title">Failed to Load Data</div>
          <div className="admin-error-msg">{error}</div>
          <AdminButton variant="primary" style={{ marginTop: "1rem" }} onClick={() => loadConfigs(null)}>
            Retry Connection
          </AdminButton>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-wrap admin-wrap--llm-config">
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
      {auditModal}

      <div className="admin-card admin-card--config-form">
        <form onSubmit={handleSave}>
          <div className="admin-form-grid admin-form-grid--llm-config">
            <div className="admin-form-field">
              <AdminFieldLabel
                htmlFor="llm-provider-name"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("vProviderName", "Provider Name")}
                auditTitle="Audit history for provider name"
              >
                Provider Name <span style={{ color: "var(--red)" }}>*</span>
              </AdminFieldLabel>
              <input
                id="llm-provider-name"
                type="text"
                className="admin-input"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                placeholder="Gemini"
              />
            </div>
            <div className="admin-form-field">
              <AdminFieldLabel htmlFor="llm-model-name">
                Model Name <span style={{ color: "var(--red)" }}>*</span>
              </AdminFieldLabel>
              <input
                id="llm-model-name"
                type="text"
                className="admin-input"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="gemini-3.5-flash"
              />
            </div>
            <div className="admin-form-field">
              <AdminFieldLabel htmlFor="llm-api-key">
                API Key <span style={{ color: "var(--red)" }}>*</span>
                {editingId && hasExistingKey ? " (masked to keep)" : ""}
              </AdminFieldLabel>
              <input
                id="llm-api-key"
                type="password"
                className="admin-input"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={editingId && hasExistingKey ? MASKED_KEY : "Enter API key"}
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="admin-form-grid admin-form-grid--full llm-prompt-form__block">
            <div className="admin-form-field">
              <AdminFieldLabel htmlFor="llm-api-url">
                API URL <span style={{ color: "var(--red)" }}>*</span>
              </AdminFieldLabel>
              <input
                id="llm-api-url"
                type="text"
                className="admin-input"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder={DEFAULT_API_URL}
              />
            </div>
          </div>

          <div className="admin-form-grid admin-form-grid--llm-config llm-prompt-form__block">
            <div className="admin-form-field">
              <AdminFieldLabel htmlFor="llm-temperature">Temperature</AdminFieldLabel>
              <input
                id="llm-temperature"
                type="text"
                className="admin-input"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                placeholder="0.2"
              />
            </div>
            <div className="admin-form-field">
              <AdminFieldLabel htmlFor="llm-max-tokens">Max Output Tokens</AdminFieldLabel>
              <input
                id="llm-max-tokens"
                type="text"
                className="admin-input"
                value={maxOutputTokens}
                onChange={(e) => setMaxOutputTokens(e.target.value)}
                placeholder="65536"
              />
            </div>
          </div>

          <div className="admin-button-row">
            <AdminButton type="submit" variant="primary" disabled={(editingId && !hasChanges) || isSaving}>
              {editingId ? (isSaving ? "Updating..." : "Update") : (isSaving ? "Saving..." : "Save")}
            </AdminButton>
            {canAudit ? (
              <AdminButton type="button" variant="secondary" onClick={openRecordAudit}>
                <i className="fas fa-clipboard-list" /> Audit
              </AdminButton>
            ) : null}
            <AdminButton type="button" variant="secondary" onClick={resetForm}>Clear</AdminButton>
            <AdminButton type="button" variant="secondary" onClick={() => navigate("/execute")}>Close</AdminButton>
          </div>
        </form>
      </div>

      <div className="admin-card admin-card--config-table">
        <ConfigDataTable
          columns={columns}
          rows={configs}
          emptyMessage="No LLM provider configs found."
          variant="admin-llm-config"
          getRowKey={(row) => row.llmProviderConfigNo}
          getRowClassName={(row) => (row.isActive ? "" : "config-data-table__row--inactive")}
          onRowClick={applyConfig}
          selectedRowKey={editingId}
          searchable
          searchPlaceholder="Search provider, model, or URL..."
          paginated
          defaultPageSize={10}
        />
      </div>
    </div>
  );
}
