/** Floating action button to manually start the guided tour (mobile/tablet). */
export function FloatingTourButton({
  visible = false,
  running = false,
  showPulse = false,
  onStart,
  disabled = false,
}) {
  if (!visible) return null

  return (
    <button
      type="button"
      className={[
        'esource-tour-fab',
        running ? 'is-running' : '',
        showPulse && !running ? 'is-pulse' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-tour="tour-fab"
      title="Start page tour"
      aria-label="Start page tour"
      disabled={disabled || running}
      onClick={onStart}
    >
      <span className="esource-tour-fab-icon" aria-hidden>
        ?
      </span>
      {showPulse && !running ? <span className="esource-tour-fab-badge" aria-hidden /> : null}
    </button>
  )
}
