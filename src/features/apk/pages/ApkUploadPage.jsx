import { useCallback, useEffect, useRef, useState } from "react";
import { AdminButton } from "@/components/shared/AdminButton";
import { SoftAlertToast } from "@/components/shared/SoftAlertToast";
import { useRoutePermission } from "@/context/PermissionContext.jsx";
import {
  formatApkSize,
  getApkInfo,
  uploadApk,
} from "../api/apkApi.js";

export default function ApkUploadPage() {
  const fileInputRef = useRef(null);
  const { canAddEdit, loading: rightsLoading } = useRoutePermission("/admin/apk");

  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);

  const showToast = (message, variant = "success") => setToast({ message, variant });

  const loadInfo = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getApkInfo();
      setInfo(data);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Failed to load APK info.";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  const canUpload = !rightsLoading && canAddEdit;
  const busy = uploading;
  const hasApk = Boolean(info?.exists);

  const handleUploadClick = () => {
    if (!canUpload || busy) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0] ?? null;
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;

    if (!String(file.name || "").toLowerCase().endsWith(".apk")) {
      showToast("Only .apk files are allowed.", "error");
      return;
    }

    try {
      setUploading(true);
      const result = await uploadApk(file);
      setInfo(result);
      showToast(hasApk ? "APK replaced." : "APK uploaded.");
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Failed to upload APK.";
      showToast(msg, "error");
    } finally {
      setUploading(false);
    }
  };

  const handleCopyLink = async () => {
    const url = info?.downloadUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Download link copied.");
    } catch {
      showToast("Could not copy link.", "error");
    }
  };

  if (loading && !info) {
    return (
      <div className="admin-wrap admin-wrap--apk">
        <div className="admin-card admin-spinner">
          <i className="fas fa-spinner fa-spin" style={{ marginRight: "0.5rem" }} /> Loading APK distribution…
        </div>
      </div>
    );
  }

  if (error && !info) {
    return (
      <div className="admin-wrap admin-wrap--apk">
        <div className="admin-card admin-error-card">
          <div className="admin-error-title">Failed to Load Data</div>
          <div className="admin-error-msg">{error}</div>
          <AdminButton variant="primary" style={{ marginTop: "1rem" }} onClick={loadInfo}>
            Retry Connection
          </AdminButton>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-wrap admin-wrap--apk">
      <SoftAlertToast
        title={toast?.variant === "error" ? "Error" : "Success"}
        message={toast?.message}
        variant={toast?.variant ?? "success"}
        onClose={() => setToast(null)}
      />

      <div className="admin-card admin-card--config-form">
        <h1 className="apk-admin-title">APK Distribution</h1>

        <input
          id="apk-upload-input"
          ref={fileInputRef}
          type="file"
          accept=".apk,application/vnd.android.package-archive"
          style={{ display: "none" }}
          disabled={busy || !canUpload}
          onChange={handleFileChange}
        />

        <div className="apk-admin-toolbar">
          <div className="apk-admin-toolbar__field apk-admin-toolbar__field--name">
            <label className="admin-label" htmlFor="apk-name-display">Name</label>
            <div id="apk-name-display" className="admin-input apk-admin-toolbar__value">
              {hasApk ? info.fileName : "—"}
            </div>
          </div>

          <div className="apk-admin-toolbar__field apk-admin-toolbar__field--size">
            <label className="admin-label" htmlFor="apk-size-display">Size</label>
            <div id="apk-size-display" className="admin-input apk-admin-toolbar__value">
              {hasApk ? formatApkSize(info.sizeBytes) : "—"}
            </div>
          </div>

          <div className="apk-admin-toolbar__actions">
            <AdminButton
              type="button"
              variant="secondary"
              onClick={handleCopyLink}
              disabled={busy || !hasApk}
            >
              Copy link
            </AdminButton>
            {hasApk ? (
              <a
                className={`btn btn--primary${busy ? " is-disabled" : ""}`}
                href={info.downloadUrl}
                download={info.fileName || "eSource.apk"}
                aria-disabled={busy}
                onClick={(e) => {
                  if (busy) e.preventDefault();
                }}
              >
                Download
              </a>
            ) : (
              <AdminButton type="button" variant="primary" disabled>
                Download
              </AdminButton>
            )}
            {canUpload ? (
              <AdminButton
                type="button"
                variant="primary"
                onClick={handleUploadClick}
                disabled={busy}
                title={hasApk ? "Replace the published APK" : "Upload APK"}
              >
                {uploading ? "Uploading…" : "Upload"}
              </AdminButton>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
