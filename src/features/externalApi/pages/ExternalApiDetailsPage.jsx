import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AdminButton } from "../../../components/shared/AdminButton";
import { ConfigDataTable } from "../../../components/shared/ConfigDataTable";
import { renderAdminStatusBadge } from "../../../components/shared/adminTableHelpers";
import { SoftAlertToast } from "../../../components/shared/SoftAlertToast";
import { AdminFieldLabel } from "@/components/shared/AdminFieldLabel.jsx";
import { useAdminRecordAudit } from "@/hooks/useAdminRecordAudit.jsx";
import { externalApiDetailsApi } from "../api/externalApiDetailsApi";

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
        <label className="admin-reason-label" htmlFor="external-api-change-reason">
          Please enter the reason for this change <span style={{ color: "var(--red)" }}>*</span>
        </label>
        <textarea
          id="external-api-change-reason"
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

export default function ExternalApiDetailsPage() {
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showReasonModal, setShowReasonModal] = useState(false);

  const [details, setDetails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [appName, setAppName] = useState("");
  const [methodName, setMethodName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [pathTemplate, setPathTemplate] = useState("");
  const [methodType, setMethodType] = useState("");
  const [returnType, setReturnType] = useState("");
  const [parameters, setParameters] = useState("");
  const [fullUrl, setFullUrl] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [originalRecord, setOriginalRecord] = useState(null);

  const showToast = (message, variant = "success") => setToast({ message, variant });
  const { openFieldAudit, openRecordAudit, auditModal, canAudit } = useAdminRecordAudit(
    editingId,
    "ExternalApiDetail",
  );

  const loadDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await externalApiDetailsApi.getExternalApiDetails();
      setDetails(data);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Failed to load external API details.";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDetails(); }, []);

  const handleCancel = () => {
    setAppName("");
    setMethodName("");
    setBaseUrl("");
    setPathTemplate("");
    setMethodType("");
    setReturnType("");
    setParameters("");
    setFullUrl("");
    setIsActive(true);
    setEditingId(null);
    setOriginalRecord(null);
  };

  const handleEdit = (detail) => {
    setAppName(detail.appName || "");
    setMethodName(detail.methodName || "");
    setBaseUrl(detail.baseUrl || "");
    setPathTemplate(detail.pathTemplate || "");
    setMethodType(detail.methodType || "");
    setReturnType(detail.returnType || "");
    setParameters(detail.parameters || "");
    setFullUrl(detail.fullUrl || "");
    setIsActive(detail.isActive);
    setEditingId(detail.externalApiDetailNo);
    setOriginalRecord(detail);
  };

  const hasChanges = useMemo(() => {
    if (!editingId || !originalRecord) return true;
    return (
      appName !== (originalRecord.appName || "") ||
      methodName !== (originalRecord.methodName || "") ||
      baseUrl !== (originalRecord.baseUrl || "") ||
      pathTemplate !== (originalRecord.pathTemplate || "") ||
      methodType !== (originalRecord.methodType || "") ||
      returnType !== (originalRecord.returnType || "") ||
      parameters !== (originalRecord.parameters || "") ||
      fullUrl !== (originalRecord.fullUrl || "") ||
      isActive !== originalRecord.isActive
    );
  }, [appName, methodName, baseUrl, pathTemplate, methodType, returnType, parameters, fullUrl, isActive, editingId, originalRecord]);

  const submitSave = async (changeReason = null) => {
    try {
      setIsSaving(true);
      await externalApiDetailsApi.saveExternalApiDetail({
        externalApiDetailNo: editingId || 0,
        appName: appName.trim(),
        methodName: methodName.trim(),
        baseUrl: baseUrl.trim() || null,
        pathTemplate: pathTemplate.trim() || null,
        methodType: methodType.trim() || null,
        returnType: returnType.trim() || null,
        parameters: parameters.trim() || null,
        fullUrl: fullUrl.trim() || null,
        isActive,
        changeReason,
      });
      const data = await externalApiDetailsApi.getExternalApiDetails();
      setDetails(data);
      showToast(editingId ? "API detail updated successfully" : "API detail created successfully", "success");
      handleCancel();
    } catch (err) {
      showToast(err?.response?.data?.message || err?.message || "Failed to save API detail.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    if (!appName.trim()) { showToast("App Name is required.", "warning"); return; }
    if (!methodName.trim()) { showToast("Method Name is required.", "warning"); return; }
    if (editingId) {
      setShowReasonModal(true);
    } else {
      submitSave();
    }
  };

  const detailColumns = useMemo(
    () => [
      {
        key: "appName",
        label: "App Name",
        render: (detail) => <span className="config-data-table__strong">{detail.appName}</span>,
        searchValue: (detail) => detail.appName ?? "",
      },
      {
        key: "methodName",
        label: "Method Name",
        searchValue: (detail) => detail.methodName ?? "",
      },
      {
        key: "fullUrl",
        label: "Full URL",
        render: (detail) => (
          <span className="config-data-table__wrap config-data-table__mono">
            {detail.fullUrl || "—"}
          </span>
        ),
        searchValue: (detail) => `${detail.fullUrl ?? ""} ${detail.baseUrl ?? ""}`,
      },
      {
        key: "pathTemplate",
        label: "Path Template",
        render: (detail) => (
          <span className="config-data-table__wrap config-data-table__mono">
            {detail.pathTemplate || "—"}
          </span>
        ),
      },
      {
        key: "isActive",
        label: "Status",
        align: "center",
        searchValue: (detail) => (detail.isActive ? "Active" : "Inactive"),
        render: (detail) => renderAdminStatusBadge(detail.isActive),
      },
    ],
    []
  );

  if (loading) {
    return (
      <div className="admin-wrap admin-wrap--external-api">
        <div className="admin-card admin-spinner">
          <i className="fas fa-spinner fa-spin" style={{ marginRight: "0.5rem" }} /> Loading external API configurations...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-wrap admin-wrap--external-api">
        <div className="admin-card admin-error-card">
          <div className="admin-error-title">Failed to Load Data</div>
          <div className="admin-error-msg">{error}</div>
          <AdminButton variant="primary" style={{ marginTop: "1rem" }} onClick={loadDetails}>
            Retry Connection
          </AdminButton>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-wrap admin-wrap--external-api">
      <SoftAlertToast
        title={toast?.variant === "error" ? "Error" : toast?.variant === "warning" ? "Warning" : "Success"}
        message={toast?.message}
        variant={toast?.variant ?? "success"}
        onClose={() => setToast(null)}
      />

      {showReasonModal && (
        <ChangeReasonModal
          onClose={() => setShowReasonModal(false)}
          onConfirm={(reason) => { setShowReasonModal(false); submitSave(reason); }}
        />
      )}
      {auditModal}

      <div className="admin-card admin-card--external-api-form">
        <form onSubmit={handleSave}>
          <div className="admin-form-grid admin-form-grid--3">
            <div className="admin-form-field">
              <AdminFieldLabel
                htmlFor="app-name"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("vAppName", "App Name")}
                auditTitle="Audit history for app name"
              >
                App Name
              </AdminFieldLabel>
              <input
                id="app-name"
                type="text"
                className="admin-input"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="e.g. Gateway API"
              />
            </div>
            <div className="admin-form-field">
              <AdminFieldLabel
                htmlFor="method-name"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("vMethodName", "Method Name")}
                auditTitle="Audit history for method name"
              >
                Method Name
              </AdminFieldLabel>
              <input
                id="method-name"
                type="text"
                className="admin-input"
                value={methodName}
                onChange={(e) => setMethodName(e.target.value)}
                placeholder="e.g. Login"
              />
            </div>
            <div className="admin-form-field">
              <AdminFieldLabel
                htmlFor="path-template"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("vPathTemplate", "Path Template")}
                auditTitle="Audit history for path template"
              >
                Path Template
              </AdminFieldLabel>
              <input
                id="path-template"
                type="text"
                className="admin-input"
                value={pathTemplate}
                onChange={(e) => setPathTemplate(e.target.value)}
                placeholder="e.g. /v1/auth/login"
              />
            </div>
          </div>

          <div className="admin-form-grid admin-form-grid--external-api-bottom">
            <div className="admin-form-field">
              <AdminFieldLabel
                htmlFor="full-url"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("vFullUrl", "Full URL")}
                auditTitle="Audit history for full URL"
              >
                Full URL
              </AdminFieldLabel>
              <input
                id="full-url"
                type="text"
                className="admin-input"
                value={fullUrl}
                onChange={(e) => setFullUrl(e.target.value)}
                placeholder="e.g. https://api.domain.com/v1/auth/login"
              />
            </div>
            <div className="admin-checkbox-wrapper admin-checkbox-wrapper--with-audit">
              <input
                id="is-active"
                type="checkbox"
                className="admin-checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <AdminFieldLabel
                htmlFor="is-active"
                variant="checkbox"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("IsActive", "Status")}
                auditTitle="Audit history for status"
              >
                IsActive
              </AdminFieldLabel>
            </div>
          </div>

          <div className="admin-button-row">
            <AdminButton
              type="submit"
              variant="primary"
              disabled={(editingId && !hasChanges) || isSaving}
            >
              {editingId ? (isSaving ? "Updating..." : "Update") : (isSaving ? "Saving..." : "Save")}
            </AdminButton>
            {canAudit ? (
              <AdminButton type="button" variant="secondary" onClick={openRecordAudit}>
                <i className="fas fa-clipboard-list" /> Audit
              </AdminButton>
            ) : null}
            <AdminButton type="button" variant="secondary" onClick={handleCancel}>Clear</AdminButton>
            <AdminButton type="button" variant="secondary" onClick={() => navigate("/execute")}>Close</AdminButton>
          </div>
        </form>
      </div>

      <div className="admin-card admin-card--external-api-table">
        <ConfigDataTable
          columns={detailColumns}
          rows={details}
          emptyMessage="No API details found."
          variant="admin-external-api"
          getRowKey={(detail) => detail.externalApiDetailNo}
          getRowClassName={(detail) => (detail.isActive ? "" : "config-data-table__row--inactive")}
          onRowClick={handleEdit}
          selectedRowKey={editingId}
          searchable
          searchPlaceholder="Search app name or URL..."
          paginated
          defaultPageSize={10}
        />
      </div>
    </div>
  );
}
