import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext.jsx";
import { IS_NATIVE } from "@/shared/api/httpClient.js";
import { ConnectionRetryScreen } from "@/components/ConnectionRetryScreen.jsx";
import { ConnectionStatusBanner } from "@/components/ConnectionStatusBanner.jsx";

export function ProtectedRoute({ children }) {
  const { user, loading, sessionError, retrySession } = useAuth();
  const [retrying, setRetrying] = useState(false);

  if (loading) {
    return (
      <div className="auth-loading-screen">
        <ConnectionStatusBanner />
        <div className="auth-loading-screen__spinner" aria-hidden="true" />
        <p>Loading session…</p>
      </div>
    );
  }

  if (sessionError && !user) {
    return (
      <>
        <ConnectionStatusBanner />
        <ConnectionRetryScreen
          title={sessionError.kind === "connectivity" ? "No connection" : "Something went wrong"}
          message={sessionError.message}
          retrying={retrying}
          onRetry={async () => {
            setRetrying(true);
            try {
              await retrySession();
            } finally {
              setRetrying(false);
            }
          }}
        />
      </>
    );
  }

  if (!user) {
    if (IS_NATIVE) {
      // Native app: go to username/password login page.
      return <Navigate to="/login" replace />;
    }
    // Web mode: AuthContext keeps loading=true while redirecting to gateway.
    // If we somehow reach here the redirect is still in-flight — show spinner.
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-screen__spinner" aria-hidden="true" />
        <p>Redirecting to login…</p>
      </div>
    );
  }

  return (
    <>
      <ConnectionStatusBanner />
      {children}
    </>
  );
}
