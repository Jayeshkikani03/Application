import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import JsBarcode from "jsbarcode";
import { useLab } from "../context/LabContext";
import { useViewport } from "../hooks/useViewport";
import { useAuth } from "../context/AuthContext";
import { ScrollableSelect } from "../components/shared/ScrollableSelect";
import {
  collectBarcodeCodesFromRuns,
  getBarcodeProjects,
  getPkTimepointsForPeriod,
  groupBarcodesByParticipant,
  resolveActiveProjectId,
  sanitizeSiteParticipantStart,
} from "../services/barcodeGenerationService";
import { saveGeneratedBarcodes, getBarcodeScheduleOptions, getStoredBarcodeRuns } from "../features/barcodeGeneration/api/barcodeImportApi";
import { downloadOrShareFile } from "../shared/nativeFileDownload.js";

function BarcodeSvg({ value }) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!svgRef.current || !value) return;
    JsBarcode(svgRef.current, value, {
      format: "CODE128",
      displayValue: true,
      font: "Consolas",
      fontSize: 18,
      height: 90,
      margin: 8,
      width: 2,
    });
  }, [value]);

  return <svg ref={svgRef} className="barcode-card__svg" aria-label={`Barcode ${value}`} />;
}

function BarcodeCard({ barcode, label, meta, caption, onClick }) {
  const isParticipant = String(label || "").toLowerCase() === "participant";
  const header = isParticipant ? "Participant" : (label || "Barcode");
  const subLabel = isParticipant
    ? String(caption || meta || "").replace(/\s*participant label\s*/gi, "").trim()
    : (caption || meta);
  return (
    <article className="barcode-card" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <div className="barcode-card__meta">
        <strong className="barcode-card__timepoint">{header}</strong>
        {subLabel && <span className="barcode-card__label">{subLabel}</span>}
      </div>
      <BarcodeSvg value={barcode} />
    </article>
  );
}

function BarcodeSection({ title, items, onBarcodeClick }) {
  if (items.length === 0) return null;

  return (
    <section className="barcode-section">
      <h2>{title}</h2>
      <div className="barcode-grid">
        {items.map((item) => (
          <BarcodeCard key={`${title}-${item.barcode}-${item.label}`} {...item} onClick={() => onBarcodeClick && onBarcodeClick(item)} />
        ))}
      </div>
    </section>
  );
}

function ParticipantBarcodeGroup({ group, projectCode, siteCode, onBarcodeClick }) {
  const hasItems = group.subject || group.pk.length || group.aliquots.length || group.bags.length;
  if (!hasItems) return null;

  return (
    <section className="barcode-participant-group">
      <div className="barcode-sheet__print-head barcode-sheet__print-only">
        <div className="barcode-sheet__print-head-left">
          <span>Project: <strong>{projectCode}</strong></span>
          <span style={{ marginLeft: "16px" }}>Site: <strong>{siteCode}</strong></span>
        </div>
        <div className="barcode-sheet__print-head-center">
          eSource
        </div>
        <div className="barcode-sheet__print-head-right">
          Participant: <strong>{group.participantLabel}</strong>
        </div>
      </div>
      <h2 className="barcode-participant-group__title barcode-sheet__screen-only">Participant {group.participantLabel}</h2>
      {group.subject && (
        <BarcodeSection title="Participant Barcode" items={[group.subject]} onBarcodeClick={onBarcodeClick} />
      )}
      <BarcodeSection title="PK Barcodes" items={group.pk} onBarcodeClick={onBarcodeClick} />
      <BarcodeSection title="Aliquot Barcodes" items={group.aliquots} onBarcodeClick={onBarcodeClick} />
      <BarcodeSection title="Bag Barcodes" items={group.bags} onBarcodeClick={onBarcodeClick} />
    </section>
  );
}

