const STORAGE_KEY = 'esource_mobile_app_tutorial_v2'

const DEFAULT_STATE = {
  /** True after first authenticated session has been recorded. */
  firstLoginSeen: false,
  /** True after the full site-user interactive tour is finished or declined. */
  tourCompleted: false,
  /** True after user answered the first-login Start/Cancel offer. */
  offerResponded: false,
  lastStartedAt: null,
  completedAt: null,
  offeredAt: null,
}

function safeParse(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function normalize(state) {
  const src = state && typeof state === 'object' ? state : {}
  return {
    firstLoginSeen: Boolean(src.firstLoginSeen),
    tourCompleted: Boolean(src.tourCompleted),
    offerResponded: Boolean(src.offerResponded),
    lastStartedAt: src.lastStartedAt ? String(src.lastStartedAt) : null,
    completedAt: src.completedAt ? String(src.completedAt) : null,
    offeredAt: src.offeredAt ? String(src.offeredAt) : null,
  }
}

export function readTutorialState() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_STATE }
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_STATE }
    return normalize(safeParse(raw) || DEFAULT_STATE)
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export function writeTutorialState(next) {
  const normalized = normalize(next)
  if (typeof window === 'undefined' || !window.localStorage) return normalized
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    // ignore quota / private mode
  }
  return normalized
}

/** Record first login (does not count as answering the tour offer). */
export function ensureFirstLoginState() {
  const current = readTutorialState()
  if (current.firstLoginSeen) return current
  const now = new Date().toISOString()
  return writeTutorialState({
    ...current,
    firstLoginSeen: true,
    offeredAt: current.offeredAt || now,
  })
}

/** True when this device should show the first-login Start/Cancel offer. */
export function shouldOfferTour() {
  const state = readTutorialState()
  return !state.tourCompleted && !state.offerResponded
}

/** @deprecated use shouldOfferTour — kept for older imports */
export function shouldAutoStartTour() {
  return shouldOfferTour()
}

export function markTourOfferResponded() {
  return writeTutorialState({
    ...readTutorialState(),
    firstLoginSeen: true,
    offerResponded: true,
    offeredAt: readTutorialState().offeredAt || new Date().toISOString(),
  })
}

/** User cancelled the first-login offer — do not ask again. */
export function markTourDeclined() {
  const now = new Date().toISOString()
  return writeTutorialState({
    ...readTutorialState(),
    firstLoginSeen: true,
    offerResponded: true,
    tourCompleted: true,
    completedAt: now,
    offeredAt: readTutorialState().offeredAt || now,
  })
}

export function markTourStarted() {
  return writeTutorialState({
    ...readTutorialState(),
    firstLoginSeen: true,
    offerResponded: true,
    lastStartedAt: new Date().toISOString(),
  })
}

export function markTourCompleted() {
  const now = new Date().toISOString()
  return writeTutorialState({
    ...readTutorialState(),
    firstLoginSeen: true,
    offerResponded: true,
    tourCompleted: true,
    completedAt: now,
  })
}

/** @deprecated per-route completion replaced by full tourCompleted */
export function markRouteCompleted() {
  return markTourCompleted()
}

export function isRouteCompleted() {
  return readTutorialState().tourCompleted
}

export function clearTutorialState() {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }
  return { ...DEFAULT_STATE }
}

export { STORAGE_KEY, DEFAULT_STATE }
