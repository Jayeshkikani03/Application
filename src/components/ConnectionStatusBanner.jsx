import { useEffect, useState } from "react";

/**
 * Banner when the device reports offline.
 */
export function ConnectionStatusBanner() {
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine === false : false
  );

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    setOffline(navigator.onLine === false);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="connection-status-banner" role="status" aria-live="polite">
      <strong>No internet</strong>
      <span>Please check your mobile data or Wi‑Fi, then try again.</span>
    </div>
  );
}
