import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { ExportLogCards } from "../components/shared/ExportLogCards";
import { MultiSelectDropdown } from "../components/shared/MultiSelectDropdown.jsx";
import { ScrollableSelect } from "../components/shared/ScrollableSelect";
import { SoftAlertToast } from "../components/shared/SoftAlertToast";
import { useViewport } from "../hooks/useViewport";
import {
  exportActivityTimepoints,
  getActivityConfiguration,
  getTimepointExportLogs,
} from "../features/activityConfiguration/api/activityConfigurationApi.js";
import {
  exportDispatchedBags,
  getBagExportLogs,
} from "../features/bagPreparation/api/bagPreparationsApi.js";
import { resolveDoseNo } from "../features/activityConfiguration/utils/activityConfigurationMappers.js";
import { normalizeDoseLabel } from "../services/activityConfigurationService.js";

function formatBody(body) {
  if (!body) return "";
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return String(body);
  }
}

/**
 * Full-page Export Log for mobile / tablet (audit-style cards).
 * Common (all logs) only — used from toolbar Export Log on small screens.
 * @param {"timepoint" | "bag"} kind
 */
export function ExportLogPage({ kind = "bag" }) {
  const navigate = useNavigate();
  const { isMobileOrTablet } = useViewport();
  const backPath = kind === "timepoint" ? "/activity-configuration" : "/bag-preparation";

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exportingId, setExportingId] = useState(null);
  const [exportingNew, setExportingNew] = useState(false);
  const [message, setMessage] = useState(null);
  const [viewRow, setViewRow] = useState(null);
  const [publishedDoses, setPublishedDoses] = useState([]);
  const [selectedDoseNos, setSelectedDoseNos] = useState([]);
  const [participantFilter, setParticipantFilter] = useState("");

  const refreshLogs = useCallback(async () => {
    setLoading(true);
    try {
      const rows = kind === "timepoint"
        ? await getTimepointExportLogs()
        : await getBagExportLogs();
      setLogs(rows);
    } catch (error) {
      setLogs([]);
      setMessage({
        type: "error",
        text: error.message || "Failed to load export log.",
      });
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void refreshLogs();
  }, [refreshLogs]);

  useEffect(() => {
    if (kind !== "timepoint") return undefined;
    let cancelled = false;
    getActivityConfiguration()
      .then((config) => {
        if (cancelled) return;
        const doses = (config?.doses ?? [])
          .filter(
            (dose) =>
              dose.isPublished
              && dose.isActive !== false
              && (
                (Number(dose.timePointCount) > 0)
                || (Array.isArray(dose.timepoints) && dose.timepoints.some((tp) => tp?.isActive !== false))
              )
          )
          .map((dose) => ({
            doseNo: resolveDoseNo(dose),
            label: normalizeDoseLabel(dose.label) || `Dose ${resolveDoseNo(dose)}`,
          }))
          .filter((dose) => dose.doseNo > 0);
        setPublishedDoses(doses);
      })
      .catch(() => {
        if (!cancelled) setPublishedDoses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [message]);

  const publishedOptions = useMemo(
    () =>
      publishedDoses.map((dose) => ({
        value: String(dose.doseNo),
        label: dose.label || `Dose ${dose.doseNo}`,
      })),
    [publishedDoses]
  );

  useEffect(() => {
    setSelectedDoseNos((prev) => {
      if (prev.length === 0) return prev;
      const valid = new Set(publishedOptions.map((option) => option.value));
      const next = prev.filter((value) => valid.has(value));
      return next.length === prev.length ? prev : next;
    });
  }, [publishedOptions]);

  const toggleDose = (value) => {
    setSelectedDoseNos((prev) => (
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    ));
  };

  const participantOptions = useMemo(() => {
    if (kind !== "bag") return [];
    const names = new Set();
    for (const row of logs) {
      String(row.participantNames || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((name) => names.add(name));
    }
    return [...names]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((name) => ({ value: name, label: name }));
  }, [kind, logs]);

  const filteredLogs = useMemo(() => {
    let list = logs;
    if (kind === "bag" && participantFilter) {
      const wanted = participantFilter.toLowerCase();
      list = list.filter((row) =>
        String(row.participantNames || "")
          .toLowerCase()
          .split(",")
          .map((p) => p.trim())
          .includes(wanted)
      );
    }
    return list;
  }, [logs, participantFilter, kind]);

  const handleReexport = async (row) => {
    if (kind === "timepoint") {
      const doseNos = Array.isArray(row?.doseNos) ? row.doseNos : [];
      if (!row?.id || doseNos.length === 0) {
        setMessage({ type: "error", text: "This log has no dose numbers to re-export." });
        return;
      }
      setExportingId(row.id);
      try {
        const result = await exportActivityTimepoints(doseNos, row.id);
        await refreshLogs();
        setMessage({
          type: "ok",
          text: `Re-exported ${result.timepointCount} timepoint(s) for ${row.doseNames || "selected doses"}.`,
        });
      } catch (error) {
        await refreshLogs().catch(() => {});
        setMessage({ type: "error", text: error.message || "Failed to re-export timepoints." });
      } finally {
        setExportingId(null);
      }
      return;
    }

    const bagNos = Array.isArray(row?.bagPreparationNos) ? row.bagPreparationNos : [];
    if (!row?.id || bagNos.length === 0) {
      setMessage({ type: "error", text: "This log has no bag numbers to re-export." });
      return;
    }
    setExportingId(row.id);
    try {
      const result = await exportDispatchedBags(bagNos, row.id);
      await refreshLogs();
      setMessage({
        type: "ok",
        text: `Re-exported ${result.bagCount} bag(s) for ${row.bagNames || "selected bags"}.`,
      });
    } catch (error) {
      await refreshLogs().catch(() => {});
      setMessage({ type: "error", text: error.message || "Failed to re-export bags." });
    } finally {
      setExportingId(null);
    }
  };

  const handleNewExport = async () => {
    const doseNos = selectedDoseNos
      .map((value) => Number(value))
      .filter((doseNo) => doseNo > 0);
    if (doseNos.length === 0) return;
    const labels = publishedDoses
      .filter((dose) => doseNos.includes(dose.doseNo))
      .map((dose) => dose.label)
      .join(", ");
    setExportingNew(true);
    try {
      const result = await exportActivityTimepoints(doseNos);
      await refreshLogs();
      setMessage({
        type: "ok",
        text: `Exported ${result.timepointCount} timepoint(s) for ${labels || "selected dose(s)"}.`,
      });
    } catch (error) {
      await refreshLogs().catch(() => {});
      setMessage({ type: "error", text: error.message || "Failed to export timepoints." });
    } finally {
      setExportingNew(false);
    }
  };

  if (!isMobileOrTablet) {
    return <Navigate to={backPath} replace />;
  }

  const title = kind === "timepoint" ? "Timepoint Export Log" : "Dispatch Audit";
  const nameLabel = kind === "timepoint" ? "Name of dose" : "Bag barcode";
  const getName = (row) => (kind === "timepoint" ? row.doseNames : row.bagNames);
  const canExport = (row) =>
    kind === "timepoint"
      ? Array.isArray(row.doseNos) && row.doseNos.length > 0
      : Array.isArray(row.bagPreparationNos) && row.bagPreparationNos.length > 0;

  return (
    <div className="page page--export-log">
      <section className="card export-log-page-card">
        <div className="export-log-page-card__header">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate(backPath)}
            aria-label="Back"
            title="Back"
          >
            ← Back
          </button>
          <h2 className="export-log-page-card__title">{title}</h2>
          {kind === "bag" ? (
            <div className="export-log-filter-bar export-log-filter-bar--header">
              <label className="export-log-filter-bar__field">
                <ScrollableSelect
                  value={participantFilter}
                  onChange={setParticipantFilter}
                  options={participantOptions}
                  placeholder={participantOptions.length > 0 ? "All participants" : "No participants"}
                  allowEmpty
                  searchable
                  disabled={participantOptions.length === 0}
                  ariaLabel="Filter by participant"
                />
              </label>
            </div>
          ) : null}
        </div>

        {kind === "timepoint" ? (
          <div className="timepoint-export-log-modal__export-bar export-log-page-card__export-bar">
            <label className="timepoint-export-log-modal__dose-field">
              <span className="config-data-table__search-label">Published dose</span>
              <MultiSelectDropdown
                label="Published doses"
                options={publishedOptions}
                selectedValues={selectedDoseNos}
                onChange={toggleDose}
                onSelectAll={() => {
                  if (exportingNew || publishedOptions.length === 0) return;
                  setSelectedDoseNos(publishedOptions.map((option) => option.value));
                }}
                onClear={() => {
                  if (exportingNew) return;
                  setSelectedDoseNos([]);
                }}
                placeholder={
                  publishedOptions.length > 0
                    ? "Select published dose(s)..."
                    : "No published doses"
                }
                disabled={exportingNew || publishedOptions.length === 0}
                getOptionLabel={(option) => option.label}
                getOptionValue={(option) => option.value}
              />
            </label>
            <button
              type="button"
              className="btn btn--primary timepoint-export-log-modal__export-new-btn"
              onClick={() => void handleNewExport()}
              disabled={
                exportingNew
                || selectedDoseNos.length === 0
                || publishedOptions.length === 0
                || exportingId != null
              }
            >
              {exportingNew ? "Exporting…" : "Export"}
            </button>
          </div>
        ) : null}

        <ExportLogCards
          rows={filteredLogs}
          loading={loading}
          emptyMessage={
            kind === "timepoint"
              ? "No timepoint exports yet."
              : "No bag exports yet. Dispatch a prepared bag to create an export log."
          }
          nameLabel={nameLabel}
          getName={getName}
          canExport={canExport}
          exportingId={exportingId}
          busy={exportingNew}
          onView={setViewRow}
          onExport={(row) => void handleReexport(row)}
          showView={kind !== "bag"}
          searchPlaceholder="Search export log..."
          pageSize={8}
          paginated
          listClassName="export-log-cards__list--page"
        />
      </section>

      {message ? (
        <SoftAlertToast
          title={message.type === "error" ? "Error" : "Success"}
          message={message.text}
          variant={message.type === "ok" ? "success" : "error"}
          onClose={() => setMessage(null)}
        />
      ) : null}

      {viewRow
        ? createPortal(
            <div
              className="admin-reason-modal-backdrop"
              role="presentation"
            >
              <div
                className="admin-reason-modal admin-reason-modal--wide admin-reason-modal--audit"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="export-log-body-title"
              >
                <div className="admin-reason-modal-title" id="export-log-body-title">
                  Export body — {getName(viewRow) || `Log #${viewRow.id}`}
                </div>
                <div className="admin-audit-modal__body">
                  {viewRow.message ? (
                    <p className="pdf-import-grid__hint" style={{ marginBottom: "0.75rem" }}>
                      {viewRow.message}
                    </p>
                  ) : null}
                  <pre
                    className="code-block"
                    style={{
                      margin: 0,
                      maxHeight: "55dvh",
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontSize: "0.8rem",
                    }}
                  >
                    {formatBody(viewRow.body) || "—"}
                  </pre>
                </div>
                <div className="admin-reason-actions admin-reason-actions--center">
                  <button type="button" className="btn btn--secondary" onClick={() => setViewRow(null)}>
                    Close
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export default ExportLogPage;
