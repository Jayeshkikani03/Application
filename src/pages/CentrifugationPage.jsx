import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLab } from "../context/LabContext";
import { useAuth } from "../context/AuthContext";
import {
  getCentrifugeQueue,
  startCentrifugeApi,
  endCentrifugeApi,
  updateFieldsApi,
} from "../features/activityExecution/api/activityExecutionApi";
import {
  mapQueueRecordToSample,
  resolveQueuePkScanIntent,
  buildSubjectOptionsFromServer,
  buildDoseOptionsFromServer,
  subjectMstNoFromFilterId,
  isExecutionReviewLocked,
} from "../features/activityExecution/utils/mapQueueSamples";
import { ScanZone } from "../components/shared/ScanZone";
import { QueueSampleRow } from "../components/shared/QueueSampleRow";
import { StatusBadge } from "../components/shared/StatusBadge";
import { CentrifugeBatchPanel, CentrifugeBatchSampleItem } from "../components/shared/CentrifugeBatchPanel";
import { DateTime24Input, DoseModal } from "../components/shared/Modal";
import { ScrollableSelect } from "../components/shared/ScrollableSelect";
import { AuditHistoryModal } from "../components/shared/AuditHistoryModal.jsx";
import { DbAuditHistoryTableBody } from "../components/shared/DbAuditHistoryTableBody.jsx";
import {
  formatDateTimeLocal,
  formatDisplayDateTime,
  formatDisplayTime,
  fromDateTimeLocal,
  nowIso,
  resolveCentrifugeEndTime,
} from "../services/workflowService";
import { resolveActiveProjectId } from "../services/barcodeGenerationService";
import { formatDoseDisplayLabel, formatTimepointDisplayLabel } from "../utils/visitDisplay";
import { useViewport } from "../hooks/useViewport";
import { UI_LABELS } from "../constants/displayLabels";
import {
  formatParticipantDisplay,
  formatParticipantDropdownLabel,
  resolveSiteRandomizationNumber,
} from "../utils/participantDisplay";

