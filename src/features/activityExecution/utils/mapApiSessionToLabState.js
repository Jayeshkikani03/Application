/**
 * Maps ActivityExecution start-by-scan API payload into LabContext-compatible
 * subject / visits / activities / subject+PK barcodes so next-activity UI works.
 *
 * Flow: buildSessionFromStartByScan (schedule shell)
 *     → loadStartByScanSessionIntoState (replace prior DB subjects)
 *     → mergeExecutionHistoryIntoState (overlay saved execution records)
 */

import { HDR_STATUS, mapHdrStatusToLocal, normalizeHdrStatus } from "./hdrStatus.js";
import {
  isActivityLifecycleStatus,
  isTerminalActivityStatus,
} from "../../../shared/domain/activityStatuses.js";

function isImpDose(activityType) {
  return String(activityType ?? "").trim().toLowerCase() === "imp dose administration";
}

function syncVisitReviewStatusesFromActivities(visits, activities, subjectId) {
  return visits.map((visit) => {
    if (visit.subjectId !== subjectId) return visit;

    const visitActivities = activities.filter((activity) => activity.visitId === visit.id);
    const reviewed = visitActivities.filter((activity) => {
      const status = String(activity.reviewStatus ?? "").trim().toLowerCase();
      return status === "reviewed";
    });
    const submitted = visitActivities.filter((activity) => {
      const status = String(activity.reviewStatus ?? "").trim().toLowerCase();
      return status === "submitted" || status === "pending review";
    });

    // Prefer existing visit status if already Reviewed/Submitted from DB.
    const existing = String(visit.reviewStatus ?? "").trim().toLowerCase();
    if (existing === "reviewed") return visit;
    if (existing === "submitted" && !reviewed.length) return visit;

    if (visitActivities.length && reviewed.length === visitActivities.length) {
      return { ...visit, reviewStatus: "Reviewed" };
    }

    // Any submitted/reviewed activity means the dose was already sent for review.
    if (submitted.length || reviewed.length) {
      const terminal = visitActivities.filter((activity) =>
        isTerminalActivityStatus(activity.status)
      );
      if (terminal.length && reviewed.length >= terminal.length) {
        return { ...visit, reviewStatus: "Reviewed" };
      }
      return { ...visit, reviewStatus: "Submitted" };
    }

    return visit;
  });
}

function isPreDose(activityType) {
  return String(activityType ?? "").trim().toLowerCase() === "pre-dose blood collection";
}

function resolveActivityName(timepoint) {
  const type = String(timepoint.activityType ?? "").trim();
  if (type) return type;
  const label = String(timepoint.label ?? "");
  if (/pre-dose/i.test(label)) return "Pre-Dose Blood Collection";
  if (/imp dose/i.test(label)) return "IMP Dose Administration";
  return "Post-Dose Blood Collection";
}

/** Shape local project.schedule.periods so filter/sort can align with API doses. */
function mapScheduleToProjectPeriods(schedule) {
  return [...(schedule.periods ?? [])]
    .sort((a, b) => (a.period || 0) - (b.period || 0))
    .map((period) => {
      const periodNumber = Number(period.period) || 0;
      const doses = [...(period.doses ?? [])]
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((dose) => ({
          id: dose.id || `dose-${dose.activityConfigDoseNo}`,
          activityConfigDoseNo: dose.activityConfigDoseNo,
          label: dose.label,
          order: dose.order || 0,
          isActive: dose.isActive !== false,
          isPublished: true,
          visitNo: Number(dose.visitNo) || 0,
          studyVisitScheduleNo: Number(dose.studyVisitScheduleNo) || 0,
          studyVisitLabel: String(dose.studyVisitLabel ?? "").trim(),
          timepoints: [...(dose.timepoints ?? [])]
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map((tp) => {
              const activityType = resolveActivityName(tp);
              return {
                id: tp.id || `tp-${tp.activityConfigTimePointNo}`,
                activityConfigTimePointNo: tp.activityConfigTimePointNo,
                label: tp.label,
                order: tp.order || 0,
                activityType,
                activity: activityType,
                offset: tp.offsetMinutes ?? null,
                duration: tp.duration,
                durationType: tp.durationType,
                isActive: tp.isActive !== false,
                generatesPkLabel: tp.generatesPkLabel !== false && !isImpDose(activityType),
                pkBarcode: tp.pkBarcode ?? null,
                aliquotBarcodes: [...(tp.aliquotBarcodes ?? [])],
              };
            }),
        }));

      return {
        id: period.id || `exec-period-${periodNumber}`,
        period: periodNumber,
        code: period.code || String(periodNumber).padStart(2, "0"),
        label: period.label || String(periodNumber),
        doses,
      };
    });
}

