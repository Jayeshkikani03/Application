import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useViewport } from '../../hooks/useViewport'
import { usePermissions } from '../../context/PermissionContext'
import { isSiteUserProfile } from '../../constants/profileCodes'
import {
  ensureFirstLoginState,
  markTourCompleted,
  markTourDeclined,
  markTourStarted,
  readTutorialState,
  shouldOfferTour,
} from './tutorialStorage.js'
import { getSiteUserTourSteps, isSiteUserTourRoute } from './tutorialRegistry.js'
import { TUTORIAL_ENABLED } from './tutorialConfig.js'
import { TourOverlay } from './TourOverlay.jsx'
import { TourOfferDialog } from './TourOfferDialog.jsx'
import { FloatingTourButton } from './FloatingTourButton.jsx'
import './tutorial.css'

const TutorialContext = createContext(null)

export function TutorialProvider({ children, enabled = TUTORIAL_ENABLED }) {
  const location = useLocation()
  const { isMobileOrTablet } = useViewport()
  const { profileCode, loading: permissionsLoading } = usePermissions()
  const [storageState, setStorageState] = useState(() => readTutorialState())
  const [running, setRunning] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [steps, setSteps] = useState([])
  const [offerOpen, setOfferOpen] = useState(false)
  const runningRef = useRef(false)
  const stepsRef = useRef([])
  const stepIndexRef = useRef(0)

  const isSiteUser = isSiteUserProfile(profileCode)
  const onSiteRoute = isSiteUserTourRoute(location.pathname)
  // Site user + mobile/tablet + Activity/Centrifuge/Aliquot/Queries/Bag only.
  const active = Boolean(
    enabled && isMobileOrTablet && !permissionsLoading && isSiteUser && onSiteRoute,
  )

  useEffect(() => {
    runningRef.current = running
  }, [running])
  useEffect(() => {
    stepsRef.current = steps
  }, [steps])
  useEffect(() => {
    stepIndexRef.current = stepIndex
  }, [stepIndex])

  useEffect(() => {
    if (!active) return
    setStorageState(ensureFirstLoginState())
  }, [active])

  useEffect(() => {
    if (!active) {
      setRunning(false)
      setOfferOpen(false)
      setStepIndex(0)
      setSteps([])
    }
  }, [active])

  const stopTour = useCallback(({ completed = false } = {}) => {
    if (completed) {
      setStorageState(markTourCompleted())
    }
    setRunning(false)
    setStepIndex(0)
    setSteps([])
  }, [])

  const advance = useCallback(() => {
    const list = stepsRef.current
    let idx = stepIndexRef.current
    if (!list.length) return

    const landAt = (next) => {
      if (next >= list.length) {
        stopTour({ completed: true })
        return
      }
      setStepIndex(next)
    }

    const next = idx + 1
    if (next >= list.length) {
      stopTour({ completed: true })
      return
    }

    const step = list[next]
    const exists = () => {
      try {
        return Boolean(document.querySelector(step.target))
      } catch {
        return false
      }
    }

    if (exists() || step.mode === 'wait' || step.optional) {
      landAt(next)
      return
    }

    let tries = 0
    const timer = window.setInterval(() => {
      tries += 1
      if (exists() || tries >= 20) {
        window.clearInterval(timer)
        if (runningRef.current) landAt(next)
      }
    }, 100)
  }, [stopTour])

  const startTour = useCallback(
    ({ force = false } = {}) => {
      if (!active) return false
      void force
      const usable = getSiteUserTourSteps({ filterMissing: false })
      if (!usable.length) return false
      setOfferOpen(false)
      setStorageState(markTourStarted())
      setSteps(usable)
      let startIdx = 0
      for (let i = 0; i < usable.length; i += 1) {
        try {
          if (document.querySelector(usable[i].target)) {
            startIdx = i
            break
          }
        } catch {
          // continue
        }
      }
      setStepIndex(startIdx)
      setRunning(true)
      return true
    },
    [active],
  )

  // First login: show Start/Cancel offer.
  // Do not use a "shown" ref — React StrictMode cleans up the timeout and would
  // permanently block the dialog if a ref stayed true after cleanup.
  useEffect(() => {
    if (!active || running || offerOpen) return undefined
    if (!shouldOfferTour()) return undefined
    const show = window.setTimeout(() => {
      if (shouldOfferTour()) setOfferOpen(true)
    }, 400)
    return () => window.clearTimeout(show)
  }, [active, running, offerOpen, storageState.tourCompleted, storageState.offerResponded])

  useEffect(() => {
    if (!running) return undefined
    let advancing = false

    const isHitOnTarget = (event, targetEl) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : []
      if (path.includes(targetEl) || (event.target instanceof Node && targetEl.contains(event.target))) {
        return true
      }
      // Hole-hit proxy sits above the real control — treat it as a valid tap.
      return Boolean(event.target instanceof Element && event.target.closest?.('.esource-tour-hole-hit'))
    }

    const maybeAdvance = (event) => {
      const list = stepsRef.current
      const idx = stepIndexRef.current
      const step = list[idx]
      if (!step || step.mode !== 'tap') return
      let targetEl = null
      try {
        targetEl = document.querySelector(step.target)
      } catch {
        return
      }
      if (!targetEl || !isHitOnTarget(event, targetEl)) return
      if (advancing) return
      advancing = true
      window.setTimeout(() => {
        if (runningRef.current) advance()
        advancing = false
      }, 120)
    }

    document.addEventListener('pointerdown', maybeAdvance, true)
    document.addEventListener('click', maybeAdvance, true)
    return () => {
      document.removeEventListener('pointerdown', maybeAdvance, true)
      document.removeEventListener('click', maybeAdvance, true)
    }
  }, [running, advance])

  useEffect(() => {
    if (!running) return undefined
    const step = steps[stepIndex]
    if (!step || step.mode !== 'wait') return undefined

    const selector = step.waitFor || step.target
    let done = false
    const check = () => {
      if (done) return true
      try {
        if (document.querySelector(selector)) {
          done = true
          advance()
          return true
        }
      } catch {
        // ignore
      }
      return false
    }

    if (check()) return undefined

    const timer = window.setInterval(check, 250)
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      done = true
      window.clearInterval(timer)
      observer.disconnect()
    }
  }, [running, steps, stepIndex, advance])

  useEffect(() => {
    if (!running) return
    const step = steps[stepIndex]
    if (!step) return
    if (typeof document === 'undefined') return
    if (step.mode === 'wait') return
    try {
      if (document.querySelector(step.target)) return
    } catch {
      return
    }
    const nextIdx = steps.findIndex((s, i) => {
      if (i <= stepIndex) return false
      try {
        return Boolean(document.querySelector(s.target))
      } catch {
        return false
      }
    })
    if (nextIdx >= 0) setStepIndex(nextIdx)
  }, [location.pathname, running, steps, stepIndex])

  const handleAcknowledge = useCallback(() => {
    advance()
  }, [advance])

  const handleSkip = useCallback(() => {
    stopTour({ completed: true })
  }, [stopTour])

  const handleOfferStart = useCallback(() => {
    setOfferOpen(false)
    startTour({ force: true })
  }, [startTour])

  const handleOfferCancel = useCallback(() => {
    setOfferOpen(false)
    setStorageState(markTourDeclined())
  }, [])

  const showFab = Boolean(active && !running && !offerOpen && storageState.offerResponded)

  const value = useMemo(
    () => ({
      active,
      running,
      steps,
      stepIndex,
      offerOpen,
      startTour,
      stopTour,
      storageState,
      tourCompleted: Boolean(storageState.tourCompleted),
    }),
    [active, running, steps, stepIndex, offerOpen, startTour, stopTour, storageState],
  )

  return (
    <TutorialContext.Provider value={value}>
      {children}
      {active ? (
        <>
          <TourOfferDialog open={offerOpen} onStart={handleOfferStart} onCancel={handleOfferCancel} />
          <FloatingTourButton
            visible={showFab}
            running={running}
            showPulse={false}
            onStart={() => startTour({ force: true })}
          />
          <TourOverlay
            steps={steps}
            stepIndex={stepIndex}
            running={running}
            onAcknowledge={handleAcknowledge}
            onSkip={handleSkip}
          />
        </>
      ) : null}
    </TutorialContext.Provider>
  )
}

export function useTutorial() {
  const ctx = useContext(TutorialContext)
  if (!ctx) {
    throw new Error('useTutorial must be used within TutorialProvider')
  }
  return ctx
}
