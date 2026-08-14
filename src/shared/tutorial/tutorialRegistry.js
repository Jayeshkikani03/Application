/**
 * Site-user guided tour — Activity page flow first.
 * Only for site users (profile 003) on mobile/tablet, on:
 * Activity, Centrifuge, Aliquot, Queries, Bag Preparation.
 *
 * Modes:
 * - tap: user must click the highlighted control
 * - gotit: info step — Got it button continues
 * - wait: auto-continues when the target appears (e.g. after participant selected)
 */

/** @typedef {{
 *  id: string,
 *  target: string,
 *  title: string,
 *  content: string,
 *  mode: 'tap' | 'gotit' | 'wait',
 *  route?: string,
 *  placement?: 'top'|'bottom'|'left'|'right'|'auto'
 * }} TourStep */

export const SITE_USER_TOUR_STEPS = /** @type {TourStep[]} */ ([
  {
    id: 'nav-activity',
    target: '[data-tour="nav-execute"]',
    title: 'Open Activity',
    content: 'Tap Activity on the bottom bar to open your main site workflow.',
    mode: 'tap',
    route: '/execute',
    placement: 'top',
  },
  {
    id: 'kpi-cards',
    target: '[data-tour="exec-kpi-cards"]',
    title: 'Work counts',
    content: 'These cards show Pending Blood, Centrifuge, Aliquot, Open Queries, and Pending Bags counts.',
    mode: 'gotit',
    route: '/execute',
    placement: 'bottom',
  },
  {
    id: 'camera',
    target: '[data-tour="scan-camera"]',
    title: 'Camera button',
    content: 'This top camera icon is for barcode scanning with the device camera. You do not need to tap it now.',
    mode: 'gotit',
    route: '/execute',
    placement: 'top',
  },
  {
    id: 'scan-toggle',
    target: '[data-tour="scan-toggle"]',
    title: 'Open the scan card',
    content: 'Now tap only the small arrow under the camera — not the camera icon — to open the participant card.',
    mode: 'tap',
    route: '/execute',
    placement: 'top',
  },
  {
    id: 'scan-mode-info',
    target: '[data-tour="mode-scan"], [data-tour="scan-zone"], [data-tour="subject-mode"]',
    title: 'Scan mode',
    content: 'Scan mode is for entering or scanning a participant barcode to start their session.',
    mode: 'gotit',
    route: '/execute',
    placement: 'top',
  },
  {
    id: 'switch-manual',
    target: '[data-tour="mode-manual"]',
    title: 'Switch to Manual',
    content: 'Tap Manual to pick a participant from the list instead of scanning a barcode.',
    mode: 'tap',
    route: '/execute',
    placement: 'top',
  },
  {
    id: 'participant-entry',
    target: '[data-tour="manual-subject-select"]',
    title: 'Select a participant',
    content: 'Open the list and select a participant. The guide continues after the session loads.',
    mode: 'wait',
    route: '/execute',
    placement: 'top',
    waitFor: '[data-tour="exec-session-tabs"]',
  },
  {
    id: 'session-tabs',
    target: '[data-tour="exec-session-tabs"]',
    title: 'Sample Collection tabs',
    content: 'Use Sample Collection for the next timepoint, and Centrifuge & Aliquot for pending sample processing.',
    mode: 'gotit',
    route: '/execute',
    placement: 'bottom',
  },
  {
    id: 'timepoint-card',
    target: '[data-tour="timepoint-card"]',
    title: 'Timepoint card',
    content: 'This card is the current timepoint (for example Pre Dose). It shows barcode, window, and remaining time.',
    mode: 'gotit',
    route: '/execute',
    placement: 'bottom',
  },
  {
    id: 'show-all-activities',
    target: '[data-tour="show-all-activities"]',
    title: 'Show All Activities',
    content: 'Tap Show All Activities to open the full activity list for this participant.',
    mode: 'tap',
    route: '/execute',
    placement: 'top',
  },
  {
    id: 'export-pdf',
    target: '[data-tour="export-pdf"]',
    title: 'Export PDF',
    content: 'Use Export PDF later to download activity compliance. No need to click it now.',
    mode: 'gotit',
    route: '/execute',
    placement: 'screenBottom',
  },
  {
    id: 'dose-filter',
    target: '[data-tour="dose-filter"]',
    title: 'Dose selection',
    content: 'Use these dose buttons to filter activities by dose (for example Dose 1).',
    mode: 'gotit',
    route: '/execute',
    placement: 'bottom',
  },
  {
    id: 'timepoint-filter',
    target: '[data-tour="timepoint-filter"]',
    title: 'Timepoint selection',
    content: 'Filter by a specific timepoint, or choose All Timepoints.',
    mode: 'gotit',
    route: '/execute',
    placement: 'bottom',
  },
  {
    id: 'skip-and-status',
    target: '[data-tour="timepoint-skip"], [data-tour="grid-skip"], [data-tour="timepoint-status"], [data-tour="activity-grid"]',
    title: 'Skip and status',
    content: 'Skip can be used when a timepoint is not done. Status shows barcode, window, and remaining for the timepoint.',
    mode: 'gotit',
    route: '/execute',
    placement: 'top',
  },
  {
    id: 'goto-centrifuge',
    target: '[data-tour="nav-centrifugation"]',
    title: 'Next: Centrifuge',
    content: 'Activity guide is done. Tap Centrifuge on the bottom bar — Centrifuge steps will be added next.',
    mode: 'tap',
    route: '/centrifugation',
    placement: 'top',
  },
])

export const SITE_USER_ROUTES = [
  '/execute',
  '/centrifugation',
  '/aliquots',
  '/bag-preparation',
  '/queries',
]

export function normalizeTourPath(pathname) {
  const raw = String(pathname || '').split('?')[0].split('#')[0].trim()
  if (!raw || raw === '/') return '/execute'
  return raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw
}

export function isSiteUserTourRoute(pathname) {
  return SITE_USER_ROUTES.includes(normalizeTourPath(pathname))
}

function targetExists(selector) {
  if (typeof document === 'undefined' || !selector) return false
  try {
    // Support comma-separated fallbacks
    return Boolean(document.querySelector(selector))
  } catch {
    return false
  }
}

export function getSiteUserTourSteps(options = {}) {
  const { filterMissing = false } = options
  if (!filterMissing) return [...SITE_USER_TOUR_STEPS]
  return SITE_USER_TOUR_STEPS.filter((step) => targetExists(step.target) || targetExists(step.waitFor))
}

export function getTourStepsForPath(pathname, options = {}) {
  void pathname
  return getSiteUserTourSteps(options)
}

export function resolveTourRouteKey(pathname) {
  return normalizeTourPath(pathname)
}

export function getRegisteredTourRoutes() {
  return [...SITE_USER_ROUTES]
}

export { targetExists }
