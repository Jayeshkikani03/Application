import { useRef, useState } from "react";

function isPdfFile(file) {
  return Boolean(file) && (
    file.type === "application/pdf"
    || String(file.name || "").toLowerCase().endsWith(".pdf")
  );
}

export function PdfImportPanel({
  uploading = false,
  parsing = false,
  cancelling = false,
  stageLabel = "",
  auditLoading = false,
  onRequestProceed,
  onOpenAudit,
  onCancelRequest,
}) {
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadError, setUploadError] = useState("");

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    if (file) setUploadError("");
  };

  const handleUploadClick = () => {
    const file = selectedFile || fileInputRef.current?.files?.[0];
    if (!file) {
      setUploadError("Please select a protocol PDF.");
      return;
    }
    if (!isPdfFile(file)) {
      setUploadError("Please upload a valid PDF document.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setUploadError("File is too large. Maximum size is 20 MB.");
      return;
    }

    setUploadError("");
    onRequestProceed?.(file);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <section className="card activity-config-ai-panel">
      <div className="activity-config-ai-panel__upload">
        <label className="field activity-config-ai-panel__file-field">
          <span>Protocol PDF <span className="field__required">*</span></span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="activity-config-ai-panel__file-input"
            onChange={handleFileChange}
            disabled={uploading || parsing || cancelling}
          />
        </label>
        <div className="activity-config-ai-panel__upload-actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleUploadClick}
            disabled={uploading || parsing || cancelling}
          >
            {uploading ? "Uploading..." : "Upload PDF"}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onOpenAudit}
            disabled={auditLoading || cancelling}
          >
            {auditLoading ? "Loading..." : "Audit"}
          </button>
          {uploading || parsing ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onCancelRequest}
              disabled={cancelling || typeof onCancelRequest !== "function"}
            >
              {cancelling ? "Cancelling..." : "Cancel request"}
            </button>
          ) : null}
        </div>
        {uploadError ? (
          <p className="activity-config-ai-panel__error" role="alert">{uploadError}</p>
        ) : null}
        {(uploading || parsing) ? (
          <p className="activity-config-ai-panel__hint">
            <i className="fas fa-spinner fa-spin" aria-hidden="true" />{" "}
            {cancelling
              ? "Cancelling request..."
              : (stageLabel || (uploading ? "Uploading PDF..." : "Working..."))}
          </p>
        ) : null}
      </div>
    </section>
  );
}
