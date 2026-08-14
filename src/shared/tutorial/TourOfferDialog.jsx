/** First-login offer: Start guided tour or Cancel (no ? FAB until answered). */
export function TourOfferDialog({ open, onStart, onCancel }) {
  if (!open) return null

  return (
    <div className="esource-tour-offer" role="dialog" aria-modal="true" aria-labelledby="esource-tour-offer-title">
      <div className="esource-tour-offer__backdrop" />
      <div className="esource-tour-offer__card">
        <p className="esource-tour-offer__kicker">Welcome to eSource</p>
        <h2 id="esource-tour-offer-title" className="esource-tour-offer__title">
          Take a quick site tour?
        </h2>
        <p className="esource-tour-offer__body">
          We will walk you through Activity, scanning, and the main site workflow step by step.
        </p>
        <div className="esource-tour-offer__actions">
          <button type="button" className="esource-tour-btn esource-tour-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="esource-tour-btn esource-tour-btn-primary" onClick={onStart}>
            Start
          </button>
        </div>
      </div>
    </div>
  )
}
