import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getReviewQueryRowActions, getReviewQueryStatus } from "../../services/reviewQueryService";

const MENU_WIDTH = 180;

function QueryActionsMenu({
  activity,
  onResolve,
  onSendback,
  onClose,
  onReraise,
  onAudit,
  allowReraise = true,
  allowResolve = true,
  allowClose = true,
  allowSendback = true
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const status = getReviewQueryStatus(activity);
  const statusActions = getReviewQueryRowActions(status);
  const canResolve = allowResolve && statusActions.canResolve;
  const canClose = allowClose && statusActions.canClose;
  const canSendback = allowSendback && statusActions.canSendback;
  const canReraise = statusActions.canReraise;
  const showReraise = allowReraise && canReraise;
  const hasMenu = canResolve || canSendback || canClose || showReraise || !!onAudit;

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    const menuEl = menuRef.current;
    if (!rect) return;

    const menuWidth = menuEl?.offsetWidth || MENU_WIDTH;
    const menuHeight = menuEl?.offsetHeight || 0;
    const gap = 4;
    const viewportPad = 8;

    // Align menu right edge with trigger; clamp so full labels stay on screen.
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
    // Re-measure after paint so menuHeight is accurate.
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
      if (
        containerRef.current?.contains(target)
        || menuRef.current?.contains(target)
      ) {
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

  if (!hasMenu) return null;

  const runAction = (action) => {
    setOpen(false);
    action?.();
  };

  const dropdown = open ? (
    <div
      ref={menuRef}
      className="query-actions-menu__dropdown"
      style={{ top: position.top, left: position.left }}
      role="menu"
    >
      {canResolve ? (
        <button
          type="button"
          role="menuitem"
          className="query-actions-menu__item"
          onClick={() => runAction(onResolve)}
        >
          Resolve
        </button>
      ) : null}
      {canSendback ? (
        <button
          type="button"
          role="menuitem"
          className="query-actions-menu__item"
          onClick={() => runAction(onSendback)}
        >
          Send Back
        </button>
      ) : null}
      {canClose ? (
        <button
          type="button"
          role="menuitem"
          className="query-actions-menu__item"
          onClick={() => runAction(onClose)}
        >
          Close Query
        </button>
      ) : null}
      {showReraise ? (
        <button
          type="button"
          role="menuitem"
          className="query-actions-menu__item"
          onClick={() => runAction(onReraise)}
        >
          Reraise
        </button>
      ) : null}
      {onAudit ? (
        <button
          type="button"
          role="menuitem"
          className="query-actions-menu__item"
          onClick={() => runAction(onAudit)}
        >
          Audit
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="query-actions-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--sm btn--ghost query-actions-menu__trigger"
        aria-label="Query actions"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
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

export { QueryActionsMenu };
