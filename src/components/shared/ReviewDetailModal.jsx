import { activityHasCrf, getCrfActiveFieldItems, getCrfDefinitionForActivity, resolveCrfSavedValues } from "../../services/crfService";
import { CrfForm } from "./CrfForm";
import { AliquotSkipRemarkCell } from "./AliquotSkipRemarkCell";
import {
  formatActivityTimepointLabel,
  formatTimepointDisplayLabel,
  resolveActivityDoseLabel
} from "../../utils/visitDisplay";
import { formatAuditOffsetDisplay, formatAuditUtc } from "../../shared/audit/auditDisplayUtils";

/** @returns {"scanned" | "skipped" | "missing"} */
function resolveAliquotBoxTone(child) {
  if (!child) return "missing";
  const status = String(child.status ?? "").toLowerCase();
  if (child.skippedAt || child.skipped || status === "skipped" || status === "missed") return "skipped";
  if (child.createdAt || status === "linked" || status === "stored" || status === "completed" || status === "scanned") {
    return "scanned";
  }
  return "missing";
}

function aliquotBoxLabel(tone) {
  if (tone === "scanned") return "Scanned";
  if (tone === "skipped") return "Skipped";
  return "Missing";
}

function resolveAliquotSkipRemark(child) {
  return String(child?.skippedReason ?? child?.skipRemark ?? "").trim();
}

function resolveAliquotAuditId(child) {
  const fromNo = Number(child?.activityExecutionAliquotNo) || 0;
  if (fromNo > 0) return fromNo;
  const fromId = Number(child?.id) || 0;
  return fromId > 0 ? fromId : null;
}

function resolveAliquotChild(activity, aliquots, sample, barcode, index) {
  const normalized = String(barcode ?? "").trim().toUpperCase();
  if (!normalized) return null;

  if (sample) {
    const fromSample = aliquots.find(
      (item) =>
        item.parentSampleId === sample.id
        && String(item.barcode ?? "").trim().toUpperCase() === normalized
    );
    if (fromSample) return fromSample;
  }

  const fromActivity = (activity.aliquots ?? []).find(
    (item) => String(item.barcode ?? "").trim().toUpperCase() === normalized
  );
  if (fromActivity) return fromActivity;

  if (sample) {
    const children = aliquots.filter((item) => item.parentSampleId === sample.id);
    return children[index] ?? null;
  }

  return (activity.aliquots ?? [])[index] ?? null;
}

function displayOrDash(value) {
  const text = String(value ?? "").trim();
  return text || "—";
}

function resolveVisitLabel(activity, visit) {
  const candidates = [
    activity?.visitLabel,
    visit?.visitLabel,
    visit?.periodLabel,
    visit?.label,
    visit?.name,
    visit?.visitName,
    typeof visit?.period === "number" && visit.period > 0 ? `Period ${visit.period}` : "",
  ];
  for (const value of candidates) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "—";
}

