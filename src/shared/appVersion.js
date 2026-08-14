import { parametersApi } from "@/features/parameters/api/parametersApi.js";

let cachedAppVersion = null;
let inFlight = null;

/**
 * Resolves AppVersion once per session (avoids Footer calling GET /parameters on every mount).
 */
export async function getAppVersionDisplay() {
  if (cachedAppVersion != null) {
    return cachedAppVersion;
  }
  if (inFlight) {
    return inFlight;
  }

  inFlight = parametersApi
    .getParameters()
    .then((params) => {
      const param = (params ?? []).find((p) => p.parameterName === "AppVersion");
      cachedAppVersion = param?.parameterValue ? String(param.parameterValue) : "";
      return cachedAppVersion;
    })
    .catch(() => {
      cachedAppVersion = "";
      return cachedAppVersion;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
