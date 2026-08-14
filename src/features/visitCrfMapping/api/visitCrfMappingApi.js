import api from "@/shared/api/httpClient.js";

function unwrap(res) {
  return res.data?.data ?? res.data ?? null;
}

function normalizeMapping(raw) {
  if (!raw) return null;
  return {
    appVisitCrfMappingNo: Number(raw.appVisitCrfMappingNo ?? raw.AppVisitCrfMappingNo) || 0,
    projectCode: String(raw.projectCode ?? raw.ProjectCode ?? "").trim(),
    activityName: String(raw.activityName ?? raw.ActivityName ?? "").trim(),
    studyVisitScheduleNo: Number(raw.studyVisitScheduleNo ?? raw.StudyVisitScheduleNo) || 0,
    visitLabel: String(raw.visitLabel ?? raw.VisitLabel ?? "").trim(),
    crfTemplateId: String(raw.crfTemplateId ?? raw.CrfTemplateId ?? "").trim(),
    crfName: String(raw.crfName ?? raw.CrfName ?? "").trim(),
    version: Number(raw.version ?? raw.Version) || 0,
    isActive: raw.isActive !== false && raw.IsActive !== false,
    isRepeat: raw.isRepeat === true || raw.IsRepeat === true,
    isPublished: raw.isPublished === true || raw.IsPublished === true,
    recordedSign: String(raw.recordedSign ?? raw.RecordedSign ?? "").trim(),
    recordedOnUtc: raw.recordedOnUtc ?? raw.RecordedOnUtc ?? null,
    recordedAtOffset: String(raw.recordedAtOffset ?? raw.RecordedAtOffset ?? "").trim(),
  };
}

function normalizeEligible(raw) {
  if (!raw) return null;
  return {
    crfTemplateId: String(raw.crfTemplateId ?? raw.CrfTemplateId ?? "").trim(),
    crfName: String(raw.crfName ?? raw.CrfName ?? "").trim(),
    appActivityCrfNo: Number(raw.appActivityCrfNo ?? raw.AppActivityCrfNo) || 0,
    version: Number(raw.version ?? raw.Version) || 1,
  };
}

function normalizeVisitOption(raw) {
  if (!raw) return null;
  return {
    studyVisitScheduleNo: Number(raw.studyVisitScheduleNo ?? raw.StudyVisitScheduleNo) || 0,
    label: String(raw.label ?? raw.Label ?? "").trim(),
    visitNo: Number(raw.visitNo ?? raw.VisitNo) || 0,
  };
}

function normalizeFillRow(raw) {
  if (!raw) return null;
  return {
    appVisitCrfMappingNo: Number(raw.appVisitCrfMappingNo ?? raw.AppVisitCrfMappingNo) || 0,
    activityName: String(raw.activityName ?? raw.ActivityName ?? "").trim(),
    subjectMstNo: Number(raw.subjectMstNo ?? raw.SubjectMstNo) || 0,
    subjectId: String(raw.subjectId ?? raw.SubjectId ?? "").trim(),
    siteRandomizationNo: String(raw.siteRandomizationNo ?? raw.SiteRandomizationNo ?? "").trim(),
    siteNo: String(raw.siteNo ?? raw.SiteNo ?? "").trim(),
    studyVisitScheduleNo: Number(raw.studyVisitScheduleNo ?? raw.StudyVisitScheduleNo) || 0,
    visitLabel: String(raw.visitLabel ?? raw.VisitLabel ?? "").trim(),
    crfTemplateId: String(raw.crfTemplateId ?? raw.CrfTemplateId ?? "").trim(),
    crfName: String(raw.crfName ?? raw.CrfName ?? "").trim(),
    isRepeat: raw.isRepeat === true || raw.IsRepeat === true,
    isNewFill: raw.isNewFill === true || raw.IsNewFill === true,
    canRepeat: raw.canRepeat === true || raw.CanRepeat === true,
    repeatVersion: Number(raw.repeatVersion ?? raw.RepeatVersion) || 0,
    activityExecutionHdrNo: (() => {
      const n = Number(raw.activityExecutionHdrNo ?? raw.ActivityExecutionHdrNo);
      return n > 0 ? n : null;
    })(),
    appActivityCrfNo: (() => {
      const n = Number(raw.appActivityCrfNo ?? raw.AppActivityCrfNo);
      return n > 0 ? n : null;
    })(),
    status: String(raw.status ?? raw.Status ?? "Pending").trim() || "Pending",
    reviewStatus: String(raw.reviewStatus ?? raw.ReviewStatus ?? "").trim(),
    openQueriesCount: Number(raw.openQueriesCount ?? raw.OpenQueriesCount) || 0,
    resolvedQueriesCount: Number(raw.resolvedQueriesCount ?? raw.ResolvedQueriesCount) || 0,
    performedBy: String(raw.performedBy ?? raw.PerformedBy ?? "").trim(),
    performedOnUtc: raw.performedOnUtc ?? raw.PerformedOnUtc ?? null,
    recordedAtOffset: String(raw.recordedAtOffset ?? raw.RecordedAtOffset ?? "").trim(),
    reviewedBy: String(raw.reviewedBy ?? raw.ReviewedBy ?? "").trim(),
    reviewedOn: raw.reviewedAt ?? raw.ReviewedAt ?? raw.reviewedOn ?? raw.ReviewedOn ?? null,
    reviewedOffset: String(
      raw.reviewedAtOffset ?? raw.ReviewedAtOffset ?? raw.reviewedOffset ?? raw.ReviewedOffset ?? ""
    ).trim(),
    queryActivityExecutionHdrNo: (() => {
      const n = Number(raw.queryActivityExecutionHdrNo ?? raw.QueryActivityExecutionHdrNo);
      return n > 0 ? n : null;
    })(),
  };
}

