import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function statusMessage(task, isError) {
  const recorded = String((isError ? task.errorMessage : task.resultMessage) || "").trim();
  if (recorded) return recorded;
  return isError ? "No error details were recorded." : "No status message was recorded.";
}

function promptLabel(task) {
  const name = String(task.templateName || "").trim();
  if (name && task.promptVersion != null) return `${name} (v${task.promptVersion})`;
  if (name) return name;
  if (task.promptVersion != null) return `v${task.promptVersion}`;
  return "—";
}

function formatPerformedOnUtc(value) {
  if (!value) return "—";
  const raw = String(value).trim();
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/
  );
  if (match) {
    return `${match[3]}-${MONTH_SHORT[Number(match[2]) - 1] || match[2]}-${match[1]} ${match[4]}:${match[5]}`;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mmm = MONTH_SHORT[date.getUTCMonth()];
  const yyyy = date.getUTCFullYear();
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${dd}-${mmm}-${yyyy} ${hh}:${mm}`;
}

function formatOffset(value) {
  const stored = String(value ?? "").trim();
  if (!stored) return "—";
  const match = stored.match(/^([+-])(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return stored;
  return `${match[1]}${String(match[2]).padStart(2, "0")}:${match[3]}`;
}

function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(1)} s`;
}

function formatPayload(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function payloadMeta(text) {
  if (!text) return "Empty";
  const lines = text.split(/\r?\n/).length;
  return `${text.length.toLocaleString()} chars · ${lines.toLocaleString()} lines`;
}

function CopyButton({ text, label = "Copy", variant = "ghost", className = "" }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      className={`btn btn--${variant} btn--sm pdf-import-message-modal__copy ${copied ? "pdf-import-message-modal__copy--done" : ""} ${className}`.trim()}
      onClick={handleCopy}
      disabled={!text}
    >
      <i className={`fas ${copied ? "fa-check" : "fa-copy"}`} aria-hidden="true" />
      {copied ? "Copied" : label}
    </button>
  );
}

function PayloadBlock({ label, value, emptyHint }) {
  const text = formatPayload(value);
  return (
    <section className="pdf-import-message-modal__io">
      <div className="pdf-import-message-modal__io-head">
        <div>
          <div className="pdf-import-message-modal__io-label">{label}</div>
          <p className="pdf-import-message-modal__io-meta">{payloadMeta(text)}</p>
        </div>
        <CopyButton text={text} label={`Copy ${label}`} />
      </div>
      {text ? (
        <pre className="pdf-import-message-modal__payload-body">{text}</pre>
      ) : (
        <p className="pdf-import-message-modal__empty">{emptyHint}</p>
      )}
    </section>
  );
}

function MetaCard({ label, value, title, wide = false, copyText = "" }) {
  const display = String(value || "").trim() || "—";
  return (
    <div className={`pdf-import-message-modal__meta-card${wide ? " pdf-import-message-modal__meta-card--wide" : ""}`}>
      <div className="pdf-import-message-modal__meta-card-head">
        <dt>{label}</dt>
        {copyText ? <CopyButton text={copyText} label="Copy" /> : null}
      </div>
      <dd title={title || display}>{display}</dd>
    </div>
  );
}

export function PdfImportMessageModal({ open, onClose, task }) {
  const isError = task?.status === "Failed";
  const outputText = useMemo(() => formatPayload(task?.responsePayload), [task?.responsePayload]);
  const statusText = useMemo(
    () => (task ? statusMessage(task, isError) : ""),
    [task, isError]
  );

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open || !task) return null;

  const title = isError ? "Import failed" : "Import result";

  return createPortal(
    <div
      className="modal-backdrop modal-backdrop--stack pdf-import-message-modal-backdrop"
      role="presentation"
    >
      <div
        className={`modal pdf-import-message-modal ${isError ? "pdf-import-message-modal--error" : "pdf-import-message-modal--success"}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-import-message-title"
      >
        <div className={`pdf-import-message-modal__banner ${isError ? "pdf-import-message-modal__banner--error" : "pdf-import-message-modal__banner--success"}`}>
          <div className="pdf-import-message-modal__banner-icon" aria-hidden="true">
            {isError ? (
              <i className="fas fa-circle-exclamation" />
            ) : (
              <i className="fas fa-circle-check" />
            )}
          </div>
          <div className="pdf-import-message-modal__banner-text">
            <h3 className="modal__title" id="pdf-import-message-title">
              {title}
            </h3>
            <p className="pdf-import-message-modal__file-name" title={task.fileName}>
              {task.fileName || "PDF document"}
            </p>
          </div>
          <button
            type="button"
            className="btn btn--secondary btn--sm pdf-import-message-modal__close"
            onClick={onClose}
            aria-label="Close import result"
          >
            Close
          </button>
        </div>

        <div className="pdf-import-message-modal__body">
          <div className="pdf-import-message-modal__status-row">
            <p className={`pdf-import-message-modal__status${isError ? " pdf-import-message-modal__status--error" : " pdf-import-message-modal__status--success"}`}>
              {statusText}
            </p>
            <CopyButton text={statusText} label="Copy message" />
          </div>

          <dl className="pdf-import-message-modal__llm-grid">
            <MetaCard label="Prompt" value={promptLabel(task)} />
            <MetaCard label="Model" value={task.modelName || "—"} />
          </dl>

          <dl className="pdf-import-message-modal__detail-grid">
            <MetaCard label="Status" value={task.status || "—"} />
            <MetaCard label="Performed by" value={task.recordedSign || "—"} />
            <MetaCard label="Performed on (UTC)" value={formatPerformedOnUtc(task.recordedOnUtc)} />
            <MetaCard label="Offset" value={formatOffset(task.recordedAtOffset)} />
            <MetaCard label="Duration" value={formatDuration(task.durationMs)} />
          </dl>

          <dl className="pdf-import-message-modal__url-row">
            <MetaCard
              wide
              label="API URL"
              value={task.apiUrl || "—"}
              title={task.apiUrl || ""}
              copyText={String(task.apiUrl || "").trim()}
            />
          </dl>

          <div className="pdf-import-message-modal__io-grid">
            <PayloadBlock
              label="Input"
              value={task.requestPayload}
              emptyHint="No request payload was recorded for this import."
            />
            <PayloadBlock
              label="Output"
              value={task.responsePayload}
              emptyHint="No model output was recorded. The request may have failed before Gemini returned a response."
            />
          </div>
        </div>

        <div className="modal__actions modal__actions--center pdf-import-message-modal__actions">
          <CopyButton
            text={outputText}
            label="Copy output"
            variant="secondary"
            className="pdf-import-message-modal__copy--footer"
          />
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
