import { useEffect, useState } from "react";
import { MEDIA } from "../../constants/breakpoints";

function useMobileQueueView() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MEDIA.mobile).matches);

  useEffect(() => {
    const media = window.matchMedia(MEDIA.mobile);
    const onChange = (event) => setIsMobile(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

export function QueueSampleRow({ timepoint, barcode, subject, className = "", flat = false, children }) {
  const isMobile = useMobileQueueView();

  if (!isMobile) {
    return <div className={`sample-table__row ${className}`.trim()}>{children}</div>;
  }

  if (flat) {
    return (
      <div className={`sample-table__row queue-sample-row queue-sample-row--flat ${className}`.trim()}>
        <div className="queue-sample-row__summary queue-sample-row__summary--flat">
          <span className="queue-sample-row__summary-content">
            <span className="queue-sample-row__headline">
              <strong>{timepoint}</strong>
              <span className="mono queue-sample-row__barcode">{barcode}</span>
            </span>
            {subject ? <span className="queue-sample-row__subject">{subject}</span> : null}
          </span>
        </div>
        <div className="queue-sample-row__details queue-sample-row__details--flat">{children}</div>
      </div>
    );
  }

  return (
    <details className={`sample-table__row queue-sample-row ${className}`.trim()}>
      <summary className="queue-sample-row__summary">
        <span className="queue-sample-row__summary-content">
          <span className="queue-sample-row__headline">
            <strong>{timepoint}</strong>
            <span className="mono queue-sample-row__barcode">{barcode}</span>
          </span>
          {subject ? <span className="queue-sample-row__subject">{subject}</span> : null}
        </span>
        <svg
          className="queue-sample-row__chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>
      <div className="queue-sample-row__details">{children}</div>
    </details>
  );
}