function normalizeSubjectContext(raw) {
  const ctx = raw?.subjectContext ?? raw?.SubjectContext ?? raw ?? {};
  if (!ctx || typeof ctx !== "object") {
    return {
      projectCode: "",
      projectName: "",
      siteNo: "",
      siteName: "",
      country: "",
      region: "",
      screeningNo: "",
      randomizationNo: "",
      siteRandomizationNo: "",
      isScreeningFailure: false,
      patientStatus: "",
      userName: "",
    };
  }
  return {
    projectCode: String(ctx.projectCode ?? ctx.ProjectCode ?? "").trim(),
    projectName: String(ctx.projectName ?? ctx.ProjectName ?? "").trim(),
    siteNo: String(ctx.siteNo ?? ctx.SiteNo ?? "").trim(),
    siteName: String(ctx.siteName ?? ctx.SiteName ?? "").trim(),
    country: String(ctx.country ?? ctx.Country ?? "").trim(),
    region: String(ctx.region ?? ctx.Region ?? "").trim(),
    screeningNo: String(ctx.screeningNo ?? ctx.ScreeningNo ?? "").trim(),
    randomizationNo: String(ctx.randomizationNo ?? ctx.RandomizationNo ?? "").trim(),
    siteRandomizationNo: String(ctx.siteRandomizationNo ?? ctx.SiteRandomizationNo ?? "").trim(),
    isScreeningFailure: ctx.isScreeningFailure === true || ctx.IsScreeningFailure === true,
    patientStatus: String(ctx.patientStatus ?? ctx.PatientStatus ?? "").trim(),
    userName: String(ctx.userName ?? ctx.UserName ?? "").trim(),
  };
}

function normalizeStringMap(raw) {
  const map = {};
  if (!raw || typeof raw !== "object") return map;
  for (const [k, v] of Object.entries(raw)) {
    map[String(k)] = v == null ? "" : String(v);
  }
  return map;
}

function normalizeFieldIds(raw) {
  const map = {};
  if (!raw || typeof raw !== "object") return map;
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k ?? "").trim();
    const id = Number(v);
    if (!key || !Number.isFinite(id) || id <= 0) continue;
    map[key] = id;
  }
  return map;
}

function normalizeReviewQueries(queriesRaw) {
  return (Array.isArray(queriesRaw) ? queriesRaw : [])
    .map((q) => ({
      activityExecutionQueryNo: Number(q.activityExecutionQueryNo ?? q.ActivityExecutionQueryNo) || null,
      fieldKey: String(q.fieldKey ?? q.FieldKey ?? "").trim(),
      fieldLabel: String(q.fieldLabel ?? q.FieldLabel ?? "").trim(),
      queryText: String(q.queryText ?? q.QueryText ?? "").trim(),
      status: String(q.status ?? q.Status ?? "raised").trim() || "raised",
      responseText: String(q.responseText ?? q.ResponseText ?? "").trim(),
      sendbackRemark: String(q.sendbackRemark ?? q.SendbackRemark ?? "").trim(),
      recordedOnUtc: q.recordedOnUtc ?? q.RecordedOnUtc ?? null,
      resolvedAt: q.resolvedAt ?? q.ResolvedAt ?? null,
      closedAt: q.closedAt ?? q.ClosedAt ?? null,
      performedBy: String(q.performedBy ?? q.PerformedBy ?? "").trim(),
      recordedAtOffset: String(q.recordedAtOffset ?? q.RecordedAtOffset ?? "").trim(),
    }))
    .filter((q) => q.fieldKey || q.queryText);
}

