import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLab } from "../context/LabContext";
import { useAuth } from "../context/AuthContext";
import {
  getAliquotQueue,
  linkAliquotApi,
  skipAliquotApi,
  endCentrifugeApi,
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
import { StatusBadge } from "../components/shared/StatusBadge";
import { QueueSampleRow } from "../components/shared/QueueSampleRow";
import { RemarkModal } from "../components/shared/Modal";
import { AliquotSkipRemarkCell } from "../components/shared/AliquotSkipRemarkCell";
import { ScrollableSelect } from "../components/shared/ScrollableSelect";
import { AuditHistoryModal } from "../components/shared/AuditHistoryModal.jsx";
import { DbAuditHistoryTableBody } from "../components/shared/DbAuditHistoryTableBody.jsx";
import { resolveActiveProjectId } from "../services/barcodeGenerationService";
import { nowIso } from "../services/workflowService";
import { formatDoseDisplayLabel, formatTimepointDisplayLabel, formatTimepointWithDose } from "../utils/visitDisplay";
import { useViewport } from "../hooks/useViewport";
import { UI_LABELS } from "../constants/displayLabels";
import {
  formatParticipantDisplay,
  formatParticipantDropdownLabel,
  resolveSiteRandomizationNumber,
} from "../utils/participantDisplay";
import { ALIQUOT_PARENT_STATUSES } from "../shared/domain/activityStatuses.js";

function renderAliquotSkipRemark(child, onEdit, onOpenAudit) {
  if (!child?.skippedAt || !child.skippedReason) return null;
  const hasAudit = Boolean(child.activityExecutionAliquotNo);
  return (
    <AliquotSkipRemarkCell
      reason={child.skippedReason}
      onEdit={onEdit}
      hasAudit={hasAudit}
      onOpenAudit={onOpenAudit}
    />
  );
}

function AliquotPage() {
  const { state } = useLab();
  const { user, activeSite } = useAuth();
  const authProject = String(user?.project || "").trim();
  const authSite = String(activeSite || user?.site || "").trim();
  const { isMobileOrTablet } = useViewport();
  const [subjectFilter, setSubjectFilter] = useState("");
  const [doseFilter, setDoseFilter] = useState("");
  const [showAllQueue, setShowAllQueue] = useState(false);
  const [skipTargetId, setSkipTargetId] = useState(null);
  const [skipRemarkEditTargetId, setSkipRemarkEditTargetId] = useState(null);
  const [scanAlert, setScanAlert] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [aliquotsModalParentId, setAliquotsModalParentId] = useState(null);
  const [aliquotsModalReturnParentId, setAliquotsModalReturnParentId] = useState(null);
  const [hasScannedParent, setHasScannedParent] = useState(false);
  const [mobileAccordionOpen, setMobileAccordionOpen] = useState(true);
  const [dbAuditTarget, setDbAuditTarget] = useState(null);
  const [saving, setSaving] = useState(false);

  const activeProjectId = resolveActiveProjectId(state);

  const [pageRecords, setPageRecords] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [subjectOptions, setSubjectOptions] = useState([]);
  const [doseOptions, setDoseOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeParentRecord, setActiveParentRecord] = useState(null);

  const subjectMstNo = subjectMstNoFromFilterId(subjectFilter);
  const canShowAll = subjectMstNo > 0;
  const effectiveShowAll = showAllQueue && canShowAll;
  const requestSeq = useRef(0);

  const reloadQueue = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const data = await getAliquotQueue({
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
      console.error("Failed to load aliquot queue:", err);
      setScanAlert(err?.response?.data?.message || err?.message || "Failed to reload queue.");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [page, pageSize, subjectMstNo, doseFilter, effectiveShowAll]);

  useEffect(() => {
    reloadQueue();
  }, [reloadQueue, activeProjectId, authProject, authSite]);

  const projectSamples = useMemo(
    () =>
      pageRecords.map((record) =>
        mapQueueRecordToSample(record, undefined, { includeAliquots: true })
      ),
    [pageRecords]
  );

  // Resolve a scanned PK parent to its raw record: prefer the current page, else exact lookup.
  const resolveScanRecord = useCallback(
    async (pkCode) => {
      const onPage = pageRecords.find(
        (r) => String(r.barcodeValue || "").toUpperCase() === pkCode
      );
      if (onPage) return onPage;
      try {
        const data = await getAliquotQueue({ scanCode: pkCode });
        return (data.records || [])[0] || null;
      } catch {
        return null;
      }
    },
    [pageRecords]
  );

  // Re-fetch the active parent after a mutation so its aliquot slots stay current even off-page.
  const refreshActiveParent = useCallback(async () => {
    if (!activeParentRecord) return;
    const barcode = String(activeParentRecord.barcodeValue || "").toUpperCase();
    if (!barcode) return;
    try {
      const data = await getAliquotQueue({ scanCode: barcode });
      setActiveParentRecord((data.records || [])[0] || null);
    } catch {
      /* keep current active parent */
    }
  }, [activeParentRecord]);

  const subjectsWithParents = useMemo(
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
  const visibleParents = projectSamples;

  const activeParent = useMemo(() => {
    if (activeParentRecord) {
      const mapped = mapQueueRecordToSample(activeParentRecord, undefined, {
        includeAliquots: true,
      });
      if (ALIQUOT_PARENT_STATUSES.includes(mapped.status)) return mapped;
    }
    return projectSamples.find((s) => s.status === "Ready For Aliquot");
  }, [activeParentRecord, projectSamples]);

  const isActiveParentReviewLocked = isExecutionReviewLocked(activeParent?.reviewStatus);

  const aliquotsModalParent = aliquotsModalParentId
    ? projectSamples.find((s) => s.id === aliquotsModalParentId)
    : null;

  const activeParentDoseStr = activeParent ? activeParent.dose : "";

  const activeChildren = activeParent ? activeParent.aliquots || [] : [];
  const activeParentExpectedBarcodes = activeParent ? activeParent.expectedBarcodes || [] : [];
  const activeCompletedCount = activeChildren.filter((a) => a.createdAt || a.skippedAt).length;

  const skipTarget = useMemo(() => {
    if (!skipTargetId || !activeParent) return undefined;
    const fromChildren = (activeParent.aliquots || []).find((a) => a.id === skipTargetId);
    if (fromChildren) return fromChildren;
    if (String(skipTargetId).startsWith("pending-")) {
      const barcode = String(skipTargetId).slice("pending-".length);
      return { id: skipTargetId, barcode, createdAt: null, skippedAt: null };
    }
    return undefined;
  }, [skipTargetId, activeParent]);
  const skipRemarkEditTarget = useMemo(() => {
    if (!skipRemarkEditTargetId) return undefined;
    const parents = [
      activeParent,
      aliquotsModalParent,
      aliquotsModalReturnParentId
        ? projectSamples.find((s) => s.id === aliquotsModalReturnParentId)
        : null,
      ...projectSamples,
    ].filter(Boolean);
    for (const parent of parents) {
      const found = (parent.aliquots || []).find((a) => a.id === skipRemarkEditTargetId);
      if (found) return found;
    }
    return undefined;
  }, [
    skipRemarkEditTargetId,
    activeParent,
    aliquotsModalParent,
    aliquotsModalReturnParentId,
    projectSamples,
  ]);

  const resumeAliquotsModalIfSuspended = () => {
    if (!aliquotsModalReturnParentId) return;
    setAliquotsModalParentId(aliquotsModalReturnParentId);
    setAliquotsModalReturnParentId(null);
  };

  const openSkipRemarkEdit = (aliquotId, parentSample) => {
    if (isExecutionReviewLocked(parentSample?.reviewStatus)) {
      setScanAlert("This record is under review and cannot be edited.");
      return;
    }
    if (aliquotsModalParentId) {
      setAliquotsModalReturnParentId(aliquotsModalParentId);
      setAliquotsModalParentId(null);
    }
    setSkipRemarkEditTargetId(aliquotId);
  };

  const closeSkipRemarkEdit = () => {
    setSkipRemarkEditTargetId(null);
    resumeAliquotsModalIfSuspended();
  };

  const openSkipRemarkAudit = (child) => {
    if (!child?.activityExecutionAliquotNo) return;
    setDbAuditTarget({
      tableName: "ActivityExecutionAliquot",
      recordId: child.activityExecutionAliquotNo,
      fieldName: "vSkipRemark",
      title: "Skip Remark Audit",
    });
  };

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
    setHasScannedParent(false);
    setActiveParentRecord(null);
    setAliquotsModalParentId(null);
    setAliquotsModalReturnParentId(null);
    setSkipTargetId(null);
    setSkipRemarkEditTargetId(null);
    setDbAuditTarget(null);
  }, [activeProjectId, authProject, authSite]);

  useEffect(() => {
    setPage(1);
  }, [subjectFilter, doseFilter, showAllQueue, pageSize]);

  useEffect(() => {
    if (!canShowAll && showAllQueue) setShowAllQueue(false);
  }, [canShowAll, showAllQueue]);

  const parentCandidates = useMemo(() => {
    const list = [...projectSamples];
    const returnParent = aliquotsModalReturnParentId
      ? projectSamples.find((s) => s.id === aliquotsModalReturnParentId)
      : null;
    for (const candidate of [activeParent, aliquotsModalParent, returnParent]) {
      if (candidate && !list.some((p) => p.id === candidate.id)) list.push(candidate);
    }
    return list;
  }, [projectSamples, activeParent, aliquotsModalParent, aliquotsModalReturnParentId]);

  const findParentForAliquot = (aliquotId) =>
    parentCandidates.find((s) => (s.aliquots || []).some((a) => a.id === aliquotId));

  const handleSkipAliquot = async (aliquot, remark) => {
    const parent =
      (aliquot?.id && findParentForAliquot(aliquot.id)) || activeParent;
    if (!parent || !aliquot?.barcode) return;
    if (isExecutionReviewLocked(parent.reviewStatus)) {
      setScanAlert("This record is under review and cannot be edited.");
      setSkipTargetId(null);
      return;
    }
    setSaving(true);
    try {
      await skipAliquotApi({
        subjectMstNo: parent.subjectMstNo,
        activityConfigTimePointNo: parent.activityConfigTimePointNo,
        barcodeValue: aliquot.barcode,
        skipRemark: remark,
      });
      setSkipTargetId(null);
      await Promise.all([reloadQueue(), refreshActiveParent()]);
    } catch (err) {
      setScanAlert(err?.response?.data?.message || err?.message || "Failed to skip aliquot.");
    } finally {
      setSaving(false);
    }
  };

  const handleEditSkipRemark = async (aliquot, remark) => {
    const parent = findParentForAliquot(aliquot.id) || activeParent || aliquotsModalParent;
    if (!parent || !aliquot?.barcode) return;
    if (isExecutionReviewLocked(parent.reviewStatus)) {
      setScanAlert("This record is under review and cannot be edited.");
      closeSkipRemarkEdit();
      return;
    }
    setSaving(true);
    try {
      await skipAliquotApi({
        subjectMstNo: parent.subjectMstNo,
        activityConfigTimePointNo: parent.activityConfigTimePointNo,
        barcodeValue: aliquot.barcode,
        skipRemark: remark,
      });
      closeSkipRemarkEdit();
      await Promise.all([reloadQueue(), refreshActiveParent()]);
    } catch (err) {
      setScanAlert(err?.response?.data?.message || err?.message || "Failed to update skip remark.");
    } finally {
      setSaving(false);
    }
  };

  const handleScan = async (code) => {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    setScanAlert(null);

    if (normalized.startsWith("PK")) {
      const scannedRecord = await resolveScanRecord(normalized);
      if (!scannedRecord) {
        setScanAlert(`Unknown PK barcode: ${normalized}`);
        return;
      }
      const scannedSample = mapQueueRecordToSample(scannedRecord, undefined, {
        includeAliquots: true,
      });
      const intent = resolveQueuePkScanIntent([scannedSample], normalized);
      if (intent.type === "aliquot") {
        setActiveParentRecord(scannedRecord);
        setHasScannedParent(true);
        setMobileAccordionOpen(true);
        return;
      }
      if (intent.type === "endCentrifugation") {
        setSaving(true);
        try {
          await endCentrifugeApi({
            subjectMstNo: intent.sample.subjectMstNo,
            activityConfigTimePointNo: intent.sample.activityConfigTimePointNo,
            actualTime: nowIso(),
          });
          setActiveParentRecord(scannedRecord);
          setHasScannedParent(true);
          setMobileAccordionOpen(true);
          await Promise.all([reloadQueue(), refreshActiveParent()]);
        } catch (err) {
          setScanAlert(err?.response?.data?.message || err?.message || "Failed to end centrifugation.");
        } finally {
          setSaving(false);
        }
        return;
      }
      if (intent.type === "startCentrifugation") {
        setScanAlert(
          `${intent.sample.barcode} has not started centrifugation yet. Complete centrifugation first.`
        );
        return;
      }
      setScanAlert(
        intent.type === "error"
          ? intent.message
          : "Scan a centrifugation-started or ready PK parent before aliquots."
      );
      return;
    }

    if (normalized.startsWith("AL")) {
      if (!activeParent) {
        setScanAlert("Scan a centrifugation-started or ready PK parent first.");
        return;
      }
      if (isActiveParentReviewLocked) {
        setScanAlert("This record is under review and cannot be edited.");
        return;
      }
      if (!activeParentExpectedBarcodes.some((expected) => expected.toUpperCase() === normalized)) {
        setScanAlert(`Wrong aliquot. ${normalized} does not belong to ${activeParent.barcode}.`);
        return;
      }
      setSaving(true);
      try {
        await linkAliquotApi({
          subjectMstNo: activeParent.subjectMstNo,
          activityConfigTimePointNo: activeParent.activityConfigTimePointNo,
          barcodeValue: normalized,
        });
        await Promise.all([reloadQueue(), refreshActiveParent()]);
      } catch (err) {
        setScanAlert(err?.response?.data?.message || err?.message || "Failed to link aliquot.");
      } finally {
        setSaving(false);
      }
      return;
    }

    setScanAlert("Scan a PK parent barcode or expected aliquot barcode.");
  };

  const aliquotInlineListEl = activeParent ? (
    <div className="aliquot-inline-list">
      {activeParentExpectedBarcodes.map((barcode, index) => {
        const child =
          activeChildren.find((a) => a.barcode.toUpperCase() === barcode.toUpperCase()) ??
          activeChildren[index];
        const skipChild = child
          ? { ...child, barcode: child.barcode || barcode }
          : { id: `pending-${barcode}`, barcode, createdAt: null, skippedAt: null };
        return (
          <div key={barcode} className="aliquot-modal-list__item">
            <div className="aliquot-modal-list__main">
              <span className="mono">{barcode}</span>
              {renderAliquotSkipRemark(
                child,
                isActiveParentReviewLocked
                  ? undefined
                  : () => child && openSkipRemarkEdit(child.id, activeParent),
                () => child && openSkipRemarkAudit(child)
              )}
            </div>
            <div className="aliquot-modal-list__status">
              <StatusBadge
                status={child?.createdAt ? "Completed" : child?.skippedAt ? "Skipped" : "Upcoming"}
              />
              {!skipChild.createdAt && !skipChild.skippedAt && !isActiveParentReviewLocked && (
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  disabled={saving}
                  onClick={() => setSkipTargetId(skipChild.id)}
                >
                  Missed/Skip
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  ) : null;

  const activeParentProgressEl = activeParent ? (
    <div className="aliquot-progress aliquot-progress--inline">
      <span>{activeCompletedCount}</span>
      <small>/ {activeParent.expectedAliquots}</small>
    </div>
  ) : null;

  return (
    <div className="page page--queue page--aliquots" data-tour="page-form">
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
            placeholder=""
            onScan={handleScan}
            showFeedback={false}
            phase="Barcode Scan"
            instruction=""
          />
        </div>

        {activeParent ? (
          <Fragment>
            <section className="card active-parent-card active-parent-card--desktop queue-side-card">
              <span className="section-label">Active Aliquot Parent</span>
              <div className="active-parent-card__head">
                <div>
                  <h2 className="preserve-case">
                    {formatTimepointWithDose(
                      activeParent.timepointLabel ?? activeParent.timepoint,
                      activeParentDoseStr
                    )}{" "}
                    <span className="mono">({activeParent.barcode})</span>
                  </h2>
                  <p>
                    {(() => {
                      const sub = state.subjects.find((item) => item.id === activeParent.subjectId);
                      return (
                        (sub && formatParticipantDisplay(sub)) ||
                        activeParent.siteRandomizationNo ||
                        resolveSiteRandomizationNumber({
                          subjectNumber: activeParent.subjectNumber,
                        })
                      );
                    })()}
                  </p>
                </div>
                {activeParentProgressEl}
              </div>
              {aliquotInlineListEl}
            </section>

            {hasScannedParent && activeParent && (
              <details
                className="card active-parent-card active-parent-accordion--mobile"
                open={mobileAccordionOpen}
                onToggle={(e) => setMobileAccordionOpen(e.target.open)}
              >
                <summary className="active-parent-accordion__summary">
                  <span className="active-parent-accordion__summary-main">
                    <strong className="preserve-case">
                      {formatTimepointWithDose(
                        activeParent.timepointLabel ?? activeParent.timepoint,
                        activeParentDoseStr
                      )}{" "}
                      <span className="mono">({activeParent.barcode})</span>
                    </strong>
                    <span>
                      {(() => {
                        const sub = state.subjects.find((item) => item.id === activeParent.subjectId);
                        return (
                          (sub && formatParticipantDisplay(sub)) ||
                          activeParent.siteRandomizationNo ||
                          resolveSiteRandomizationNumber({
                            subjectNumber: activeParent.subjectNumber,
                          })
                        );
                      })()}
                    </span>
                  </span>
                  {activeParentProgressEl}
                </summary>
                <div className="active-parent-accordion__body">{aliquotInlineListEl}</div>
              </details>
            )}
          </Fragment>
        ) : (
          <section className="card active-parent-card active-parent-card--desktop queue-side-card queue-side-card--empty">
            <span className="section-label">Active Aliquot Parent</span>
            <p className="empty-state">
              No active parent. Scan a centrifugation-started or ready PK parent sample.
            </p>
          </section>
        )}

        <section className="card collapsible-card centrifuge-queue-inline">
          <div className="centrifuge-queue__head">
            <span className="centrifuge-queue__title">Parent Samples For Aliquot</span>
            <div className="centrifuge-queue__controls">
              <label className="field centrifuge-queue__filter centrifuge-queue__filter--participant">
                <span>{UI_LABELS.participant}</span>
                <ScrollableSelect
                  value={subjectFilter}
                  onChange={setSubjectFilter}
                  options={subjectsWithParents.map((subject) => ({
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
          <div className="sample-table sample-table--aliquot centrifuge-queue__table">
            <div className="sample-table__head">
              <span>Parent PK Tube</span>
              <span>{UI_LABELS.participant}</span>
              <span>Dose</span>
              <span>Timepoint</span>
              <span>Expected</span>
              <span>Linked</span>
              <span>Action</span>
            </div>
            {visibleParents.map((s) => {
              const linked = (s.aliquots || []).filter((a) => a.createdAt || a.skippedAt).length;
              const isActive = activeParent && activeParent.id === s.id;
              const sub = state.subjects.find((item) => item.id === s.subjectId);
              const subjectDisplay =
                (sub && formatParticipantDisplay(sub)) ||
                s.siteRandomizationNo ||
                resolveSiteRandomizationNumber({ subjectNumber: s.subjectNumber });
              return (
                <QueueSampleRow
                  key={s.id}
                  timepoint={s.timepoint}
                  barcode={s.barcode}
                  subject={subjectDisplay}
                  className={isActive ? "sample-table__row--active" : ""}
                >
                  <span className="mono" data-label="Parent PK Tube">
                    {s.barcode}
                  </span>
                  <span data-label={UI_LABELS.participant}>{subjectDisplay}</span>
                  <span className="preserve-case" data-label="Dose">{formatDoseDisplayLabel(s.dose)}</span>
                  <span className="preserve-case" data-label="Timepoint">{formatTimepointDisplayLabel(s.timepoint, s.dose)}</span>
                  <span data-label="Expected">{s.expectedAliquots}</span>
                  <span data-label="Linked">
                    {linked} / {s.expectedAliquots}
                  </span>
                  <span data-label="Action">
                    {s.status === "Centrifuging" ? (
                      <span style={{ color: "var(--blue)", fontWeight: "600", fontSize: "12px" }}>
                        Centrifuging
                      </span>
                    ) : s.status === "Ready For Aliquot" ? (
                      <span style={{ color: "var(--text-secondary)", fontWeight: "600", fontSize: "12px" }}>
                        Ready
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--sm btn--secondary"
                        onClick={() => setAliquotsModalParentId(s.id)}
                      >
                        View Aliquots
                      </button>
                    )}
                  </span>
                </QueueSampleRow>
              );
            })}
            {!loading && totalCount === 0 && (
              <p className="empty-state">
                {showAllQueue
                  ? "No parent samples for the selected filters."
                  : "No pending parent samples. Select a participant and check Show all to include completed parents."}
              </p>
            )}
          </div>
          {totalCount > PAGE_SIZE && (
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
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <span>
                  {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <RemarkModal
        open={!!skipTarget}
        title={`Skip Aliquot — ${skipTarget?.barcode ?? ""}`}
        placeholder="Enter reason, e.g. tube not found or insufficient plasma..."
        submitLabel="Confirm Skip"
        required
        onClose={() => !saving && setSkipTargetId(null)}
        onSubmit={(text) => {
          if (!skipTarget) return;
          handleSkipAliquot(skipTarget, text);
        }}
      />

      <RemarkModal
        open={!!skipRemarkEditTarget}
        title={`Edit Skip Remark — ${skipRemarkEditTarget?.barcode ?? ""}`}
        placeholder="Enter reason, e.g. tube not found or insufficient plasma..."
        initialValue={skipRemarkEditTarget?.skippedReason ?? ""}
        submitLabel="Save Remark"
        required
        onClose={() => !saving && closeSkipRemarkEdit()}
        onSubmit={(text) => {
          if (!skipRemarkEditTarget) return;
          handleEditSkipRemark(skipRemarkEditTarget, text);
        }}
      />

      {aliquotsModalParent && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3 className="modal__title">Aliquots Details</h3>

            <div style={{ marginBottom: "14px", display: "flex", flexDirection: "column", gap: "4px" }}>
              <span className="section-label" style={{ marginBottom: "0" }}>
                Parent: {aliquotsModalParent.barcode}
              </span>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                {UI_LABELS.participant}:{" "}
                {resolveSiteRandomizationNumber({
                  subjectId: aliquotsModalParent.subjectId,
                  subjects: state.subjects,
                  subjectNumber:
                    aliquotsModalParent.siteRandomizationNo || aliquotsModalParent.subjectNumber,
                })}
              </span>
            </div>

            <div className="review-detail-modal__aliquot-grid">
              {(aliquotsModalParent.aliquots || []).map((alq) => {
                const status = String(alq.status ?? "").toLowerCase();
                const tone = alq.skippedAt || status === "skipped" || status === "missed"
                  ? "skipped"
                  : alq.createdAt || status === "linked" || status === "stored" || status === "completed" || status === "scanned"
                    ? "scanned"
                    : "missing";
                const toneLabel = tone === "scanned" ? "Scanned" : tone === "skipped" ? "Skipped" : "Missing";
                return (
                  <div
                    key={alq.id}
                    className={`review-detail-modal__aliquot-box review-detail-modal__aliquot-box--${tone}`}
                    title={alq.skippedReason || toneLabel}
                  >
                    <div className="review-detail-modal__aliquot-head">
                      <span className="mono review-detail-modal__aliquot-code">{alq.barcode}</span>
                      <span className="review-detail-modal__aliquot-tone">{toneLabel}</span>
                    </div>
                    {renderAliquotSkipRemark(
                      alq,
                      isExecutionReviewLocked(aliquotsModalParent.reviewStatus)
                        ? undefined
                        : () => openSkipRemarkEdit(alq.id, aliquotsModalParent),
                      () => openSkipRemarkAudit(alq)
                    )}
                  </div>
                );
              })}
            </div>

            <div className="modal__actions modal__actions--center">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setAliquotsModalParentId(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
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
            fieldName={dbAuditTarget.fieldName}
            customLabel="Skip Remark"
          />
        )}
      </AuditHistoryModal>
    </div>
  );
}

export default AliquotPage;
