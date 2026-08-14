import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useViewport } from "../../hooks/useViewport";
import { getDashboardSummary } from "../../features/activityExecution/api/activityExecutionApi.js";

const EMPTY_COUNTS = {
  pendingBloodCollection: 0,
  pendingCentrifuge: 0,
  pendingAliquot: 0,
  openQueries: 0,
  pendingBags: 0,
};

const CARDS = [
  {
    key: "pendingBloodCollection",
    label: "Pending Blood",
    color: "blue",
    to: "/execute",
    wide: false,
  },
  {
    key: "pendingCentrifuge",
    label: "Pending Centrifuge",
    color: "yellow",
    to: "/centrifugation",
    wide: false,
  },
  {
    key: "pendingAliquot",
    label: "Pending Aliquot",
    color: "green",
    to: "/aliquots",
    wide: false,
  },
  {
    key: "openQueries",
    label: "Open Queries",
    color: "red",
    to: "/queries",
    wide: false,
  },
  {
    key: "pendingBags",
    label: "Pending Bags",
    color: "blue",
    to: "/bag-preparation",
    wide: true,
  },
];

/**
 * Site KPI cards for the Activity Execution home (mobile / tablet only).
 * Fills the blank upper area above the Scan/Manual dock.
 */
export function ExecutionHomeDashboard() {
  const { isMobileOrTablet } = useViewport();
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const summary = await getDashboardSummary();
      setCounts({
        pendingBloodCollection: summary.pendingBloodCollection,
        pendingCentrifuge: summary.pendingCentrifuge,
        pendingAliquot: summary.pendingAliquot,
        openQueries: summary.openQueries,
        pendingBags: summary.pendingBags,
      });
    } catch (err) {
      setCounts(EMPTY_COUNTS);
      setError(err?.response?.data?.message || err?.message || "Could not load dashboard counts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isMobileOrTablet) return undefined;
    loadSummary();

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        loadSummary();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [isMobileOrTablet, loadSummary]);

  if (!isMobileOrTablet) return null;

  return (
    <section
      className="execution-home-dashboard"
      aria-label="Site workflow summary"
      data-tour="exec-kpi-cards"
    >
      {error ? (
        <p className="execution-home-dashboard__error" role="status">
          {error}
        </p>
      ) : null}
      <div className="metric-grid execution-home-dashboard__grid">
        {CARDS.map((card) => {
          const value = loading ? "—" : counts[card.key];
          const className = [
            "metric-card",
            `metric-card--${card.color}`,
            "execution-home-dashboard__card",
            card.wide ? "execution-home-dashboard__card--wide" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <Link
              key={card.key}
              to={card.to}
              className={className}
              aria-label={`${card.label}: ${value}`}
            >
              <span className="metric-card__value">{value}</span>
              <span className="metric-card__label">{card.label}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