/** Study visit display label from schedule dose — exact DB text only. */
function resolveStudyVisitLabel(dose) {
  return String(dose?.studyVisitLabel ?? "").trim();
}

/** PRMS-completed studyVisitScheduleNo values from subject timeline (start-by-scan). */
function getPrmsCompletedScheduleNos(subjectDto) {
  const visits = subjectDto?.visits ?? subjectDto?.Visits ?? [];
  const completed = new Set();
  for (const visit of visits) {
    const isCompleted = visit?.isPrmsCompleted === true || visit?.IsPrmsCompleted === true;
    if (!isCompleted) continue;
    const scheduleNo = Number(visit.studyVisitScheduleNo ?? visit.StudyVisitScheduleNo) || 0;
    if (scheduleNo > 0) completed.add(scheduleNo);
  }
  return completed;
}

function isDoseUnlockedByPrms(dose, completedScheduleNos) {
  const scheduleNo = Number(dose?.studyVisitScheduleNo ?? dose?.StudyVisitScheduleNo) || 0;
  return scheduleNo > 0 && completedScheduleNos.has(scheduleNo);
}

/**
 * @param {{ barcode: string, subject: object, schedule: object }} apiPayload
 */
export function buildSessionFromStartByScan(apiPayload) {
  const subjectDto = apiPayload?.subject ?? {};
  const schedule = apiPayload?.schedule ?? {};
  const barcode = String(apiPayload?.barcode ?? subjectDto.siteRandomizationNo ?? "").trim();
  const subjectMstNo = Number(subjectDto.subjectMstNo) || 0;
  const subjectId = `api-sub-${subjectMstNo || barcode.replace(/\W/g, "")}`;
  const siteRand = String(subjectDto.siteRandomizationNo || barcode).trim();
  const subjectNumber =
    String(subjectDto.mySubjectNo || subjectDto.subjectId || siteRand).trim() || siteRand;
  const projectCode = String(schedule.projectCode || "").trim();
  const prmsCompletedScheduleNos = getPrmsCompletedScheduleNos(subjectDto);
  // Full published schedule (all periods/doses) — used for compliance PDF export.
  // Visits/activities below stay PRMS-gated so execution UI only unlocks completed visits.
  const projectPeriods = mapScheduleToProjectPeriods(schedule);
  const aliquotsPerSeparation = Number(schedule.aliquotsPerSeparation) || 3;

  const subject = {
    id: subjectId,
    subjectNumber,
    randomizationNumber: siteRand,
    barcode: siteRand,
    initials: String(subjectDto.initials || "---").trim() || "---",
    status: "Ready",
    projectId: projectCode || undefined,
    subjectMstNo,
  };

  const barcodeRows = [
    {
      code: siteRand,
      type: "subject",
      subjectId,
      label: `Participant ${siteRand}`,
    },
  ];

  const visits = [];
  const activities = [];
  let firstVisitId = null;
  let firstPreDoseActivityId = null;
  let firstActivityId = null;

  const periods = [...(schedule.periods ?? [])].sort((a, b) => (a.period || 0) - (b.period || 0));
  for (const period of periods) {
    const doses = [...(period.doses ?? [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    for (const dose of doses) {
      if (!isDoseUnlockedByPrms(dose, prmsCompletedScheduleNos)) {
        continue;
      }

      const visitId = `api-visit-${subjectId}-${dose.activityConfigDoseNo}`;
      if (!firstVisitId) firstVisitId = visitId;

      const doseLabel = String(dose.label ?? "").trim();
      const studyVisitLabel = resolveStudyVisitLabel(dose);
      const periodCode = period.code || String(period.period ?? "").padStart(2, "0");
      const periodLabel = String(period.label ?? "").trim();

      // LabContext "visit" = one dose-session. label = study visit (not dose).
      visits.push({
        id: visitId,
        subjectId,
        label: studyVisitLabel,
        studyVisitLabel,
        visitNo: Number(dose.visitNo) || 0,
        studyVisitScheduleNo: Number(dose.studyVisitScheduleNo) || 0,
        doseLabel,
        status: "Ready",
        plannedDoseTime: null,
        actualDoseTime: null,
        periodCode,
        periodLabel,
        projectId: projectCode || undefined,
        activityConfigDoseNo: dose.activityConfigDoseNo,
      });

      const timepoints = [...(dose.timepoints ?? [])].sort((a, b) => (a.order || 0) - (b.order || 0));
      for (const tp of timepoints) {
        const activityName = resolveActivityName(tp);
        const imp = isImpDose(activityName);
        const activityId = `api-act-${subjectId}-${tp.activityConfigTimePointNo}`;
        if (!firstActivityId) firstActivityId = activityId;
        if (isPreDose(activityName) && !firstPreDoseActivityId) firstPreDoseActivityId = activityId;

        const pkBarcode = imp ? null : String(tp.pkBarcode ?? "").trim() || null;
        const aliquotBarcodes = imp
          ? []
          : [...(tp.aliquotBarcodes ?? [])]
              .map((code) => String(code ?? "").trim())
              .filter(Boolean);

        // Prefer schedule/DB timepoint label as-is; fall back to dose label for IMP if blank.
        const timepointLabel = String(tp.label ?? "").trim() || (imp ? doseLabel : "");

        activities.push({
          id: activityId,
          subjectId,
          subjectMstNo,
          visitId,
          projectId: projectCode || undefined,
          subjectNumber,
          visitLabel: studyVisitLabel || doseLabel,
          dose: doseLabel,
          timepoint: timepointLabel,
          activity: activityName,
          executionMethod: imp ? "manual" : "pkBarcode",
          scheduledTime: null,
          windowStart: null,
          windowEnd: null,
          actualTime: null,
          status: "Upcoming",
          barcode: pkBarcode,
          sampleId: null,
          pkOffsetMinutes: imp ? null : tp.offsetMinutes ?? 0,
          timepointOrder: Number(tp.order) || 0,
          expectedAliquots: imp ? 0 : aliquotBarcodes.length || aliquotsPerSeparation,
          expectedAliquotBarcodes: aliquotBarcodes,
          configSynced: true,
          activityConfigTimePointNo: tp.activityConfigTimePointNo,
          activityConfigDoseNo: dose.activityConfigDoseNo,
        });

        if (pkBarcode) {
          barcodeRows.push({
            code: pkBarcode,
            type: "pk",
            activityId,
            label: `${subjectNumber} ${timepointLabel} PK tube`,
          });
        }

        aliquotBarcodes.forEach((aliquotCode, index) => {
          barcodeRows.push({
            code: aliquotCode,
            type: "aliquot",
            activityId,
            label: `${subjectNumber} ${timepointLabel} aliquot ${index + 1}`,
          });
        });
      }
    }
  }

  // Protocol order: Pre-Dose → IMP → Post-Dose. Mark first Pre-Dose Ready (fallback: first timepoint).
  const readyId = firstPreDoseActivityId || firstActivityId;
  if (readyId) {
    for (const activity of activities) {
      if (activity.id === readyId) activity.status = "Ready";
    }
  }

  return {
    subjectId,
    visitId: firstVisitId,
    subject,
    barcodeRows,
    visits,
    activities,
    projectCode,
    projectPeriods,
    aliquotsPerSeparation,
  };
}

/**
 * Apply API history records onto schedule activities/samples after start-by-scan.
 */
export function mergeExecutionHistoryIntoState(state, history, subjectId) {
  const records = history?.records ?? [];
  if (!subjectId || !records.length) return state;

  let next = { ...state };
  let activities = [...(next.activities ?? [])];
  let visits = [...(next.visits ?? [])];
  let samples = [...(next.samples ?? [])];
  let aliquots = [...(next.aliquots ?? [])];
  let barcodes = [...(next.barcodes ?? [])];

  for (const record of records) {
    const tpNo = Number(record.activityConfigTimePointNo) || 0;
    if (!tpNo) continue;
    const activityIndex = activities.findIndex(
      (a) => a.subjectId === subjectId && Number(a.activityConfigTimePointNo) === tpNo
    );
    if (activityIndex < 0) continue;

    const activity = { ...activities[activityIndex] };
    const isImp = isImpDose(activity.activity || record.activityType);
    activity.fieldIds = record.fieldIds ?? {};
    activity.activityExecutionHdrNo = record.activityExecutionHdrNo ?? activity.activityExecutionHdrNo;
    if (record.appActivityCrfNo) {
      activity.appActivityCrfNo = record.appActivityCrfNo;
    }
    if (record.crfVersion) {
      activity.crfVersion = record.crfVersion;
    }
    if (record.crfName) {
      activity.crfName = record.crfName;
    }
    const crfValues = record.crfValues ?? {};
    if (Object.keys(crfValues).length > 0) {
      const crfId =
        String(activity.crfDefinition?.id ?? activity.activity ?? "").trim() ||
        Object.keys(activity.crfResponses ?? {})[0] ||
        "crf";
      activity.crfResponses = {
        ...(activity.crfResponses ?? {}),
        [crfId]: {
          values: { ...(activity.crfResponses?.[crfId]?.values ?? {}), ...crfValues },
          savedAt: new Date().toISOString()
        }
      };
    }
    activity.actualTime = record.actualTime ?? activity.actualTime;
    activity.scheduledTime = record.scheduledTime ?? activity.scheduledTime;
    activity.windowStart = record.windowStart ?? activity.windowStart;
    activity.windowEnd = record.windowEnd ?? activity.windowEnd;
    activity.deviation = Boolean(record.deviation);
    activity.deviationReason = record.deviationReason ?? activity.deviationReason;
    activity.remarks = record.remarks ?? activity.remarks;
    activity.executionMethod = record.executionMethod ?? activity.executionMethod;
    if (record.barcodeValue) activity.barcode = record.barcodeValue;
    if (record.reviewQuery !== undefined || record.reviewQueries !== undefined) {
      activity.reviewQuery = record.reviewQuery;
      activity.reviewQueryAt = record.reviewQueryAt;
      activity.reviewQueryFieldKey = record.reviewQueryFieldKey;
      activity.reviewQueryFieldLabel = record.reviewQueryFieldLabel;
      activity.reviewQueryStatus = record.reviewQueryStatus;
      activity.reviewQueryResponse = record.reviewQueryResponse;
      activity.reviewQuerySendbackRemark = record.reviewQuerySendbackRemark;
      activity.reviewQueryResolvedAt = record.reviewQueryResolvedAt;
      activity.reviewQueryClosedAt = record.reviewQueryClosedAt;
      activity.activityExecutionQueryNo = record.activityExecutionQueryNo ?? record.ActivityExecutionQueryNo ?? null;
      if (Array.isArray(record.reviewQueries)) {
        activity.reviewQueries = record.reviewQueries;
      }
    }

    if (record.reviewStatus) {
      activity.reviewStatus = record.reviewStatus;
      const reviewLower = String(record.reviewStatus).trim().toLowerCase();
      if (reviewLower === "submitted" || reviewLower === "reviewed" || reviewLower === "pending review") {
        visits = visits.map((visit) => {
          if (visit.id !== activity.visitId) return visit;
          const existing = String(visit.reviewStatus ?? "").trim().toLowerCase();
          if (existing === "reviewed") return visit;
          if (reviewLower === "reviewed") return { ...visit, reviewStatus: "Reviewed" };
          if (existing === "submitted") return visit;
          return { ...visit, reviewStatus: "Submitted" };
        });
      }
    }

    const mapped = mapHdrStatusToLocal(record.status, {
      deviation: activity.deviation,
      isImp,
      hasCentrifugeEnd: Boolean(record.centrifugationEnd),
    });
    if (mapped.activityStatus) {
      activity.status = mapped.activityStatus;
    } else if (record.status) {
      // Unknown/legacy string — keep only known lifecycle values
      const raw = String(record.status).trim();
      if (isActivityLifecycleStatus(raw)) {
        activity.status = raw;
      }
    }

    if (isImp && (record.actualTime || normalizeHdrStatus(record.status) === HDR_STATUS.Completed)) {
      visits = visits.map((visit) =>
        visit.id === activity.visitId
          ? {
              ...visit,
              actualDoseTime: record.actualTime ?? visit.actualDoseTime,
              plannedDoseTime: record.scheduledTime ?? record.actualTime ?? visit.plannedDoseTime,
              status: "In Progress",
              doseScheduleConfirmed: true,
            }
          : visit
      );
    }

    // Skipped PK timepoints: no sample; terminal for Ready promotion
    if (!isImp && normalizeHdrStatus(record.status) === HDR_STATUS.Skipped) {
      activity.status = "Skipped";
      activities[activityIndex] = activity;
      continue;
    }

    if (!isImp && (record.actualTime || mapped.sampleStatus)) {
      const sampleId = activity.sampleId || `api-smp-${tpNo}`;
      activity.sampleId = sampleId;
      let sample = samples.find((s) => s.id === sampleId);
      if (!sample) {
        sample = {
          id: sampleId,
          barcode: activity.barcode || record.barcodeValue || `PK-${sampleId}`,
          subjectId,
          subjectNumber: activity.subjectNumber,
          visitId: activity.visitId,
          activityId: activity.id,
          timepoint: activity.timepoint,
          dose: activity.dose,
          status: mapped.sampleStatus || "Awaiting Centrifugation",
          collectedAt: record.actualTime || null,
          centrifugationStart: null,
          centrifugationEnd: null,
          expectedAliquots: record.expectedAliquots || activity.expectedAliquots || 0,
          expectedAliquotBarcodes: [...(activity.expectedAliquotBarcodes ?? [])],
          storageLocation: null,
        };
        samples = [...samples, sample];
      } else {
        sample = {
          ...sample,
          collectedAt: record.actualTime ?? sample.collectedAt,
          barcode: activity.barcode || sample.barcode,
        };
      }

      if (record.centrifugationStart) {
        sample.centrifugationStart = record.centrifugationStart;
        sample.scanStartTime = record.centrifugationStart;
        sample.status = "Centrifuging";
      }
      if (record.centrifugationEnd) {
        sample.centrifugationEnd = record.centrifugationEnd;
        sample.scanEndTime = record.centrifugationEnd;
        sample.status = "Ready For Aliquot";
      }

      // Prefer explicit hdr process status when times are incomplete
      const hdrNorm = normalizeHdrStatus(record.status);
      if (hdrNorm === HDR_STATUS.BloodCollected && !record.centrifugationStart) {
        sample.status = "Awaiting Centrifugation";
      } else if (hdrNorm === HDR_STATUS.Centrifugation) {
        sample.status = record.centrifugationEnd ? "Ready For Aliquot" : "Centrifuging";
      } else if (hdrNorm === HDR_STATUS.Aliquoted) {
        sample.status = "Aliquoted";
      }

      samples = samples.map((s) => (s.id === sampleId ? sample : s));
      if (!samples.some((s) => s.id === sampleId)) samples = [...samples, sample];

      for (const aliquotDto of record.aliquots ?? []) {
        const aliquotCode = String(aliquotDto.barcodeValue ?? "").trim();
        if (!aliquotCode) continue;
        const existingAliquot = aliquots.find(
          (a) => String(a.barcode ?? "").toUpperCase() === aliquotCode.toUpperCase()
        );
        if (existingAliquot) {
          aliquots = aliquots.map((a) =>
            a.id === existingAliquot.id
              ? {
                  ...a,
                  activityExecutionAliquotNo: aliquotDto.activityExecutionAliquotNo || a.activityExecutionAliquotNo,
                  parentSampleId: sampleId,
                  parentBarcode: sample.barcode,
                  createdAt:
                    aliquotDto.status?.toLowerCase() === "linked" || aliquotDto.createdAt
                      ? aliquotDto.createdAt || a.createdAt || new Date().toISOString()
                      : a.createdAt,
                  skippedAt:
                    aliquotDto.status?.toLowerCase() === "skipped"
                      ? aliquotDto.skippedAt || a.skippedAt || new Date().toISOString()
                      : a.skippedAt,
                  skippedReason: aliquotDto.skipRemark ?? aliquotDto.skippedReason ?? a.skippedReason,
                  storageLocation: aliquotDto.storageLocation ?? a.storageLocation,
                  status: aliquotDto.status || a.status,
                }
              : a
          );
        } else {
          const status = String(aliquotDto.status ?? "Pending").trim() || "Pending";
          const aliquotId = `api-alq-${aliquotDto.activityExecutionAliquotNo || aliquotCode}`;
          aliquots = [
            ...aliquots,
            {
              id: aliquotId,
              activityExecutionAliquotNo: aliquotDto.activityExecutionAliquotNo || null,
              barcode: aliquotCode,
              parentSampleId: sampleId,
              parentBarcode: sample.barcode,
              subjectId,
              subjectNumber: activity.subjectNumber,
              createdAt: status.toLowerCase() === "linked" ? aliquotDto.createdAt || new Date().toISOString() : null,
              skippedAt: status.toLowerCase() === "skipped" ? aliquotDto.skippedAt || new Date().toISOString() : null,
              skippedReason: aliquotDto.skipRemark ?? aliquotDto.skippedReason ?? null,
              storageLocation: aliquotDto.storageLocation ?? null,
              status,
            },
          ];

          if (!barcodes.some((b) => String(b.code).toUpperCase() === aliquotCode.toUpperCase())) {
            barcodes = [
              ...barcodes,
              {
                code: aliquotCode,
                type: "aliquot",
                aliquotId,
                sampleId,
                activityId: activity.id,
                label: `${activity.subjectNumber} ${activity.timepoint} aliquot`,
              },
            ];
          }
        }
      }

      const completedCount = aliquots.filter(
        (a) =>
          a.parentSampleId === sampleId &&
          (a.createdAt || a.skippedAt || ["linked", "skipped", "stored"].includes(String(a.status ?? "").toLowerCase()))
      ).length;
      if (
        hdrNorm === HDR_STATUS.Aliquoted ||
        (completedCount > 0 && completedCount >= (sample.expectedAliquots || 0))
      ) {
        sample.status = "Aliquoted";
        samples = samples.map((s) => (s.id === sampleId ? sample : s));
      }
    }

    activities[activityIndex] = activity;
  }

  // Propagate scheduled times from actual dose time for upcoming activities
  for (const visit of visits) {
    if (visit.actualDoseTime) {
      const firstDoseLabel = String(visit.doseLabel ?? "").split(",")[0]?.trim();
      const refDate = new Date(visit.actualDoseTime);
      activities = activities.map((a) => {
        if (a.subjectId !== subjectId || a.visitId !== visit.id || a.pkOffsetMinutes === null) return a;
        if (firstDoseLabel && a.dose !== firstDoseLabel) return a;

        const scheduledTimeMs = refDate.getTime() + a.pkOffsetMinutes * 60000;
        const local = new Date(scheduledTimeMs - refDate.getTimezoneOffset() * 60000);
        const scheduledTimeStr = local.toISOString().slice(0, 19);
        const hasWindow = a.activity !== "Pre-Dose Blood Collection";

        let windowStartStr = null;
        let windowEndStr = null;
        if (hasWindow) {
           const startLocal = new Date((scheduledTimeMs - 3 * 60000) - refDate.getTimezoneOffset() * 60000);
           const endLocal = new Date((scheduledTimeMs + 3 * 60000) - refDate.getTimezoneOffset() * 60000);
           windowStartStr = startLocal.toISOString().slice(0, 19);
           windowEndStr = endLocal.toISOString().slice(0, 19);
        }

        return {
          ...a,
          scheduledTime: a.scheduledTime || scheduledTimeStr,
          windowStart: a.windowStart || windowStartStr,
          windowEnd: a.windowEnd || windowEndStr
        };
      });
    }
  }

  // Promote first incomplete activity to Ready in protocol order.
  const subjectActivities = activities
    .filter((a) => a.subjectId === subjectId)
    .sort((a, b) => {
      const doseDiff =
        (Number(String(a.dose).match(/\d+/)?.[0]) || 0) -
        (Number(String(b.dose).match(/\d+/)?.[0]) || 0);
      if (doseDiff !== 0) return doseDiff;
      return (Number(a.activityConfigTimePointNo) || 0) - (Number(b.activityConfigTimePointNo) || 0);
    });

  let foundReady = false;
  activities = activities.map((activity) => {
    if (activity.subjectId !== subjectId) return activity;
    if (isTerminalActivityStatus(activity.status) || activity.actualTime) {
      return activity;
    }
    if (!foundReady && subjectActivities.some((a) => a.id === activity.id)) {
      const priorIncomplete = subjectActivities.find(
        (a) =>
          a.id !== activity.id &&
          !a.actualTime &&
          !isTerminalActivityStatus(a.status) &&
          (Number(a.activityConfigTimePointNo) || 0) < (Number(activity.activityConfigTimePointNo) || 0)
      );
      if (!priorIncomplete) {
        foundReady = true;
        return { ...activity, status: "Ready" };
      }
    }
    return activity.status === "Ready" ? { ...activity, status: "Upcoming" } : activity;
  });

  if (!foundReady) {
    const firstUpcoming = subjectActivities.find(
      (a) => !a.actualTime && !isTerminalActivityStatus(a.status)
    );
    if (firstUpcoming) {
      activities = activities.map((a) =>
        a.id === firstUpcoming.id ? { ...a, status: "Ready" } : a
      );
    }
  }

  // Mirror updateSubjectVisitStatus: mark fully-done doses Completed so
  // Activity Execution can advance activeVisitId after a session reload.
  visits = visits.map((visit) => {
    if (visit.subjectId !== subjectId) return visit;
    const visitActivities = activities.filter((a) => a.visitId === visit.id);
    if (!visitActivities.length) return visit;
    const allTerminal = visitActivities.every((a) => isTerminalActivityStatus(a.status));
    const anyStarted = visitActivities.some(
      (a) =>
        ["Ready", "Completed", "Skipped", "Deviation"].includes(a.status) ||
        Boolean(a.actualTime)
    );
    if (allTerminal) return { ...visit, status: "Completed" };
    if (anyStarted || visit.actualDoseTime) {
      return { ...visit, status: "In Progress" };
    }
    return visit;
  });

  visits = syncVisitReviewStatusesFromActivities(visits, activities, subjectId);

  // Prefer the visit that owns the next Ready activity (e.g. Dose 2 after Pre Dose).
  const readyActivity = activities.find(
    (a) => a.subjectId === subjectId && a.status === "Ready"
  );
  const activeVisitId =
    readyActivity?.visitId
    ?? visits.find((v) => v.subjectId === subjectId && v.status !== "Completed")?.id
    ?? next.activeVisitId;

  return {
    ...next,
    activities,
    visits,
    samples,
    aliquots,
    barcodes,
    activeVisitId,
  };
}

/**
 * Apply VisitTracker review statuses (Submitted / Reviewed) onto local dose visits
 * so Submit never reappears after a dose was already submitted in the DB.
 */
export function applyVisitReviewStatusesToState(state, apiVisits = [], subjectMstNo) {
  const subjectId = state.subjects.find(
    (subject) => Number(subject.subjectMstNo) === Number(subjectMstNo)
  )?.id;
  if (!subjectId) return state;

  const subjectApiVisits = (apiVisits ?? []).filter(
    (visit) => Number(visit.subjectMstNo ?? visit.SubjectMstNo) === Number(subjectMstNo)
  );
  if (!subjectApiVisits.length) return state;

  const normalizeDose = (value) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const extractDoseNumber = (value) => {
    const match = String(value ?? "").match(/\d+/);
    return match ? Number(match[0]) : null;
  };

  const rank = (status) => {
    const normalized = String(status ?? "").trim().toLowerCase();
    if (normalized === "reviewed") return 3;
    if (normalized === "submitted" || normalized === "pending review") return 2;
    if (normalized === "pending") return 1;
    return 0;
  };

  const visits = state.visits.map((visit) => {
    if (visit.subjectId !== subjectId) return visit;

    const doseKey = normalizeDose(visit.doseLabel ?? visit.dose ?? visit.label);
    const doseNo =
      Number(visit.activityConfigDoseNo) || extractDoseNumber(visit.doseLabel ?? visit.dose ?? visit.label);

    let match = subjectApiVisits.find((apiVisit) => {
      const apiDose = normalizeDose(apiVisit.visitName ?? apiVisit.VisitName);
      const apiDoseNo = extractDoseNumber(apiVisit.visitName ?? apiVisit.VisitName);
      if (apiDose && doseKey && (apiDose === doseKey || apiDose.includes(doseKey) || doseKey.includes(apiDose))) {
        return true;
      }
      return doseNo != null && apiDoseNo != null && doseNo === apiDoseNo;
    });

    // Fallback: single submitted/reviewed visit for this subject maps to matching dose number visit.
    if (!match && doseNo != null) {
      const submittedForDose = subjectApiVisits.filter((apiVisit) => {
        const apiDoseNo = extractDoseNumber(apiVisit.visitName ?? apiVisit.VisitName);
        const status = String(apiVisit.reviewStatus ?? apiVisit.ReviewStatus ?? "").trim().toLowerCase();
        return (
          apiDoseNo === doseNo
          && (status === "submitted" || status === "reviewed" || status === "pending review")
        );
      });
      if (submittedForDose.length === 1) match = submittedForDose[0];
    }

    // Last resort: if this subject has exactly one Submitted/Reviewed visit tracker, apply it
    // when the local dose also has only one candidate visit.
    if (!match) {
      const submittedVisits = subjectApiVisits.filter((apiVisit) => {
        const status = String(apiVisit.reviewStatus ?? apiVisit.ReviewStatus ?? "").trim().toLowerCase();
        return status === "submitted" || status === "reviewed" || status === "pending review";
      });
      if (submittedVisits.length === 1) {
        const localSubmittedCandidates = state.visits.filter((item) => item.subjectId === subjectId);
        if (localSubmittedCandidates.length === 1) match = submittedVisits[0];
        else if (doseNo != null) {
          const byNumber = submittedVisits.find(
            (apiVisit) => extractDoseNumber(apiVisit.visitName ?? apiVisit.VisitName) === doseNo
          );
          if (byNumber) match = byNumber;
        }
      }
    }

    if (!match) return visit;

    const apiReviewStatus = String(match.reviewStatus ?? match.ReviewStatus ?? "").trim();
    if (!apiReviewStatus) return visit;

    // Never downgrade a stronger local status (e.g. Submitted) with Pending from a racey API read.
    if (rank(apiReviewStatus) < rank(visit.reviewStatus)) {
      return {
        ...visit,
        visitTrackerNo: match.visitTrackerNo ?? match.VisitTrackerNo ?? visit.visitTrackerNo,
      };
    }

    if (apiReviewStatus.toLowerCase() === "pending") return visit;

    return {
      ...visit,
      reviewStatus: apiReviewStatus,
      visitTrackerNo: match.visitTrackerNo ?? match.VisitTrackerNo ?? visit.visitTrackerNo,
    };
  });

  return { ...state, visits };
}

/**
 * Load start-by-scan session into LabContext (replaces prior DB-backed subject rows).
 */
export function loadStartByScanSessionIntoState(state, apiPayload) {
  const session = buildSessionFromStartByScan(apiPayload);
  const { projectCode, projectPeriods, aliquotsPerSeparation } = session;

  let projects = [...(state.projects ?? [])];
  if (projectCode) {
    const existingIdx = projects.findIndex(
      (p) => String(p.id).toLowerCase() === projectCode.toLowerCase()
        || String(p.code ?? "").toLowerCase() === projectCode.toLowerCase()
    );
    const projectRow = {
      id: projectCode,
      code: projectCode,
      name: projectCode,
      aliquotsPerSeparation,
      schedule: { periods: projectPeriods },
    };
    if (existingIdx >= 0) {
      projects[existingIdx] = {
        ...projects[existingIdx],
        ...projectRow,
        schedule: { periods: projectPeriods },
        aliquotsPerSeparation,
      };
    } else {
      projects = [...projects, projectRow];
    }
  }

  // Barcodes belonging to this start-by-scan session (subject + PK + aliquot).
  const incomingBarcodeCodes = new Set(
    session.barcodeRows.map((b) => String(b.code ?? "").toUpperCase()).filter(Boolean)
  );

  // When a new subject is scanned, clear ALL prior DB-backed subjects from state.
  // We only work with ONE active subject at a time. Keep only rows with no subjectMstNo.
  const keepSubject = (s) => !Number(s.subjectMstNo);

  // Preserve Submitted/Reviewed across re-scan so Submit never comes back.
  const { subjectId } = session;
  const previousReviewByDoseNo = new Map();
  for (const visit of state.visits ?? []) {
    if (visit.subjectId !== subjectId) continue;
    const doseNo = Number(visit.activityConfigDoseNo) || 0;
    const status = String(visit.reviewStatus ?? "").trim();
    if (!doseNo || !status) continue;
    const lower = status.toLowerCase();
    if (lower === "submitted" || lower === "reviewed" || lower === "pending review") {
      previousReviewByDoseNo.set(doseNo, status);
    }
  }

  const seededVisits = session.visits.map((visit) => {
    const doseNo = Number(visit.activityConfigDoseNo) || 0;
    const preserved = doseNo ? previousReviewByDoseNo.get(doseNo) : null;
    return preserved ? { ...visit, reviewStatus: preserved } : visit;
  });

  return {
    ...state,
    subjects: [...state.subjects.filter(keepSubject), session.subject],
    visits: [
      ...state.visits.filter((v) => {
        const owner = state.subjects.find((s) => s.id === v.subjectId);
        return keepSubject(owner ?? {});
      }),
      ...seededVisits,
    ],
    activities: [
      ...state.activities.filter((a) => {
        const owner = state.subjects.find((s) => s.id === a.subjectId);
        return keepSubject(owner ?? {});
      }),
      ...session.activities,
    ],
    barcodes: [
      ...state.barcodes.filter((b) => {
        const owner = state.subjects.find((s) => s.id === b.subjectId);
        return keepSubject(owner ?? {}) && !incomingBarcodeCodes.has(String(b.code ?? "").toUpperCase());
      }),
      ...session.barcodeRows,
    ],
    samples: (state.samples ?? []).filter((s) => {
      const owner = state.subjects.find((sub) => sub.id === s.subjectId);
      return keepSubject(owner ?? {});
    }),
    aliquots: (state.aliquots ?? []).filter((a) => {
      const owner = state.subjects.find((sub) => sub.id === a.subjectId);
      return keepSubject(owner ?? {});
    }),
    projects,
    activeProjectId: projectCode || state.activeProjectId,
    activeSubjectId: session.subjectId,
    activeVisitId: session.visitId,
    lastScanMessage: `Participant ${session.barcodeRows[0]?.code ?? ""} session started.`,
  };
}
