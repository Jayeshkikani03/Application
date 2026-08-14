import { BrandName } from "@/components/BrandName.jsx";
import { getPublicAssetUrl } from "@/config/publicAssetUrl.js";

export function AppSplash({ exiting = false }) {
  const logoSrc = getPublicAssetUrl("stslogo.png");

  return (
    <div
      className={`app-splash${exiting ? " app-splash--exit" : ""}`}
      role="status"
      aria-live="polite"
      aria-label="Loading eSource"
    >
      <div className="app-splash__glow" aria-hidden="true" />
      <div className="app-splash__content">
        <div className="app-splash__logo-wrap">
          <img alt="" className="app-splash__logo" src={logoSrc} />
        </div>
        <BrandName as="p" className="app-splash__title" />
        <div className="app-splash__spinner" aria-hidden="true" />
      </div>
    </div>
  );
}
