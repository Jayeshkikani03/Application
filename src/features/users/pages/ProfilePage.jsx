import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AdminButton } from "../../../components/shared/AdminButton";
import { ConfigDataTable } from "../../../components/shared/ConfigDataTable";
import { renderAdminStatusBadge } from "../../../components/shared/adminTableHelpers";
import { SoftAlertToast } from "../../../components/shared/SoftAlertToast";
import { AdminFieldLabel } from "@/components/shared/AdminFieldLabel.jsx";
import { useAdminRecordAudit } from "@/hooks/useAdminRecordAudit.jsx";
import { profilesApi } from "../api/profilesApi";
import { getNextRoleCode } from "../utils/profileHelpers";

function ChangeReasonModal({ onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="admin-reason-modal-backdrop">
      <div className="admin-reason-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-reason-modal-title">Reason for Change</div>
        <label className="admin-reason-label" htmlFor="profile-change-reason">
          Reason <span style={{ color: "var(--red)" }}>*</span>
        </label>
        <textarea
          id="profile-change-reason"
          className="admin-reason-textarea"
          value={reason}
          onChange={(e) => { setReason(e.target.value); setError(""); }}
          placeholder="Enter reason..."
          autoFocus
        />
        {error && <div className="admin-reason-error">{error}</div>}
        <div className="admin-reason-actions">
          <AdminButton variant="secondary" onClick={onClose}>Cancel</AdminButton>
          <AdminButton
            variant="primary"
            onClick={() => { if (!reason.trim()) { setError("Reason is required."); return; } onConfirm(reason.trim()); }}
          >
            Confirm
          </AdminButton>
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showReasonModal, setShowReasonModal] = useState(false);

  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [vRole, setVRole] = useState("");
  const [vRoleName, setVRoleName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [originalRecord, setOriginalRecord] = useState(null);

  const showToast = (message, variant = "success") => setToast({ message, variant });
  const { openFieldAudit, openRecordAudit, auditModal, canAudit } = useAdminRecordAudit(
    editingId,
    "ProfileMst",
  );

  const loadProfiles = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await profilesApi.getProfiles();
      setProfiles(data);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Failed to load profiles.";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProfiles(); }, []);

  const nextRoleCode = useMemo(() => getNextRoleCode(profiles), [profiles]);

  useEffect(() => {
    if (!editingId) {
      setVRole(nextRoleCode);
    }
  }, [editingId, nextRoleCode]);

  const handleCancel = (sourceProfiles = profiles) => {
    setVRole(getNextRoleCode(sourceProfiles));
    setVRoleName("");
    setIsActive(true);
    setEditingId(null);
    setOriginalRecord(null);
  };

  const handleEdit = (profile) => {
    setVRole(profile.vRole);
    setVRoleName(profile.vRoleName);
    setIsActive(profile.isActive);
    setEditingId(profile.profileNo);
    setOriginalRecord(profile);
  };

  const hasChanges = useMemo(() => {
    if (!editingId || !originalRecord) return true;
    return (
      vRoleName !== (originalRecord.vRoleName || "") ||
      isActive !== originalRecord.isActive
    );
  }, [vRoleName, isActive, editingId, originalRecord]);

  const submitSave = async (changeReason = null) => {
    try {
      setIsSaving(true);
      await profilesApi.saveProfile({
        profileNo: editingId || 0,
        vRole: vRole.trim(),
        vRoleName: vRoleName.trim(),
        isActive,
        changeReason,
      });
      const data = await profilesApi.getProfiles();
      setProfiles(data);
      showToast(editingId ? "Profile updated successfully" : "Profile created successfully", "success");
      handleCancel(data);
    } catch (err) {
      showToast(err?.response?.data?.message || err?.message || "Failed to save profile.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    if (!vRole.trim()) { showToast("Role Code is required.", "warning"); return; }
    if (!vRoleName.trim()) { showToast("Role Name is required.", "warning"); return; }
    if (editingId) { setShowReasonModal(true); } else { submitSave(); }
  };

  const profileColumns = useMemo(
    () => [
      {
        key: "index",
        label: "#",
        align: "center",
        render: (_row, index) => index + 1,
      },
      {
        key: "vRole",
        label: "Role Code",
        render: (profile) => <span className="config-data-table__strong">{profile.vRole}</span>,
        searchValue: (profile) => profile.vRole ?? "",
      },
      {
        key: "vRoleName",
        label: "Role Name",
        searchValue: (profile) => profile.vRoleName ?? "",
      },
      {
        key: "isActive",
        label: "Status",
        align: "center",
        searchValue: (profile) => (profile.isActive ? "Active" : "Inactive"),
        render: (profile) => renderAdminStatusBadge(profile.isActive),
      },
    ],
    []
  );

  if (loading) {
    return (
      <div className="admin-wrap admin-wrap--profile">
        <div className="admin-card admin-spinner">
          <i className="fas fa-spinner fa-spin" style={{ marginRight: "0.5rem" }} /> Loading profiles...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-wrap admin-wrap--profile">
        <div className="admin-card admin-error-card">
          <div className="admin-error-title">Failed to Load Data</div>
          <div className="admin-error-msg">{error}</div>
          <AdminButton variant="primary" style={{ marginTop: "1rem" }} onClick={loadProfiles}>Retry</AdminButton>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-wrap admin-wrap--profile">
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
                htmlFor="profile-role"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("vRole", "Role Code")}
                auditTitle="Audit history for role code"
              >
                Role Code
              </AdminFieldLabel>
              <input
                id="profile-role"
                type="text"
                className="admin-input"
                value={vRole}
                disabled
                readOnly
                placeholder="Auto-generated"
              />
            </div>
            <div className="admin-form-field">
              <AdminFieldLabel
                htmlFor="profile-role-name"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("vRoleName", "Role Name")}
                auditTitle="Audit history for role name"
              >
                Role Name
              </AdminFieldLabel>
              <input
                id="profile-role-name"
                type="text"
                className="admin-input"
                value={vRoleName}
                onChange={(e) => setVRoleName(e.target.value)}
                placeholder="e.g. Site User"
              />
            </div>
            <div className="admin-checkbox-wrapper admin-checkbox-wrapper--with-audit">
              <input id="profile-active" type="checkbox" className="admin-checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <AdminFieldLabel
                htmlFor="profile-active"
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
            <AdminButton type="submit" variant="primary" disabled={(editingId && !hasChanges) || isSaving}>
              {editingId ? (isSaving ? "Updating..." : "Update") : (isSaving ? "Saving..." : "Save")}
            </AdminButton>
            {canAudit ? (
              <AdminButton type="button" variant="secondary" onClick={openRecordAudit}>
                <i className="fas fa-clipboard-list" /> Audit
              </AdminButton>
            ) : null}
            <AdminButton type="button" variant="secondary" onClick={() => handleCancel()}>Clear</AdminButton>
            <AdminButton type="button" variant="secondary" onClick={() => navigate("/execute")}>Close</AdminButton>
          </div>
        </form>
      </div>

      <div className="admin-card admin-card--config-table">
        <ConfigDataTable
          columns={profileColumns}
          rows={profiles}
          emptyMessage="No profiles found."
          variant="admin-profile"
          getRowKey={(profile) => profile.profileNo}
          getRowClassName={(profile) => (profile.isActive ? "" : "config-data-table__row--inactive")}
          onRowClick={handleEdit}
          selectedRowKey={editingId}
          searchable
          searchPlaceholder="Search role code or name..."
          paginated
          defaultPageSize={10}
        />
      </div>
    </div>
  );
}
