import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'

const PAD = 10
const TOOLTIP_GAP = 16

function getTargetRect(selector) {
  if (!selector || typeof document === 'undefined') return null
  try {
    const el = document.querySelector(selector)
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 && rect.height <= 0) return null
    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      bottom: rect.bottom,
      right: rect.right,
    }
  } catch {
    return null
  }
}

/** Union of target + open select menus (portaled lists sit outside the trigger). */
function getInteractiveRect(selector) {
  const base = getTargetRect(selector)
  if (typeof document === 'undefined') return base

  let union = base
  try {
    const menus = document.querySelectorAll(
      '.scrollable-select__list--portal, .scrollable-select__list[data-open="true"], [data-tour-interactive]',
    )
    menus.forEach((node) => {
      const r = node.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return
      const next = {
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
        bottom: r.bottom,
        right: r.right,
      }
      if (!union) {
        union = next
        return
      }
      const top = Math.min(union.top, next.top)
      const left = Math.min(union.left, next.left)
      const right = Math.max(union.right, next.right)
      const bottom = Math.max(union.bottom, next.bottom)
      union = { top, left, right, bottom, width: right - left, height: bottom - top }
    })
  } catch {
    // ignore
  }
  return union
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function overlaps(a, b, pad = 8) {
  if (!a || !b) return false
  return !(
    a.bottom + pad <= b.top ||
    a.top - pad >= b.bottom ||
    a.right + pad <= b.left ||
    a.left - pad >= b.right
  )
}

function computeTooltipPosition(rect, placement, tooltipSize, { preferAwayFromTarget = false } = {}) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const tw = tooltipSize.width || 320
  const th = tooltipSize.height || 160
  const preferred = placement && placement !== 'auto' ? placement : 'bottom'
  const gap = TOOLTIP_GAP

  const candidates = {
    bottom: {
      top: (rect?.bottom ?? 24) + gap,
      left: (rect?.left ?? 12) + ((rect?.width ?? 0) / 2) - tw / 2,
    },
    top: {
      top: (rect?.top ?? 24) - th - gap,
      left: (rect?.left ?? 12) + ((rect?.width ?? 0) / 2) - tw / 2,
    },
    left: {
      top: (rect?.top ?? 24) + ((rect?.height ?? 0) / 2) - th / 2,
      left: (rect?.left ?? 24) - tw - gap,
    },
    right: {
      top: (rect?.top ?? 24) + ((rect?.height ?? 0) / 2) - th / 2,
      left: (rect?.right ?? 24) + gap,
    },
    screenTop: {
      top: 16,
      left: Math.max(12, (vw - tw) / 2),
    },
    screenBottom: {
      top: Math.max(16, vh - th - 24),
      left: Math.max(12, (vw - tw) / 2),
    },
  }

  const order =
    preferred === 'screenTop' || preferred === 'top'
      ? ['top', 'screenTop', 'bottom', 'screenBottom', 'right', 'left']
      : preferred === 'screenBottom'
        ? ['screenBottom', 'bottom', 'top', 'screenTop', 'right', 'left']
        : preferred === 'left'
          ? ['left', 'right', 'top', 'screenTop', 'bottom', 'screenBottom']
          : preferred === 'right'
            ? ['right', 'left', 'top', 'screenTop', 'bottom', 'screenBottom']
            : preferAwayFromTarget
              ? ['top', 'screenTop', 'bottom', 'screenBottom', 'right', 'left']
              : ['bottom', 'top', 'screenTop', 'screenBottom', 'right', 'left']

  const fitsViewport = (c) =>
    c.top >= 8 && c.left >= 8 && c.top + th <= vh - 8 && c.left + tw <= vw - 8

  const asBox = (c) => ({ top: c.top, left: c.left, right: c.left + tw, bottom: c.top + th })

  let chosen = null
  for (const key of order) {
    const c = candidates[key]
    if (!c) continue
    if (fitsViewport(c) && !overlaps(asBox(c), rect, 16)) {
      chosen = c
      break
    }
  }

  // Last resort: place at screen top/bottom on the side opposite the target.
  if (!chosen) {
    const targetMidY = rect ? rect.top + rect.height / 2 : vh / 2
    chosen = targetMidY < vh / 2 ? candidates.screenBottom : candidates.screenTop
  }

  if (!rect) {
    return {
      top: Math.max(16, (vh - th) / 2),
      left: Math.max(12, (vw - tw) / 2),
    }
  }

  let top = clamp(chosen.top, 8, Math.max(8, vh - th - 8))
  let left = clamp(chosen.left, 8, Math.max(8, vw - tw - 8))

  // If clamping pushed the tip over the spotlight, jump to a safe screen edge.
  if (overlaps({ top, left, right: left + tw, bottom: top + th }, rect, 16)) {
    const targetMidY = rect.top + rect.height / 2
    const safe = targetMidY < vh / 2 ? candidates.screenBottom : candidates.screenTop
    top = clamp(safe.top, 8, Math.max(8, vh - th - 8))
    left = clamp(safe.left, 8, Math.max(8, vw - tw - 8))
  }

  return { top, left }
}

