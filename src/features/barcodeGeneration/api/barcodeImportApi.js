import api from "@/shared/api/httpClient.js";

/** POST /Barcode/save — persist a client-generated barcode run. */
export async function saveGeneratedBarcodes(run) {
  const res = await api.post("/Barcode/save", run);
  return res.data;
}

/** GET /Barcode/stored — load barcode preview runs from DB tables. */
export async function getStoredBarcodeRuns() {
  const res = await api.get("/Barcode/stored");
  const payload = res.data?.data ?? res.data ?? [];
  const rows = Array.isArray(payload) ? payload : [];
  return rows.map((run) => ({
    id: String(run.id ?? run.Id ?? ""),
    projectId: String(run.projectId ?? run.ProjectId ?? run.projectCode ?? run.ProjectCode ?? ""),
    projectCode: String(run.projectCode ?? run.ProjectCode ?? ""),
    projectName: String(run.projectName ?? run.ProjectName ?? ""),
    labelType: String(run.labelType ?? run.LabelType ?? "PK Label"),
    periodId: run.periodId ?? run.PeriodId ?? "",
    periodIds: run.periodIds ?? run.PeriodIds ?? [],
    periodCode: run.periodCode ?? run.PeriodCode ?? "",
    periodLabel: run.periodLabel ?? run.PeriodLabel ?? "",
    doseLabel: run.doseLabel ?? run.DoseLabel ?? "",
    timepointIds: run.timepointIds ?? run.TimepointIds ?? [],
    timepointLabels: run.timepointLabels ?? run.TimepointLabels ?? [],
    siteParticipantStart: run.siteParticipantStart ?? run.SiteParticipantStart ?? "",
    totalSubjects: Number(run.totalSubjects ?? run.TotalSubjects) || 0,
    lotCount: Number(run.lotCount ?? run.LotCount) || 0,
    bagCount: Number(run.bagCount ?? run.BagCount) || 0,
    generatePk: run.generatePk !== false && run.GeneratePk !== false,
    generatedAt: run.generatedAt ?? run.GeneratedAt ?? new Date().toISOString(),
    subjects: mapItems(run.subjects ?? run.Subjects),
    pk: mapItems(run.pk ?? run.Pk),
    aliquots: mapItems(run.aliquots ?? run.Aliquots),
    bags: mapItems(run.bags ?? run.Bags),
  }));
}

function mapItems(items) {
  return (items ?? []).map((item) => {
    const tpNo = Number(item.activityConfigTimePointNo ?? item.ActivityConfigTimePointNo) || 0;
    const caption = item.caption ?? item.Caption ?? "";
    const period = item.period ?? item.Period ?? "";
    const lotNo = Number(item.lotNo ?? item.LotNo) || 0;
    return {
      barcode: String(item.barcode ?? item.Barcode ?? "").trim(),
      label: item.label ?? item.Label ?? "",
      ...(caption ? { caption: String(caption) } : {}),
      participantLabel: item.participantLabel ?? item.ParticipantLabel ?? "",
      ...(tpNo > 0 ? { activityConfigTimePointNo: tpNo } : {}),
      ...(period ? { period: String(period) } : {}),
      ...(lotNo > 0 ? { lotNo } : {}),
    };
  });
}

/**
 * GET /Barcode/schedule-options — periods + blood-collection timepoints from ActivityConfig.
 * Maps to the period/dose/timepoint shape used by barcodeGenerationService.
 */
export async function getBarcodeScheduleOptions() {
  const res = await api.get("/Barcode/schedule-options");
  const payload = res.data?.data ?? res.data ?? {};
  const projectCode = payload.projectCode ?? payload.ProjectCode ?? "";
  const aliquotsPerSeparation =
    Number(payload.aliquotsPerSeparation ?? payload.AliquotsPerSeparation) || 3;
  const rawPeriods = payload.periods ?? payload.Periods ?? [];

  const periods = rawPeriods.map((period) => {
    const periodNumber = Number(period.period ?? period.Period) || 0;
    const periodId = String(period.periodId ?? period.PeriodId ?? `period-${periodNumber}`);
    const doses = (period.doses ?? period.Doses ?? []).map((dose) => {
      const doseNo = Number(dose.activityConfigDoseNo ?? dose.ActivityConfigDoseNo) || 0;
      const doseId = String(dose.id ?? dose.Id ?? `dose-${doseNo}`);
      const timepoints = (dose.timepoints ?? dose.Timepoints ?? []).map((tp) => {
        const tpNo = Number(tp.activityConfigTimePointNo ?? tp.ActivityConfigTimePointNo) || 0;
        const activityType = String(tp.activityType ?? tp.ActivityType ?? "").trim();
        const offset =
          tp.offsetMinutes ?? tp.OffsetMinutes ?? tp.offset ?? tp.Offset ?? null;
        return {
          id: String(tp.id ?? tp.Id ?? `tp-${tpNo}`),
          activityConfigTimePointNo: tpNo,
          label: String(tp.label ?? tp.Label ?? "").trim(),
          order: Number(tp.order ?? tp.Order) || 0,
          activityType,
          activity: activityType,
          duration: Number(tp.duration ?? tp.Duration) || 0,
          durationType: String(tp.durationType ?? tp.DurationType ?? "Hour"),
          offset: offset == null ? null : Number(offset),
          isActive: tp.isActive !== false && tp.IsActive !== false,
          generatesPkLabel: tp.generatesPkLabel !== false && tp.GeneratesPkLabel !== false,
        };
      });

      return {
        id: doseId,
        activityConfigDoseNo: doseNo,
        label: String(dose.label ?? dose.Label ?? "").trim(),
        order: Number(dose.order ?? dose.Order) || 0,
        isActive: dose.isActive !== false && dose.IsActive !== false,
        timepoints,
      };
    });

    return {
      id: periodId,
      period: periodNumber,
      code: String(period.code ?? period.Code ?? String(periodNumber).padStart(2, "0")),
      label: String(period.label ?? period.Label ?? String(periodNumber)),
      doses,
    };
  });

  return { projectCode, aliquotsPerSeparation, periods };
}