function CentrifugationPage() {
  const { state } = useLab();
  const { user, activeSite } = useAuth();
  const authProject = String(user?.project || "").trim();
  const authSite = String(activeSite || user?.site || "").trim();
  const { isMobileOrTablet } = useViewport();
  // Centrifuge always starts in Scan mode (do not inherit Activity Execution Manual).
  const [manualEntry, setManualEntry] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState("");
  const [doseFilter, setDoseFilter] = useState("");
  const [showAllQueue, setShowAllQueue] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [centrifugeBatch, setCentrifugeBatch] = useState(null);
  const [centrifugeBatchConfirm, setCentrifugeBatchConfirm] = useState(false);
  const [scanAlert, setScanAlert] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [centrifugeStartTime, setCentrifugeStartTime] = useState("");
  const [centrifugeStartTimeError, setCentrifugeStartTimeError] = useState("");
  const [editStartTarget, setEditStartTarget] = useState(null);
  const [dbAuditTarget, setDbAuditTarget] = useState(null);
  const [saving, setSaving] = useState(false);

  const activeProjectId = resolveActiveProjectId(state);

  const [pageRecords, setPageRecords] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [subjectOptions, setSubjectOptions] = useState([]);
  const [doseOptions, setDoseOptions] = useState([]);
  const [loading, setLoading] = useState(false);

  const subjectMstNo = subjectMstNoFromFilterId(subjectFilter);
  const canShowAll = subjectMstNo > 0;
  const effectiveShowAll = showAllQueue && canShowAll;
  const requestSeq = useRef(0);

  const reloadQueue = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const data = await getCentrifugeQueue({
        page,
        pageSize,
        subjectMstNo,
        dose: doseFilter ? Number(doseFilter) : 0,
        includeCompleted: effectiveShowAll,
      });
      if (seq !== requestSeq.current) return;
      setPageRecords(data.records || []);
      setTotalCount(data.totalCount || 0);
      setPendingCount(data.pendingCount || 0);
      setSubjectOptions(data.subjectOptions || []);
      setDoseOptions(data.doseOptions || []);
      if (data.page && data.page !== page) setPage(data.page);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      console.error("Failed to load centrifuge queue:", err);
      setScanAlert(err?.response?.data?.message || err?.message || "Failed to reload queue.");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [page, pageSize, subjectMstNo, doseFilter, effectiveShowAll]);

  useEffect(() => {
    reloadQueue();
  }, [reloadQueue, activeProjectId, authProject, authSite]);

  const projectSamples = useMemo(
    () => pageRecords.map((record) => mapQueueRecordToSample(record)),
    [pageRecords]
  );

  const subjectsWithSamples = useMemo(
    () => buildSubjectOptionsFromServer(subjectOptions),
    [subjectOptions]
  );

  const dosesWithSamples = useMemo(
    () => buildDoseOptionsFromServer(doseOptions),
    [doseOptions]
  );

  const pendingQueueCount = pendingCount;

  const PAGE_SIZE = pageSize;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = totalCount === 0 ? 0 : (safePage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + projectSamples.length, totalCount);
  const visibleDisplayQueue = projectSamples;

  // Resolve a scanned PK tube: prefer the current page, else fetch it by exact barcode.
  const resolveScanSample = useCallback(
    async (pkCode) => {
      const onPage = projectSamples.find(
        (s) => String(s.barcode || "").toUpperCase() === pkCode
      );
      if (onPage) return onPage;
      try {
        const data = await getCentrifugeQueue({ scanCode: pkCode });
        const record = (data.records || [])[0];
        return record ? mapQueueRecordToSample(record) : null;
      } catch {
        return null;
      }
    },
    [projectSamples]
  );

  const nextTube = projectSamples.find(
    (s) => s.status === "Awaiting Centrifugation" || s.status === "Collected" || s.status === "Centrifuging"
  );

  useEffect(() => {
    if (!scanAlert) return;
    const id = window.setTimeout(() => setScanAlert(null), 4500);
    return () => window.clearTimeout(id);
  }, [scanAlert]);

  useEffect(() => {
    setDoseFilter("");
  }, [subjectFilter]);

  useEffect(() => {
    setSubjectFilter("");
    setDoseFilter("");
    setShowAllQueue(false);
    setPage(1);
    setScanAlert(null);
    setCentrifugeBatch(null);
    setCentrifugeBatchConfirm(false);
    setConfirmTarget(null);
    setEditStartTarget(null);
    setDbAuditTarget(null);
  }, [activeProjectId, authProject, authSite]);

  useEffect(() => {
    setPage(1);
  }, [subjectFilter, doseFilter, showAllQueue, pageSize]);

  useEffect(() => {
    if (!canShowAll && showAllQueue) setShowAllQueue(false);
  }, [canShowAll, showAllQueue]);

  useEffect(() => {
    if ((confirmTarget && confirmTarget.type === "start") || centrifugeBatch) {
      if (!centrifugeStartTime) {
        setCentrifugeStartTime(formatDateTimeLocal(nowIso()));
      }
      setCentrifugeStartTimeError("");
    } else {
      setCentrifugeStartTime("");
      setCentrifugeStartTimeError("");
    }
  }, [confirmTarget, centrifugeBatch]);

  const getSampleTarget = (sample) => ({
    sampleId: sample.id,
    subjectId: sample.subjectId,
    subjectMstNo: sample.subjectMstNo,
    activityConfigTimePointNo: sample.activityConfigTimePointNo,
    barcode: sample.barcode,
    subjectNumber: sample.siteRandomizationNo || sample.subjectNumber,
    siteRandomizationNo: sample.siteRandomizationNo,
    doseLabel: formatDoseDisplayLabel(sample.dose),
    timepoint: formatTimepointDisplayLabel(sample.timepoint, sample.dose),
    collectedAt: sample.collectedAt,
    fieldIds: sample.fieldIds,
    reviewStatus: sample.reviewStatus || null,
  });

  const beginCentrifugeAddOn = (target) => {
    setCentrifugeBatch({ samples: [target] });
    setConfirmTarget(null);
    setScanAlert("Add On mode enabled. Scan another collected PK tube, then start the batch.");
  };

  const addCentrifugeBatchSample = (sample) => {
    const target = getSampleTarget(sample);
    setCentrifugeBatch((current) => {
      if (!current) return { samples: [target] };
      if (current.samples.some((item) => item.sampleId === target.sampleId)) return current;
      return { samples: [...current.samples, target] };
    });
  };

  const removeCentrifugeBatchSample = (sampleId) => {
    setCentrifugeBatch((current) => {
      if (!current) return null;
      const samples = current.samples.filter((item) => item.sampleId !== sampleId);
      if (samples.length === 0) setCentrifugeBatchConfirm(false);
      return samples.length ? { samples } : null;
    });
  };

  const persistStart = async (sample, actualTime) => {
    if (isExecutionReviewLocked(sample?.reviewStatus)) {
      throw new Error("This record is under review and cannot be edited.");
    }
    await startCentrifugeApi({
      subjectMstNo: sample.subjectMstNo,
      activityConfigTimePointNo: sample.activityConfigTimePointNo,
      actualTime: actualTime || nowIso(),
    });
  };

  const persistEnd = async (sample) => {
    if (isExecutionReviewLocked(sample?.reviewStatus)) {
      throw new Error("This record is under review and cannot be edited.");
    }
    await endCentrifugeApi({
      subjectMstNo: sample.subjectMstNo,
      activityConfigTimePointNo: sample.activityConfigTimePointNo,
      actualTime: nowIso(),
    });
  };

  const confirmCentrifugeBatchStart = async () => {
    if (!centrifugeBatch?.samples.length || saving) return;
    let startTime = nowIso();
    if (manualEntry) {
      if (!centrifugeStartTime) {
        setCentrifugeStartTimeError("Start time is required.");
        return;
      }
      startTime = fromDateTimeLocal(centrifugeStartTime);
    }
    setSaving(true);
    try {
      for (const sample of centrifugeBatch.samples) {
        await persistStart(sample, startTime);
      }
      setCentrifugeBatch(null);
      setCentrifugeBatchConfirm(false);
      await reloadQueue();
    } catch (err) {
      setScanAlert(err?.response?.data?.message || err?.message || "Failed to start centrifuge batch.");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmTarget || saving) return;
    setSaving(true);
    try {
      if (confirmTarget.type === "start") {
        let startTime = nowIso();
        if (manualEntry) {
          if (!centrifugeStartTime) {
            setCentrifugeStartTimeError("Start time is required.");
            setSaving(false);
            return;
          }
          startTime = fromDateTimeLocal(centrifugeStartTime);
        }
        await persistStart(confirmTarget, startTime);
      } else {
        await persistEnd(confirmTarget);
      }
      setConfirmTarget(null);
      await reloadQueue();
    } catch (err) {
      setScanAlert(err?.response?.data?.message || err?.message || "Centrifuge action failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleEditStart = async (newStartTime, reason) => {
    if (!editStartTarget || saving) return;
    if (isExecutionReviewLocked(editStartTarget.reviewStatus)) {
      setScanAlert("This record is under review and cannot be edited.");
      setEditStartTarget(null);
      return;
    }
    setSaving(true);
    try {
      await updateFieldsApi({
        subjectMstNo: editStartTarget.subjectMstNo,
        activityConfigTimePointNo: editStartTarget.activityConfigTimePointNo,
        fields: { CentrifugationStart: fromDateTimeLocal(newStartTime) },
        changeReason: reason || "",
      });
      setEditStartTarget(null);
      await reloadQueue();
    } catch (err) {
      setScanAlert(err?.response?.data?.message || err?.message || "Failed to update start time.");
    } finally {
      setSaving(false);
    }
  };

  const openStartAudit = (sample) => {
    const dtlNo = sample.fieldIds?.CentrifugationStart ?? sample.fieldIds?.centrifugationStart;
    setDbAuditTarget({
      tableName: "ActivityExecutionDtl",
      recordId: dtlNo || null,
      fieldName: "CentrifugationStart",
      title: "Centrifuge Start Audit",
    });
  };

  const handleScan = async (code) => {
    setScanAlert(null);
    const pkCode = code.trim().toUpperCase();
    if (!pkCode) return;

    if (centrifugeBatch) {
      const scannedSample = await resolveScanSample(pkCode);
      const batchSample =
        scannedSample &&
        ["Collected", "Awaiting Centrifugation"].includes(scannedSample.status)
          ? scannedSample
          : null;
      if (!batchSample) {
        setScanAlert("Scan another collected PK tube to add it, or start the current centrifuge batch.");
        return;
      }
      if (isExecutionReviewLocked(batchSample.reviewStatus)) {
        setScanAlert(`${batchSample.barcode} is under review and cannot be centrifuged.`);
        return;
      }
      if (centrifugeBatch.samples.some((sample) => sample.sampleId === batchSample.id)) {
        setScanAlert(`${batchSample.barcode} is already in the current centrifuge batch.`);
        return;
      }
      addCentrifugeBatchSample(batchSample);
      setCentrifugeBatchConfirm(true);
      return;
    }

    const scannedSample = await resolveScanSample(pkCode);
    if (!scannedSample) {
      setScanAlert(`Unknown PK barcode: ${pkCode}`);
      return;
    }
    const intent = resolveQueuePkScanIntent([scannedSample], pkCode);
    if (intent.type === "startCentrifugation" || intent.type === "endCentrifugation") {
      if (isExecutionReviewLocked(intent.sample.reviewStatus)) {
        setScanAlert(`${intent.sample.barcode} is under review and cannot be edited.`);
        return;
      }
    }
    if (intent.type === "startCentrifugation") {
      setConfirmTarget({
        type: "start",
        ...getSampleTarget(intent.sample),
      });
      return;
    }
    if (intent.type === "endCentrifugation") {
      setSaving(true);
      try {
        await persistEnd(intent.sample);
        setScanAlert(`Centrifugation complete for ${intent.sample.barcode}. Continue in Aliquot Creation.`);
        await reloadQueue();
      } catch (err) {
        setScanAlert(err?.response?.data?.message || err?.message || "Failed to end centrifugation.");
      } finally {
        setSaving(false);
      }
      return;
    }
    if (intent.type === "aliquot") {
      const message =
        intent.sample.status === "Aliquoted"
          ? `${intent.sample.barcode} is already aliquoted. No centrifugation action is needed.`
          : `Centrifugation is already complete for ${intent.sample.barcode}. Continue in Aliquot Creation.`;
      setScanAlert(message);
      return;
    }
    setScanAlert(intent.type === "error" ? intent.message : "This PK tube cannot be centrifuged at this step.");
  };

  return (
    <div className={`page page--queue page--centrifuge${centrifugeBatch ? " page--centrifuge--batch" : ""}`} data-tour="page-form">
      {scanAlert && (
        <div className="soft-alert-toast soft-alert-toast--warning" role="alert">
          <div>
            <strong>Scan Alert</strong>
            <span>{scanAlert}</span>
          </div>
          <button type="button" aria-label="Close alert" onClick={() => setScanAlert(null)}>
            x
          </button>
        </div>
      )}

      <div className="two-col two-col--queue">
        <div className="scan-zone-dock">
          <ScanZone
            placeholder={centrifugeBatch ? "Scan another collected PK tube" : nextTube?.barcode ?? "Scan PK tube barcode"}
            onScan={handleScan}
            showFeedback={false}
            showManualToggle={true}
            manualToggleVariant="checkbox"
            manualEntry={manualEntry}
            onManualToggle={setManualEntry}
            phase="Pk Barcode scan"
            areaTitle="Pk Barcode scan"
            instruction=""
          />
        </div>
        <div className="scan-zone-dock--spacer" />

        {centrifugeBatch && (
          <CentrifugeBatchPanel
            layout="queue"
            samples={centrifugeBatch.samples}
            centrifugeStartTime={centrifugeStartTime}
            onRemove={removeCentrifugeBatchSample}
            onCancel={() => {
              setCentrifugeBatch(null);
              setCentrifugeBatchConfirm(false);
            }}
            onStart={() => setCentrifugeBatchConfirm(true)}
            subjects={subjectsWithSamples}
          />
        )}

        <section className="card collapsible-card centrifuge-queue-inline">
          <div className="centrifuge-queue__head">
            <span className="centrifuge-queue__title">PK Tube Queue</span>
            <div className="centrifuge-queue__controls">
              <label className="field centrifuge-queue__filter centrifuge-queue__filter--participant">
                <span>{UI_LABELS.participant}</span>
                <ScrollableSelect
                  value={subjectFilter}
                  onChange={setSubjectFilter}
                  options={subjectsWithSamples.map((subject) => ({
                    value: subject.id,
                    label: formatParticipantDropdownLabel(subject),
                  }))}
                  placeholder={UI_LABELS.allParticipants}
                />
              </label>
              <label className="field centrifuge-queue__filter centrifuge-queue__filter--dose">
                <span>Dose</span>
                <ScrollableSelect
                  value={doseFilter}
                  onChange={setDoseFilter}
                  options={dosesWithSamples.map((dose) => ({
                    value: dose.value,
                    label: dose.label,
                  }))}
                  placeholder="All doses"
                />
              </label>
            </div>
            <div className="centrifuge-queue__head-end">
              {!showAllQueue && pendingQueueCount > 0 && (
                <span className="centrifuge-queue__badge">{pendingQueueCount} pending</span>
              )}
              {(!isMobileOrTablet || subjectFilter) && (
                <label
                  className="centrifuge-queue__show-all centrifuge-queue__show-all--emphasis"
                  title={canShowAll ? "" : "Select a participant to show completed records."}
                >
                  <input
                    type="checkbox"
                    checked={showAllQueue}
                    disabled={!canShowAll}
                    onChange={(event) => setShowAllQueue(event.target.checked)}
                  />
                  <span>Show all</span>
                </label>
              )}
            </div>
          </div>
          <div className="sample-table sample-table--centrifuge centrifuge-queue__table">
            <div className="sample-table__head">
              <span>PK Barcode</span>
              <span>{UI_LABELS.participant}</span>
              <span>Dose</span>
              <span>Timepoint</span>
              <span>Collected Time</span>
              <span>Centrifuge Start Time</span>
              <span>Centrifuge End Time</span>
              <span>Status</span>
            </div>
            {visibleDisplayQueue.map((s) => {
              const sub = state.subjects.find((item) => item.id === s.subjectId);
              const subjectDisplay =
                (sub && formatParticipantDisplay(sub)) ||
                s.siteRandomizationNo ||
                resolveSiteRandomizationNumber({ subjectNumber: s.subjectNumber });
              const hasStartAudit = Boolean(
                s.fieldIds?.CentrifugationStart ?? s.fieldIds?.centrifugationStart
              );
              return (
                <QueueSampleRow
                  key={s.id}
                  timepoint={s.timepoint}
                  barcode={s.barcode}
                  subject={subjectDisplay}
                >
                  <span className="mono" data-label="PK Barcode">
                    {s.barcode}
                  </span>
                  <span data-label={UI_LABELS.participant}>{subjectDisplay}</span>
                  <span className="preserve-case" data-label="Dose">{formatDoseDisplayLabel(s.dose)}</span>
                  <span className="preserve-case" data-label="Timepoint">{formatTimepointDisplayLabel(s.timepoint, s.dose)}</span>
                  <span data-label="Collected Time">{formatDisplayDateTime(s.collectedAt)}</span>
                  <span data-label="Centrifuge Start Time" className="activity-grid__actual">
                    <span className="activity-grid__label-actions">
                      {s.centrifugationStart && (
                        <>
                          {!isExecutionReviewLocked(s.reviewStatus) && (
                          <button
                            type="button"
                            className="btn btn--sm btn--secondary activity-grid__edit-btn"
                            onClick={() => setEditStartTarget(s)}
                            aria-label="Edit start time"
                            title="Edit start time"
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                              <path d="M11.3 1.7a1.1 1.1 0 0 1 1.6 0l1.4 1.4a1.1 1.1 0 0 1 0 1.6L5.8 12.2 2 13l.8-3.8L11.3 1.7zM9.5 3.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          )}
                          {hasStartAudit && (
                            <button
                              type="button"
                              className="btn btn--sm btn--secondary activity-grid__edit-btn activity-grid__audit-btn"
                              onClick={() => openStartAudit(s)}
                              aria-label="View start time audit"
                              title="View start time audit"
                            >
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                <path d="M4 2.5h5.2L12 5.3v8.2H4v-11zM9 2.5v3h3M5.8 8h4.4M5.8 10h4.4M5.8 12h2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          )}
                        </>
                      )}
                    </span>
                    <span className="activity-grid__value-wrapper">
                      {formatDisplayTime(s.centrifugationStart)}
                    </span>
                  </span>
                  <span data-label="Centrifuge End Time">
                    <span>{formatDisplayTime(resolveCentrifugeEndTime(null, s))}</span>
                  </span>
                  <span data-label="Status">
                    <StatusBadge status={s.status} kind="sample" />
                  </span>
                </QueueSampleRow>
              );
            })}
            {!loading && totalCount === 0 && (
              <p className="empty-state">
                {showAllQueue
                  ? "No PK samples for the selected filters."
                  : "No pending PK tubes. All collected tubes have been centrifuged."}
              </p>
            )}
          </div>
          {totalCount > PAGE_SIZE ? (
            <div className="table-pagination config-data-table__pagination">
              <div className="config-data-table__pagination-meta">
                <span>
                  Showing {startIndex + 1}–{endIndex} of {totalCount}
                </span>
                <label className="config-data-table__page-size">
                  <ScrollableSelect
                    className="scrollable-select--compact"
                    value={pageSize}
                    onChange={(nextValue) => setPageSize(Number(nextValue))}
                    options={[10, 20, 50].map((option) => ({
                      value: option,
                      label: `${option} / page`,
                    }))}
                    allowEmpty={false}
                    ariaLabel="Rows per page"
                  />
                </label>
              </div>
              <div className="table-pagination__pager config-data-table__pager">
                <button type="button" className="btn btn--secondary btn--sm" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Prev
                </button>
                <span>
                  {safePage} / {totalPages}
                </span>
                <button type="button" className="btn btn--secondary btn--sm" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {confirmTarget && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal modal--centrifuge-confirm" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <h3 className="modal__title">
              {confirmTarget.type === "start" ? "Start Centrifugation" : "End Centrifugation"}
            </h3>
            <p className="modal__message">
              {confirmTarget.type === "start"
                ? "Do you want to start centrifuge for this PK sample?"
                : "Do you want to end centrifuge for this PK sample?"}
            </p>
            <div className="confirm-detail-card">
              <div className="confirm-detail-card__row">
                <span>{UI_LABELS.siteRandomizationNo}</span>
                <strong>
                  {resolveSiteRandomizationNumber({
                    subjectId: confirmTarget.subjectId,
                    subjects: state.subjects,
                    subjectNumber: confirmTarget.subjectNumber,
                  })}
                </strong>
              </div>
              <div className="confirm-detail-card__row">
                <span>Dose</span>
                <strong>{confirmTarget.doseLabel}</strong>
              </div>
              <div className="confirm-detail-card__row">
                <span>Timepoint</span>
                <strong className="preserve-case">{confirmTarget.timepoint}</strong>
              </div>
              <div className="confirm-detail-card__row">
                <span>PK Barcode</span>
                <strong className="mono">{confirmTarget.barcode}</strong>
              </div>
            </div>
            {confirmTarget.type === "start" && manualEntry && (
              <label className="field modal__field" style={{ width: "100%", marginTop: "12px" }}>
                <span>Centrifugation Start Time</span>
                <DateTime24Input
                  value={centrifugeStartTime}
                  onChange={(val) => {
                    setCentrifugeStartTime(val);
                    setCentrifugeStartTimeError("");
                  }}
                />
              </label>
            )}
            {manualEntry && centrifugeStartTimeError && (
              <p className="modal__error">{centrifugeStartTimeError}</p>
            )}
            <div className="modal__actions modal__actions--center">
              <button type="button" className="btn btn--ghost" disabled={saving} onClick={() => setConfirmTarget(null)}>
                Cancel
              </button>
              {confirmTarget.type === "start" && (
                <button type="button" className="btn btn--secondary" disabled={saving} onClick={() => beginCentrifugeAddOn(confirmTarget)}>
                  Add On
                </button>
              )}
              <button type="button" className="btn btn--primary" disabled={saving} onClick={handleConfirmAction}>
                {confirmTarget.type === "start" ? "Start" : "End"}
              </button>
            </div>
          </div>
        </div>
      )}

      {centrifugeBatchConfirm && centrifugeBatch && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal modal--centrifuge-batch" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <h3 className="modal__title">Start Centrifugation Batch</h3>
            <p className="modal__message">Start centrifugation for all selected PK tubes with the same start time?</p>
            <div className="aliquot-modal-list">
              {centrifugeBatch.samples.map((sample) => (
                <CentrifugeBatchSampleItem
                  key={sample.sampleId}
                  sample={sample}
                  centrifugeStartTime={centrifugeStartTime}
                  onRemove={removeCentrifugeBatchSample}
                  subjects={subjectsWithSamples}
                />
              ))}
            </div>
            {manualEntry && (
              <label className="field modal__field" style={{ width: "100%", marginTop: "12px" }}>
                <span>Centrifugation Start Time</span>
                <DateTime24Input
                  value={centrifugeStartTime}
                  onChange={(val) => {
                    setCentrifugeStartTime(val);
                    setCentrifugeStartTimeError("");
                  }}
                />
              </label>
            )}
            {manualEntry && centrifugeStartTimeError && (
              <p className="modal__error">{centrifugeStartTimeError}</p>
            )}
            <div className="modal__actions modal__actions--center">
              <button type="button" className="btn btn--ghost" disabled={saving} onClick={() => setCentrifugeBatchConfirm(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn--secondary" disabled={saving} onClick={() => setCentrifugeBatchConfirm(false)}>
                Add On
              </button>
              <button type="button" className="btn btn--primary" disabled={saving} onClick={confirmCentrifugeBatchStart}>
                Start
              </button>
            </div>
          </div>
        </div>
      )}

      {editStartTarget && (
        <DoseModal
          open={!!editStartTarget}
          title="Edit Centrifugation Start Time"
          fieldLabel="Centrifugation Start Time"
          initialValue={formatDateTimeLocal(editStartTarget.centrifugationStart)}
          onClose={() => !saving && setEditStartTarget(null)}
          onSubmit={handleEditStart}
        />
      )}

      <AuditHistoryModal
        open={!!dbAuditTarget}
        onClose={() => setDbAuditTarget(null)}
        title={dbAuditTarget?.title ?? "Audit History"}
      >
        {dbAuditTarget && (
          <DbAuditHistoryTableBody
            tableName={dbAuditTarget.tableName}
            recordId={dbAuditTarget.recordId}
            fieldName="vFieldValue"
            customLabel="Centrifugation Start Time"
          />
        )}
      </AuditHistoryModal>
    </div>
  );
}

export default CentrifugationPage;
