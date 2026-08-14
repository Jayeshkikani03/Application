/**
 * App-wide viewport breakpoints (CSS + JS).
 *
 * Mobile:  0 – 640px
 * Tablet:  641px – 1024px
 * Desktop: 1025px+
 */
export const BREAKPOINTS = {
  mobile: { min: 0, max: 640 },
  tablet: { min: 641, max: 1024 },
  desktop: { min: 1025, max: Number.POSITIVE_INFINITY },
};

export const BP = {
  mobileMax: BREAKPOINTS.mobile.max,
  tabletMin: BREAKPOINTS.tablet.min,
  tabletMax: BREAKPOINTS.tablet.max,
  desktopMin: BREAKPOINTS.desktop.min,
};

/** Media query strings — use with window.matchMedia or in JS hooks. */
export const MEDIA = {
  mobile: `(max-width: ${BP.mobileMax}px)`,
  tablet: `(min-width: ${BP.tabletMin}px) and (max-width: ${BP.tabletMax}px)`,
  tabletUp: `(min-width: ${BP.tabletMin}px)`,
  desktop: `(min-width: ${BP.desktopMin}px)`,
  notDesktop: `(max-width: ${BP.tabletMax}px)`,
};

export function getViewport(width = typeof window !== "undefined" ? window.innerWidth : BP.desktopMin) {
  if (width <= BP.mobileMax) return "mobile";
  if (width <= BP.tabletMax) return "tablet";
  return "desktop";
}
