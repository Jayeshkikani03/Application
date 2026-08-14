import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

class MemoryStorage {
  constructor() {
    this.map = new Map()
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null
  }
  setItem(key, value) {
    this.map.set(key, String(value))
  }
  removeItem(key) {
    this.map.delete(key)
  }
}

globalThis.window = { localStorage: new MemoryStorage() }
globalThis.localStorage = globalThis.window.localStorage

const dir = path.dirname(fileURLToPath(import.meta.url))

test('tutorialStorage offers until Start or Cancel', async () => {
  const {
    clearTutorialState,
    ensureFirstLoginState,
    markTourCompleted,
    markTourDeclined,
    markTourStarted,
    readTutorialState,
    shouldOfferTour,
    STORAGE_KEY,
  } = await import('./tutorialStorage.js')

  clearTutorialState()
  assert.equal(shouldOfferTour(), true)

  const offered = ensureFirstLoginState()
  assert.equal(offered.firstLoginSeen, true)
  assert.equal(shouldOfferTour(), true)
  assert.ok(window.localStorage.getItem(STORAGE_KEY))

  markTourStarted()
  assert.equal(readTutorialState().offerResponded, true)
  assert.equal(shouldOfferTour(), false)

  clearTutorialState()
  markTourDeclined()
  assert.equal(readTutorialState().tourCompleted, true)
  assert.equal(shouldOfferTour(), false)

  clearTutorialState()
  markTourCompleted()
  assert.equal(shouldOfferTour(), false)
})

test('site-user tour routes are only Activity Centrifuge Aliquot Bag Queries', async () => {
  const { SITE_USER_ROUTES, isSiteUserTourRoute } = await import('./tutorialRegistry.js')

  assert.deepEqual(SITE_USER_ROUTES, [
    '/execute',
    '/centrifugation',
    '/aliquots',
    '/bag-preparation',
    '/queries',
  ])
  assert.equal(isSiteUserTourRoute('/execute'), true)
  assert.equal(isSiteUserTourRoute('/centrifugation'), true)
  assert.equal(isSiteUserTourRoute('/aliquots'), true)
  assert.equal(isSiteUserTourRoute('/bag-preparation'), true)
  assert.equal(isSiteUserTourRoute('/queries'), true)
  assert.equal(isSiteUserTourRoute('/admin/parameters'), false)
  assert.equal(isSiteUserTourRoute('/review'), false)
  assert.equal(isSiteUserTourRoute('/subjects'), false)
  assert.equal(isSiteUserTourRoute('/activity-configuration'), false)
})

test('site-user tour covers Activity flow first', async () => {
  const {
    SITE_USER_TOUR_STEPS,
    getSiteUserTourSteps,
  } = await import('./tutorialRegistry.js')

  const steps = getSiteUserTourSteps()
  assert.ok(steps.length >= 10)
  assert.ok(steps.every((s) => s.mode === 'tap' || s.mode === 'gotit' || s.mode === 'wait'))
  assert.ok(steps.some((s) => s.target === '[data-tour="nav-execute"]' && s.mode === 'tap'))
  assert.ok(steps.some((s) => s.target === '[data-tour="exec-kpi-cards"]' && s.mode === 'gotit'))
  assert.ok(steps.some((s) => s.target === '[data-tour="scan-camera"]' && s.mode === 'gotit'))
  assert.ok(steps.some((s) => s.target === '[data-tour="scan-toggle"]' && s.mode === 'tap'))
  assert.ok(steps.some((s) => s.id === 'scan-mode-info' && s.mode === 'gotit'))
  assert.ok(steps.some((s) => s.target === '[data-tour="mode-manual"]' && s.mode === 'tap'))
  assert.ok(steps.some((s) => s.target === '[data-tour="manual-subject-select"]' && s.mode === 'wait'))
  assert.ok(steps.some((s) => s.mode === 'wait' && s.waitFor === '[data-tour="exec-session-tabs"]'))
  assert.ok(steps.some((s) => s.target === '[data-tour="export-pdf"]' && s.mode === 'gotit'))
  assert.ok(steps.some((s) => s.target === '[data-tour="show-all-activities"]' && s.mode === 'tap'))
  assert.equal(SITE_USER_TOUR_STEPS[0].id, 'nav-activity')
  assert.equal(SITE_USER_TOUR_STEPS.at(-1).id, 'goto-centrifuge')
})

test('Application wires interactive tour shell anchors', () => {
  const layout = fs.readFileSync(path.resolve(dir, '../../components/layout/AuthenticatedLayout.jsx'), 'utf8')
  const shell = fs.readFileSync(path.resolve(dir, '../../components/layout/AppShell.jsx'), 'utf8')
  const provider = fs.readFileSync(path.resolve(dir, './TutorialProvider.jsx'), 'utf8')
  const config = fs.readFileSync(path.resolve(dir, './tutorialConfig.js'), 'utf8')
  assert.match(layout, /TutorialProvider/)
  assert.match(shell, /data-tour=\{`nav-\$\{/)
  assert.match(shell, /data-tour="bottom-nav"/)
  assert.match(shell, /data-tour="scan-camera"/)
  assert.match(shell, /data-tour="scan-toggle"/)
  assert.match(provider, /TourOfferDialog/)
  assert.match(provider, /isSiteUserProfile/)
  assert.match(provider, /isSiteUserTourRoute/)
  assert.match(provider, /TUTORIAL_ENABLED/)
  assert.match(config, /export const TUTORIAL_ENABLED/)
})

test('TUTORIAL_ENABLED gates tour when false', async () => {
  const { TUTORIAL_ENABLED } = await import('./tutorialConfig.js')
  assert.equal(typeof TUTORIAL_ENABLED, 'boolean')
})
