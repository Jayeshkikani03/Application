let resolvedApiPathBase = "/api";

export function setResolvedApiPathBase(path) {
  resolvedApiPathBase = path;
}

export function getApiBaseUrl() {
  return resolvedApiPathBase;
}
