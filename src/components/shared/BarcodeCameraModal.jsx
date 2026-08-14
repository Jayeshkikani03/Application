import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Camera } from "@capacitor/camera";

const BARCODE_FORMATS = [
  "code_128",
  "code_39",
  "code_93",
  "codabar",
  "ean_13",
  "ean_8",
  "itf",
  "upc_a",
  "upc_e",
  "qr_code",
  "data_matrix",
];

async function ensureCameraPermission() {
  if (!Capacitor.isNativePlatform()) {
    return true;
  }

  const current = await Camera.checkPermissions();
  if (current.camera === "granted") {
    return true;
  }

  const requested = await Camera.requestPermissions({ permissions: ["camera"] });
  return requested.camera === "granted";
}

function getVideoConstraints() {
  if (Capacitor.isNativePlatform()) {
    return {
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    };
  }

  return {
    video: { facingMode: { ideal: "environment" } },
    audio: false,
  };
}

function pickBackCameraDeviceId(devices) {
  if (!devices?.length) return undefined;
  const backCamera = devices.find((device) =>
    /back|rear|environment|0/i.test(String(device.label ?? ""))
  );
  return (backCamera ?? devices[devices.length - 1] ?? devices[0])?.deviceId;
}

function BarcodeCameraModal({ open, title = "Scan Barcode", onClose, onDetected }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const controlsRef = useRef(null);
  const onDetectedRef = useRef(onDetected);
  const [message, setMessage] = useState("Point the camera at the barcode.");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    let frameId = null;

    const stopCamera = () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      controlsRef.current?.stop?.();
      controlsRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setTorchAvailable(false);
      setTorchOn(false);
    };

    const handleDetected = (code) => {
      const trimmed = code?.trim();
      if (!trimmed) return;
      cancelled = true;
      stopCamera();
      navigator.vibrate?.(50);
      onDetectedRef.current(trimmed);
    };

    const updateTorchSupport = () => {
      const track = streamRef.current?.getVideoTracks?.()[0];
      const capabilities = track?.getCapabilities?.();
      setTorchAvailable(!!capabilities?.torch);
    };

    async function startNativeScanner() {
      detectorRef.current = new window.BarcodeDetector({ formats: BARCODE_FORMATS });
      const stream = await navigator.mediaDevices.getUserMedia(getVideoConstraints());
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsinline", "true");
        videoRef.current.setAttribute("webkit-playsinline", "true");
        await videoRef.current.play();
      }
      updateTorchSupport();
      setMessage("Scanning...");

      const scanFrame = async () => {
        if (cancelled || !videoRef.current || !detectorRef.current) return;
        try {
          const barcodes = await detectorRef.current.detect(videoRef.current);
          const code = barcodes[0]?.rawValue;
          if (code) {
            handleDetected(code);
            return;
          }
        } catch {
          setMessage("Unable to read barcode yet. Hold steady and keep the barcode inside the frame.");
        }
        frameId = window.requestAnimationFrame(scanFrame);
      };
      frameId = window.requestAnimationFrame(scanFrame);
    }

    async function startZxingScanner() {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      const deviceId = pickBackCameraDeviceId(devices);

      setMessage("Scanning with camera...");
      controlsRef.current = await reader.decodeFromVideoDevice(
        deviceId,
        videoRef.current,
        (result, error) => {
          if (cancelled) return;
          if (result) {
            handleDetected(result.getText());
            return;
          }
          if (error && error.name !== "NotFoundException") {
            setMessage("Hold the barcode steady inside the frame.");
          }
        }
      );

      const stream = videoRef.current?.srcObject;
      if (stream instanceof MediaStream) {
        streamRef.current = stream;
        updateTorchSupport();
      } else if (deviceId) {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } },
          audio: false,
        });
        if (cancelled) {
          fallbackStream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = fallbackStream;
        if (videoRef.current) {
          videoRef.current.srcObject = fallbackStream;
          await videoRef.current.play();
        }
        updateTorchSupport();
      }
    }

    async function startCamera() {
      try {
        setMessage("Checking camera permission...");
        const allowed = await ensureCameraPermission();
        if (!allowed) {
          setMessage("Camera permission is required. Allow camera access in app settings, then try again.");
          return;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
          setMessage("Camera is not available on this device.");
          return;
        }

        setMessage("Point the camera at the barcode.");
        if ("BarcodeDetector" in window && !Capacitor.isNativePlatform()) {
          await startNativeScanner();
        } else {
          await startZxingScanner();
        }
      } catch (error) {
        console.error("Camera start failed:", error);
        setMessage("Camera could not start. Allow camera access or type the barcode manually.");
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open]);

  if (!open) return null;

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn((current) => !current);
    } catch {
      setMessage("Torch is not available on this device.");
    }
  };

  return (
    <div className="camera-modal-backdrop" role="presentation">
      <div className="camera-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="camera-modal__head">
          <h2 className="camera-modal__title">{title}</h2>
          <div className="camera-modal__actions">
            {torchAvailable ? (
              <button type="button" className="camera-modal__btn camera-modal__btn--secondary" onClick={toggleTorch}>
                {torchOn ? "Torch Off" : "Torch On"}
              </button>
            ) : null}
            <button type="button" className="camera-modal__btn camera-modal__btn--close" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="camera-modal__viewport">
          <video ref={videoRef} className="camera-modal__video" playsInline muted autoPlay />
          <div className="camera-modal__target" aria-hidden="true" />
        </div>
        <p className="camera-modal__message">{message}</p>
      </div>
    </div>
  );
}

export { BarcodeCameraModal };
