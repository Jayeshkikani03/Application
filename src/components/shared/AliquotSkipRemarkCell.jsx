import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M11.3 1.7a1.1 1.1 0 0 1 1.6 0l1.4 1.4a1.1 1.1 0 0 1 0 1.6L5.8 12.2 2 13l.8-3.8L11.3 1.7zM9.5 3.5l3 3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AuditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 2.5h5.2L12 5.3v8.2H4v-11zM9 2.5v3h3M5.8 8h4.4M5.8 10h4.4M5.8 12h2.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AliquotSkipRemarkCell({
  reason,
  onEdit,
  onOpenAudit,
  hasAudit = false,
}) {
  const [hoverOpen, setHoverOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0, width: 280 });
  const valueRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const popoverId = useId();

  useEffect(() => () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
  }, []);

  if (!reason) return null;

  const clearHoverTimer = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const placePopover = () => {
    const el = valueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.min(320, Math.max(220, window.innerWidth - 24));
    let left = rect.left;
    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - width - 12);
    }
    let top = rect.bottom + 6;
    if (top + 120 > window.innerHeight) {
      top = Math.max(12, rect.top - 126);
    }
    setPopoverPos({ top, left, width });
  };

  const openHover = () => {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      placePopover();
      setHoverOpen(true);
    }, 220);
  };

  const closeHover = () => {
    clearHoverTimer();
    setHoverOpen(false);
  };

  const showActions = onEdit || (hasAudit && onOpenAudit);

  return (
    <div className="aliquot-skip-remark-cell">
      <div className="aliquot-skip-remark-cell__header">
        <span className="aliquot-skip-remark-cell__label">Skip Remark</span>
        {showActions ? (
          <div className="aliquot-skip-remark-cell__actions">
            {onEdit ? (
              <button
                type="button"
                className="btn btn--sm btn--secondary activity-grid__edit-btn"
                onClick={onEdit}
                aria-label="Edit skip remark"
                title="Edit skip remark"
              >
                <EditIcon />
              </button>
            ) : null}
            {hasAudit && onOpenAudit ? (
              <button
                type="button"
                className="btn btn--sm btn--secondary activity-grid__edit-btn activity-grid__audit-btn"
                onClick={onOpenAudit}
                aria-label="View skip remark audit"
                title="View skip remark audit"
              >
                <AuditIcon />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        ref={valueRef}
        className="aliquot-skip-remark-cell__value"
        onMouseEnter={openHover}
        onMouseLeave={closeHover}
        onFocus={openHover}
        onBlur={closeHover}
        aria-describedby={hoverOpen ? popoverId : undefined}
        title={reason}
      >
        {reason}
      </button>

      {hoverOpen
        ? createPortal(
          <div
            id={popoverId}
            className="aliquot-skip-remark-popover"
            role="tooltip"
            style={{
              top: `${popoverPos.top}px`,
              left: `${popoverPos.left}px`,
              width: `${popoverPos.width}px`,
            }}
            onMouseEnter={openHover}
            onMouseLeave={closeHover}
          >
            <div className="aliquot-skip-remark-popover__head">Skip Remark</div>
            <p className="aliquot-skip-remark-popover__body">{reason}</p>
          </div>,
          document.body
        )
        : null}
    </div>
  );
}

export { AliquotSkipRemarkCell };
