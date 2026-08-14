import { Capacitor } from "@capacitor/core";

/**
 * Save a file on native (APK) or trigger a browser download on web.
 *
 * Android WebView ignores `<a download>` and jsPDF `doc.save()`, so native
 * builds write through Capacitor Filesystem. Prefer a direct save to a
 * user-visible folder; only fall back to the system Share sheet if every
 * write target fails.
 *
 * @param {{
 *   fileName: string,
 *   mimeType?: string,
 *   base64Data?: string,
 *   blob?: Blob,
 *   text?: string,
 * }} args
 * @returns {Promise<
 *   | { ok: true, saved?: boolean, shared?: boolean, uri?: string, message?: string }
 *   | { ok: false, message: string }
 * >}
 */
export async function downloadOrShareFile({
  fileName,
  mimeType = "application/octet-stream",
  base64Data,
  blob,
  text,
} = {}) {
  const safeName = String(fileName || "export")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim() || "export";

  if (Capacitor.isNativePlatform()) {
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const { Share } = await import("@capacitor/share");

      let data = base64Data;
      if (!data && blob) {
        data = await blobToBase64(blob);
      }
      if (!data && text != null) {
        data = textToBase64(String(text));
      }
      if (!data) {
        return { ok: false, message: "Nothing to export." };
      }

      try {
        if (typeof Filesystem.requestPermissions === "function") {
          await Filesystem.requestPermissions();
        }
      } catch (permissionError) {
        console.warn("Filesystem permission request skipped", permissionError);
      }

      const relativePath = `Download/${safeName}`;
      const writeTargets = [
        {
          directory: Directory.ExternalStorage,
          label: "Downloads",
          displayPath: `Downloads/${safeName}`,
        },
        {
          directory: Directory.Documents,
          label: "Documents",
          displayPath: `Documents/Download/${safeName}`,
        },
        {
          directory: Directory.External,
          label: "App files",
          displayPath: `App files/Download/${safeName}`,
        },
      ].filter((target) => Boolean(target.directory));

      for (const target of writeTargets) {
        try {
          await Filesystem.writeFile({
            path: relativePath,
            data,
            directory: target.directory,
            recursive: true,
          });

          let uri = "";
          try {
            const result = await Filesystem.getUri({
              path: relativePath,
              directory: target.directory,
            });
            uri = result?.uri || "";
          } catch {
            uri = "";
          }

          return {
            ok: true,
            saved: true,
            uri,
            message: `Saved to ${target.displayPath}`,
          };
        } catch (writeError) {
          console.warn(`Native save to ${target.label} failed`, writeError);
        }
      }

      // Last resort: Cache + Share sheet (user can pick Files / Downloads).
      const cachePath = `exports/${safeName}`;
      await Filesystem.writeFile({
        path: cachePath,
        data,
        directory: Directory.Cache,
        recursive: true,
      });

      const { uri } = await Filesystem.getUri({
        path: cachePath,
        directory: Directory.Cache,
      });

      await Share.share({
        title: safeName,
        url: uri,
        dialogTitle: "Save or share export",
      });

      return {
        ok: true,
        shared: true,
        uri,
        message: "Opened share sheet. Choose Files or Downloads to save.",
      };
    } catch (error) {
      // User dismissed the share sheet — treat as cancelled, not failure.
      const message = String(error?.message || error || "");
      if (/cancel|dismiss|abort/i.test(message)) {
        return { ok: true, shared: false, message: "Export cancelled." };
      }
      console.error("Native file save failed", error);
      return {
        ok: false,
        message: message || "Failed to save export on this device.",
      };
    }
  }

  try {
    let downloadBlob = blob;
    if (!downloadBlob && base64Data) {
      downloadBlob = base64ToBlob(base64Data, mimeType);
    }
    if (!downloadBlob && text != null) {
      downloadBlob = new Blob([String(text)], { type: mimeType });
    }
    if (!downloadBlob) {
      return { ok: false, message: "Nothing to export." };
    }

    const url = URL.createObjectURL(downloadBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = safeName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return { ok: true, saved: true, message: `Downloaded ${safeName}` };
  } catch (error) {
    console.error("Browser download failed", error);
    return {
      ok: false,
      message: error?.message || "Failed to download export.",
    };
  }
}

function textToBase64(text) {
  // btoa fails on non-Latin1; encode as UTF-8 first.
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}
