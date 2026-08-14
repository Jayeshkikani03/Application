import { mapHdrStatusToLocal } from "./hdrStatus.js";

/**
 * Resolve dose/timepoint labels (+ optional aliquot barcodes) from published schedule
 * and/or labels already enriched on the queue record.
 */
export function resolveScheduleLabels(record, scheduleCache) {
  const doseNo = Number(record.activityConfigDoseNo) || 0;
  const tpNo = Number(record.activityConfigTimePointNo) || 0;

  let doseLabel =
    String(record.doseLabel || "").trim() || (doseNo > 0 ? `Dose ${doseNo}` : "Dose");
  let timepointLabel =
    String(record.timePointLabel || "").trim() || (tpNo > 0 ? `TP ${tpNo}` : "TP");
  let expectedBarcodes = [];
  let resolvedDoseNo = doseNo;

  if (scheduleCache?.periods) {
    let matchedDose = null;
    let matchedTp = null;

    // Prefer exact dose + timepoint match.
    if (doseNo > 0) {
      outerDose: for (const period of scheduleCache.periods) {
        for (const dose of period.doses || []) {
          if (Number(dose.activityConfigDoseNo) === doseNo) {
            matchedDose = dose;
            matchedTp = (dose.timepoints || []).find(
              (t) => Number(t.activityConfigTimePointNo) === tpNo
            );
            break outerDose;
          }
        }
      }
    }

    // Legacy rows often lack ActivityConfigDoseNo — find by timepoint alone.
    if (!matchedTp && tpNo > 0) {
      outerTp: for (const period of scheduleCache.periods) {
        for (const dose of period.doses || []) {
          const tp = (dose.timepoints || []).find(
            (t) => Number(t.activityConfigTimePointNo) === tpNo
          );
          if (tp) {
            matchedDose = dose;
            matchedTp = tp;
            resolvedDoseNo = Number(dose.activityConfigDoseNo) || doseNo;
            break outerTp;
          }
        }
      }
    }

    if (matchedDose?.label) {
      doseLabel = matchedDose.label;
    }
    if (matchedTp) {
      if (matchedTp.label) timepointLabel = matchedTp.label;
      expectedBarcodes = matchedTp.aliquotBarcodes || [];
    }
  }

  return { doseLabel, timepointLabel, expectedBarcodes, resolvedDoseNo };
}

/**
 * Map a centrifuge/aliquot queue record into UI sample shape with mutation keys.
 */
export function mapQueueRecordToSample(record, scheduleCache, { includeAliquots = false } = {}) {
  const { doseLabel, timepointLabel, expectedBarcodes: scheduleBarcodes, resolvedDoseNo } =
    resolveScheduleLabels(record, scheduleCache);
  const hasCentrifugeEnd = Boolean(record.centrifugationEnd);
  const { sampleStatus } = mapHdrStatusToLocal(record.status, { hasCentrifugeEnd });
  const siteRand = String(record.siteRandomizationNo || "").trim();
  const subjectMstNo = Number(record.subjectMstNo) || 0;

  const fromRecord = (record.expectedAliquotBarcodes || [])
    .map((code) => String(code || "").trim())
    .filter(Boolean);
  const fromChildren = (record.aliquots || [])
    .map((a) => String(a.barcodeValue || a.barcode || "").trim())
    .filter(Boolean);
  const expectedBarcodes = [
    ...new Set(
      [...fromRecord, ...scheduleBarcodes, ...fromChildren].map((c) => c.toUpperCase())
    ),
  ].map((upper) => {
    const original =
      fromRecord.find((c) => c.toUpperCase() === upper) ||
      scheduleBarcodes.find((c) => c.toUpperCase() === upper) ||
      fromChildren.find((c) => c.toUpperCase() === upper);
    return original || upper;
  });

  const aliquotsPerSeparation = Number(scheduleCache?.aliquotsPerSeparation) || 0;
  const expectedAliquots =
    Number(record.expectedAliquots) ||
    expectedBarcodes.length ||
    aliquotsPerSeparation ||
    0;

  const sample = {
    id: record.activityExecutionHdrNo,
    activityExecutionHdrNo: record.activityExecutionHdrNo,
    subjectMstNo,
    activityConfigTimePointNo: record.activityConfigTimePointNo,
    activityConfigDoseNo: resolvedDoseNo || record.activityConfigDoseNo,
    subjectId: `api-sub-${subjectMstNo}`,
    subjectNumber: siteRand || subjectMstNo,
    siteRandomizationNo: siteRand,
    barcode: record.barcodeValue || "",
    dose: doseLabel,
    timepoint: timepointLabel,
    collectedAt: record.actualTime,
    centrifugationStart: record.centrifugationStart,
    centrifugationEnd: record.centrifugationEnd,
    status: sampleStatus || record.status || "Collected",
    reviewStatus: record.reviewStatus || null,
    expectedAliquots,
    expectedBarcodes,
    fieldIds: record.fieldIds || {},
  };

  if (includeAliquots) {
    const childByBarcode = new Map();
    for (const a of record.aliquots || []) {
      const code = String(a.barcodeValue || "").trim().toUpperCase();
      if (code) childByBarcode.set(code, a);
    }

    sample.aliquots = expectedBarcodes.map((barcode, index) => {
      const a = childByBarcode.get(barcode.toUpperCase()) || (record.aliquots || [])[index];
      if (a) {
        const status = String(a.status ?? "").toLowerCase();
        return {
          id: a.activityExecutionAliquotNo || `pending-${barcode}`,
          activityExecutionAliquotNo: a.activityExecutionAliquotNo || 0,
          parentSampleId: a.activityExecutionHdrNo || record.activityExecutionHdrNo,
          barcode: a.barcodeValue || barcode,
          createdAt:
            status === "linked" || status === "stored"
              ? a.createdAt || new Date().toISOString()
              : null,
          skippedAt: status === "skipped" ? a.skippedAt || new Date().toISOString() : null,
          skippedReason: a.skipRemark ?? a.skippedReason ?? null,
          status: a.status || "Pending",
          slotOrder: a.slotOrder || index + 1,
        };
      }
      return {
        id: `pending-${barcode}`,
        activityExecutionAliquotNo: 0,
        parentSampleId: record.activityExecutionHdrNo,
        barcode,
        createdAt: null,
        skippedAt: null,
        skippedReason: null,
        status: "Pending",
        slotOrder: index + 1,
      };
    });
  }

  return sample;
}