function normalizeOpenResult(raw) {
  if (!raw) return null;
  const crfValues = normalizeStringMap(raw.crfValues ?? raw.CrfValues);
  const labelFromCrfValues = normalizeStringMap(raw.labelFromCrfValues ?? raw.LabelFromCrfValues);
  const fieldIds = normalizeFieldIds(raw.fieldIds ?? raw.FieldIds);
  const auditedFieldIds = normalizeFieldIds(raw.auditedFieldIds ?? raw.AuditedFieldIds);
  const queriesRaw = raw.queries ?? raw.Queries ?? [];
  const reviewQueries = normalizeReviewQueries(queriesRaw);
  return {
    activityExecutionHdrNo: Number(raw.activityExecutionHdrNo ?? raw.ActivityExecutionHdrNo) || 0,
    subjectMstNo: Number(raw.subjectMstNo ?? raw.SubjectMstNo) || 0,
    appVisitCrfMappingNo: Number(raw.appVisitCrfMappingNo ?? raw.AppVisitCrfMappingNo) || 0,
    activityName: String(raw.activityName ?? raw.ActivityName ?? "").trim(),
    isRepeat: raw.isRepeat === true || raw.IsRepeat === true,
    repeatVersion: Number(raw.repeatVersion ?? raw.RepeatVersion) || 1,
    versions: (() => {
      const list = raw.versions ?? raw.Versions;
      if (!Array.isArray(list)) return [];
      return list
        .map((v) => ({
          activityExecutionHdrNo: Number(v.activityExecutionHdrNo ?? v.ActivityExecutionHdrNo) || 0,
          repeatVersion: Number(v.repeatVersion ?? v.RepeatVersion) || 1,
          status: String(v.status ?? v.Status ?? "Pending").trim() || "Pending",
          openQueriesCount: Number(v.openQueriesCount ?? v.OpenQueriesCount) || 0,
        }))
        .filter((v) => v.activityExecutionHdrNo > 0);
    })(),
    appActivityCrfNo: Number(raw.appActivityCrfNo ?? raw.AppActivityCrfNo) || 0,
    crfTemplateId: String(raw.crfTemplateId ?? raw.CrfTemplateId ?? "").trim(),
    crfName: String(raw.crfName ?? raw.CrfName ?? "").trim(),
    crfVersion: raw.crfVersion ?? raw.CrfVersion ?? null,
    status: String(raw.status ?? raw.Status ?? "Pending").trim() || "Pending",
    reviewStatus: String(raw.reviewStatus ?? raw.ReviewStatus ?? "").trim(),
    reviewedBy: String(raw.reviewedBy ?? raw.ReviewedBy ?? "").trim(),
    reviewedOn: raw.reviewedAt ?? raw.ReviewedAt ?? raw.reviewedOn ?? raw.ReviewedOn ?? null,
    reviewedOffset: String(
      raw.reviewedAtOffset ?? raw.ReviewedAtOffset ?? raw.reviewedOffset ?? raw.ReviewedOffset ?? ""
    ).trim(),
    performedBy: String(raw.performedBy ?? raw.PerformedBy ?? raw.recordedSign ?? raw.RecordedSign ?? "").trim(),
    performedOn: raw.performedOnUtc ?? raw.PerformedOnUtc ?? raw.performedOn ?? raw.PerformedOn ?? null,
    performedOffset: String(
      raw.recordedAtOffset ?? raw.RecordedAtOffset ?? raw.performedOffset ?? raw.PerformedOffset ?? ""
    ).trim(),
    crfValues,
    fieldIds,
    auditedFieldIds,
    subjectContext: normalizeSubjectContext(raw),
    labelFromCrfValues,
    reviewQueries,
  };
}

/** GET /VisitCrfMapping */
export async function listVisitCrfMappings() {
  const res = await api.get("/VisitCrfMapping");
  const raw = unwrap(res);
  return (Array.isArray(raw) ? raw : []).map(normalizeMapping).filter(Boolean);
}

