import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  formatApkSize,
  formatApkTimestamp,
  getApkInfo,
} from "../api/apkApi.js";

/** Public page — no login required to download the published APK. */
export default function ApkDownloadPage() {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getApkInfo();
        if (!cancelled) setInfo(data);
      } catch (err) {
        if (!cancelled) {
          setError(err?.response?.data?.message || err?.message || "Could not load APK info.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="apk-download-page">
      <div className="apk-download-card">
        <h1 className="apk-download-title">eSource Android App</h1>
        <p className="apk-download-subtitle">Download the latest published APK. No login required.</p>

        {loading ? (
          <p style={{ color: "#64748b" }}>Loading…</p>
        ) : error ? (
          <p style={{ color: "var(--red, #b91c1c)" }}>{error}</p>
        ) : info?.exists ? (
          <>
            <dl className="apk-download-meta">
              <div>
                <dt>File</dt>
                <dd>{info.fileName}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{formatApkSize(info.sizeBytes)}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatApkTimestamp(info.lastModifiedUtc)}</dd>
              </div>
            </dl>
            <a
              className="btn btn--primary apk-download-cta"
              href={info.downloadUrl}
              download={info.fileName || "eSource.apk"}
            >
              Download APK
            </a>
          </>
        ) : (
          <p style={{ color: "#64748b" }}>No APK has been published yet. Ask an administrator to upload one.</p>
        )}

        <p className="apk-download-footer">
          <Link to="/login">Sign in</Link>
          {" · "}
          <Link to="/admin/apk">Admin upload</Link>
        </p>
      </div>
    </div>
  );
}
