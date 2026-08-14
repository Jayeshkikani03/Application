import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MENU_WIDTH = 168;

function ActivityFillRowMenu({
  openLabel = "Open",
  onOpen,
  canRepeat = false,
  onRepeat,
  repeating = false,
  queryCount = 0,
  resolvedQueryCount = 0,
  onQuery,
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    const menuEl = menuRef.current;
    if (!rect) return;

    const menuWidth = menuEl?.offsetWidth || MENU_WIDTH;
    const menuHeight = menuEl?.offsetHeight || 0;
    const gap = 4;
    const viewportPad = 8;

    let left = rect.right - menuWidth;
    left = Math.max(viewportPad, Math.min(left, window.innerWidth - menuWidth - viewportPad));

    let top = rect.bottom + gap;
    if (menuHeight > 0 && top + menuHeight > window.innerHeight - viewportPad) {
      top = Math.max(viewportPad, rect.top - menuHeight - gap);
    }

    setPosition({ top, left });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(event) {
      const target = event.target;
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [open]);

  const runAction = (fn) => {
    setOpen(false);
    fn?.();
  };

  const isView = String(openLabel).toLowerCase() === "view";
  const openCount = Number(queryCount) || 0;
  const resolvedCount = Number(resolvedQueryCount) || 0;
  const displayCount = openCount > 0 ? openCount : resolvedCount;
  const queryTitle =
    openCount > 0
      ? `${openCount} raised quer${openCount === 1 ? "y" : "ies"}`
      : resolvedCount > 0
        ? `${resolvedCount} resolved quer${resolvedCount === 1 ? "y" : "ies"}`
        : "No open queries";
  const pillClass =
    openCount > 0
      ? " activity-fill-query-pill--open"
      : resolvedCount > 0
        ? " activity-fill-query-pill--resolved"
        : " activity-fill-query-pill--none";

  const canOpenQuery = displayCount > 0 && typeof onQuery === "function";

  const dropdown = open ? (
    <div
      ref={menuRef}
      className="query-actions-menu__dropdown activity-fill-row-menu__dropdown"
      style={{ top: position.top, left: position.left }}
      role="menu"
    >
      <button
        type="button"
        role="menuitem"
        className="query-actions-menu__item activity-fill-row-menu__item"
        onClick={() => runAction(onOpen)}
      >
        <i className={`fas ${isView ? "fa-eye" : "fa-folder-open"}`} aria-hidden="true" />
        <span>{openLabel}</span>
      </button>
      {canRepeat ? (
        <button
          type="button"
          role="menuitem"
          className="query-actions-menu__item activity-fill-row-menu__item"
          disabled={repeating}
          onClick={() => {
            if (repeating) return;
            runAction(onRepeat);
          }}
        >
          <i className={`fas ${repeating ? "fa-spinner fa-spin" : "fa-redo"}`} aria-hidden="true" />
          <span>{repeating ? "Repeating…" : "Repeat"}</span>
        </button>
      ) : null}
      {canOpenQuery ? (
        <button
          type="button"
          role="menuitem"
          className="query-actions-menu__item activity-fill-row-menu__item activity-fill-row-menu__query"
          title={queryTitle}
          onClick={() => runAction(onQuery)}
        >
          <span className="activity-fill-row-menu__query-label">
            <i className="fas fa-question-circle" aria-hidden="true" />
            <span>Query</span>
          </span>
          <span className={`activity-fill-query-pill${pillClass}`}>
            {displayCount}
          </span>
        </button>
      ) : (
        <div
          className="query-actions-menu__item activity-fill-row-menu__item activity-fill-row-menu__query activity-fill-row-menu__query--disabled"
          role="menuitem"
          title={queryTitle}
        >
          <span className="activity-fill-row-menu__query-label">
            <i className="fas fa-question-circle" aria-hidden="true" />
            <span>Query</span>
          </span>
          <span className={`activity-fill-query-pill${pillClass}`}>
            {displayCount}
          </span>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="query-actions-menu activity-fill-row-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--sm btn--ghost query-actions-menu__trigger"
        aria-label="More actions"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          if (open) {
            setOpen(false);
            return;
          }
          updatePosition();
          setOpen(true);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="8" cy="3" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="8" cy="13" r="1.4" />
        </svg>
      </button>
      {dropdown ? createPortal(dropdown, document.body) : null}
    </div>
  );
}

export { ActivityFillRowMenu };
