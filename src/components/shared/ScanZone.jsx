import { useState } from "react";
import { createPortal } from "react-dom";
import { useLab } from "../../context/LabContext";
import { useScanNavRegistration } from "../../context/ScanNavContext";
import { useViewport } from "../../hooks/useViewport";
import { getExpectedScanInstruction } from "../../services/workflowService";
import { BarcodeCameraModal } from "./BarcodeCameraModal";

function ScanIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M6 12V6h6M28 6h6v6M34 28v6h-6M12 34H6v-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 20h24M11 15h4M18 15h3M24 15h5M11 25h7M21 25h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ScanZone({
  placeholder = "Scan or type barcode...",
  onScan,
  showFeedback = true,
  showManualToggle = false,
  manualToggleVariant = "button",
  manualEntry = false,
  onManualToggle,
  hideHeader = false,
  noCard = false,
  layout = "default",
  variant = "default",
  phase,
  instruction,
  areaTitle = "SCAN BARCODE",
  /** When false, this instance does not claim the bottom-nav scan chrome (e.g. nested duplicate). */
  registerNavChrome = true,
}) {
  const { state, scan } = useLab();
  const { isMobileOrTablet } = useViewport();
  const [value, setValue] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);

  const submitCode = (code) => {
    if (!code) return;
    if (onScan) onScan(code);
    else scan(code);
    setValue("");
  };

  const handleSubmit = () => {
    const code = value.trim();
    if (!code) {
      setCameraOpen(true);
      return;
    }
    submitCode(code);
  };

  const navEnabled = registerNavChrome && isMobileOrTablet;
  const { cardOpen } = useScanNavRegistration({
    enabled: navEnabled,
    openCamera: () => {
      const code = value.trim();
      if (code) {
        submitCode(code);
        return;
      }
      setCameraOpen(true);
    },
  });

  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.code === "NumpadEnter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    handleSubmit();
  };

  const isError =
    state.lastScanMessage?.includes("Unknown") ||
    state.lastScanMessage?.includes("not ready") ||
    state.lastScanMessage?.includes("before") ||
    state.lastScanMessage?.includes("Invalid");
  const isWarning =
    !isError &&
    (state.lastScanMessage?.startsWith("Wrong") ||
      state.lastScanMessage?.includes("does not belong") ||
      state.lastScanMessage?.includes("Scan one of"));
  const displayPhase = phase !== undefined ? phase : (state.scanPhase === "PK Collection" ? "Scan Barcode" : state.scanPhase);
  const scanInstruction = instruction !== undefined ? instruction : (hideHeader ? "" : getExpectedScanInstruction(state));
  const isExecutionVariant = variant === "execution";
  const areaClass = layout === "session" || isExecutionVariant ? "scan-area--session" : "";
  const collapsed = navEnabled && !cardOpen;
  const hideScanButton = navEnabled;

  return (
    <section
      className={`scan-zone scan-zone--guided ${noCard ? "scan-zone--embedded" : "card"}${isExecutionVariant ? " scan-zone--execution" : ""}${collapsed ? " scan-zone--nav-collapsed" : ""}${hideScanButton ? " scan-zone--no-scan-btn" : ""}`}
      data-scan-card-open={navEnabled ? (cardOpen ? "true" : "false") : undefined}
      data-tour="scan-zone"
    >
      {typeof document !== "undefined"
        ? createPortal(
            <BarcodeCameraModal
              open={cameraOpen}
              onClose={() => setCameraOpen(false)}
              onDetected={(code) => {
                setCameraOpen(false);
                submitCode(code);
              }}
            />,
            document.body
          )
        : null}
      {!hideHeader && (
        <div className="scan-zone__header">
          <div>
            {!isExecutionVariant && <span className="section-label">Barcode Scan Workflow</span>}
            <div className="scan-zone__phase-row">
              <h2 className="scan-zone__phase">{displayPhase}</h2>
            </div>
          </div>
          <div className="scan-zone__header-actions">
            {showManualToggle && manualToggleVariant === "checkbox" && (
              <label className="scan-zone__manual-checkbox">
                <input
                  type="checkbox"
                  checked={manualEntry}
                  onChange={(event) => onManualToggle?.(event.target.checked)}
                />
                <span>Manual</span>
              </label>
            )}
            {showManualToggle && manualToggleVariant !== "checkbox" && (
              <button
                type="button"
                className={`btn btn--sm ${manualEntry ? "btn--primary" : "btn--secondary"}`}
                onClick={() => onManualToggle(!manualEntry)}
              >
                Manual
              </button>
            )}
          </div>
        </div>
      )}
      {scanInstruction ? <p className="scan-zone__instruction">{scanInstruction}</p> : null}
      <form
        className={`scan-area ${areaClass}${isExecutionVariant ? " scan-area--execution" : ""}${hideScanButton ? " scan-area--input-only" : ""}`}
        onSubmit={onSubmit}
      >
        {!hideHeader && !isExecutionVariant && <ScanIcon />}
        {!hideHeader && !isExecutionVariant && <p className="scan-area__title">{areaTitle}</p>}
        <input
          className="scan-area__input"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Barcode input"
        />
        {/* Mobile/tablet: Scan via Enter or nav camera icon. Desktop keeps the button. */}
        {!hideScanButton ? (
          <button type="submit" className="btn btn--primary scan-area__button">
            Scan
          </button>
        ) : (
          <button type="submit" className="scan-area__submit-hidden" tabIndex={-1} aria-hidden="true">
            Scan
          </button>
        )}
      </form>
      {showFeedback && state.lastScanMessage && (
        <div
          className={`scan-feedback ${isError ? "scan-feedback--error" : isWarning ? "scan-feedback--warning" : "scan-feedback--ok"}`}
        >
          {state.lastScanMessage}
        </div>
      )}
    </section>
  );
}

export { ScanZone };
