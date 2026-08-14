import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const ScanNavContext = createContext(null);

/**
 * Lets page-level scan UIs register with the mobile/tablet bottom-nav chrome:
 * camera icon opens the scanner; arrow expands/collapses the scan card.
 */
export function ScanNavProvider({ children }) {
  const handlersRef = useRef(null);
  const [available, setAvailable] = useState(false);
  const [cardOpen, setCardOpenState] = useState(false);

  const setCardOpen = useCallback((open) => {
    setCardOpenState((prev) => {
      const next = typeof open === "function" ? open(prev) : !!open;
      handlersRef.current?.onCardOpenChange?.(next);
      return next;
    });
  }, []);

  const register = useCallback((handlers) => {
    const wasEmpty = handlersRef.current == null;
    handlersRef.current = handlers;
    setAvailable(true);
    // Only collapse when a page first claims the chrome — not on re-register
    // (re-register used to run whenever cardOpen changed and immediately closed the card).
    if (wasEmpty) setCardOpenState(false);
    return () => {
      if (handlersRef.current === handlers) {
        handlersRef.current = null;
        setAvailable(false);
        setCardOpenState(false);
      }
    };
  }, []);

  const openCamera = useCallback(() => {
    handlersRef.current?.openCamera?.();
  }, []);

  const toggleCard = useCallback(() => {
    setCardOpenState((prev) => {
      const next = !prev;
      handlersRef.current?.onCardOpenChange?.(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      available,
      cardOpen,
      setCardOpen,
      toggleCard,
      openCamera,
      register,
    }),
    [available, cardOpen, setCardOpen, toggleCard, openCamera, register]
  );

  return <ScanNavContext.Provider value={value}>{children}</ScanNavContext.Provider>;
}

export function useScanNav() {
  return useContext(ScanNavContext);
}

/**
 * Register camera + card chrome for the current page scan UI (mobile/tablet only).
 * Returns whether the scan card panel should be visible.
 */
export function useScanNavRegistration({ openCamera, enabled = true, onCardOpenChange } = {}) {
  const scanNav = useScanNav();
  const register = scanNav?.register;
  const openCameraRef = useRef(openCamera);
  const onCardOpenChangeRef = useRef(onCardOpenChange);

  useEffect(() => {
    openCameraRef.current = openCamera;
  }, [openCamera]);

  useEffect(() => {
    onCardOpenChangeRef.current = onCardOpenChange;
  }, [onCardOpenChange]);

  useEffect(() => {
    if (!register || !enabled) return undefined;
    const handlers = {
      openCamera: () => openCameraRef.current?.(),
      onCardOpenChange: (open) => onCardOpenChangeRef.current?.(open),
    };
    return register(handlers);
  }, [register, enabled]);

  return {
    available: Boolean(scanNav?.available && enabled),
    cardOpen: scanNav?.cardOpen ?? false,
    setCardOpen: scanNav?.setCardOpen,
    toggleCard: scanNav?.toggleCard,
  };
}
