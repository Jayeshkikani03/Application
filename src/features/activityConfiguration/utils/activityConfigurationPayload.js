/**
 * Activity configuration save payloads use audited wrappers:
 * `{ value, changeRemark }` (or bare scalars when no remark).
 */

function trimRemark(changeRemark) {
  const t = changeRemark == null ? "" : String(changeRemark).trim();
  return t || undefined;
}

export function wrapStr(value, changeRemark) {
  const remark = trimRemark(changeRemark);
  if (!remark) return value == null ? "" : String(value);
  return { value: value == null ? "" : String(value), changeRemark: remark };
}

export function wrapBool(value, changeRemark) {
  const remark = trimRemark(changeRemark);
  const boolVal = value !== false;
  if (!remark) return boolVal;
  return { value: boolVal, changeRemark: remark };
}

export function wrapInt(value, changeRemark) {
  const remark = trimRemark(changeRemark);
  const n = Number(value);
  const intVal = Number.isFinite(n) ? Math.trunc(n) : 0;
  if (!remark) return intVal;
  return { value: intVal, changeRemark: remark };
}

export function wrapNullableInt(value, changeRemark) {
  const remark = trimRemark(changeRemark);
  let intVal = null;
  if (value !== "" && value != null) {
    const n = Number(value);
    if (Number.isFinite(n)) intVal = Math.round(n);
  }
  // Always send an audited wrapper so ASP.NET does not treat bare `null` as "required".
  if (!remark) return { value: intVal };
  return { value: intVal, changeRemark: remark };
}

export function wrapDecimal(value, changeRemark) {
  const remark = trimRemark(changeRemark);
  const n = Number(value);
  const decVal = Number.isFinite(n) ? n : 0;
  if (!remark) return decVal;
  return { value: decVal, changeRemark: remark };
}

/**
 * @param {object} flatDose — UI dose
 * @param {Record<string, string>} [fieldRemarks] — UI field key → remark
 */
export function buildDosePatchPayload(flatDose, fieldRemarks = {}, visitOptions = []) {
  const r = fieldRemarks && typeof fieldRemarks === "object" ? fieldRemarks : {};
  const period = Number(flatDose.period ?? flatDose.periodLabel) || 1;
  const visitLabel = flatDose.studyVisitScheduleDescription ?? flatDose.visitLabel ?? "";
  const studyVisitScheduleNo = Number(flatDose.studyVisitScheduleNo) || 0;
  const visitRemark = r.visit || r.studyVisitScheduleNo;

  return {
    activityConfigDoseNo: Number(flatDose.activityConfigDoseNo ?? flatDose.id) || 0,
    period: wrapInt(period, r.period),
    label: wrapStr(flatDose.label, r.label),
    studyVisitScheduleNo: wrapInt(studyVisitScheduleNo, visitRemark),
    visitNo: Number(flatDose.visitNo) || 0,
    studyVisitScheduleDescription: wrapStr(visitLabel, visitRemark),
    order: wrapInt(flatDose.order, r.order),
    isActive: wrapBool(flatDose.isActive !== false, r.isActive),
  };
}

/**
 * @param {object} flatTp — UI timepoint
 * @param {Record<string, string>} [fieldRemarks]
 */
export function buildTimepointPatchPayload(flatTp, fieldRemarks = {}, index = 0) {
  const r = fieldRemarks && typeof fieldRemarks === "object" ? fieldRemarks : {};
  const resolvedOrder = Number(flatTp.order);
  const order = Number.isFinite(resolvedOrder) && resolvedOrder >= 1 ? resolvedOrder : index + 1;
  const visitLabel = flatTp.studyVisitScheduleDescription ?? flatTp.visitLabel ?? "";
  const visitRemark = r.visit || r.studyVisitScheduleNo;

  return {
    activityConfigTimePointNo: Number(flatTp.activityConfigTimePointNo ?? flatTp.id) || 0,
    order: wrapInt(order, r.order),
    label: wrapStr(String(flatTp.label ?? "").trim(), r.label),
    studyVisitScheduleNo: wrapInt(flatTp.studyVisitScheduleNo, visitRemark),
    visitNo: Number(flatTp.visitNo) || 0,
    studyVisitScheduleDescription: wrapStr(visitLabel, visitRemark),
    duration: wrapDecimal(flatTp.duration, r.duration),
    durationType: wrapStr(flatTp.durationType ?? "Hour", r.durationType),
    windowPeriodMinus: wrapNullableInt(flatTp.windowPeriodMinus, r.windowPeriodMinus),
    windowPeriodPlus: wrapNullableInt(flatTp.windowPeriodPlus, r.windowPeriodPlus),
    windowPeriodDurationType: wrapStr(
      flatTp.windowPeriodDurationType ?? "Hour",
      r.windowPeriodDurationType
    ),
    activityType: wrapStr(flatTp.activityType, r.activityType),
    isActive: wrapBool(flatTp.isActive !== false, r.isActive),
  };
}

/**
 * @param {{ aliquotsPerSeparation: number|string, centrifugeTimeMinutes?: number|string, doses: object[], aliquotRemark?: string, centrifugeRemark?: string, doseFieldRemarksById?: Record<string, Record<string, string>> }} args
 */
export function buildConfigSavePayload({
  aliquotsPerSeparation,
  centrifugeTimeMinutes = 10,
  doses = [],
  aliquotRemark,
  centrifugeRemark,
  doseFieldRemarksById = {},
}) {
  return {
    projectParameterNo: undefined,
    aliquotsPerSeparation: wrapInt(aliquotsPerSeparation, aliquotRemark),
    centrifugeTimeMinutes: wrapInt(centrifugeTimeMinutes, centrifugeRemark),
    doses: (doses ?? []).map((dose) => {
      const id = String(dose.activityConfigDoseNo ?? dose.id ?? 0);
      const remarks = doseFieldRemarksById[id] ?? doseFieldRemarksById[Number(id)] ?? {};
      return buildDosePatchPayload(dose, remarks);
    }),
  };
}
