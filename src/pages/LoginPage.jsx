import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext.jsx";
import { mobileLogin } from "@/features/auth/api/authApi.js";
import { getPublicAssetUrl } from "@/config/publicAssetUrl.js";
import { BrandName } from "@/components/BrandName.jsx";
import { AppSplash } from "@/components/AppSplash.jsx";
import { ConnectionStatusBanner } from "@/components/ConnectionStatusBanner.jsx";

const SPLASH_MIN_MS = 1800;
const SPLASH_FADE_MS = 420;

async function completeMobileLogin(result, login, navigate) {
  if (!result?.isAuthenticated || !result.token || !result.user) {
    return false;
  }
  await login(result.token, result.user);
  navigate("/execute", { replace: true });
  return true;
}

function formatLoginError(err) {
  if (!err) return "Login failed. Please try again.";
  if (err.response?.status >= 300 && err.response?.status < 400) {
    return "Login was redirected to Gateway SSO. This app uses username/password login only — do not use the WEB gateway flow here.";
  }
  if (!err.response) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return "Please check your internet connection and try again.";
    }
    return "We could not connect right now. Please check your internet and try again.";
  }
  return err.message || "Login failed. Please try again.";
}

function LoginPage() {
  const navigate = useNavigate();
  const { loading, login, isAuthenticated } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashExiting, setSplashExiting] = useState(false);
  const splashStartedAt = useRef(Date.now());

  const logoSrc = getPublicAssetUrl("stslogo.png");

  useEffect(() => {
    if (!loading && isAuthenticated) {
      navigate("/execute", { replace: true });
    }
  }, [loading, isAuthenticated, navigate]);

  useEffect(() => {
    if (loading || isAuthenticated) return undefined;

    const elapsed = Date.now() - splashStartedAt.current;
    const waitMs = Math.max(0, SPLASH_MIN_MS - elapsed);
    let fadeTimer;

    const hideTimer = window.setTimeout(() => {
      setSplashExiting(true);
      fadeTimer = window.setTimeout(() => {
        setSplashVisible(false);
      }, SPLASH_FADE_MS);
    }, waitMs);

    return () => {
      window.clearTimeout(hideTimer);
      if (fadeTimer) window.clearTimeout(fadeTimer);
    };
  }, [loading, isAuthenticated]);

  async function handleCredentialsSubmit(event) {
    event.preventDefault();
    setError("");

    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError("Username is required.");
      return;
    }
    if (!password) {
      setError("Password is required.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await mobileLogin({
        username: trimmedUsername,
        password,
      });

      if (await completeMobileLogin(result, login, navigate)) {
        return;
      }

      setError("Login failed. Please check your credentials.");
    } catch (err) {
      setError(formatLoginError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!loading && isAuthenticated) {
    return <Navigate to="/execute" replace />;
  }

  const showLoginForm = !loading && !isAuthenticated;

  return (
    <div className={`login-page${splashVisible ? " login-page--splash" : ""}`}>
      {showLoginForm ? (
        <>
          <ConnectionStatusBanner />
          <div className="login-page__atmosphere" aria-hidden="true" />

          <div className="login-page__stage">
            <header className="login-page__hero">
              <div className="login-page__logo-wrap">
                <img alt="" className="login-page__logo" src={logoSrc} />
              </div>
              <BrandName as="h1" className="login-page__title" />
            </header>

            <main className="login-page__sheet">
              <div className="login-page__sheet-handle" aria-hidden="true" />

              <form className="login-page__form" action="#" method="post" onSubmit={handleCredentialsSubmit}>
                <label className="login-page__field">
                  <span>Username</span>
                  <input
                    type="text"
                    name="username"
                    inputMode="text"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoComplete="username"
                    placeholder="Enter username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    disabled={submitting}
                    required
                  />
                </label>

                <label className="login-page__field">
                  <span>Password</span>
                  <div className="login-page__password">
                    <input
                      type={showPassword ? "text" : "password"}
                      name="password"
                      autoComplete="current-password"
                      placeholder="Enter password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={submitting}
                      required
                    />
                    <button
                      type="button"
                      className="login-page__password-toggle"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      disabled={submitting}
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>

                {error ? (
                  <p className="login-page__error" role="alert">
                    {error}
                  </p>
                ) : null}

                <button type="submit" className="btn btn--primary login-page__submit" disabled={submitting}>
                  {submitting ? "Signing in…" : "Sign in"}
                </button>
              </form>
            </main>
          </div>
        </>
      ) : null}

      {splashVisible ? <AppSplash exiting={splashExiting} /> : null}
    </div>
  );
}

export default LoginPage;
