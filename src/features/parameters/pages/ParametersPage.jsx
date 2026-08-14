import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AdminButton } from "../../../components/shared/AdminButton";
import { ConfigDataTable } from "../../../components/shared/ConfigDataTable";
import { renderAdminStatusBadge } from "../../../components/shared/adminTableHelpers";
import { SoftAlertToast } from "../../../components/shared/SoftAlertToast";
import { AdminFieldLabel } from "@/components/shared/AdminFieldLabel.jsx";
import { useAdminRecordAudit } from "@/hooks/useAdminRecordAudit.jsx";
import { parametersApi } from "../api/parametersApi";

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
        <label className="admin-reason-label" htmlFor="change-reason-input">
          Please enter the reason for this change <span style={{ color: "var(--red)" }}>*</span>
        </label>
        <textarea
          id="change-reason-input"
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

export default function ParametersPage() {
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showReasonModal, setShowReasonModal] = useState(false);

  const [parameters, setParameters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [parameterName, setParameterName] = useState("");
  const [parameterValue, setParameterValue] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [originalRecord, setOriginalRecord] = useState(null);

  const showToast = (message, variant = "success") => setToast({ message, variant });
  const { openFieldAudit, openRecordAudit, auditModal, canAudit } = useAdminRecordAudit(
    editingId,
    "ParameterList",
  );

  const loadParameters = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await parametersApi.getParameters();
      setParameters(data);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Failed to load parameters.";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadParameters(); }, []);

  const handleCancel = () => {
    setParameterName("");
    setParameterValue("");
    setIsActive(true);
    setEditingId(null);
    setOriginalRecord(null);
  };

  const handleEdit = (param) => {
    setParameterName(param.parameterName);
    setParameterValue(param.parameterValue);
    setIsActive(param.isActive);
    setEditingId(param.parameterListNo);
    setOriginalRecord(param);
  };

  const hasChanges = useMemo(() => {
    if (!editingId || !originalRecord) return true;
    return (
      parameterName !== (originalRecord.parameterName || "") ||
      parameterValue !== (originalRecord.parameterValue || "") ||
      isActive !== originalRecord.isActive
    );
  }, [parameterName, parameterValue, isActive, editingId, originalRecord]);

  const submitSave = async (changeReason = null) => {
    try {
      setIsSaving(true);
      const name = parameterName.trim();
      await parametersApi.saveParameter({
        parameterListNo: editingId || 0,
        parameterName: name,
        parameterValue: parameterValue.trim(),
        isActive,
        changeReason,
      });
      const data = await parametersApi.getParameters();
      setParameters(data);
      showToast(editingId ? "Parameter updated successfully" : "Parameter created successfully", "success");
      handleCancel();
    } catch (err) {
      showToast(err?.response?.data?.message || err?.message || "Failed to save parameter.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    if (!parameterName.trim()) { showToast("Parameter Name is required.", "warning"); return; }
    if (!parameterValue.trim()) { showToast("Parameter Value is required.", "warning"); return; }
    if (editingId) {
      setShowReasonModal(true);
    } else {
      submitSave();
    }
  };

  const parameterColumns = useMemo(
    () => [
      {
        key: "index",
        label: "#",
        align: "center",
        render: (_row, index) => index + 1,
      },
      {
        key: "parameterName",
        label: "Parameter Name",
        render: (param) => <span className="config-data-table__strong">{param.parameterName}</span>,
        searchValue: (param) => param.parameterName ?? "",
      },
      {
        key: "parameterValue",
        label: "Parameter Value",
        searchValue: (param) => param.parameterValue ?? "",
      },
      {
        key: "isActive",
        label: "Status",
        align: "center",
        searchValue: (param) => (param.isActive ? "Active" : "Inactive"),
        render: (param) => renderAdminStatusBadge(param.isActive),
      },
    ],
    []
  );

  if (loading) {
    return (
      <div className="admin-wrap admin-wrap--parameters">
        <div className="admin-card admin-spinner">
          <i className="fas fa-spinner fa-spin" style={{ marginRight: "0.5rem" }} /> Loading parameters...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-wrap admin-wrap--parameters">
        <div className="admin-card admin-error-card">
          <div className="admin-error-title">Failed to Load Data</div>
          <div className="admin-error-msg">{error}</div>
          <AdminButton variant="primary" style={{ marginTop: "1rem" }} onClick={loadParameters}>
            Retry
          </AdminButton>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-wrap admin-wrap--parameters">
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

      <div className="admin-card admin-card--config-form">
        <form onSubmit={handleSave}>
          <div className="admin-form-grid">
            <div className="admin-form-field">
              <AdminFieldLabel
                htmlFor="param-name"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("vParameterName", "Parameter Name")}
                auditTitle="Audit history for parameter name"
              >
                Parameter Name
              </AdminFieldLabel>
              <input
                id="param-name"
                type="text"
                className="admin-input"
                value={parameterName}
                onChange={(e) => setParameterName(e.target.value)}
                placeholder="e.g. maxSessionMinutes"
              />
            </div>
            <div className="admin-form-field">
              <AdminFieldLabel
                htmlFor="param-value"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("vParameterValue", "Parameter Value")}
                auditTitle="Audit history for parameter value"
              >
                Parameter Value
              </AdminFieldLabel>
              <input
                id="param-value"
                type="text"
                className="admin-input"
                value={parameterValue}
                onChange={(e) => setParameterValue(e.target.value)}
                placeholder="e.g. true or false"
              />
            </div>
            <div className="admin-checkbox-wrapper admin-checkbox-wrapper--with-audit">
              <input
                id="param-active"
                type="checkbox"
                className="admin-checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <AdminFieldLabel
                htmlFor="param-active"
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

      <div className="admin-card admin-card--config-table">
        <ConfigDataTable
          columns={parameterColumns}
          rows={parameters}
          emptyMessage="No parameters found."
          variant="admin-params"
          getRowKey={(param) => param.parameterListNo}
          getRowClassName={(param) => (param.isActive ? "" : "config-data-table__row--inactive")}
          onRowClick={handleEdit}
          selectedRowKey={editingId}
          searchable
          searchPlaceholder="Search name or value..."
          paginated
          defaultPageSize={10}
        />
      </div>
    </div>
  );
}
