/**
 * EF store column name → user-facing label for audit rows (`AuditDtl.vFieldName`).
 * Keys are scoped by `tableName` on each audit row.
 */
export const AUDIT_FIELD_LABELS_BY_TABLE = {
  ParameterList: {
    vParameterName: "Parameter Name",
    vParameterValue: "Parameter Value",
    IsActive: "Status",
  },
  ProfileMst: {
    vRole: "Role Code",
    vRoleName: "Role Name",
    IsActive: "Status",
  },
  OperationMaster: {
    vMenuGroup: "Menu Group / Page Name",
    vPath: "Path",
    nOrder: "Order",
    nParentGroup: "Under Which Group",
    bIsParent: "Parent",
    bNotForMenu: "Not For Menu",
    bForMobile: "Mobile Menu",
    IsActive: "Status",
  },
  ExternalApiDetail: {
    vAppName: "App Name",
    vMethodName: "Method Name",
    vBaseUrl: "Base URL",
    vPathTemplate: "Path Template",
    vMethodType: "Method Type",
    vReturnType: "Return Type",
    vParameters: "Parameters",
    vFullUrl: "Full URL",
    IsActive: "Status",
  },
  RoleMatrix: {
    vProfileCode: "Profile Code",
    nMenuItemId: "Menu Item",
    bCanAddEdit: "Add / Edit",
    bCanInActive: "Inactivate",
    bCanView: "View",
    bCanReview: "Review",
    IsActive: "Status",
  },
  ProjectParameter: {
    vParameterValue: "Parameter value",
    vParameterName: "Parameter",
    vProjectCode: "Project",
    IsActive: "Status",
  },
  ActivityConfigPdfImportTask: {
    vProjectCode: "Project",
    vFileName: "File name",
    vStatus: "Status",
    IsActive: "Status",
  },
  ActivityConfigDose: {
    vDoseLabel: "Dose name",
    iGlobalOrder: "Order",
    nPeriod: "Period",
    nStudyVisitScheduleNo: "Visit",
    vStudyVisitScheduleDescription: "Visit",
    nVisitNo: "Visit no",
    bIsPublished: "Published",
    vCreatedBySource: "Source",
    IsActive: "Status",
  },
  ActivityConfigTimePoint: {
    vTimePointLabel: "Time point name",
    iDisplayOrder: "Order",
    vActivityType: "Activity type",
    nStudyVisitScheduleNo: "Visit",
    vStudyVisitScheduleDescription: "Visit",
    nVisitNo: "Visit no",
    nDuration: "Duration",
    vDurationType: "Duration type",
    nWindowPeriodMinus: "Window (−)",
    nWindowPeriodPlus: "Window (+)",
    vWindowPeriodDurationType: "Window type",
    IsActive: "Status",
  },
  BagPreparation: {
    vStatus: "Status",
    IsActive: "Is Active",
    vMissingRemark: "Missing Remark",
  },
  ActivityExecutionDtl: {
    vFieldValue: "Value",
    nAppActivityCrfNo: "CRF version",
    IsActive: "Status",
  },
  ActivityExecutionHdr: {
    vRemarks: "Remarks",
    vStatus: "Status",
    bDeviation: "Deviation",
    vDeviationReason: "Deviation Reason",
    vChangeReason: "Reason",
    dActualTime: "Actual Time",
    dCentrifugationStart: "Centrifuge Start",
    dCentrifugationEnd: "Centrifuge End",
    IsActive: "Status",
  },
  ActivityExecutionAliquot: {
    vStatus: "Status",
    vSkipRemark: "Skip Remark",
    IsActive: "Status",
  },
  AppVisitCrfMapping: {
    vActivityName: "Activity Name",
    nStudyVisitScheduleNo: "Visit",
    vCrfTemplateId: "CRF",
    bIsRepeat: "Repeat",
    bIsPublished: "Published",
    IsActive: "Is Active",
  },
  LlmProviderConfig: {
    vProviderName: "Provider Name",
    vModelName: "Model Name",
    vApiUrl: "API URL",
    vTemperature: "Temperature",
    nMaxOutputTokens: "Max Output Tokens",
    vStatus: "Published",
    IsActive: "Status",
  },
  LlmPromptTemplate: {
    vTemplateCode: "Template Code",
    vTemplateType: "Template Type",
    vTemplateName: "Template Name",
    vDescription: "Description",
    IsActive: "Status",
  },
  LlmPromptVersion: {
    nVersion: "Version",
    vPromptText: "Prompt",
    vStatus: "Status",
    dPublishedOnUTC: "Published On (UTC)",
    IsActive: "Status",
  },
};

export function resolveAuditFieldLabel(row) {
  const field = String(row?.field ?? "").trim();
  if (!field) return String(row?.fieldLabel || "").trim() || "—";
  const table = String(row?.tableName ?? "").trim();
  const map = table ? AUDIT_FIELD_LABELS_BY_TABLE[table] : undefined;
  if (map) {
    if (map[field]) return map[field];
    const matchedKey = Object.keys(map).find((key) => key.toLowerCase() === field.toLowerCase());
    if (matchedKey) return map[matchedKey];
  }
  const fieldLabel = String(row?.fieldLabel ?? "").trim();
  if (fieldLabel && fieldLabel.toLowerCase() !== field.toLowerCase()) return fieldLabel;
  return field;
}
