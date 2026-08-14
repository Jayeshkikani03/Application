import { useCallback, useState } from "react";
import { AuditHistoryModal } from "@/components/shared/AuditHistoryModal.jsx";
import { DbAuditHistoryTableBody } from "@/components/shared/DbAuditHistoryTableBody.jsx";

/**
 * Admin form audit helper — field-wise and full-record history for the selected row.
 * @param {number|string|null|undefined} editingId Primary key of the record being edited.
 * @param {string} tableName EF table name (e.g. `ParameterList`, `OperationMaster`).
 */
export function useAdminRecordAudit(editingId, tableName, options = {}) {
  const excludedFieldNames = Array.isArray(options.excludeFields) ? options.excludeFields : [];
  const [auditState, setAuditState] = useState(null);

  const canAudit = editingId != null && String(editingId).trim() !== "";

  const openFieldAudit = useCallback(
    (fieldName, fieldLabel, options = {}) => {
      if (!canAudit) return;
      setAuditState({
        kind: "field",
        fieldName,
        fieldLabel,
        valueMap: options?.valueMap && typeof options.valueMap === "object"
          ? options.valueMap
          : null,
      });
    },
    [canAudit],
  );

  const openRecordAudit = useCallback(() => {
    if (!canAudit) return;
    setAuditState({ kind: "record", valueMap: null });
  }, [canAudit]);

  const closeAudit = useCallback(() => setAuditState(null), []);

  const auditModal = auditState ? (
    <AuditHistoryModal open onClose={closeAudit}>
      <DbAuditHistoryTableBody
        tableName={tableName}
        recordId={String(editingId)}
        fieldName={auditState.kind === "field" ? auditState.fieldName : undefined}
        customLabel={auditState.kind === "field" ? auditState.fieldLabel : undefined}
        valueMap={auditState.valueMap || undefined}
        excludedFieldNames={excludedFieldNames.length > 0 ? excludedFieldNames : undefined}
        emptyMessage={
          auditState.kind === "field"
            ? `No audit entries for "${auditState.fieldLabel}" yet.`
            : "No audit entries for this record yet."
        }
      />
    </AuditHistoryModal>
  ) : null;

  return { openFieldAudit, openRecordAudit, closeAudit, auditModal, canAudit };
}