/** GET /VisitCrfMapping/eligible-crfs */
export async function listEligibleVisitCrfs() {
  const res = await api.get("/VisitCrfMapping/eligible-crfs");
  const raw = unwrap(res);
  return (Array.isArray(raw) ? raw : []).map(normalizeEligible).filter(Boolean);
}

/** GET /VisitCrfMapping/visit-options */
export async function listVisitCrfVisitOptions() {
  const res = await api.get("/VisitCrfMapping/visit-options");
  const raw = unwrap(res);
  return (Array.isArray(raw) ? raw : []).map(normalizeVisitOption).filter(Boolean);
}

/** POST /VisitCrfMapping/save — activity name + visits + single CRF + flags */
export async function saveVisitCrfMappings({
  activityName,
  studyVisitScheduleNos,
  crfTemplateId,
  isActive,
  isRepeat,
  isUpdate,
  changeReason,
}) {
  const res = await api.post("/VisitCrfMapping/save", {
    activityName: String(activityName ?? "").trim(),
    studyVisitScheduleNos: Array.isArray(studyVisitScheduleNos)
      ? studyVisitScheduleNos.map((n) => Number(n) || 0).filter((n) => n > 0)
      : [],
    crfTemplateId: String(crfTemplateId ?? "").trim(),
    isActive: isActive !== false,
    isRepeat: isRepeat === true,
    isUpdate: isUpdate === true,
    changeReason: changeReason ?? null,
  });
  const raw = unwrap(res);
  return (Array.isArray(raw) ? raw : []).map(normalizeMapping).filter(Boolean);
}

/** POST /VisitCrfMapping/publish — password + activity names */
export async function publishVisitCrfMappings({
  activityNames,
  password,
  confirmSharedCrf,
}) {
  const res = await api.post("/VisitCrfMapping/publish", {
    activityNames: Array.isArray(activityNames)
      ? activityNames.map((n) => String(n ?? "").trim()).filter(Boolean)
      : [],
    password: String(password ?? ""),
    confirmSharedCrf: confirmSharedCrf === true,
  });
  const raw = unwrap(res);
  return (Array.isArray(raw) ? raw : []).map(normalizeMapping).filter(Boolean);
}

/** GET /VisitCrfMapping/fill-rows */
export async function listVisitCrfFillRows({
  siteCode,
  subjectMstNo,
  studyVisitScheduleNo,
  latestOnly,
} = {}) {
  const res = await api.get("/VisitCrfMapping/fill-rows", {
    params: {
      siteCode: siteCode || undefined,
      subjectMstNo: subjectMstNo > 0 ? subjectMstNo : undefined,
      studyVisitScheduleNo: studyVisitScheduleNo > 0 ? studyVisitScheduleNo : undefined,
      latestOnly: latestOnly === true ? true : undefined,
    },
  });
  const raw = unwrap(res);
  return (Array.isArray(raw) ? raw : []).map(normalizeFillRow).filter(Boolean);
}

/** POST /VisitCrfMapping/open */
export async function openVisitCrf({ subjectMstNo, appVisitCrfMappingNo, activityExecutionHdrNo }) {
  const res = await api.post("/VisitCrfMapping/open", {
    subjectMstNo: Number(subjectMstNo) || 0,
    appVisitCrfMappingNo: Number(appVisitCrfMappingNo) || 0,
    activityExecutionHdrNo: activityExecutionHdrNo > 0 ? Number(activityExecutionHdrNo) : null,
  });
  return normalizeOpenResult(unwrap(res));
}

/** POST /VisitCrfMapping/repeat — blank next-version Pending hdr */
export async function repeatVisitCrf({
  subjectMstNo,
  appVisitCrfMappingNo,
  sourceActivityExecutionHdrNo,
}) {
  const res = await api.post("/VisitCrfMapping/repeat", {
    subjectMstNo: Number(subjectMstNo) || 0,
    appVisitCrfMappingNo: Number(appVisitCrfMappingNo) || 0,
    sourceActivityExecutionHdrNo:
      sourceActivityExecutionHdrNo > 0 ? Number(sourceActivityExecutionHdrNo) : null,
  });
  return normalizeOpenResult(unwrap(res));
}

/** GET /VisitCrfMapping/execution-queries?activityExecutionHdrNo= */
export async function listVisitCrfExecutionQueries(activityExecutionHdrNo) {
  const hdr = Number(activityExecutionHdrNo) || 0;
  if (hdr <= 0) return [];
  const res = await api.get("/VisitCrfMapping/execution-queries", {
    params: { activityExecutionHdrNo: hdr },
  });
  return normalizeReviewQueries(unwrap(res));
}
