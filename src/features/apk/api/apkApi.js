import { api } from "@/shared/api/httpClient.js";
import { getApiBaseUrl } from "@/config/apiBaseUrl.js";

function normalizeApkInfo(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const publicPath = String(data.publicPath ?? data.PublicPath ?? "/apk/eSource.apk").trim() || "/apk/eSource.apk";
  const base = String(getApiBaseUrl() || "").replace(/\/+$/, "");
  // Prefer API download endpoint (forces Downloads folder via Content-Disposition).
  const apiDownloadPath = "/Apk/download";
  const downloadUrl =
    String(data.downloadUrl ?? data.DownloadUrl ?? "").trim()
    || (base ? `${base}${apiDownloadPath}` : apiDownloadPath);

  return {
    exists: Boolean(data.exists ?? data.Exists),
    fileName: String(data.fileName ?? data.FileName ?? "").trim() || "eSource.apk",
    sizeBytes: Number(data.sizeBytes ?? data.SizeBytes) || 0,
    lastModifiedUtc: data.lastModifiedUtc ?? data.LastModifiedUtc ?? null,
    publicPath,
    downloadUrl,
  };
}

/** GET /Apk/info — public (no auth required). */
export async function getApkInfo() {
  const res = await api.get("/Apk/info");
  return normalizeApkInfo(res.data?.data ?? res.data ?? {});
}

/** POST /Apk/upload — authorized multipart upload. */
export async function uploadApk(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await api.post("/Apk/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 10 * 60 * 1000,
  });
  return normalizeApkInfo(res.data?.data ?? res.data ?? {});
}

/** DELETE /Apk — authorized delete of published APK. */
export async function deleteApk() {
  const res = await api.delete("/Apk");
  return normalizeApkInfo(res.data?.data ?? res.data ?? {});
}

export function formatApkSize(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatApkTimestamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = months[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day}-${month}-${year} ${hours}:${minutes} UTC`;
}
