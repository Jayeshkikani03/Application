import axios from "axios";
import { Capacitor } from "@capacitor/core";
import { getApiBaseUrl, setResolvedApiPathBase } from "@/config/apiBaseUrl.js";

/** True when the app uses mobile auth (JWT + /login page). Set from app.config.json or Capacitor. */
export let IS_NATIVE = Capacitor.isNativePlatform();

export const TOKEN_STORAGE_KEY = "eSourceLabToken";

const UNAUTHORIZED_SKIP_PATHS = ["/login/mobile", "/login/mobile/sites"];

/** Error codes attached when the request never reached a usable API response. */
export const CONNECTIVITY_ERROR_CODES = Object.freeze({
  OFFLINE: "OFFLINE",
  TIMEOUT: "TIMEOUT",
  UNREACHABLE: "UNREACHABLE",
});

let unauthorizedHandler = null;
let unauthorizedHandling = false;

function isBrowserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * True when the failure is network / API-down (no HTTP response), not a business/auth error.
 * Do not clear session or force full-page reload for these — show Retry instead.
 */
export function isConnectivityError(error) {
  if (!error) return false;
  if (error.isConnectivityError === true) return true;
  if (CONNECTIVITY_ERROR_CODES[error.code]) return true;
  if (error.response) return false;
  if (axios.isCancel?.(error)) return false;
  const code = String(error.code || "").toUpperCase();
  if (
    code === "ERR_NETWORK" ||
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    code === "ERR_CANCELED"
  ) {
    return code !== "ERR_CANCELED";
  }
  const msg = String(error.message || "").toLowerCase();
  return (
    msg.includes("network error") ||
    msg.includes("failed to fetch") ||
    msg.includes("networkrequestfailed") ||
    msg.includes("timeout") ||
    msg.includes("err_connection") ||
    msg.includes("cannot reach")
  );
}

/** Short, non-technical copy for offline / unreachable API. */
export function getConnectivityErrorMessage(error) {
  if (isBrowserOffline() || error?.code === CONNECTIVITY_ERROR_CODES.OFFLINE) {
    return "Please check your internet connection and try again.";
  }
  if (
    error?.code === CONNECTIVITY_ERROR_CODES.TIMEOUT ||
    String(error?.code || "").toUpperCase() === "ECONNABORTED" ||
    /timeout/i.test(String(error?.message || ""))
  ) {
    return "This is taking longer than usual. Please try again in a moment.";
  }
  return "We could not connect right now. Please check your internet and try again.";
}

/** Short title for connectivity retry screens. */
export function getConnectivityErrorTitle(error) {
  if (isBrowserOffline() || error?.code === CONNECTIVITY_ERROR_CODES.OFFLINE) {
    return "No internet";
  }
  if (
    error?.code === CONNECTIVITY_ERROR_CODES.TIMEOUT ||
    String(error?.code || "").toUpperCase() === "ECONNABORTED" ||
    /timeout/i.test(String(error?.message || ""))
  ) {
    return "Still waiting";
  }
  return "No connection";
}

export function getUserFacingApiError(error, fallback = "Request failed") {
  if (!error) return fallback;
  if (isConnectivityError(error)) {
    return getConnectivityErrorMessage(error);
  }
  const msg = typeof error.message === "string" ? error.message.trim() : "";
  if (msg && !/^network error$/i.test(msg) && !/^request failed$/i.test(msg)) {
    return msg;
  }
  return fallback;
}

function annotateConnectivityError(error) {
  if (!error || error.response) return error;

  let code = CONNECTIVITY_ERROR_CODES.UNREACHABLE;
  if (isBrowserOffline()) {
    code = CONNECTIVITY_ERROR_CODES.OFFLINE;
  } else if (
    String(error.code || "").toUpperCase() === "ECONNABORTED" ||
    /timeout/i.test(String(error.message || ""))
  ) {
    code = CONNECTIVITY_ERROR_CODES.TIMEOUT;
  }

  const message = getConnectivityErrorMessage({ ...error, code });
  const err = new Error(message);
  err.code = code;
  err.isConnectivityError = true;
  err.response = error.response;
  err.config = error.config;
  err.originalError = error;
  return err;
}

/** Call once after {@link loadRuntimeAppConfig} resolves (see `main.jsx`). */
export function applyRuntimeApiConfig(cfg) {
  const base = cfg.apiPathBase;
  setResolvedApiPathBase(base);
  api.defaults.baseURL = base;
  if (cfg.isNative !== undefined) {
    IS_NATIVE = Boolean(cfg.isNative);
  }
}

export function getApiUrl() {
  return api.defaults.baseURL;
}

export function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setStoredToken(token) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors (private mode, etc.)
  }
}

export function clearStoredToken() {
  setStoredToken("");
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

function shouldHandleUnauthorized(config) {
  const url = String(config?.url || "").toLowerCase();
  return !UNAUTHORIZED_SKIP_PATHS.some((path) => url.includes(path));
}

function triggerUnauthorizedHandler(config) {
  if (!unauthorizedHandler || unauthorizedHandling || !shouldHandleUnauthorized(config)) {
    return;
  }
  unauthorizedHandling = true;
  Promise.resolve(unauthorizedHandler()).finally(() => {
    unauthorizedHandling = false;
  });
}

export const api = axios.create({
  baseURL: getApiBaseUrl(),
  // withCredentials allows the browser to send/receive the auth cookie set by
  // GatewayLogin (web mode). In native mode the cookie is absent and Bearer
  // from the Authorization header is used instead.
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

function extractApiErrorMessage(body, fallback) {
  if (!body || typeof body !== "object") return fallback;

  if (typeof body.message === "string" && body.message.trim()) {
    return body.message.trim();
  }

  // ASP.NET ProblemDetails / validation (e.g. "The WindowPeriodMinus field is required.")
  const errors = body.errors;
  if (errors && typeof errors === "object") {
    const parts = [];
    for (const [key, value] of Object.entries(errors)) {
      const field = String(key || "").split(".").pop() || key;
      const texts = Array.isArray(value) ? value : [value];
      for (const text of texts) {
        const msg = String(text ?? "").trim();
        if (!msg) continue;
        parts.push(field ? `${field}: ${msg}` : msg);
      }
    }
    if (parts.length) return parts.join(" ");
  }

  if (typeof body.title === "string" && body.title.trim()) {
    return body.title.trim();
  }

  return fallback;
}

api.interceptors.response.use(
  (response) => {
    const body = response.data;
    if (
      body &&
      typeof body === "object" &&
      Object.prototype.hasOwnProperty.call(body, "success") &&
      body.success === false
    ) {
      const err = new Error(extractApiErrorMessage(body, "Request failed"));
      err.response = response;
      return Promise.reject(err);
    }
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      triggerUnauthorizedHandler(error.config);
    }

    // No HTTP response → offline, DNS, CORS, or API process down.
    // Normalize to a clear message; callers should Retry, not full reload.
    if (!error.response && isConnectivityError(error)) {
      return Promise.reject(annotateConnectivityError(error));
    }

    const body = error.response?.data;
    const fallback = error.message || "Request failed";
    const message = extractApiErrorMessage(body, fallback);
    if (message && message !== fallback) {
      const err = new Error(message);
      err.response = error.response;
      err.code = error.code;
      return Promise.reject(err);
    }
    if (body && typeof body === "object" && typeof body.message === "string" && body.message) {
      const err = new Error(body.message);
      err.response = error.response;
      err.code = error.code;
      return Promise.reject(err);
    }
    return Promise.reject(error);
  }
);

export default api;
