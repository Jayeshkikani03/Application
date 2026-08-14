import { useEffect, useState } from "react";
import { getAppVersionDisplay } from "@/shared/appVersion.js";
import { useViewport } from "@/hooks/useViewport";

export function Footer() {
  const { isMobile } = useViewport();
  const [versionDisplay, setVersionDisplay] = useState("");

  useEffect(() => {
    let active = true;
    getAppVersionDisplay().then((value) => {
      if (active && value) setVersionDisplay(value);
    });
    return () => {
      active = false;
    };
  }, []);

  if (isMobile) {
    return null;
  }

  return (
    <footer className="page-footer print-suppress">
      <div className="footer-content">
        <div className="footer-row">
          <div className="footer-left">
            <span className="footer-muted">
              Version <span id="version">{versionDisplay}</span>
            </span>
          </div>
          <div className="footer-right">
            <span className="footer-muted">
              Developed By{" "}
              <a href="https://www.sarjen.com/" target="_blank" rel="noreferrer">
                Sarjen Systems Pvt. Ltd.
              </a>
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