/**
 * Interactive tour overlay:
 * - Dark blockers around the spotlight hole (target stays clickable)
 * - tap/wait: tooltip is pointer-passthrough except Skip/Got it
 * - wait: hole expands to cover open select dropdown menus
 */
export function TourOverlay({
  steps = [],
  stepIndex = 0,
  running = false,
  onAcknowledge,
  onSkip,
}) {
  const step = steps[stepIndex] || null
  const [rect, setRect] = useState(null)
  const [tooltipSize, setTooltipSize] = useState({ width: 320, height: 160 })
  const [tooltipEl, setTooltipEl] = useState(null)

  const measure = useCallback(() => {
    if (!running || !step) {
      setRect(null)
      return
    }
    const next =
      step.mode === 'wait' || step.mode === 'tap'
        ? getInteractiveRect(step.target)
        : getTargetRect(step.target)
    setRect(next)
  }, [running, step])

  useLayoutEffect(() => {
    measure()
  }, [measure, stepIndex])

  useEffect(() => {
    if (!running) return undefined
    const onWin = () => measure()
    window.addEventListener('resize', onWin)
    window.addEventListener('scroll', onWin, true)
    const id = window.setInterval(measure, 200)
    const observer = new MutationObserver(measure)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      window.removeEventListener('resize', onWin)
      window.removeEventListener('scroll', onWin, true)
      window.clearInterval(id)
      observer.disconnect()
    }
  }, [running, measure])

  useLayoutEffect(() => {
    if (!tooltipEl) return
    const r = tooltipEl.getBoundingClientRect()
    setTooltipSize({ width: r.width, height: r.height })
  }, [tooltipEl, stepIndex, step?.title, step?.content, step?.mode])

  useEffect(() => {
    if (!running || !step?.target) return
    const el = document.querySelector(step.target)
    if (el && typeof el.scrollIntoView === 'function') {
      try {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
      } catch {
        // ignore
      }
    }
  }, [running, stepIndex, step?.target])

  const hole = useMemo(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0
    const vh = typeof window !== 'undefined' ? window.innerHeight : 0
    if (!rect) return null
    // Small controls (scan arrow) get a slightly larger spotlight so the tap target is clear.
    const pad = rect.height < 40 || rect.width < 40 ? 14 : PAD
    const top = Math.max(0, rect.top - pad)
    const left = Math.max(0, rect.left - pad)
    const right = Math.min(vw, rect.right + pad)
    const bottom = Math.min(vh, rect.bottom + pad)
    return { top, left, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
  }, [rect])

  const isTap = step?.mode === 'tap'
  const isWait = step?.mode === 'wait'
  const isGotIt = step?.mode === 'gotit'
  const passthroughTooltip = isTap || isWait

  const tooltipPos = useMemo(
    () =>
      computeTooltipPosition(rect, step?.placement || 'auto', tooltipSize, {
        // Always keep the tip off the spotlight so Export / filters stay visible.
        preferAwayFromTarget: true,
      }),
    [rect, step?.placement, tooltipSize],
  )

  // Lock page scroll while the tour is guiding a required tap/action.
  useEffect(() => {
    if (!running) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.classList.add('esource-tour-active')
    if (isTap) document.documentElement.classList.add('esource-tour-tap-required')
    return () => {
      document.body.style.overflow = prev
      document.documentElement.classList.remove('esource-tour-active', 'esource-tour-tap-required')
    }
  }, [running, isTap])

  if (!running || !step) return null

  const total = steps.length
  const hint = isTap
    ? 'Tap the pulsing button to continue'
    : isWait
      ? 'Complete this action — the guide continues automatically'
      : 'Read this tip, then tap Got it'

  const spotlightStyle = hole
    ? {
        top: hole.top,
        left: hole.left,
        width: hole.width,
        height: hole.height,
      }
    : null

  return (
    <div
      className={`esource-tour-root${isTap ? ' esource-tour-root--tap' : ''}${isWait ? ' esource-tour-root--wait' : ''}${isGotIt ? ' esource-tour-root--gotit' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Guided tour"
    >
      {hole ? (
        <>
          {/* Dim everything except the spotlight so the explained UI keeps original color */}
          <div className="esource-tour-blocker" style={{ top: 0, left: 0, right: 0, height: hole.top }} />
          <div className="esource-tour-blocker" style={{ top: hole.bottom, left: 0, right: 0, bottom: 0 }} />
          <div className="esource-tour-blocker" style={{ top: hole.top, left: 0, width: hole.left, height: hole.height }} />
          <div className="esource-tour-blocker" style={{ top: hole.top, left: hole.right, right: 0, height: hole.height }} />
          {/* Info steps: clear hole (full color) but block clicks on the target */}
          {isGotIt ? (
            <div
              className="esource-tour-blocker esource-tour-blocker--clear"
              style={{
                top: hole.top,
                left: hole.left,
                width: hole.width,
                height: hole.height,
              }}
            />
          ) : null}
          {/*
            Tap steps: proxy hit-area above the overlay. Bottom-nav lives in a lower
            stacking context (z-index 35), so click-through alone often fails —
            especially for the scan card chevron.
          */}
          {isTap ? (
            <button
              type="button"
              className="esource-tour-hole-hit"
              aria-label={step.title || 'Tap highlighted control'}
              style={{
                top: hole.top,
                left: hole.left,
                width: hole.width,
                height: hole.height,
              }}
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                let el = null
                try {
                  el = document.querySelector(step.target)
                } catch {
                  el = null
                }
                if (!el) return
                // Prefer the exact control (toggle/camera/nav), then fall back to click().
                if (typeof el.focus === 'function') {
                  try {
                    el.focus({ preventScroll: true })
                  } catch {
                    // ignore
                  }
                }
                el.dispatchEvent(
                  new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
                )
              }}
            />
          ) : null}
        </>
      ) : (
        <div className="esource-tour-blocker esource-tour-blocker--full" />
      )}

      {spotlightStyle ? (
        <div
          className={[
            'esource-tour-spotlight-ring',
            isTap ? 'esource-tour-spotlight-ring--tap' : '',
            isWait ? 'esource-tour-spotlight-ring--wait' : '',
            isGotIt ? 'esource-tour-spotlight-ring--info' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={spotlightStyle}
        >
          {isTap ? (
            <>
              <span className="esource-tour-pulse" aria-hidden />
              <span className="esource-tour-pulse esource-tour-pulse--delay" aria-hidden />
              <span className="esource-tour-tap-cue" aria-hidden>
                <svg viewBox="0 0 48 48" width="36" height="36" focusable="false">
                  <circle cx="18" cy="14" r="5.5" fill="currentColor" opacity="0.95" />
                  <path
                    d="M22 18c1.2-1.4 3.2-1.5 4.5-.3l7.2 7.1c.7.7.8 1.8.2 2.6-.6.8-1.7 1-2.5.4l-3.6-2.8v12.2c0 1.1-.9 2-2 2s-2-.9-2-2V22.4l-1.2.9c-.9.7-2.2.5-2.8-.4-.6-.9-.4-2.1.4-2.8L22 18z"
                    fill="currentColor"
                  />
                </svg>
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      <div
        ref={setTooltipEl}
        className={`esource-tour-tooltip${passthroughTooltip ? ' esource-tour-tooltip--passthrough' : ''}`}
        style={{ top: tooltipPos.top, left: tooltipPos.left }}
      >
        <div className="esource-tour-tooltip-kicker">Site user guide</div>
        <h3 className="esource-tour-tooltip-title">{step.title}</h3>
        <p className="esource-tour-tooltip-body">{step.content}</p>
        <p className={`esource-tour-tooltip-hint${isTap ? ' esource-tour-tooltip-hint--tap' : ''}`}>{hint}</p>
        <div className="esource-tour-tooltip-footer">
          <span className="esource-tour-progress">
            {stepIndex + 1} / {total}
          </span>
          <div className="esource-tour-actions">
            <button type="button" className="esource-tour-btn esource-tour-btn-ghost" onClick={onSkip}>
              Skip
            </button>
            {isGotIt ? (
              <button type="button" className="esource-tour-btn esource-tour-btn-primary" onClick={onAcknowledge}>
                {stepIndex >= total - 1 ? 'Done' : 'Got it'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
