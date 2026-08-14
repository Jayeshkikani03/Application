/** Canonical ActivityExecutionHdr.vStatus values (process / display). */
export const HDR_STATUS = {
  Pending: "Pending",
  BloodCollected: "Blood Collected",
  Centrifugation: "Centrifugation",
  Aliquoted: "Aliquoted",
  Skipped: "Skipped",
  Completed: "Completed",
};

/** Normalize API hdr status for comparisons (legacy + current). */
export function normalizeHdrStatus(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower === "collected" || lower === "blood collected" || lower === "awaiting centrifugation") {
    return HDR_STATUS.BloodCollected;
  }
  if (
    lower === "centrifuging" ||
    lower === "centrifugation" ||
    lower === "ready for aliquot"
  ) {
    return HDR_STATUS.Centrifugation;
  }
  if (lower === "aliquoted" || lower === "stored") {
    return HDR_STATUS.Aliquoted;
  }
  if (lower === "skipped") return HDR_STATUS.Skipped;
  if (lower === "completed") return HDR_STATUS.Completed;
  if (lower === "pending") return HDR_STATUS.Pending;
  return s;
}

/**
 * Map hdr process status → local activity lifecycle + sample stage hints.
 * @returns {{ activityStatus: string|null, sampleStatus: string|null }}
 */
export function mapHdrStatusToLocal(recordStatus, { deviation = false, isImp = false, hasCentrifugeEnd = false } = {}) {
  const hdr = normalizeHdrStatus(recordStatus);
  const lifecycleFromDeviation = deviation ? "Deviation" : "Completed";

  if (hdr === HDR_STATUS.Skipped) {
    return { activityStatus: "Skipped", sampleStatus: null };
  }
  if (isImp) {
    return { activityStatus: lifecycleFromDeviation, sampleStatus: null };
  }
  if (hdr === HDR_STATUS.Completed) {
    // Legacy PK rows stored Completed; treat as collected for centrifuge pending.
    return { activityStatus: lifecycleFromDeviation, sampleStatus: "Awaiting Centrifugation" };
  }
  if (hdr === HDR_STATUS.BloodCollected) {
    return { activityStatus: lifecycleFromDeviation, sampleStatus: "Awaiting Centrifugation" };
  }
  if (hdr === HDR_STATUS.Centrifugation) {
    return {
      activityStatus: lifecycleFromDeviation,
      sampleStatus: hasCentrifugeEnd ? "Ready For Aliquot" : "Centrifuging",
    };
  }
  if (hdr === HDR_STATUS.Aliquoted) {
    return { activityStatus: lifecycleFromDeviation, sampleStatus: "Aliquoted" };
  }
  // Legacy PK Completed / Deviation without process string
  const rawLower = String(recordStatus ?? "").trim().toLowerCase();
  if (rawLower === "completed" || rawLower === "deviation") {
    return {
      activityStatus: rawLower === "deviation" || deviation ? "Deviation" : "Completed",
      sampleStatus: "Awaiting Centrifugation",
    };
  }
  return { activityStatus: null, sampleStatus: null };
}

/** True when hdr/visit review status blocks lab edits (Submitted / Reviewed). */
export function isExecutionReviewLocked(reviewStatus) {
  const status = String(reviewStatus ?? "").trim().toLowerCase();
  return status === "submitted" || status === "reviewed" || status === "pending review";
}