function ReviewDetailModal({
  open,
  activity,
  sample,
  visit,
  aliquots = [],
  expectedBarcodes = [],
  crfAuditEntries = [],
  allowFieldQuery = false,
  onRaiseFieldQuery,
  onOpenFieldAudit,
  onOpenQueryAudit,
  onOpenAliquotSkipAudit,
  onClose
}) {
  if (!open || !activity) return null;

  const definition = activityHasCrf(activity) ? getCrfDefinitionForActivity(activity) : null;
  const crfItems = definition ? getCrfActiveFieldItems(definition) : [];
  const savedValues = definition ? resolveCrfSavedValues(activity, definition) : {};
  const aliquotChildren = sample
    ? aliquots.filter((item) => item.parentSampleId === sample.id)
    : [];
  const activityAliquotBarcodes = (activity.aliquots ?? [])
    .map((item) => String(item.barcode ?? "").trim())
    .filter(Boolean);
  const displayBarcodes = expectedBarcodes.length
    ? expectedBarcodes
    : aliquotChildren.length
      ? aliquotChildren.map((item) => item.barcode).filter(Boolean)
      : activityAliquotBarcodes;
  const hasAliquots = !!(sample || displayBarcodes.length || activityAliquotBarcodes.length);
  const activityStatus = String(activity.status ?? "").trim();
  const isSkippedOrMissed = ["Skipped", "Missed"].includes(activityStatus);
  const hasCrf = !!(definition && crfItems.length) && !isSkippedOrMissed;
  const doseLabel = resolveActivityDoseLabel(activity);
  const visitLabel = resolveVisitLabel(activity, visit);
  const timepointLabel = formatActivityTimepointLabel(activity)
    || formatTimepointDisplayLabel(activity.timepoint, doseLabel);

  const performedBy = displayOrDash(activity.performedBy);
  const performedOn = formatAuditUtc(activity.performedOn) || "—";
  const performedOffset = formatAuditOffsetDisplay(activity.performedOffset) || "—";
  const reviewedBy = displayOrDash(activity.reviewedBy);
  const reviewedOn = formatAuditUtc(activity.reviewedOn) || "—";
  const reviewedOffset = formatAuditOffsetDisplay(activity.reviewedOffset) || "—";

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal modal--wide review-detail-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="review-detail-modal__head">
          <div className="review-detail-modal__context">
            <div className="review-detail-modal__context-cell">
              <span>Subject</span>
              <strong>{activity.subjectNumber || "—"}</strong>
            </div>
            <div className="review-detail-modal__context-cell">
              <span>Visit</span>
              <strong>{visitLabel}</strong>
            </div>
            <div className="review-detail-modal__context-cell">
              <span>Dose</span>
              <strong>{doseLabel || "—"}</strong>
            </div>
            <div className="review-detail-modal__context-cell">
              <span>Timepoint</span>
              <strong>{timepointLabel || "—"}</strong>
            </div>
          </div>
          <button
            type="button"
            className="btn btn--ghost review-detail-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            {"\u00d7"}
          </button>
        </div>

        <div className="review-detail-modal__audit">
          <div className="review-detail-modal__audit-row">
            <div className="review-detail-modal__audit-item">
              <span>Performed By</span>
              <strong>{performedBy}</strong>
            </div>
            <div className="review-detail-modal__audit-item">
              <span>Performed On (UTC)</span>
              <strong>{performedOn}</strong>
            </div>
            <div className="review-detail-modal__audit-item">
              <span>Performed On (Offset)</span>
              <strong>{performedOffset}</strong>
            </div>
          </div>
          <div className="review-detail-modal__audit-row">
            <div className="review-detail-modal__audit-item">
              <span>Reviewed By</span>
              <strong>{reviewedBy}</strong>
            </div>
            <div className="review-detail-modal__audit-item">
              <span>Reviewed On (UTC)</span>
              <strong>{reviewedOn}</strong>
            </div>
            <div className="review-detail-modal__audit-item">
              <span>Reviewed On Offset</span>
              <strong>{reviewedOffset}</strong>
            </div>
          </div>
        </div>

        <div className="review-detail-modal__body review-detail-modal__body--stack">
          {hasAliquots ? (
            <section className="review-detail-modal__panel">
              <div className="review-detail-modal__aliquot-grid">
                {displayBarcodes.length ? displayBarcodes.map((barcode, index) => {
                  const child = resolveAliquotChild(activity, aliquots, sample, barcode, index);
                  const tone = resolveAliquotBoxTone(child);
                  const skipNote = resolveAliquotSkipRemark(child);
                  const auditId = resolveAliquotAuditId(child);
                  const showSkipRemark = tone === "skipped";
                  return (
                    <div
                      key={barcode}
                      className={`review-detail-modal__aliquot-box review-detail-modal__aliquot-box--${tone}${showSkipRemark ? " review-detail-modal__aliquot-box--with-remark" : ""}`}
                    >
                      <div className="review-detail-modal__aliquot-head">
                        <span className="mono review-detail-modal__aliquot-code">{barcode}</span>
                        <span className="review-detail-modal__aliquot-tone">{aliquotBoxLabel(tone)}</span>
                      </div>
                      {showSkipRemark ? (
                        <AliquotSkipRemarkCell
                          reason={skipNote || "—"}
                          hasAudit={!!auditId && !!onOpenAliquotSkipAudit}
                          onOpenAudit={
                            auditId && onOpenAliquotSkipAudit
                              ? () => onOpenAliquotSkipAudit(child)
                              : undefined
                          }
                        />
                      ) : null}
                    </div>
                  );
                }) : (
                  <p className="empty-state empty-state--compact">No aliquot barcodes configured.</p>
                )}
              </div>
            </section>
          ) : null}

          {hasCrf ? (
            <section className="review-detail-modal__panel">
              <div className="review-detail-modal__crf">
                <CrfForm
                  formId={`review-detail-crf-${activity.id}`}
                  definition={definition}
                  activity={activity}
                  sample={sample}
                  visit={visit}
                  savedValues={savedValues}
                  crfAuditEntries={crfAuditEntries}
                  onOpenFieldAudit={onOpenFieldAudit}
                  onOpenQueryAudit={onOpenQueryAudit}
                  allowFieldQuery={allowFieldQuery}
                  onRaiseFieldQuery={onRaiseFieldQuery}
                  viewOnly
                />
              </div>
            </section>
          ) : null}
        </div>

        <div className="modal__actions modal__actions--center">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export { ReviewDetailModal };
