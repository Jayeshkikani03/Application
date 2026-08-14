import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AdminButton } from "../../../components/shared/AdminButton";
import { ConfigDataTable } from "../../../components/shared/ConfigDataTable";
import { renderAdminStatusBadge } from "../../../components/shared/adminTableHelpers";
import { SoftAlertToast } from "../../../components/shared/SoftAlertToast";
import { AdminFieldLabel } from "@/components/shared/AdminFieldLabel.jsx";
import { useAdminRecordAudit } from "@/hooks/useAdminRecordAudit.jsx";
import { APP_ROUTE_CATALOG, isRoutePathAssigned, normalizeRoutePath } from "@/config/appMenuConfig.js";
import { operationsApi } from "../api/operationsApi";

function ChangeReasonModal({ onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="admin-reason-modal-backdrop">
      <div className="admin-reason-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-reason-modal-title">Reason for Change</div>
        <label className="admin-reason-label" htmlFor="op-change-reason">
          Reason <span style={{ color: "var(--red)" }}>*</span>
        </label>
        <textarea
          id="op-change-reason"
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

export default function OperationMasterPage() {
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showReasonModal, setShowReasonModal] = useState(false);

  const [menuGroup, setMenuGroup] = useState("");
  const [path, setPath] = useState("");
  const [order, setOrder] = useState("");
  const [parentGroup, setParentGroup] = useState("");
  const [notForMenu, setNotForMenu] = useState(false);
  const [forMobile, setForMobile] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [isParent, setIsParent] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [originalRecord, setOriginalRecord] = useState(null);

  const [records, setRecords] = useState([]);
  const [parentRecords, setParentRecords] = useState([]);
  const [allMappedPaths, setAllMappedPaths] = useState([]);
  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: "order", direction: "asc" });

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [localSearch, setLocalSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const showToast = (message, variant = "success") => setToast({ message, variant });
  const { openFieldAudit, openRecordAudit, auditModal, canAudit } = useAdminRecordAudit(
    editingId,
    "OperationMaster",
  );

  useEffect(() => {
    const h = setTimeout(() => { setDebouncedSearch(localSearch); setPage(1); }, 300);
    return () => clearTimeout(h);
  }, [localSearch]);

  const fetchParents = async () => {
    try {
      const data = await operationsApi.getParentOperations();
      setParentRecords(data);
    } catch { /* silent */ }
  };

  const fetchAllMappedPaths = async () => {
    try {
      const data = await operationsApi.getOperations();
      const items = Array.isArray(data) ? data : (data.items ?? []);
      setAllMappedPaths(
        items
          .map((o) => String(o.path ?? o.Path ?? "").trim())
          .filter(Boolean),
      );
    } catch { /* silent */ }
  };

  useEffect(() => { fetchParents(); fetchAllMappedPaths(); }, []);

  const fetchOps = async () => {
    try {
      if (initialLoading) setLoading(true);
      setError(null);
      const response = await operationsApi.getOperations(page, pageSize, debouncedSearch, sortConfig.key, sortConfig.direction);
      const items = Array.isArray(response) ? response : (response.items ?? []);
      const total = Array.isArray(response) ? response.length : (response.totalCount ?? 0);
      setRecords(items);
      setTotalCount(total);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Failed to load menu operations.";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  };

  useEffect(() => { fetchOps(); }, [page, pageSize, debouncedSearch, sortConfig]);

  const mappedPaths = useMemo(() => {
    const list = [];
    const seen = new Set();
    const push = (raw) => {
      const n = normalizeRoutePath(raw);
      if (!n || seen.has(n)) return;
      seen.add(n);
      list.push(n);
    };
    for (const p of allMappedPaths) push(p);
    for (const rec of records) push(rec.path);
    return list;
  }, [allMappedPaths, records]);

  const pathOptions = useMemo(() => {
    const empty = { value: "", label: "— No path (group header) —" };
    const ownPath = originalRecord?.path || null;
    const catalog = [...APP_ROUTE_CATALOG]
      .sort((a, b) => a.label.localeCompare(b.label))
      .filter((r) => !isRoutePathAssigned(r.path, mappedPaths, ownPath))
      .map((r) => ({ value: r.path, label: `${r.label} — ${r.path}` }));

    // Keep the current edit value visible even if it left the catalog,
    // but never re-introduce a path assigned to a different page.
    if (path) {
      const alreadyListed = catalog.some(
        (o) => normalizeRoutePath(o.value) === normalizeRoutePath(path),
      );
      if (!alreadyListed && !isRoutePathAssigned(path, mappedPaths, ownPath)) {
        catalog.unshift({ value: path, label: `${path} (not in catalog)` });
      }
    }

    return [empty, ...catalog];
  }, [mappedPaths, originalRecord, path]);

  // Drop a selected path that is already assigned to another page (e.g. legacy alias).
  useEffect(() => {
    if (!path) return;
    const ownPath = originalRecord?.path || null;
    if (isRoutePathAssigned(path, mappedPaths, ownPath)) {
      setPath("");
    }
  }, [path, mappedPaths, originalRecord]);

  const parentGroups = useMemo(() => {
    const keepParentNo = String(originalRecord?.parentGroup || parentGroup || "");
    const dbParents = parentRecords
      .filter((r) => {
        if (!r.isParent) return false;
        if (r.isActive !== false) return true;
        // Keep current selection visible when editing a child under an inactive parent.
        return keepParentNo && String(r.operationMasterNo) === keepParentNo;
      })
      .map((r) => ({ value: String(r.operationMasterNo), label: r.menuGroup }));
    const seen = new Set();
    const unique = [];
    for (const p of dbParents) {
      if (!seen.has(p.value)) { seen.add(p.value); unique.push(p); }
    }
    return [{ value: "", label: "— None (Top Level) —" }, ...unique];
  }, [parentRecords, originalRecord, parentGroup]);

  // Keep table label working even if the assigned parent is inactive.
  const parentLabel = (val) => {
    if (!val) return "—";
    const fromActive = parentGroups.find((g) => g.value === String(val))?.label;
    if (fromActive) return fromActive;
    const fromAll = parentRecords.find(
      (r) => r.isParent && String(r.operationMasterNo) === String(val),
    );
    return fromAll?.menuGroup || "—";
  };

  const handleIsParentChange = (checked) => {
    setIsParent(checked);
    if (checked) { setPath(""); setParentGroup(""); setNotForMenu(false); setForMobile(false); }
  };

  const handleCancel = () => {
    setMenuGroup(""); setPath(""); setOrder(""); setParentGroup("");
    setNotForMenu(false); setForMobile(false); setIsActive(true); setIsParent(false);
    setEditingId(null); setOriginalRecord(null);
  };

  const handleEdit = (rec) => {
    setMenuGroup(rec.menuGroup);
    setPath(rec.path || "");
    setOrder(String(rec.order ?? ""));
    setParentGroup(rec.parentGroup ? String(rec.parentGroup) : "");
    setNotForMenu(rec.notForMenu || false);
    setForMobile(rec.forMobile || false);
    setIsActive(rec.isActive);
    setIsParent(rec.isParent || false);
    setEditingId(rec.operationMasterNo);
    setOriginalRecord(rec);
  };

  const hasChanges = useMemo(() => {
    if (!editingId || !originalRecord) return true;
    return (
      menuGroup !== (originalRecord.menuGroup || "") ||
      path !== (originalRecord.path || "") ||
      order !== String(originalRecord.order ?? "") ||
      parentGroup !== (originalRecord.parentGroup ? String(originalRecord.parentGroup) : "") ||
      notForMenu !== (originalRecord.notForMenu || false) ||
      forMobile !== (originalRecord.forMobile || false) ||
      isActive !== originalRecord.isActive ||
      isParent !== (originalRecord.isParent || false)
    );
  }, [menuGroup, path, order, parentGroup, notForMenu, forMobile, isActive, isParent, editingId, originalRecord]);

  const submitSave = async (changeReason = null) => {
    try {
      setIsSaving(true);
      await operationsApi.saveOperation({
        operationMasterNo: editingId || 0,
        menuGroup: menuGroup.trim(),
        path: isParent ? null : path.trim() || null,
        order: Number(order) || 0,
        parentGroup: isParent ? null : (parentGroup ? Number(parentGroup) : null),
        notForMenu: isParent ? false : notForMenu,
        forMobile: isParent ? false : forMobile,
        isParent,
        isActive,
        changeReason,
      });
      fetchOps(); fetchParents(); fetchAllMappedPaths();
      showToast(editingId ? "Menu operation updated successfully" : "Menu operation created successfully", "success");
      handleCancel();
    } catch (err) {
      showToast(err?.response?.data?.message || err?.message || "Failed to save menu operation.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    if (!menuGroup.trim()) { showToast("Menu Group / Page Name is required.", "warning"); return; }
    if (editingId) { setShowReasonModal(true); } else { submitSave(); }
  };

  const operationColumns = useMemo(
    () => [
      {
        key: "menuGroup",
        label: "Menu Group / Page",
        render: (rec) => (
          <>
            <span className="config-data-table__strong">{rec.menuGroup}</span>
            {rec.isParent ? <span className="admin-pill admin-pill--parent">Parent</span> : null}
          </>
        ),
        searchValue: (rec) => rec.menuGroup ?? "",
      },
      {
        key: "parentGroup",
        label: "Under Group",
        render: (rec) => parentLabel(rec.parentGroup),
      },
      {
        key: "path",
        label: "Path",
        render: (rec) => rec.path
          ? <span className="config-data-table__mono">{rec.path}</span>
          : <span style={{ color: "#cbd5e1" }}>—</span>,
      },
      {
        key: "order",
        label: "Order",
        align: "center",
      },
      {
        key: "notForMenu",
        label: "Not For Menu",
        align: "center",
        render: (rec) => (
          rec.notForMenu
            ? <span className="admin-pill admin-pill--menu">Yes</span>
            : <span className="admin-pill admin-pill--no">No</span>
        ),
      },
      {
        key: "forMobile",
        label: "Mobile Menu",
        align: "center",
        render: (rec) => (
          rec.forMobile
            ? <span className="admin-pill admin-pill--menu">Yes</span>
            : <span className="admin-pill admin-pill--no">No</span>
        ),
      },
      {
        key: "isActive",
        label: "Status",
        align: "center",
        render: (rec) => renderAdminStatusBadge(rec.isActive),
      },
    ],
    [parentGroups]
  );

  if (initialLoading) {
    return (
      <div className="admin-wrap admin-wrap--operation">
        <div className="admin-card admin-spinner">
          <i className="fas fa-spinner fa-spin" style={{ marginRight: "0.5rem" }} /> Loading menu operations...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-wrap admin-wrap--operation">
        <div className="admin-card admin-error-card">
          <div className="admin-error-title">Failed to Load Data</div>
          <div className="admin-error-msg">{error}</div>
          <AdminButton variant="primary" style={{ marginTop: "1rem" }} onClick={() => { fetchOps(); fetchParents(); }}>
            Retry
          </AdminButton>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-wrap admin-wrap--operation">
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

      <div className="admin-card admin-card--operation-form">
        <form onSubmit={handleSave}>
          <div className="admin-form-grid admin-form-grid--operation">
            <div className="admin-form-field">
              <AdminFieldLabel
                htmlFor="op-menu-group"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("vMenuGroup", "Menu Group / Page Name")}
                auditTitle="Audit history for menu group name"
              >
                Menu Group / Page Name <span style={{ color: "var(--red)" }}>*</span>
              </AdminFieldLabel>
              <input
                id="op-menu-group"
                type="text"
                className="admin-input"
                value={menuGroup}
                onChange={(e) => setMenuGroup(e.target.value)}
                placeholder="e.g. Participants"
                required
              />
            </div>

            <div className="admin-form-field">
              <AdminFieldLabel
                htmlFor="op-path"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("vPath", "Path")}
                auditTitle="Audit history for path"
              >
                Path <span style={{ color: "#94a3b8", fontWeight: 400 }}>(blank for group)</span>
              </AdminFieldLabel>
              <select
                id="op-path"
                className="admin-select"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                disabled={isParent}
              >
                {pathOptions.map((o) => (
                  <option key={o.value === "" ? "__empty" : o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="admin-form-field">
              <AdminFieldLabel
                htmlFor="op-order"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("nOrder", "Order")}
                auditTitle="Audit history for order"
              >
                Order
              </AdminFieldLabel>
              <input
                id="op-order"
                type="number"
                className="admin-input"
                value={order}
                onChange={(e) => setOrder(e.target.value)}
                placeholder="1"
                min={1}
              />
            </div>

            <div className="admin-form-field">
              <AdminFieldLabel
                htmlFor="op-parent-group"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("nParentGroup", "Under Which Group")}
                auditTitle="Audit history for parent group"
              >
                Under Which Group
              </AdminFieldLabel>
              <select
                id="op-parent-group"
                className="admin-select"
                value={parentGroup}
                onChange={(e) => setParentGroup(e.target.value)}
                disabled={isParent}
              >
                {parentGroups.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="admin-checkbox-group-row">
            <div className="admin-checkbox-wrapper admin-checkbox-wrapper--with-audit">
              <input id="op-is-parent" type="checkbox" className="admin-checkbox" checked={isParent} onChange={(e) => handleIsParentChange(e.target.checked)} />
              <AdminFieldLabel
                htmlFor="op-is-parent"
                variant="checkbox"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("bIsParent", "Parent")}
                auditTitle="Audit history for parent option"
              >
                Parent
              </AdminFieldLabel>
            </div>
            <div className="admin-checkbox-wrapper admin-checkbox-wrapper--with-audit">
              <input id="op-not-menu" type="checkbox" className="admin-checkbox" checked={notForMenu} onChange={(e) => setNotForMenu(e.target.checked)} disabled={isParent} />
              <AdminFieldLabel
                htmlFor="op-not-menu"
                variant="checkbox"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("bNotForMenu", "Not For Menu")}
                auditTitle="Audit history for not for menu option"
              >
                Not For Menu
              </AdminFieldLabel>
            </div>
            <div className="admin-checkbox-wrapper admin-checkbox-wrapper--with-audit">
              <input id="op-mobile-menu" type="checkbox" className="admin-checkbox" checked={forMobile} onChange={(e) => setForMobile(e.target.checked)} disabled={isParent} />
              <AdminFieldLabel
                htmlFor="op-mobile-menu"
                variant="checkbox"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("bForMobile", "Mobile Menu")}
                auditTitle="Audit history for mobile menu option"
              >
                Mobile Menu
              </AdminFieldLabel>
            </div>
            <div className="admin-checkbox-wrapper admin-checkbox-wrapper--with-audit">
              <input id="op-active" type="checkbox" className="admin-checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <AdminFieldLabel
                htmlFor="op-active"
                variant="checkbox"
                showAudit={canAudit}
                onOpenAudit={() => openFieldAudit("IsActive", "Status")}
                auditTitle="Audit history for active status"
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
            <AdminButton type="button" variant="secondary" onClick={handleCancel}>Clear</AdminButton>
            <AdminButton type="button" variant="secondary" onClick={() => navigate("/execute")}>Close</AdminButton>
          </div>
        </form>
      </div>

      <div className="admin-card admin-card--operation-table">
        <ConfigDataTable
          columns={operationColumns}
          rows={records}
          emptyMessage="No records found."
          variant="admin-operation"
          getRowKey={(rec) => rec.operationMasterNo}
          getRowClassName={(rec) => (rec.isActive ? "" : "config-data-table__row--inactive")}
          onRowClick={handleEdit}
          selectedRowKey={editingId}
          searchable
          searchPlaceholder="Search group or page..."
          searchQuery={localSearch}
          onSearchChange={setLocalSearch}
          paginated
          defaultPageSize={pageSize}
          serverPagination={{
            page,
            pageSize,
            totalCount,
            onPageChange: setPage,
            onPageSizeChange: (nextSize) => {
              setPageSize(nextSize);
              setPage(1);
            },
          }}
        />
      </div>
    </div>
  );
}
