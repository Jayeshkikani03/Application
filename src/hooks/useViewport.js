import { useEffect, useState } from "react";
import { getViewport } from "../constants/breakpoints";

export function useViewport() {
  const [viewport, setViewport] = useState(() => getViewport());

  useEffect(() => {
    const onResize = () => setViewport(getViewport(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return {
    viewport,
    isMobile: viewport === "mobile",
    isTablet: viewport === "tablet",
    isDesktop: viewport === "desktop",
    isMobileOrTablet: viewport !== "desktop",
  };
}