export { isExecutionReviewLocked } from "./hdrStatus.js";

/** Resolve PK scan intent against mapped queue samples (API-backed pages). */
export function resolveQueuePkScanIntent(samples, rawCode) {
  const code = String(rawCode ?? "").trim().toUpperCase();
  if (!code) return { type: "error", message: "Empty barcode." };

  const sample = samples.find((s) => String(s.barcode || "").toUpperCase() === code);
  if (!sample) {
    return { type: "error", message: `Unknown PK barcode: ${code}` };
  }

  const status = sample.status;
  if (status === "Collected" || status === "Awaiting Centrifugation") {
    return { type: "startCentrifugation", sample, code };
  }
  if (status === "Centrifuging") {
    return { type: "endCentrifugation", sample, code };
  }
  if (status === "Ready For Aliquot") {
    return { type: "aliquot", sample, code };
  }
  if (status === "Aliquoted" || status === "Stored") {
    return { type: "aliquot", sample, code };
  }
  return {
    type: "error",
    message: `${sample.barcode} cannot be processed at this step (${status}).`,
  };
}

/** Build participant filter options from queue samples. */
export function buildSubjectOptionsFromQueue(samples, statusList) {
  const map = new Map();
  for (const sample of samples) {
    if (statusList && !statusList.includes(sample.status)) continue;
    if (!sample.subjectId || map.has(sample.subjectId)) continue;
    const label = String(sample.siteRandomizationNo || sample.subjectNumber || "").trim();
    map.set(sample.subjectId, {
      id: sample.subjectId,
      subjectMstNo: sample.subjectMstNo,
      subjectNumber: sample.subjectNumber,
      siteRandomizationNo: sample.siteRandomizationNo,
      barcode: label,
      randomizationNumber: label,
    });
  }
  return [...map.values()];
}

/** Subject filter id used across queue pages (matches mapQueueRecordToSample). */
export function subjectFilterId(subjectMstNo) {
  return `api-sub-${Number(subjectMstNo) || 0}`;
}

/** Parse the numeric SubjectMstNo back out of a subject filter id. */
export function subjectMstNoFromFilterId(filterId) {
  const match = String(filterId ?? "").match(/api-sub-(\d+)/);
  return match ? Number(match[1]) : 0;
}

/** Build participant filter options from the server-provided subject facet list. */
export function buildSubjectOptionsFromServer(subjectOptions) {
  return (subjectOptions || [])
    .filter((option) => Number(option?.subjectMstNo) > 0)
    .map((option) => {
      const subjectMstNo = Number(option.subjectMstNo) || 0;
      const label = String(option.siteRandomizationNo || subjectMstNo || "").trim();
      return {
        id: subjectFilterId(subjectMstNo),
        subjectMstNo,
        subjectNumber: option.siteRandomizationNo || subjectMstNo,
        siteRandomizationNo: option.siteRandomizationNo || "",
        barcode: label,
        randomizationNumber: label,
      };
    });
}

/** Build dose filter options from the server-provided dose facet list. */
export function buildDoseOptionsFromServer(doseOptions) {
  return (doseOptions || [])
    .filter((option) => Number(option?.activityConfigDoseNo) > 0)
    .map((option) => ({
      value: String(Number(option.activityConfigDoseNo)),
      label: String(option.label || `Dose ${option.activityConfigDoseNo}`).trim(),
    }));
}

/** Stable dose filter key from mapped sample (prefer config dose no). */
export function getSampleDoseFilterKey(sample) {
  const doseNo = Number(sample?.activityConfigDoseNo) || 0;
  if (doseNo > 0) return String(doseNo);
  const raw = sample?.dose ?? "";
  const doseNumber = String(raw).match(/\d+/)?.[0];
  return doseNumber ?? String(raw).trim();
}
