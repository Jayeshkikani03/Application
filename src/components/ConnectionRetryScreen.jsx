/**
 * Full-screen connectivity failure with in-app Retry (no location.reload).
 */
export function ConnectionRetryScreen({
  title = "No connection",
  message,
  onRetry,
  retrying = false,
  retryLabel = "Try again",
}) {
  return (
    <div className="connection-retry-screen" role="alert">
      <div className="connection-retry-screen__card">
        <h1 className="connection-retry-screen__title">{title}</h1>
        <p className="connection-retry-screen__message">
          {message || "We could not connect right now. Please check your internet and try again."}
        </p>
        {typeof onRetry === "function" && (
          <button
            type="button"
            className="connection-retry-screen__btn"
            onClick={onRetry}
            disabled={retrying}
          >
            {retrying ? "Trying…" : retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