function getRunSiteCode(run) {
  const digits = String(run.siteParticipantStart ?? "").replace(/\D/g, "");
  if (digits.length >= 3) return digits.slice(0, 3);
  const match = String(run.siteParticipantStart ?? "").match(/^(\d+)-/);
  return match?.[1] ?? "";
}

function toCsvValue(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function MultiSelectDropdown({
  label,
  options,
  selectedValues,
  onChange,
  onSelectAll,
  onClear,
  placeholder = "Select...",
  getOptionLabel = (opt) => String(opt),
  getOptionValue = (opt) => opt,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOptions = options.filter((opt) => selectedValues.includes(getOptionValue(opt)));

  let displayText = placeholder;
  if (selectedOptions.length > 0) {
    if (selectedOptions.length === options.length) {
      displayText = "All Selected";
    } else {
      displayText = selectedOptions.map((opt) => getOptionLabel(opt)).join(", ");
    }
  }

  return (
    <div className="multiselect-dropdown-container" ref={containerRef}>
      <div
        className={`multiselect-trigger ${isOpen ? "multiselect-trigger--active" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            setIsOpen(!isOpen);
          }
        }}
      >
        <span className="multiselect-trigger__text" title={displayText}>
          {displayText}
        </span>
        <span className="multiselect-trigger__arrow">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>

      {isOpen && (
        <div className="multiselect-dropdown">
          <div className="checkbox-select__header">
            <span>{label}</span>
            <div className="checkbox-select__actions">
              <button type="button" onClick={onSelectAll}>
                Select All
              </button>
              <button type="button" onClick={onClear}>
                Clear
              </button>
            </div>
          </div>
          <div className="checkbox-select__list" role="group" aria-label={label}>
            {options.map((option) => {
              const val = getOptionValue(option);
              const isChecked = selectedValues.includes(val);
              return (
                <label key={val} className="checkbox-select__option">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => onChange(val)}
                  />
                  <span>{getOptionLabel(option)}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BarcodeGenerationPage() {
  const { isMobileOrTablet } = useViewport();
  const { state, generateBarcodes, addProject } = useLab();
  const { user } = useAuth();
  const authProjectCode = user?.project?.trim() ?? "";

  if (isMobileOrTablet) {
    return <Navigate to="/execute" replace />;
  }
  const projects = useMemo(() => {
    const fromState = getBarcodeProjects(state);
    if (fromState.length) return fromState;
    if (!authProjectCode) return [];
    return [{ id: authProjectCode, code: authProjectCode, name: authProjectCode }];
  }, [state, authProjectCode]);

  const matchedProject = useMemo(() => {
    const norm = (code) => String(code ?? "").trim().toUpperCase();
    return projects.find((project) => norm(project.code) === norm(authProjectCode));
  }, [projects, authProjectCode]);
  const activeProjectId = matchedProject?.id || resolveActiveProjectId(state);
  const [storedRuns, setStoredRuns] = useState([]);
  const [storedRunsLoading, setStoredRunsLoading] = useState(false);
  const [form, setForm] = useState({
    projectId: "",
    labelType: "PK Label",
    periodIds: [],
    timepointIds: [],
    siteParticipantStart: "",
    totalSubjects: "1",
    lotCount: "",
    bagCount: "1",
    generatePk: true,
  });
  const [message, setMessage] = useState(null);
  const [selectedBarcodeForModal, setSelectedBarcodeForModal] = useState(null);
  const [copied, setCopied] = useState(false);
  const [generatingBarcodes, setGeneratingBarcodes] = useState(false);
  const [schedulePeriods, setSchedulePeriods] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [participantFilter, setParticipantFilter] = useState("");

  const reloadStoredRuns = async () => {
    setStoredRunsLoading(true);
    try {
      const runs = await getStoredBarcodeRuns();
      setStoredRuns(runs);
      return runs;
    } catch (error) {
      setStoredRuns([]);
      throw error;
    } finally {
      setStoredRunsLoading(false);
    }
  };

  useEffect(() => {
    if (!message) return undefined;
    const timeoutId = setTimeout(() => setMessage(null), 2000);
    return () => clearTimeout(timeoutId);
  }, [message]);

  useEffect(() => {
    let cancelled = false;
    reloadStoredRuns().catch((error) => {
      if (!cancelled) {
        setMessage({ type: "error", text: error.message || "Unable to load stored barcodes." });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authProjectCode]);

  useEffect(() => {
    if (!selectedBarcodeForModal) {
      setCopied(false);
    }
  }, [selectedBarcodeForModal]);

  const handleCopy = () => {
    if (!selectedBarcodeForModal) return;
    navigator.clipboard.writeText(selectedBarcodeForModal.barcode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    const fromState = getBarcodeProjects(state);
    if (
      authProjectCode &&
      !fromState.some((p) => String(p.code ?? "").trim().toUpperCase() === authProjectCode.toUpperCase())
    ) {
      try {
        addProject({ code: authProjectCode, name: `Project ${authProjectCode}` });
      } catch {
        // Ignore duplicate race while auth project is being registered.
      }
    }
  }, [authProjectCode, state, addProject]);

  useEffect(() => {
    const defaultProjectId = matchedProject?.id || activeProjectId || projects[0]?.id || "";
    setForm((current) => ({
      ...current,
      projectId: defaultProjectId,
    }));
  }, [matchedProject, activeProjectId, projects]);

  useEffect(() => {
    if (!form.projectId) {
      setSchedulePeriods([]);
      setScheduleError("");
      return undefined;
    }

    let cancelled = false;
    setScheduleLoading(true);
    setScheduleError("");
    getBarcodeScheduleOptions()
      .then((options) => {
        if (cancelled) return;
        setSchedulePeriods(options.periods ?? []);
        setForm((current) => ({
          ...current,
          lotCount: String(options.aliquotsPerSeparation ?? current.lotCount ?? 3),
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        setSchedulePeriods([]);
        setScheduleError(error.message || "Unable to load periods and timepoints.");
      })
      .finally(() => {
        if (!cancelled) setScheduleLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [form.projectId, authProjectCode]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === form.projectId) ?? null,
    [form.projectId, projects]
  );
  const projectRuns = useMemo(() => {
    const projectCode = String(selectedProject?.code ?? authProjectCode ?? "").trim().toUpperCase();
    if (!projectCode) return storedRuns;
    return storedRuns.filter(
      (run) => String(run.projectCode ?? run.projectId ?? "").trim().toUpperCase() === projectCode
    );
  }, [storedRuns, selectedProject, authProjectCode]);

  /** One combined preview of every stored barcode for the project (no run picker). */
  const allBarcodesRun = useMemo(() => {
    if (projectRuns.length === 0) return null;

    const subjects = [];
    const pk = [];
    const aliquots = [];
    const bags = [];
    const seen = {
      subjects: new Set(),
      pk: new Set(),
      aliquots: new Set(),
      bags: new Set(),
    };

    const pushUnique = (list, keySet, item) => {
      const code = String(item?.barcode ?? "").trim();
      if (!code || keySet.has(code)) return;
      keySet.add(code);
      list.push(item);
    };

    const sortedRuns = [...projectRuns].sort((a, b) =>
      String(a.generatedAt ?? "").localeCompare(String(b.generatedAt ?? ""))
    );

    for (const run of sortedRuns) {
      for (const item of run.subjects ?? []) pushUnique(subjects, seen.subjects, item);
      for (const item of run.pk ?? []) pushUnique(pk, seen.pk, item);
      for (const item of run.aliquots ?? []) pushUnique(aliquots, seen.aliquots, item);
      for (const item of run.bags ?? []) pushUnique(bags, seen.bags, item);
    }

    const latest = sortedRuns[sortedRuns.length - 1];
    return {
      id: `all-${latest.projectCode || "barcodes"}`,
      projectId: latest.projectId || latest.projectCode,
      projectCode: latest.projectCode,
      projectName: latest.projectName,
      labelType: latest.labelType ?? "PK Label",
      periodCode: "",
      periodLabel: "",
      siteParticipantStart: subjects[0]?.barcode || latest.siteParticipantStart || "",
      totalSubjects: subjects.length,
      lotCount: latest.lotCount ?? 0,
      bagCount: bags.length,
      generatePk: pk.length > 0,
      generatedAt: latest.generatedAt,
      subjects,
      pk,
      aliquots,
      bags,
    };
  }, [projectRuns]);

  const periods = schedulePeriods;
  const hasSchedule = periods.length > 0;

  useEffect(() => {
    setForm((current) => {
      const validPeriodIds = current.periodIds.filter((id) =>
        periods.some((p) => p.id === id)
      );
      return {
        ...current,
        periodIds: validPeriodIds.length ? validPeriodIds : periods.map((p) => p.id),
      };
    });
  }, [form.projectId, periods]);

  const selectedPeriods = useMemo(
    () => periods.filter((period) => form.periodIds.includes(period.id)),
    [form.periodIds, periods]
  );
  const timepoints = useMemo(() => {
    if (selectedPeriods.length === 0) return [];
    return selectedPeriods.flatMap((period) => getPkTimepointsForPeriod(period));
  }, [selectedPeriods]);
  const selectedRun = allBarcodesRun;
  const participantOptions = useMemo(() => {
    const labels = (selectedRun?.subjects ?? [])
      .map((item) => String(item.participantLabel || item.barcode || "").trim())
      .filter(Boolean);
    return [...new Set(labels)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [selectedRun]);

  const filteredRun = useMemo(() => {
    if (!selectedRun) return null;
    const filter = String(participantFilter ?? "").trim();
    if (!filter) return selectedRun;

    const matchParticipant = (item) => {
      const label = String(item.participantLabel || item.barcode || "").trim();
      return label === filter;
    };

    const subjects = (selectedRun.subjects ?? []).filter(matchParticipant);
    const pk = (selectedRun.pk ?? []).filter(matchParticipant);
    const aliquots = (selectedRun.aliquots ?? []).filter(matchParticipant);
    const bags = (selectedRun.bags ?? []).filter(matchParticipant);

    return {
      ...selectedRun,
      subjects,
      pk,
      aliquots,
      bags,
      totalSubjects: subjects.length,
      bagCount: bags.length,
    };
  }, [selectedRun, participantFilter]);

  const participantGroups = useMemo(
    () => (filteredRun ? groupBarcodesByParticipant(filteredRun) : []),
    [filteredRun]
  );

  useEffect(() => {
    if (!participantFilter) return;
    if (!participantOptions.includes(participantFilter)) {
      setParticipantFilter("");
    }
  }, [participantOptions, participantFilter]);

  useEffect(() => {
    setForm((current) => {
      const availableIds = new Set(timepoints.map((timepoint) => timepoint.id));
      const validIds = current.timepointIds.filter((id) => availableIds.has(id));
      return {
        ...current,
        timepointIds: validIds.length ? validIds : timepoints.map((timepoint) => timepoint.id),
      };
    });
  }, [timepoints]);

  const updateField = (field, value) => {
    setMessage(null);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleGenerate = async (event) => {
    event.preventDefault();
    const runId = `run-${Date.now()}`;
    setGeneratingBarcodes(true);
    setMessage(null);

    try {
      const latestRuns = await reloadStoredRuns();
      const projectCode = String(selectedProject?.code ?? authProjectCode ?? "").trim().toUpperCase();
      const runsForProject = projectCode
        ? (latestRuns ?? []).filter(
            (run) => String(run.projectCode ?? run.projectId ?? "").trim().toUpperCase() === projectCode
          )
        : (latestRuns ?? []);
      const existingBarcodeCodes = collectBarcodeCodesFromRuns(runsForProject);

      const nextState = generateBarcodes({
        ...form,
        projectCode: selectedProject?.code || authProjectCode,
        runId,
        resolvedPeriods: periods,
        existingBarcodeCodes,
      });
      const generatedRun =
        (nextState.generatedBarcodeRuns ?? []).find((run) => run.id === runId) ??
        (nextState.generatedBarcodeRuns ?? [])[0];
      if (!generatedRun) {
        throw new Error("Generated barcode run was not created.");
      }

      const response = await saveGeneratedBarcodes(generatedRun);
      const saved = response?.data ?? response;
      await reloadStoredRuns();
      setMessage({
        type: "ok",
        text: `Barcodes generated and saved (${saved?.participantCount ?? generatedRun.subjects?.length ?? 0} participant(s), ${saved?.pkCount ?? generatedRun.pk?.length ?? 0} PK, ${saved?.aliquotCount ?? generatedRun.aliquots?.length ?? 0} aliquot, ${saved?.bagCount ?? generatedRun.bags?.length ?? 0} bag).`,
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Unable to generate barcodes." });
    } finally {
      setGeneratingBarcodes(false);
    }
  };

  const toggleMultiField = (field, value) => {
    setMessage(null);
    setForm((current) => {
      const currentValues = current[field];
      const exists = currentValues.includes(value);
      return {
        ...current,
        [field]: exists ? currentValues.filter((item) => item !== value) : [...currentValues, value],
      };
    });
  };

  const setMultiField = (field, values) => {
    setMessage(null);
    setForm((current) => ({ ...current, [field]: values }));
  };

  const handleClear = () => {
    setForm({
      projectId: form.projectId || projects[0]?.id || "",
      labelType: "PK Label",
      periodIds: periods.map((p) => p.id),
      timepointIds: [],
      siteParticipantStart: "101-01",
      totalSubjects: "1",
      lotCount: form.lotCount || "3",
      bagCount: "1",
      generatePk: true,
    });
    setParticipantFilter("");
    setMessage(null);
  };

  const handleExport = () => {
    if (!filteredRun) return;

    const rows = [
      ["Type", "Barcode Value", "Label Type", "Time Point Name", "Display Label", "Project", "Period"],
      ...filteredRun.subjects.map((item) => ["Participant", item.barcode, filteredRun.labelType ?? "PK Label", item.caption || item.meta || "", item.meta, filteredRun.projectCode, filteredRun.periodCode]),
      ...filteredRun.pk.map((item) => ["PK", item.barcode, filteredRun.labelType ?? "PK Label", item.caption || item.label, item.meta, filteredRun.projectCode, filteredRun.periodCode]),
      ...filteredRun.aliquots.map((item) => ["Aliquot", item.barcode, filteredRun.labelType ?? "PK Label", item.caption || item.label, item.meta, filteredRun.projectCode, filteredRun.periodCode]),
      ...(filteredRun.bags ?? []).map((item) => ["Bag", item.barcode, filteredRun.labelType ?? "PK Label", item.caption || item.label, item.meta, filteredRun.projectCode, filteredRun.periodCode]),
    ];
    const csv = rows.map((row) => row.map(toCsvValue).join(",")).join("\n");
    const filterSuffix = participantFilter ? `-${participantFilter}` : "";
    const fileName = `barcodes-${filteredRun.projectCode}${filterSuffix}-${filteredRun.id}.csv`;
    // Android WebView ignores <a download>; native save handles APK builds.
    void downloadOrShareFile({
      fileName,
      mimeType: "text/csv;charset=utf-8",
      text: csv,
    }).then((result) => {
      if (!result.ok) {
        setMessage(result.message || "Failed to export barcodes.");
        return;
      }
      setMessage(result.message || "Barcodes exported successfully.");
    });
  };

  return (
    <div className="page page--barcodes page--barcode-generation">
      <form className="card barcode-generation-card" onSubmit={handleGenerate}>
        <div className={`barcode-form-grid barcode-form-grid--top ${selectedProject ? "barcode-form-grid--top-row" : ""}`}>
          <div className="field">
            <span>Project</span>
            <div className="barcode-project-code" aria-label="Project code">
              {selectedProject?.code || authProjectCode || "—"}
            </div>
          </div>

          {selectedProject && (
            <label className="field">
              <span>Label Type</span>
              <ScrollableSelect
                value={form.labelType}
                onChange={(nextValue) => updateField("labelType", nextValue)}
                options={["PK Label"]}
                allowEmpty={false}
              />
            </label>
          )}

          {hasSchedule ? (
            <>
              <div className="field">
                <span>Period</span>
                <MultiSelectDropdown
                  label="Period"
                  options={periods}
                  selectedValues={form.periodIds}
                  onChange={(val) => toggleMultiField("periodIds", val)}
                  onSelectAll={() => setMultiField("periodIds", periods.map((p) => p.id))}
                  onClear={() => setMultiField("periodIds", [])}
                  placeholder="Select periods..."
                  getOptionLabel={(p) => p.label}
                  getOptionValue={(p) => p.id}
                />
              </div>

              <div className="field">
                <span>Timepoint</span>
                <MultiSelectDropdown
                  label="Timepoint"
                  options={timepoints}
                  selectedValues={form.timepointIds}
                  onChange={(val) => toggleMultiField("timepointIds", val)}
                  onSelectAll={() => setMultiField("timepointIds", timepoints.map((timepoint) => timepoint.id))}
                  onClear={() => setMultiField("timepointIds", [])}
                  placeholder="Select timepoints..."
                  getOptionLabel={(timepoint) => timepoint.label}
                  getOptionValue={(timepoint) => timepoint.id}
                />
              </div>
            </>
          ) : selectedProject ? (
            <div className="field barcode-schedule-upload-inline">
              <span>Period &amp; Timepoint</span>
              <p className="barcode-schedule-hint">
                {scheduleLoading
                  ? "Loading periods and timepoints..."
                  : scheduleError || "No activity configuration timepoints found for this project."}
              </p>
            </div>
          ) : null}
        </div>

        {selectedProject && (
          <>
            <div className="barcode-form-grid barcode-form-grid--numbers barcode-form-grid--numbers-row">
              <label className="field">
                <span>Site / Participant Start</span>
                <input
                  type="text"
                  value={form.siteParticipantStart}
                  onChange={(event) => updateField("siteParticipantStart", sanitizeSiteParticipantStart(event.target.value))}
                  placeholder="101-01 or 10101"
                  maxLength={6}
                  inputMode="numeric"
                  required
                />
              </label>

              <label className="field">
                <span>Number of Participant</span>
                <input min="1" type="number" value={form.totalSubjects} onChange={(event) => updateField("totalSubjects", event.target.value)} required />
              </label>

              <label className="field">
                <span>Number of Lots</span>
                <input min="0" type="number" value={form.lotCount} onChange={(event) => updateField("lotCount", event.target.value)} required />
              </label>

              <label className="field">
                <span>Number of Bags to Generate</span>
                <input min="0" type="number" value={form.bagCount} onChange={(event) => updateField("bagCount", event.target.value)} required />
                <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--text-muted, #64748b)" }}>
                  When lots are set, bags are created as Period × Lot (e.g. 2 periods × 2 lots = 4 bags).
                </p>
              </label>
            </div>

            <label className="field field--checkbox barcode-pk-checkbox">
              <input type="checkbox" checked={form.generatePk} onChange={(event) => updateField("generatePk", event.target.checked)} />
              <span>Generate PK Label</span>
            </label>

            <div className="barcode-generation-card__actions barcode-actions">
              <button type="submit" className="btn btn--primary" disabled={!hasSchedule || generatingBarcodes}>
                {generatingBarcodes ? "Generating..." : "Generate"}
              </button>
              <button type="button" className="btn btn--secondary" onClick={handleClear}>
                Clear
              </button>
              {filteredRun && (
                <button type="button" className="btn btn--secondary barcode-export-btn" onClick={handleExport}>
                  Export
                </button>
              )}
            </div>
          </>
        )}

        {message && <p className={`scan-feedback scan-feedback--${message.type === "ok" ? "ok" : "error"}`}>{message.text}</p>}
      </form>

      <section className="card barcode-run-card">
        <label className="field">
          <span>Generated Barcode Preview</span>
          <ScrollableSelect
            value={participantFilter}
            onChange={setParticipantFilter}
            disabled={!selectedRun || participantOptions.length === 0 || storedRunsLoading}
            options={participantOptions}
            placeholder={
              storedRunsLoading
                ? "Loading stored barcodes..."
                : selectedRun
                  ? "All participants"
                  : "No stored barcodes"
            }
            allowEmpty
          />
        </label>
      </section>

      {!filteredRun ? (
        <section className="card">
          <p className="empty-state">
            {storedRunsLoading
              ? "Loading barcodes from database..."
              : "Generate barcodes, or push from the barcode mock Export (import-payload) to load a preview from the database."}
          </p>
        </section>
      ) : (
        <div className="barcode-sheet">
          <div className="barcode-summary barcode-sheet__screen-only">
            <span>Participant Labels: {filteredRun.subjects.length}</span>
            <span>PK Barcodes: {filteredRun.pk.length}</span>
            <span>Aliquot Barcodes: {filteredRun.aliquots.length}</span>
            <span>Bag Barcodes: {(filteredRun.bags ?? []).length}</span>
          </div>

          <div className="barcode-sheet__by-participant">
            {participantGroups.map((group) => (
              <ParticipantBarcodeGroup
                key={group.participantLabel}
                group={group}
                projectCode={filteredRun.projectCode}
                siteCode={getRunSiteCode(filteredRun)}
                onBarcodeClick={setSelectedBarcodeForModal}
              />
            ))}
          </div>
        </div>
      )}

      {selectedBarcodeForModal && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" style={{ backgroundColor: 'white', padding: '20px', display: 'flex', flexDirection: 'column', width: 'auto', maxWidth: '90vw', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', marginBottom: '16px', gap: '24px' }}>
              <div className="barcode-card__meta" style={{ flex: 1, alignItems: 'center', textAlign: 'center' }}>
                <strong className="barcode-card__timepoint" style={{ fontSize: '1.25rem', fontWeight: 800, width: '100%' }}>
                  {String(selectedBarcodeForModal.label || "").toLowerCase() === "participant"
                    ? "Participant"
                    : selectedBarcodeForModal.label}
                </strong>
                {(() => {
                  const isParticipant = String(selectedBarcodeForModal.label || "").toLowerCase() === "participant";
                  const raw = selectedBarcodeForModal.caption || selectedBarcodeForModal.meta || "";
                  const sub = isParticipant
                    ? String(raw).replace(/\s*participant label\s*/gi, "").trim()
                    : raw;
                  return sub ? (
                    <span className="barcode-card__label" style={{ color: 'var(--text)', fontSize: '0.95rem', fontWeight: 400, width: '100%' }}>
                      {sub}
                    </span>
                  ) : null;
                })()}
              </div>
              <button type="button" className="btn btn--ghost" onClick={() => setSelectedBarcodeForModal(null)} style={{ padding: '4px', minHeight: 'auto', minWidth: 'auto', border: 0, color: 'var(--text-muted)' }} aria-label="Close modal">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div style={{ backgroundColor: 'white', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px 24px', display: 'flex', justifyContent: 'center', width: '100%', marginBottom: '16px' }}>
              <BarcodeSvg value={selectedBarcodeForModal.barcode} />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' }}>
              <button type="button" className={`btn ${copied ? "btn--success" : "btn--primary"}`} onClick={handleCopy} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                {copied ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  "Copy Barcode"
                )}
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => setSelectedBarcodeForModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BarcodeGenerationPage;
