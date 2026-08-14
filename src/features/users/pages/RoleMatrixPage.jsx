import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { usePermissions } from "@/context/PermissionContext.jsx";
import { AdminButton } from "../../../components/shared/AdminButton";
import { ConfigDataTable } from "../../../components/shared/ConfigDataTable";
import { SoftAlertToast } from "../../../components/shared/SoftAlertToast";
import { profilesApi } from "../api/profilesApi";
import { roleMatrixApi } from "../api/roleMatrixApi";
import { operationsApi } from "../../parameters/api/operationsApi";

function ChangeReasonModal({ onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="admin-reason-modal-backdrop">
      <div className="admin-reason-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-reason-modal-title">Reason for Change</div>
        <label className="admin-reason-label" htmlFor="rm-change-reason">
          Reason <span style={{ color: "var(--red)" }}>*</span>
        </label>
        <textarea
          id="rm-change-reason"
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

function parseMenuItemId(key) {
  if (String(key).endsWith("_group")) return null;
  const id = Number(key);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export default function RoleMatrixPage() {
  const navigate = useNavigate();
  const { profileCode: sessionProfileCode, refresh: refreshPermissions } = usePermissions();
  const [toast, setToast] = useState(null);
  const [showReasonModal, setShowReasonModal] = useState(false);

  const [profiles, setProfiles] = useState([]);
  const [selectedProfileCode, setSelectedProfileCode] = useState("");
  const [rightsMap, setRightsMap] = useState({});
  const [originalRightsMap, setOriginalRightsMap] = useState({});
  const [menuStructure, setMenuStructure] = useState([]);

  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [saving, setSaving] = useState(false);

  const showToast = (message, variant = "success") => setToast({ message, variant });

  useEffect(() => {
    async function fetchProfiles() {
      try {
        setLoadingProfiles(true);
        const data = await profilesApi.getProfiles();
        setProfiles(data);
        if (data.length > 0) {
          const firstActive = data.find((p) => p.isActive) || data[0];
          setSelectedProfileCode(firstActive.vRole);
        }
      } catch (err) {
        showToast(err?.message || "Failed to load profiles.", "error");
      } finally {
        setLoadingProfiles(false);
      }
    }
    fetchProfiles();
  }, []);

  useEffect(() => {
    if (!selectedProfileCode) return;

    async function fetchMatrix() {
      try {
        setLoadingMatrix(true);
        const [opsData, matrixData] = await Promise.all([
          operationsApi.getOperations(),
          roleMatrixApi.getRoleMatrix(selectedProfileCode),
        ]);

        const ops = Array.isArray(opsData) ? opsData : (opsData.items ?? []);
        const standalone = ops.filter((o) => !o.isParent && !o.parentGroup).sort((a, b) => a.order - b.order);
        const parents = ops.filter((o) => o.isParent).sort((a, b) => a.order - b.order);

        const standaloneGroups = standalone.map((s) => ({
          id: s.operationMasterNo,
          label: "",
          isStandalone: true,
          children: [{ id: s.operationMasterNo, label: s.menuGroup }],
        }));

        const parentGroups = parents.map((p) => {
          const children = ops
            .filter((o) => !o.isParent && o.parentGroup === p.operationMasterNo)
            .sort((a, b) => a.order - b.order);
          return {
            id: p.operationMasterNo,
            label: p.menuGroup,
            isGroup: true,
            children: children.map((c) => ({ id: c.operationMasterNo, label: c.menuGroup })),
          };
        });

        const dynamicMenu = [...standaloneGroups, ...parentGroups];
        setMenuStructure(dynamicMenu);

        const matrix = Array.isArray(matrixData) ? matrixData : (matrixData.items ?? []);
        const newMap = {};
        matrix.forEach((item) => {
          newMap[item.menuItemId] = {
            canAddEdit: item.canAddEdit,
            canInActive: item.canInActive,
            canView: item.canView,
            canReview: item.canReview,
          };
        });
        dynamicMenu.forEach((group) => {
          if (!newMap[group.id]) newMap[group.id] = { canAddEdit: false, canInActive: false, canView: false, canReview: false };
          group.children.forEach((child) => {
            if (!newMap[child.id]) newMap[child.id] = { canAddEdit: false, canInActive: false, canView: false, canReview: false };
          });
        });
        setRightsMap(newMap);
        setOriginalRightsMap(JSON.parse(JSON.stringify(newMap)));
      } catch (err) {
        showToast(err?.message || "Failed to load role matrix.", "error");
      } finally {
        setLoadingMatrix(false);
      }
    }
    fetchMatrix();
  }, [selectedProfileCode]);

  const handleCheckboxChange = (childId, field, isChecked) => {
    setRightsMap((prev) => ({
      ...prev,
      [childId]: { ...prev[childId], [field]: isChecked },
    }));
  };

  const hasChanges = useMemo(() => {
    return Object.keys(rightsMap).some((key) => {
      const cur = rightsMap[key];
      const orig = originalRightsMap[key];
      if (!orig) return true;
      return cur.canAddEdit !== orig.canAddEdit || cur.canInActive !== orig.canInActive || cur.canView !== orig.canView || cur.canReview !== orig.canReview;
    });
  }, [rightsMap, originalRightsMap]);

  const submitSave = async (changeReason) => {
    if (!selectedProfileCode) return;
    try {
      setSaving(true);
      const changedRights = Object.keys(rightsMap)
        .filter((key) => {
          const cur = rightsMap[key], orig = originalRightsMap[key];
          if (!orig) return true;
          return cur.canAddEdit !== orig.canAddEdit || cur.canInActive !== orig.canInActive || cur.canView !== orig.canView || cur.canReview !== orig.canReview;
        })
        .map((key) => {
          const menuItemId = parseMenuItemId(key);
          if (menuItemId === null) return null;
          return {
            menuItemId,
            canAddEdit: rightsMap[key].canAddEdit,
            canInActive: rightsMap[key].canInActive,
            canView: rightsMap[key].canView,
            canReview: rightsMap[key].canReview,
          };
        })
        .filter(Boolean);

      if (changedRights.length === 0) {
        showToast("No changes detected.", "warning");
        return;
      }

      await roleMatrixApi.saveRoleMatrix({ profileCode: selectedProfileCode, changeReason, rights: changedRights });
      setOriginalRightsMap(JSON.parse(JSON.stringify(rightsMap)));
      showToast(`${changedRights.length} permission(s) saved successfully.`, "success");
      if (
        sessionProfileCode &&
        selectedProfileCode.toLowerCase() === sessionProfileCode.toLowerCase()
      ) {
        await refreshPermissions();
      }
    } catch (err) {
      showToast(err?.response?.data?.message || err?.message || "Failed to save role matrix.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (!selectedProfileCode) return;
    setShowReasonModal(true);
  };

  const matrixRows = useMemo(
    () =>
      menuStructure.flatMap((group) =>
        group.children.map((child, childIndex) => ({
          id: child.id,
          groupLabel: childIndex === 0 ? (group.isStandalone || !group.label ? "—" : group.label) : "",
          pageName: child.label,
          isGroupStart: childIndex === 0,
          isGroupEnd: childIndex === group.children.length - 1,
          rights: rightsMap[child.id] || {
            canAddEdit: false,
            canInActive: false,
            canView: false,
            canReview: false,
          },
        }))
      ),
    [menuStructure, rightsMap]
  );

  const matrixColumns = useMemo(
    () => [
      {
        key: "groupLabel",
        label: "Menu Group",
        cellClassName: (row) => (row.isGroupStart ? "config-data-table__cell--group" : ""),
        render: (row) => row.groupLabel,
      },
      {
        key: "pageName",
        label: "Page Name",
        render: (row) => row.pageName,
      },
      ...["canAddEdit", "canInActive", "canView", "canReview"].map((field) => ({
        key: field,
        label: field === "canAddEdit" ? "Add/Edit" : field === "canInActive" ? "InActive" : field === "canView" ? "View" : "Review",
        align: "center",
        stopRowClick: true,
        render: (row) => (
          <input
            type="checkbox"
            className="admin-checkbox"
            checked={row.rights[field]}
            onChange={(event) => handleCheckboxChange(row.id, field, event.target.checked)}
          />
        ),
      })),
    ],
    []
  );

  const handleCancel = () => {
    const current = selectedProfileCode;
    setSelectedProfileCode("");
    setTimeout(() => setSelectedProfileCode(current), 10);
  };

  if (loadingProfiles) {
    return (
      <div className="admin-wrap admin-wrap--role-matrix">
        <div className="admin-card admin-spinner">
          <i className="fas fa-spinner fa-spin" style={{ marginRight: "0.5rem" }} /> Loading profiles...
        </div>
      </div>
    );
  }

  return (
    <div className="admin-wrap admin-wrap--role-matrix">
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

      <div className="admin-card admin-card--role-matrix">
        <div className="admin-profile-select-row">
          <label className="admin-label" htmlFor="profile-select">Select Role Profile:</label>
          <select
            id="profile-select"
            className="admin-select"
            style={{ width: "auto", minWidth: "14rem" }}
            value={selectedProfileCode}
            onChange={(e) => setSelectedProfileCode(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.vRole} value={p.vRole}>{p.vRoleName} ({p.vRole})</option>
            ))}
          </select>
        </div>

        {loadingMatrix ? (
          <div className="admin-spinner"><i className="fas fa-spinner fa-spin" style={{ marginRight: "0.5rem" }} /> Loading permissions...</div>
        ) : (
          <>
            <ConfigDataTable
              columns={matrixColumns}
              rows={matrixRows}
              emptyMessage="No menu operations configured."
              variant="admin-role-matrix"
              getRowKey={(row) => row.id}
              getRowClassName={(row) => (row.isGroupEnd ? "config-data-table__row--group-end" : "")}
              paginated={false}
            />

            <div className="admin-button-row">
              <AdminButton type="button" variant="primary" onClick={handleSave} disabled={saving || !hasChanges}>
                {saving ? "Saving..." : "Save"}
              </AdminButton>
              <AdminButton type="button" variant="secondary" onClick={handleCancel} disabled={saving}>Clear</AdminButton>
              <AdminButton type="button" variant="secondary" onClick={() => navigate("/execute")} disabled={saving}>Close</AdminButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
