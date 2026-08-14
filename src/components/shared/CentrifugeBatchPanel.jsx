import { formatDisplayTime, fromDateTimeLocal } from "../../services/workflowService";
import { formatTimepointDisplayLabel } from "../../utils/visitDisplay";
import { resolveSiteRandomizationNumber } from "../../utils/participantDisplay";

function BatchRemoveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

export function CentrifugeBatchSampleItem({ sample, centrifugeStartTime, onRemove, subjects }) {
  return (
    <div className="aliquot-modal-list__item">
      <button
        type="button"
        className="aliquot-modal-list__remove aliquot-modal-list__remove--mobile"
        onClick={() => onRemove(sample.sampleId)}
        aria-label={`Remove ${sample.barcode}`}
        title="Remove"
      >
        <BatchRemoveIcon />
      </button>
      <div className="aliquot-modal-list__main">
        <span className="mono">{sample.barcode}</span>
        <small className="preserve-case">
          {resolveSiteRandomizationNumber({ subjectId: sample.subjectId, subjects, subjectNumber: sample.subjectNumber })} - {formatTimepointDisplayLabel(sample.timepoint, sample.dose ?? sample.doseLabel)}
          {centrifugeStartTime && ` - ${formatDisplayTime(fromDateTimeLocal(centrifugeStartTime))}`}
        </small>
      </div>
      <button type="button" className="btn btn--sm btn--ghost aliquot-modal-list__remove--desktop" onClick={() => onRemove(sample.sampleId)}>
        Remove
      </button>
    </div>
  );
}

function CentrifugeBatchPanelBody({ samples, centrifugeStartTime, onRemove, onCancel, onStart, showHeader = true, subjects }) {
  return (
    <>
      {showHeader && (
        <div className="centrifuge-batch-panel__head">
          <span className="section-label">Centrifuge Add-On Batch</span>
          <div className="aliquot-progress aliquot-progress--inline">
            <span>{samples.length}</span>
            <small> selected</small>
          </div>
        </div>
      )}
      <div className="aliquot-inline-list centrifuge-batch-panel__list">
        {samples.map((sample) => (
          <CentrifugeBatchSampleItem
            key={sample.sampleId}
            sample={sample}
            centrifugeStartTime={centrifugeStartTime}
            onRemove={onRemove}
            subjects={subjects}
          />
        ))}
      </div>
      <div className="modal__actions modal__actions--center centrifuge-batch-panel__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancel Batch
        </button>
        <button type="button" className="btn btn--primary" onClick={onStart}>
          Start Centrifuge
        </button>
      </div>
    </>
  );
}

export function CentrifugeBatchPanel({
  samples,
  centrifugeStartTime,
  onRemove,
  onCancel,
  onStart,
  variant = "both",
  layout = "default",
  subjects,
}) {
  if (!samples?.length) return null;

  const showDesktop = variant === "both" || variant === "desktop";
  const showMobile = variant === "both" || variant === "mobile";
  const queueSideClass = layout === "queue" ? " queue-side-card" : "";
  const execClass = layout === "default" ? " exec-batch-panel" : "";

  return (
    <>
      {showDesktop && (
        <section className={`card active-parent-card active-parent-card--desktop centrifuge-batch-panel${queueSideClass}${execClass}`}>
          <CentrifugeBatchPanelBody
            samples={samples}
            centrifugeStartTime={centrifugeStartTime}
            onRemove={onRemove}
            onCancel={onCancel}
            onStart={onStart}
            subjects={subjects}
          />
        </section>
      )}
      {showMobile && (
        <details className={`card active-parent-card active-parent-accordion--mobile centrifuge-batch-panel${queueSideClass}${execClass}`} open>
          <summary className="active-parent-accordion__summary">
            <span className="active-parent-accordion__summary-main">
              <strong>Centrifuge Add-On Batch</strong>
              <span>{samples.length} selected</span>
            </span>
          </summary>
          <div className="active-parent-accordion__body">
            <CentrifugeBatchPanelBody
              samples={samples}
              centrifugeStartTime={centrifugeStartTime}
              onRemove={onRemove}
              onCancel={onCancel}
              onStart={onStart}
              showHeader={false}
              subjects={subjects}
            />
          </div>
        </details>
      )}
    </>
  );
}
