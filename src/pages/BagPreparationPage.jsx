import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isSiteUserProfile } from "../constants/profileCodes";
import { useViewport } from "../hooks/useViewport";
import { BarcodeCameraModal } from "../components/shared/BarcodeCameraModal";
import { ScrollableSelect } from "../components/shared/ScrollableSelect";
import { PasswordConfirmModal, RemarkModal } from "../components/shared/Modal";
import { AuditHistoryModal } from "../components/shared/AuditHistoryModal.jsx";
import { DbAuditHistoryTableBody } from "../components/shared/DbAuditHistoryTableBody.jsx";
import { validatePassword } from "../features/auth/api/authApi";
import { fetchSubjectsList } from "../features/participants/api/participantsApi.js";
import { getProjectSites } from "../shared/api/projectMasterApi.js";
import {
  createBagPreparation,
  exportDispatchedBags,
  fetchBagPrepFormOptions,
  fetchBagPreparations,
  fetchEligibleBagPrepParticipants,
  fetchExpectedAliquots,
  getBagExportLogs,
  inactivateBagPreparation,
  reactivateBagPreparation,
  updateBagPreparation,
  updateBagPreparationStatus,
  validateBagPrepBarcode,
} from "../features/bagPreparation/api/bagPreparationsApi.js";
import { BagExportLogModal } from "../features/bagPreparation/components/BagExportLogModal.jsx";

function normalizeCode(code) {
  return String(code ?? "").trim().toUpperCase();
}

/** @param {string | { text?: string, tone?: string } | null} alert */
function scanAlertText(alert) {
  if (!alert) return "";
  if (typeof alert === "string") return alert;
  return String(alert.text || "").trim();
}

/** @param {string | { text?: string, tone?: string } | null} alert */
function scanAlertToneClass(alert) {
  const tone = typeof alert === "object" && alert ? String(alert.tone || "").toLowerCase() : "warning";
  if (tone === "success" || tone === "ok") return "soft-alert-toast--success";
  if (tone === "error") return "soft-alert-toast--error";
  return "soft-alert-toast--warning";
}

function mapSubjectRow(row) {
  const participantNo = String(row?.siteRandomizationNo ?? row?.SiteRandomizationNo ?? "").trim();
  const siteCode = String(row?.siteCode ?? row?.SiteCode ?? row?.siteNo ?? row?.SiteNo ?? "").trim();
  return {
    participantNo,
    siteCode,
    initials: String(row?.initials ?? row?.Initials ?? "").trim(),
    subjectMstNo: Number(row?.subjectMstNo ?? row?.SubjectMstNo) || 0,
  };
}

function apiErrorMessage(err, fallback) {
  return (
    err?.response?.data?.message ||
    err?.response?.data?.Message ||
    err?.message ||
    fallback
  );
}

function parseBatchNo(batchIdOrLabel) {
  const raw = String(batchIdOrLabel ?? "").trim();
  const fromId = Number(raw);
  if (Number.isFinite(fromId) && fromId > 0) return fromId;
  const m = raw.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

function matchSiteCodes(a, b) {
  const normA = String(a ?? "").trim().toLowerCase();
  const normB = String(b ?? "").trim().toLowerCase();
  if (!normA || !normB) return false;
  const digitsA = normA.match(/\d+/)?.[0] || normA;
  const digitsB = normB.match(/\d+/)?.[0] || normB;
  return digitsA === digitsB || normA.includes(normB) || normB.includes(normA);
}

function parseAliquotPayload(raw) {
  const empty = { codes: [], count: 0, skippedSlots: [] };
  if (!raw || String(raw).trim() === "") return empty;
  const s = String(raw).trim();
  const tokens = s.split(",").map((x) => x.trim());
  const codes = tokens.filter((t) => t && t.toUpperCase() !== "SKIPPED" && t.toLowerCase() !== "pending");
  const skippedSlots = tokens
    .map((t, i) => (t.toUpperCase() === "SKIPPED" ? i + 1 : null))
    .filter(Boolean);
  return { codes, count: codes.length, skippedSlots };
}

function hasPendingAliquotTokens(rawOrRows) {
  if (Array.isArray(rawOrRows)) {
    return rawOrRows.some((r) => {
      const v = String(r?.value ?? "").trim();
      return !v || v.toUpperCase() === "PENDING";
    });
  }
  const s = String(rawOrRows ?? "").trim();
  if (!s) return true;
  return s.split(",").some((t) => {
    const v = t.trim();
    return !v || v.toUpperCase() === "PENDING";
  });
}

/** Pending slots that need their own missing remark (not one shared bag remark). */
function getPendingAliquotSlots(aliquotRowsOrCsv, expectedAliquots = []) {
  if (Array.isArray(aliquotRowsOrCsv)) {
    return aliquotRowsOrCsv
      .map((row, idx) => {
        const value = String(row?.value ?? "").trim();
        const expected = expectedAliquots[idx] || {};
        return {
          index: idx,
          value,
          label: expected.timepoint || expected.label || `Slot ${idx + 1}`,
          code: expected.expectedCode || expected.code || "",
        };
      })
      .filter((s) => !s.value || s.value.toUpperCase() === "PENDING");
  }

  return String(aliquotRowsOrCsv || "")
    .split(",")
    .map((token, idx) => ({
      index: idx,
      value: String(token || "").trim(),
      label: `Slot ${idx + 1}`,
      code: "",
    }))
    .filter((s) => !s.value || s.value.toUpperCase() === "PENDING");
}

function serializeSlotRemarks(remarksByIndex) {
  const out = {};
  Object.entries(remarksByIndex || {}).forEach(([key, value]) => {
    const text = String(value || "").trim();
    if (!text) return;
    out[String(key)] = text;
  });
  return JSON.stringify(out);
}

function formatAliquotBarcodesCell(raw) {
  const { codes, count } = parseAliquotPayload(raw);
  if (count === 0) return "—";
  return codes.join(", ");
}

/** Shows native tooltip only when text is truncated with ellipsis. */
function TruncatedWithTooltip({ text, style, className }) {
  const ref = useRef(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const full = String(text ?? "");
      setTitle(el.scrollWidth > el.clientWidth + 1 ? full : "");
    };
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [text]);

  return (
    <div
      ref={ref}
      className={className}
      title={title || undefined}
      style={{
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        width: "100%",
        ...style,
      }}
    >
      {text}
    </div>
  );
}

/** Status chip classes: Pending=amber, Prepared=green, Dispatched=blue, Inactive=gray */
function bagPrepStatusClass(row) {
  if (!row?.isActive) return "status--inactive";
  if (row.status === "Dispatched") return "status--ready";
  if (row.status === "Prepared") return "status--completed";
  if (row.status === "Pending") return "status--upcoming";
  return "status--neutral";
}

function bagPrepStatusLabel(row) {
  if (!row?.isActive) return "Inactive";
  return row.status || "Pending";
}

function formatPerformedOn(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Row actions menu rendered via portal so table overflow does not clip it. */
function BagPrepRowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 160;
    const left = Math.min(rect.left, window.innerWidth - menuWidth - 8);
    setPosition({ top: rect.bottom + 4, left: Math.max(8, left) });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  if (!items?.length) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--ghost btn--sm"
        aria-label="More actions"
        aria-expanded={open}
        aria-haspopup="menu"
        style={{ padding: "2px 6px", minWidth: "22px", fontSize: "0.875rem", height: "24px", lineHeight: 1 }}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          updatePosition();
          setOpen(true);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="8" cy="3" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="8" cy="13" r="1.4" />
        </svg>
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{
                position: "fixed",
                top: position.top,
                left: position.left,
                zIndex: 3000,
                minWidth: "148px",
                padding: "4px 0",
                background: "#fff",
                border: "1px solid #cbd5e1",
                borderRadius: "8px",
                boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
              }}
            >
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "8px 12px",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    color: item.danger ? "#ef4444" : "#0f172a",
                  }}
                  onClick={() => {
                    setOpen(false);
                    item.onClick?.();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function buildBagPrepMenuItems(row, { includeView, includeViewAliquots = true, onView, onViewAliquots, onMarkPrepared, onDispatch, onExportLog, onInactivate, onReactivate, onAudit }) {
  const items = [];
  if (includeView && row.status !== "Pending") {
    items.push({ key: "view", label: "View", onClick: onView });
  }
  if (includeViewAliquots) {
    items.push({ key: "aliquots", label: "View Aliquots", onClick: onViewAliquots });
  }
  if (row.isActive) {
    if (row.status === "Pending") {
      items.push({ key: "prepared", label: "Mark Prepared", onClick: onMarkPrepared });
      items.push({ key: "inactive", label: "Inactive", danger: true, onClick: onInactivate });
    }
    if (row.status === "Prepared") {
      items.push({ key: "dispatch", label: "Dispatch", onClick: onDispatch });
    }
    if (row.status === "Dispatched" && onExportLog) {
      items.push({ key: "export-log", label: "Dispatch Audit", onClick: onExportLog });
    }
  } else {
    items.push({ key: "reactivate", label: "Reactivate", onClick: onReactivate });
  }
  items.push({ key: "audit", label: "Audit", onClick: onAudit });
  return items;
}

export function BagPreparationPage() {
  const navigate = useNavigate();
  const { user, activeSite } = useAuth();
  const { isMobile, isTablet, isMobileOrTablet } = useViewport();
  const isSiteUser = useMemo(() => isSiteUserProfile(user?.profileCode), [user]);
  const authProject = String(user?.project || "").trim();
  const authSite = String(activeSite || user?.site || "").trim();
  // Prefer full site code from header JWT (e.g. 0235-24-101); matchSiteCodes handles short/long forms.
  const userSite = useMemo(() => authSite, [authSite]);

  const [records, setRecords] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [projectSites, setProjectSites] = useState([]);
  const [formOptions, setFormOptions] = useState({ periods: [], batches: [], aliquotsPerSeparation: 3 });
  const [eligibleParticipants, setEligibleParticipants] = useState([]);
  const [eligibleParticipantsLoading, setEligibleParticipantsLoading] = useState(false);
  const [expectedAliquots, setExpectedAliquots] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [saving, setSaving] = useState(false);
  const [scanAlert, setScanAlert] = useState(null);

  const reloadList = useCallback(async () => {
    setListLoading(true);
    setListError("");
    try {
      const rows = await fetchBagPreparations();
      setRecords(Array.isArray(rows) ? rows : []);
    } catch (err) {
      const msg = apiErrorMessage(err, "Failed to load bag preparations.");
      setScanAlert(msg);
      setListError(msg);
      setRecords([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [subjectRows, siteRows, options] = await Promise.all([
          fetchSubjectsList(),
          getProjectSites(),
          fetchBagPrepFormOptions(),
        ]);
        if (cancelled) return;
        setSubjects((Array.isArray(subjectRows) ? subjectRows : []).map(mapSubjectRow).filter((s) => s.participantNo));
        setProjectSites(Array.isArray(siteRows) ? siteRows : []);
        setFormOptions(options || { periods: [], batches: [], aliquotsPerSeparation: 3 });
      } catch (err) {
        if (!cancelled) {
          setScanAlert(apiErrorMessage(err, "Failed to load form options."));
        }
      }
      if (!cancelled) {
        await reloadList();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadList, authProject, authSite]);



  const [filterSite, setFilterSite] = useState("");
  const [filterSubject, setFilterSubject] = useState("");
  const [filterPeriod, setFilterPeriod] = useState("");
  const [filterBatch, setFilterBatch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [showForm, setShowForm] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [contextRecord, setContextRecord] = useState(null);
  const [viewAliquotsRecord, setViewAliquotsRecord] = useState(null);
  const [viewAliquotSlots, setViewAliquotSlots] = useState([]);
  const [sendConfirmRecord, setSendConfirmRecord] = useState(null);
  const [exportLogOpen, setExportLogOpen] = useState(false);
  /** @type {[{ bagPreparationNo: number, bagBarcode: string } | null, Function]} */
  const [exportLogScope, setExportLogScope] = useState(null);
  const [exportLogs, setExportLogs] = useState([]);
  const [exportLogsLoading, setExportLogsLoading] = useState(false);
  const [exportingLogId, setExportingLogId] = useState(null);
  /** @type {[{ type: string, record?: object, statusOverride?: string } | null, Function]} */
  const [remarkPrompt, setRemarkPrompt] = useState(null);
  const [auditRecord, setAuditRecord] = useState(null);
  const [siteKey, setSiteKey] = useState("");

  // Keep create/filter site aligned with header when login site changes.
  useEffect(() => {
    if (!authSite) return;
    if (isSiteUser) {
      setSiteKey(authSite);
    }
    setFilterSite(authSite);
  }, [authSite, isSiteUser]);

  const [participantNo, setParticipantNo] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [bagBarcode, setBagBarcode] = useState("");
  const [isBagVerified, setIsBagVerified] = useState(false);
  const [aliquotRows, setAliquotRows] = useState([]);
  const [aliquotScanInput, setAliquotScanInput] = useState("");
  /** @type {["bag" | "aliquot" | null, Function]} */
  const [cameraTarget, setCameraTarget] = useState(null);
  const bagScanRef = useRef(null);

  useEffect(() => {
    const targetSite = isSiteUser ? userSite : siteKey;
    if (!targetSite) {
      setEligibleParticipants([]);
      setEligibleParticipantsLoading(false);
      return undefined;
    }

    let cancelled = false;
    setEligibleParticipantsLoading(true);
    (async () => {
      try {
        const rows = await fetchEligibleBagPrepParticipants(targetSite);
        if (!cancelled) {
          setEligibleParticipants(Array.isArray(rows) ? rows : []);
        }
      } catch (err) {
        if (!cancelled) {
          setEligibleParticipants([]);
          setScanAlert(apiErrorMessage(err, "Failed to load participants ready for bag preparation."));
        }
      } finally {
        if (!cancelled) setEligibleParticipantsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isSiteUser, userSite, siteKey, authProject]);

  useEffect(() => {
    if (!scanAlert) return undefined;
    const id = setTimeout(() => setScanAlert(null), 4000);
    return () => clearTimeout(id);
  }, [scanAlert]);

  const siteOptions = useMemo(() => {
    const fromProjects = projectSites
      .map((s) => String(s.siteCode ?? s.SiteCode ?? s.siteNo ?? s.SiteNo ?? "").trim())
      .filter(Boolean);
    if (fromProjects.length > 0) return [...new Set(fromProjects)].sort();
    return [...new Set(subjects.map((s) => s.siteCode).filter(Boolean))].sort();
  }, [projectSites, subjects]);

  const participantOptions = useMemo(() => {
    const targetSite = isSiteUser ? userSite : siteKey;
    if (!targetSite) return [];
    return eligibleParticipants.filter((p) => matchSiteCodes(p.siteCode, targetSite));
  }, [siteKey, isSiteUser, userSite, eligibleParticipants]);

  const periodOptions = useMemo(
    () =>
      (formOptions.periods || []).map((p) => ({
        id: p.periodId,
        label: p.label || `Period ${p.period}`,
        period: p.period,
      })),
    [formOptions.periods]
  );

  const readyPeriodOptions = useMemo(() => {
    const participant = eligibleParticipants.find(
      (p) => normalizeCode(p.participantNo) === normalizeCode(participantNo)
    );
    return (participant?.readyPeriods || []).map((p) => ({
      id: p.periodId,
      label: p.label || `Period ${p.period}`,
      period: p.period,
    }));
  }, [eligibleParticipants, participantNo]);

  useEffect(() => {
    if (!showForm || modalMode !== "create" || eligibleParticipantsLoading) return;
    // Bag barcode API already validated participant/period — don't wipe after scan.
    if (isBagVerified) return;

    const participantStillEligible = participantOptions.some(
      (p) => normalizeCode(p.participantNo) === normalizeCode(participantNo)
    );
    if (participantNo && !participantStillEligible) {
      setParticipantNo("");
      setPeriodId("");
      setBatchId("");
      setBagBarcode("");
      setIsBagVerified(false);
      setExpectedAliquots([]);
      setAliquotRows([]);
      return;
    }

    const periodStillReady = readyPeriodOptions.some(
      (p) => String(p.id) === String(periodId)
    );
    if (periodId && !periodStillReady) {
      setPeriodId("");
      setBatchId("");
      setBagBarcode("");
      setIsBagVerified(false);
      setExpectedAliquots([]);
      setAliquotRows([]);
    }
  }, [
    showForm,
    modalMode,
    eligibleParticipantsLoading,
    participantOptions,
    readyPeriodOptions,
    participantNo,
    periodId,
    isBagVerified,
  ]);

  const batchOptions = useMemo(() => {
    if (!periodId) return [];
    return (formOptions.batches || []).map((b) => ({
      id: String(b.id || b.batchNo),
      label: b.label || `Batch ${b.batchNo}`,
      batchNo: b.batchNo || parseBatchNo(b.id),
    }));
  }, [formOptions.batches, periodId]);

  const isBatchPrepared = useCallback((batchOpt) => {
    if (!participantNo || !periodId) return false;
    const targetPeriodLabel = periodOptions.find((p) => String(p.id) === String(periodId))?.label || periodId;

    return records.some((r) => {
      if (!r.isActive) return false;
      if (normalizeCode(r.subjectCode) !== normalizeCode(participantNo)) return false;

      const rPeriodNorm = normalizeCode(r.period);
      const targetPeriodNorm = normalizeCode(targetPeriodLabel);
      if (rPeriodNorm !== targetPeriodNorm) return false;

      const rBatchNorm = normalizeCode(r.batchNumber);
      const optLabelNorm = normalizeCode(batchOpt.label);
      const optIdNorm = normalizeCode(batchOpt.id);

      const rBatchNo = parseBatchNo(r.batchNumber);
      const optBatchNo = batchOpt.batchNo;

      return (
        rBatchNorm === optLabelNorm ||
        rBatchNorm === optIdNorm ||
        (rBatchNo > 0 && optBatchNo > 0 && rBatchNo === optBatchNo)
      );
    });
  }, [records, participantNo, periodId, periodOptions]);

  useEffect(() => {
    if (!showForm || modalMode !== "create" || !batchId || isBagVerified) return;
    const selectedBatch = batchOptions.find((b) => String(b.id) === String(batchId));
    if (selectedBatch && isBatchPrepared(selectedBatch)) {
      setBatchId("");
      setBagBarcode("");
      setIsBagVerified(false);
      setExpectedAliquots([]);
      setAliquotRows([]);
    }
  }, [showForm, modalMode, batchId, batchOptions, isBatchPrepared, isBagVerified]);

  const siteSelectOptions = useMemo(
    () => siteOptions.map((s) => ({ value: s, label: s })),
    [siteOptions]
  );
  const participantSelectOptions = useMemo(
    () => participantOptions.map((p) => ({ value: p.participantNo, label: p.participantNo })),
    [participantOptions]
  );
  const periodSelectOptions = useMemo(
    () => readyPeriodOptions.map((p) => ({ value: String(p.id), label: p.label })),
    [readyPeriodOptions]
  );
  const batchSelectOptions = useMemo(
    () =>
      batchOptions
        .filter((b) => !isBatchPrepared(b) || String(b.id) === String(batchId))
        .map((b) => ({
          value: String(b.id),
          label: isBatchPrepared(b) ? `${b.label} (Prepared)` : b.label,
        })),
    [batchOptions, batchId, isBatchPrepared]
  );


  useEffect(() => {
    if (isSiteUser && userSite && modalMode === "create") {
      setSiteKey(userSite);
    }
  }, [isSiteUser, userSite, modalMode]);

  useEffect(() => {
    if (showForm && modalMode === "create") {
      if (participantOptions.length === 1 && !participantNo) {
        setParticipantNo(participantOptions[0].participantNo);
      }
    }
  }, [showForm, modalMode, participantOptions, participantNo]);

  useEffect(() => {
    if (showForm && modalMode === "create") {
      if (readyPeriodOptions.length === 1 && !periodId) {
        setPeriodId(readyPeriodOptions[0].id);
      }
    }
  }, [showForm, modalMode, readyPeriodOptions, periodId]);

  useEffect(() => {
    if (showForm && modalMode === "create") {
      if (batchOptions.length === 1 && !batchId) {
        setBatchId(batchOptions[0].id);
      }
    }
  }, [showForm, modalMode, batchOptions, batchId]);

  useEffect(() => {
    if (!showForm || !participantNo || !periodId || !batchId) {
      setExpectedAliquots([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const slots = await fetchExpectedAliquots({
          participantNo,
          siteCode: siteKey,
          periodId,
          batchNo: parseBatchNo(batchId),
          requireReady: modalMode === "create",
        });
        if (!cancelled) setExpectedAliquots(Array.isArray(slots) ? slots : []);
      } catch (err) {
        if (!cancelled) {
          setExpectedAliquots([]);
          setScanAlert(apiErrorMessage(err, "Failed to load expected aliquots."));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showForm, participantNo, siteKey, periodId, batchId, modalMode]);

  useEffect(() => {
    if (!showForm) return;
    if (expectedAliquots.length === 0) {
      setAliquotRows([]);
      return;
    }
    // Bag verify only loads expected slots — do not mark aliquots scanned until each is scanned.
    setAliquotRows((prev) =>
      expectedAliquots.map((row) => {
        const previous = prev.find(
          (slot) => normalizeCode(slot.expectedCode) === normalizeCode(row.code)
        );
        const oldVal = row.isSkipped
          ? "SKIPPED"
          : previous?.value && previous.value !== "SKIPPED"
            ? previous.value
            : "";
        return {
          value: oldVal,
          error: "",
          timepoint: row.timepoint,
          expectedCode: row.code,
          status: row.status,
          isSkipped: row.isSkipped,
        };
      })
    );
  }, [expectedAliquots, showForm, modalMode]);

  useEffect(() => {
    if (!viewAliquotsRecord) {
      setViewAliquotSlots([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const period = periodOptions.find(
          (p) =>
            p.label.toLowerCase() === String(viewAliquotsRecord.period || "").toLowerCase() ||
            p.id.toLowerCase() === String(viewAliquotsRecord.period || "").toLowerCase()
        );
        const batchNo = parseBatchNo(viewAliquotsRecord.batchNumber);
        if (!period?.id || !batchNo) {
          const tokens = String(viewAliquotsRecord.aliquotBarcodes || "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          if (!cancelled) {
            setViewAliquotSlots(
              tokens.map((token, idx) => ({
                timepoint: `Slot ${idx + 1}`,
                code: token.toUpperCase() === "SKIPPED" || token.toLowerCase() === "pending" ? "—" : token,
                value: token,
              }))
            );
          }
          return;
        }
        const slots = await fetchExpectedAliquots({
          participantNo: viewAliquotsRecord.subjectCode,
          siteCode: viewAliquotsRecord.siteCode,
          periodId: period.id,
          batchNo,
          requireReady: false,
        });
        const { codes, skippedSlots } = parseAliquotPayload(viewAliquotsRecord.aliquotBarcodes);
        if (cancelled) return;
        setViewAliquotSlots(
          (slots || []).map((slot, idx) => {
            const isSkipped = slot.isSkipped || skippedSlots.includes(idx + 1);
            const matchingCode = codes.find((c) => normalizeCode(c) === normalizeCode(slot.code));
            return {
              timepoint: slot.timepoint,
              code: slot.code,
              value: isSkipped ? "SKIPPED" : matchingCode || "",
            };
          })
        );
      } catch {
        if (!cancelled) setViewAliquotSlots([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewAliquotsRecord, periodOptions]);

  const isSaveEnabled = useMemo(() => {
    return !!(siteKey && participantNo && periodId && batchId && bagBarcode && isBagVerified);
  }, [siteKey, participantNo, periodId, batchId, bagBarcode, isBagVerified]);

  const isSavePreparedEnabled = useMemo(() => {
    return !!(isSaveEnabled && aliquotRows.length > 0 && !hasPendingAliquotTokens(aliquotRows));
  }, [isSaveEnabled, aliquotRows]);

  const uniqueSites = useMemo(() => [...new Set(records.map((r) => r.siteCode))].sort(), [records]);
  const uniqueSubjects = useMemo(() => [...new Set(records.map((r) => r.subjectCode))].sort(), [records]);
  const uniquePeriods = useMemo(() => [...new Set(records.map((r) => r.period))].sort(), [records]);
  const uniqueBatches = useMemo(() => [...new Set(records.map((r) => r.batchNumber))].sort(), [records]);

  const filteredRecords = useMemo(() => {
    let result = records;
    const currentFilterSite = isSiteUser ? userSite : filterSite;
    if (currentFilterSite) {
      result = result.filter((r) => matchSiteCodes(r.siteCode, currentFilterSite));
    }
    if (filterSubject) result = result.filter((r) => r.subjectCode === filterSubject);
    if (filterPeriod) result = result.filter((r) => r.period === filterPeriod);
    if (filterBatch) result = result.filter((r) => r.batchNumber === filterBatch);
    return result;
  }, [records, isSiteUser, userSite, filterSite, filterSubject, filterPeriod, filterBatch]);

  const listRecords = useMemo(() => {
    if (isMobileOrTablet) return filteredRecords;
    const start = (currentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, currentPage, pageSize, isMobileOrTablet]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));

  const clearInvalidBagBarcode = () => {
    setBagBarcode("");
    setIsBagVerified(false);
    setTimeout(() => bagScanRef.current?.focus(), 50);
  };

  const runVerifyBag = async (rawCode, options = {}) => {
    const treatAsCreate = options.asCreate === true || modalMode === "create";
    const norm = normalizeCode(rawCode ?? bagBarcode);
    if (!norm) {
      setScanAlert("Bag barcode cannot be empty.");
      setIsBagVerified(false);
      return;
    }
    setBagBarcode(norm);
    const resolveSiteCode =
      options.siteCode !== undefined ? options.siteCode : siteKey || undefined;
    try {
      const result = await validateBagPrepBarcode({
        code: norm,
        kind: "bag",
        siteCode: resolveSiteCode || undefined,
        excludeBagPreparationNo: treatAsCreate
          ? undefined
          : contextRecord?.bagPreparationNo || undefined,
      });
      if (!result.valid) {
        setScanAlert(result.message || `Bag barcode ${norm} is invalid.`);
        clearInvalidBagBarcode();
        return;
      }

      if (treatAsCreate) {
        let resolvedPeriodId = result.periodId || "";
        if (!resolvedPeriodId && result.period) {
          const match = periodOptions.find(
            (p) =>
              String(p.label).toLowerCase() === String(result.period).toLowerCase() ||
              String(p.id).toLowerCase() === String(result.period).toLowerCase() ||
              String(p.period) === String(result.period)
          );
          if (match) {
            resolvedPeriodId = match.id;
          }
        }

        const batchNo = result.batchNo ? Number(result.batchNo) : 0;
        const bagCode = result.code || norm;
        const nextSite = result.siteCode || resolveSiteCode || "";

        // Apply bag context immediately — no extra confirm modal.
        if (nextSite && !isSiteUser) setSiteKey(nextSite);
        if (result.participantNo) setParticipantNo(result.participantNo);
        if (resolvedPeriodId) setPeriodId(resolvedPeriodId);
        if (batchNo) setBatchId(String(batchNo));
        setBagBarcode(bagCode);
        setIsBagVerified(true);
        setShowForm(true);
        setScanAlert(null);
        return;
      }

      setIsBagVerified(true);
      setScanAlert(result.message || "Bag barcode verified successfully.");
    } catch (err) {
      setScanAlert(apiErrorMessage(err, "Bag barcode validation failed."));
      clearInvalidBagBarcode();
    }
  };

  const handleAliquotScan = async (rawCode) => {
    const norm = normalizeCode(rawCode ?? aliquotScanInput);
    if (!norm) return;
    setAliquotScanInput("");
    if (!isBagVerified) {
      setScanAlert("Verify the bag barcode first before scanning aliquots.");
      return;
    }
    try {
      const result = await validateBagPrepBarcode({
        code: norm,
        kind: "aliquot",
        participantNo,
        siteCode: siteKey,
        periodId,
        batchNo: parseBatchNo(batchId),
      });
      if (!result.valid) {
        setScanAlert(result.message || `Barcode ${norm} is invalid.`);
        return;
      }
      const slotIdx = expectedAliquots.findIndex((row) => normalizeCode(row.code) === norm);
      if (slotIdx === -1) {
        setScanAlert("Aliquot is not expected for the selected period/batch.");
        return;
      }
      if (aliquotRows[slotIdx]?.value === "SKIPPED") {
        setScanAlert("This timepoint slot is already skipped in CRF.");
        return;
      }
      setAliquotRows((prev) => {
        const copy = [...prev];
        copy[slotIdx] = { ...copy[slotIdx], value: norm, error: "" };
        return copy;
      });
      setScanAlert(null);
    } catch (err) {
      setScanAlert(apiErrorMessage(err, "Aliquot validation failed."));
    }
  };

  const clearAliquotSlot = (idx) => {
    setAliquotRows((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], value: "" };
      return copy;
    });
  };

  const clearBagScanProgress = () => {
    setBagBarcode("");
    setIsBagVerified(false);
    setAliquotRows([]);
    setExpectedAliquots([]);
    setAliquotScanInput("");
  };

  const resetContextConfirmation = () => {
    setParticipantNo("");
    setPeriodId("");
    setBatchId("");
    if (!isSiteUser) setSiteKey("");
    clearBagScanProgress();
    // Desktop scans from the list — return there to rescan.
    if (!isMobileOrTablet) setShowForm(false);
  };

  const prepareCreateState = () => {
    setModalMode("create");
    setContextRecord(null);
    setSiteKey(isSiteUser ? userSite : "");
    setParticipantNo("");
    setPeriodId("");
    setBatchId("");
    clearBagScanProgress();
  };

  /** Mobile: open dedicated scan view. Desktop uses list barcode field instead. */
  const openCreate = () => {
    prepareCreateState();
    setShowForm(true);
  };

  /** Desktop list: scan bag in place (Enter) â†’ open store form. */
  const handleDesktopListBagScan = async (rawCode) => {
    const norm = normalizeCode(rawCode ?? bagBarcode);
    if (!norm) {
      setScanAlert("Bag barcode cannot be empty.");
      return;
    }
    prepareCreateState();
    setBagBarcode(norm);
    await runVerifyBag(norm, {
      asCreate: true,
      siteCode: isSiteUser ? userSite : "",
    });
  };

  const openEdit = async (record) => {
    setModalMode("edit");
    setContextRecord(record);
    setSiteKey(record.siteCode);
    setParticipantNo(record.subjectCode);
    const p = periodOptions.find(
      (x) =>
        x.label.toLowerCase() === String(record.period || "").toLowerCase() ||
        x.id.toLowerCase() === String(record.period || "").toLowerCase()
    );
    setPeriodId(p ? p.id : "");
    const batchNo = parseBatchNo(record.batchNumber);
    setBatchId(batchNo ? String(batchNo) : "");
    setBagBarcode(record.bagBarcode);
    setIsBagVerified(true);
    const { codes, skippedSlots } = parseAliquotPayload(record.aliquotBarcodes);
    try {
      const expected = p?.id
        ? await fetchExpectedAliquots({
            participantNo: record.subjectCode,
            siteCode: record.siteCode,
            periodId: p.id,
            batchNo,
            requireReady: false,
          })
        : [];
      setExpectedAliquots(expected);
      setAliquotRows(
        expected.map((row, idx) => {
          const isSkipped = row.isSkipped || skippedSlots.includes(idx + 1);
          const codeValue = isSkipped
            ? "SKIPPED"
            : codes.find((c) => normalizeCode(c) === normalizeCode(row.code)) || "";
          return {
            value: codeValue,
            error: "",
            timepoint: row.timepoint,
            expectedCode: row.code,
            status: row.status,
            isSkipped,
          };
        })
      );
    } catch (err) {
      setScanAlert(apiErrorMessage(err, "Failed to load aliquot slots."));
      setAliquotRows([]);
    }
    setShowForm(true);
  };

  const openView = async (record) => {
    await openEdit(record);
    setModalMode("view");
  };

  const handleSave = async (statusOverride, missingRemark) => {
    if (modalMode === "view" || saving) return;
    if (!siteKey || !participantNo || !periodId || !batchId || !bagBarcode || !isBagVerified) {
      setScanAlert("Verify all fields and barcodes before saving.");
      return;
    }
    if (statusOverride === "Prepared" && hasPendingAliquotTokens(aliquotRows) && missingRemark == null) {
      const pendingSlots = getPendingAliquotSlots(aliquotRows, expectedAliquots);
      setRemarkPrompt({
        type: "missingPreparedSave",
        statusOverride: "Prepared",
        pendingSlots,
        pendingCursor: 0,
        slotRemarks: {},
      });
      return;
    }
    const payloadAliquotString = aliquotRows.map((r) => r.value || "PENDING").join(",");
    const periodLabelSaved = periodOptions.find((p) => p.id === periodId)?.label || periodId;
    const batchLabel =
      batchOptions.find((b) => String(b.id) === String(batchId))?.label || `Batch ${batchId}`;
    const payload = {
      bagBarcode,
      siteCode: siteKey,
      subjectCode: participantNo,
      period: periodLabelSaved,
      batchNumber: batchLabel,
      aliquotBarcodes: payloadAliquotString || "PENDING",
      status: statusOverride || "Pending",
      missingRemark: String(missingRemark || "").trim() || undefined,
    };
    setSaving(true);
    try {
      if (modalMode === "edit" && contextRecord?.bagPreparationNo) {
        await updateBagPreparation(contextRecord.bagPreparationNo, {
          ...payload,
          status: statusOverride || contextRecord.status,
        });
      } else {
        await createBagPreparation(payload);
      }
      await reloadList();
      setShowForm(false);
      setScanAlert("Bag preparation saved successfully.");
    } catch (err) {
      setScanAlert(apiErrorMessage(err, "Save failed."));
    } finally {
      setSaving(false);
    }
  };

  const handleInactivate = (recordNo) => {
    const record = records.find((r) => r.bagPreparationNo === recordNo) || { bagPreparationNo: recordNo };
    setRemarkPrompt({ type: "inactivate", record });
  };

  const handleReactivate = (recordNo) => {
    const record = records.find((r) => r.bagPreparationNo === recordNo) || { bagPreparationNo: recordNo };
    const hasActive = records.some((r) => {
      if (!r.isActive) return false;
      if (r.bagPreparationNo === record.bagPreparationNo) return false;
      return (
        normalizeCode(r.subjectCode) === normalizeCode(record.subjectCode) &&
        normalizeCode(r.period) === normalizeCode(record.period) &&
        normalizeCode(r.batchNumber) === normalizeCode(record.batchNumber)
      );
    });
    if (hasActive) {
      setScanAlert("Cannot reactivate. An active preparation already exists for this batch.");
      return;
    }
    setRemarkPrompt({ type: "reactivate", record });
  };

  const handleStatusChange = async (recordNo, status, changeReason, missingRemark) => {
    try {
      await updateBagPreparationStatus(recordNo, status, changeReason, missingRemark);
      await reloadList();
      if (String(status).trim() === "Dispatched") {
        setScanAlert({
          text: "Bag dispatched and export completed.",
          tone: "success",
        });
      }
    } catch (err) {
      await reloadList().catch(() => {});
      setScanAlert({
        text: apiErrorMessage(err, "Status update failed."),
        tone: "error",
      });
    }
  };

  const requestMarkPrepared = (row) => {
    if (hasPendingAliquotTokens(row.aliquotBarcodes)) {
      const pendingSlots = getPendingAliquotSlots(row.aliquotBarcodes);
      setRemarkPrompt({
        type: "missingPrepared",
        record: row,
        pendingSlots,
        pendingCursor: 0,
        slotRemarks: {},
      });
      return;
    }
    void handleStatusChange(row.bagPreparationNo, "Prepared");
  };

  const requestSendBag = (row) => {
    setSendConfirmRecord(row);
  };

  const confirmSendBag = async () => {
    if (!sendConfirmRecord?.bagPreparationNo) return;
    await handleStatusChange(sendConfirmRecord.bagPreparationNo, "Dispatched");
    setSendConfirmRecord(null);
  };

  const refreshExportLogs = async () => {
    setExportLogsLoading(true);
    try {
      const rows = await getBagExportLogs();
      setExportLogs(rows);
    } catch (error) {
      setExportLogs([]);
      throw error;
    } finally {
      setExportLogsLoading(false);
    }
  };

  /** Common Export Log: all bags. Mobile/tablet â†’ full page; desktop â†’ modal with filters. */
  const handleOpenCommonExportLog = async () => {
    if (isMobileOrTablet) {
      navigate("/bag-preparation/export-log");
      return;
    }
    setExportLogScope(null);
    setExportLogOpen(true);
    try {
      await refreshExportLogs();
    } catch (error) {
      setScanAlert({
        text: apiErrorMessage(error, "Failed to load export log."),
        tone: "error",
      });
    }
  };

  /** Row â‹¯ Export Log: that bag only. Always modal (audit cards on mobile/tablet). */
  const handleOpenRowExportLog = async (row) => {
    setExportLogScope({
      bagPreparationNo: row?.bagPreparationNo,
      bagBarcode: row?.bagBarcode || "",
    });
    setExportLogOpen(true);
    try {
      await refreshExportLogs();
    } catch (error) {
      setScanAlert({
        text: apiErrorMessage(error, "Failed to load export log."),
        tone: "error",
      });
    }
  };

  const handleReexportLog = async (row) => {
    const bagNos = Array.isArray(row?.bagPreparationNos) ? row.bagPreparationNos : [];
    if (!row?.id || bagNos.length === 0) {
      setScanAlert({
        text: "This log has no bag numbers to re-export.",
        tone: "error",
      });
      return;
    }

    setExportingLogId(row.id);
    try {
      const result = await exportDispatchedBags(bagNos, row.id);
      await refreshExportLogs();
      setScanAlert({
        text: `Re-exported ${result.bagCount} bag(s) for ${row.bagNames || "selected bags"}.`,
        tone: "success",
      });
    } catch (error) {
      try {
        await refreshExportLogs();
      } catch {
        // keep prior rows if refresh fails
      }
      setScanAlert({
        text: apiErrorMessage(error, "Failed to re-export bags."),
        tone: "error",
      });
    } finally {
      setExportingLogId(null);
    }
  };

  const confirmRemarkPrompt = async (text) => {
    const prompt = remarkPrompt;
    if (!prompt) return;
    const trimmed = String(text || "").trim();
    try {
      if (prompt.type === "inactivate") {
        setRemarkPrompt(null);
        await inactivateBagPreparation(prompt.record.bagPreparationNo, trimmed);
        await reloadList();
        setScanAlert("Bag preparation inactivated.");
        return;
      }
      if (prompt.type === "reactivate") {
        setRemarkPrompt(null);
        const record = prompt.record;
        const hasActive = records.some((r) => {
          if (!r.isActive) return false;
          if (r.bagPreparationNo === record.bagPreparationNo) return false;
          return (
            normalizeCode(r.subjectCode) === normalizeCode(record.subjectCode) &&
            normalizeCode(r.period) === normalizeCode(record.period) &&
            normalizeCode(r.batchNumber) === normalizeCode(record.batchNumber)
          );
        });
        if (hasActive) {
          setScanAlert("Cannot reactivate. An active preparation already exists for this batch.");
          return;
        }
        await reactivateBagPreparation(record.bagPreparationNo, trimmed);
        await reloadList();
        setScanAlert("Bag preparation reactivated.");
        return;
      }

      if (prompt.type === "missingPrepared" || prompt.type === "missingPreparedSave") {
        const pendingSlots = Array.isArray(prompt.pendingSlots) ? prompt.pendingSlots : [];
        const cursor = Number(prompt.pendingCursor) || 0;
        const current = pendingSlots[cursor];
        if (!current) {
          setRemarkPrompt(null);
          setScanAlert("No pending aliquot slots found.");
          return;
        }
        if (!trimmed) {
          setScanAlert("Remark is required for this missing aliquot.");
          return;
        }

        const nextRemarks = {
          ...(prompt.slotRemarks || {}),
          [String(current.index)]: trimmed,
        };
        const nextCursor = cursor + 1;
        if (nextCursor < pendingSlots.length) {
          setRemarkPrompt({
            ...prompt,
            pendingCursor: nextCursor,
            slotRemarks: nextRemarks,
          });
          return;
        }

        const missingRemarkJson = serializeSlotRemarks(nextRemarks);
        setRemarkPrompt(null);
        if (prompt.type === "missingPrepared") {
          await handleStatusChange(prompt.record.bagPreparationNo, "Prepared", undefined, missingRemarkJson);
          setScanAlert("Bag marked Prepared.");
        } else {
          await handleSave(prompt.statusOverride || "Prepared", missingRemarkJson);
        }
        return;
      }
    } catch (err) {
      setRemarkPrompt(null);
      setScanAlert(apiErrorMessage(err, "Action failed."));
    }
  };

  // --- RENDER FORM AS NEW PAGE ---
  if (showForm) {
    // Resolved readable labels for the summary panel
    const periodLabel = periodOptions.find((p) => p.id === periodId)?.label || periodId;
    const batchLabel = batchOptions.find((b) => b.id === batchId)?.label || batchId;

    return (
      <div
        className="page page--bag-prep-form"
        style={{
          padding: isMobileOrTablet ? "0" : "12px",
          paddingBottom: isMobileOrTablet ? "180px" : "12px",
        }}
      >
        <BarcodeCameraModal
          open={cameraTarget != null}
          title={cameraTarget === "aliquot" ? "Scan Aliquot Barcode" : "Scan Bag Barcode"}
          onClose={() => setCameraTarget(null)}
          onDetected={(code) => {
            const target = cameraTarget;
            setCameraTarget(null);
            if (target === "aliquot") {
              handleAliquotScan(code);
            } else if (modalMode === "create") {
              runVerifyBag(code);
            }
          }}
        />

        {scanAlert ? (
          <div className={`soft-alert-toast ${scanAlertToneClass(scanAlert)}`} role="status">
            {scanAlertText(scanAlert)}
          </div>
        ) : null}

        {/* ===== MOBILE / TABLET FIXED BOTTOM SCAN PANEL ===== */}
        {isMobileOrTablet && modalMode !== "view" && (
          <div className="scan-zone-dock">
            <div className="bag-prep-scan-card">
              <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--text-primary, #1e293b)", marginBottom: "8px" }}>
                {isBagVerified ? "Aliquot Barcode Scan" : "Barcode Scan"}
              </div>
              {!isBagVerified ? (
                <>
                  <input
                    ref={bagScanRef}
                    type="text"
                    className="form-control font-mono"
                    placeholder=""
                    value={bagBarcode}
                    onChange={(e) => {
                      setBagBarcode(e.target.value);
                      setIsBagVerified(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (String(bagBarcode).trim()) runVerifyBag();
                        else setCameraTarget("bag");
                      }
                    }}
                    style={{
                      width: "100%",
                      height: "44px",
                      marginBottom: "8px",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      background: "#fff",
                      boxSizing: "border-box",
                      outline: "none",
                      fontFamily: "monospace",
                      fontSize: "1rem",
                      textAlign: "center",
                      color: "#0f172a",
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => {
                      if (String(bagBarcode).trim()) runVerifyBag();
                      else setCameraTarget("bag");
                    }}
                    style={{ width: "100%", height: "42px", borderRadius: "8px", fontSize: "1rem", fontWeight: 700 }}
                  >
                    Scan
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    className="form-control font-mono"
                    placeholder=""
                    value={aliquotScanInput}
                    onChange={(e) => setAliquotScanInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (String(aliquotScanInput).trim()) handleAliquotScan();
                        else setCameraTarget("aliquot");
                      }
                    }}
                    style={{
                      width: "100%",
                      height: "44px",
                      marginBottom: "8px",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      background: "#fff",
                      boxSizing: "border-box",
                      outline: "none",
                      fontFamily: "monospace",
                      fontSize: "1rem",
                      textAlign: "center",
                      color: "#0f172a",
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => {
                      if (String(aliquotScanInput).trim()) handleAliquotScan();
                      else setCameraTarget("aliquot");
                    }}
                    style={{ width: "100%", height: "42px", borderRadius: "8px", fontSize: "1rem", fontWeight: 700 }}
                  >
                    Scan
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <div
          className={isMobileOrTablet ? "bag-prep-form-shell" : "card"}
          style={{
            padding: isMobileOrTablet ? "4px" : "20px",
            maxWidth: "1000px",
            margin: "0 auto",
            width: "100%",
            minWidth: 0,
            boxSizing: "border-box",
            overflow: "visible",
            ...(isMobileOrTablet
              ? {
                  borderRadius: 0,
                  boxShadow: "none",
                  border: "none",
                  background: "transparent",
                  width: "100%",
                }
              : {}),
          }}
        >

          {isMobileOrTablet ? (
            /* ====== MOBILE / TABLET FORM LAYOUT ====== */
            <div>
              {/* Create: scan bag only — no Participant/Period/Batch dropdowns */}
              {/* Create: content area — scan dock is fixed at bottom (Aliquot-style) */}
              {modalMode === "create" && !isBagVerified && (
                <div style={{ padding: "16px 8px", textAlign: "center", color: "var(--text-muted, #64748b)", fontSize: "0.85rem" }}>
                  Scan the bag barcode below to start bag preparation.
                </div>
              )}

              {/* Edit/view before verified: keep summary fields read-only if needed — skip for create */}
              {modalMode !== "create" && !isBagVerified && (
                <div style={{ padding: "8px", color: "var(--text-muted)" }}>Loading bag…</div>
              )}

              {/* After confirm + bag verified: compact summary â†’ actions â†’ aliquot boxes */}
              {isBagVerified && (
                <div>
                  <div style={{
                    display: "flex",
                    flexWrap: "nowrap",
                    alignItems: "flex-start",
                    gap: "6px",
                    background: "var(--bg-subtle, #f8fafc)",
                    borderRadius: "8px",
                    padding: "6px 8px",
                    border: "1px solid var(--border-color, #e2e8f0)",
                    marginBottom: "8px",
                    overflowX: "auto",
                  }}>
                    {!isSiteUser && (
                      <div style={{ flex: "1 1 0", minWidth: 0 }}>
                        <div style={{ fontSize: "0.58rem", color: "var(--text-muted, #64748b)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.15, whiteSpace: "nowrap" }}>Site</div>
                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-primary, #1e293b)", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{siteKey || "—"}</div>
                      </div>
                    )}
                    <div style={{ flex: "1 1 0", minWidth: 0 }}>
                      <div style={{ fontSize: "0.58rem", color: "var(--text-muted, #64748b)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.15, whiteSpace: "nowrap" }}>Participant</div>
                      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-primary, #1e293b)", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{participantNo || "—"}</div>
                    </div>
                    <div style={{ flex: "1 1 0", minWidth: 0 }}>
                      <div style={{ fontSize: "0.58rem", color: "var(--text-muted, #64748b)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.15, whiteSpace: "nowrap" }}>Period</div>
                      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-primary, #1e293b)", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{periodLabel || "—"}</div>
                    </div>
                    <div style={{ flex: "1 1 0", minWidth: 0 }}>
                      <div style={{ fontSize: "0.58rem", color: "var(--text-muted, #64748b)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.15, whiteSpace: "nowrap" }}>Batch</div>
                      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-primary, #1e293b)", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{batchLabel || "—"}</div>
                    </div>
                    <div style={{ flex: "1 1 0", minWidth: 0 }}>
                      <div style={{ fontSize: "0.58rem", color: "var(--text-muted, #64748b)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.15, whiteSpace: "nowrap" }}>Bag Barcode</div>
                      <div style={{ fontSize: "0.72rem", fontWeight: 700, fontFamily: "monospace", color: "#059669", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {"\u2713"} {bagBarcode}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "5px", marginBottom: "8px", justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
                    {modalMode === "create" ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={resetContextConfirmation}
                        style={{ fontSize: "0.7rem", padding: "3px 10px", height: "26px" }}
                      >
                        Rescan Bag
                      </button>
                    ) : null}
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => setShowForm(false)} style={{ fontSize: "0.7rem", padding: "3px 10px", height: "26px", minWidth: "64px" }}>
                      {modalMode === "view" ? "Close" : "Cancel"}
                    </button>
                    {modalMode !== "view" && (
                      <>
                        <button type="button" className="btn btn--primary btn--sm" disabled={!isSaveEnabled} onClick={() => handleSave("Pending")} style={{ fontSize: "0.7rem", padding: "3px 10px", height: "26px", minWidth: "56px" }}>
                          Save
                        </button>
                        {isSavePreparedEnabled && (
                          <button type="button" className="btn btn--primary btn--sm" style={{ background: "#059669", borderColor: "#059669", fontSize: "0.7rem", padding: "3px 10px", height: "26px" }} onClick={() => handleSave("Prepared")}>
                            Prepare
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  <label className="section-label" style={{ marginBottom: "6px", display: "block", fontWeight: 600, fontSize: "0.72rem" }}>
                    Expected Aliquot Slots
                  </label>
                  <div
                    className="bag-prep-aliquot-scroll"
                    style={{
                      maxHeight: "min(48vh, 360px)",
                      overflowY: "auto",
                      overflowX: "hidden",
                      WebkitOverflowScrolling: "touch",
                      paddingRight: "2px",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: isTablet
                          ? "repeat(6, minmax(0, 1fr))"
                          : "repeat(4, minmax(0, 1fr))",
                        gap: "5px",
                      }}
                    >
                      {aliquotRows.map((slot, idx) => {
                        const isSkipped = slot.value === "SKIPPED";
                        const isFilled = slot.value && !isSkipped;
                        const borderStyle = isSkipped ? "1.5px solid #f59e0b" : isFilled ? "1.5px solid #10b981" : "1px solid var(--border-color)";
                        const bgStyle = isSkipped ? "#fef3c7" : isFilled ? "#ecfdf5" : "var(--bg-white)";
                        const displayCode = isFilled ? slot.value : slot.expectedCode || "—";
                        return (
                          <div
                            key={idx}
                            onClick={() => {
                              if (modalMode !== "view" && isFilled) clearAliquotSlot(idx);
                            }}
                            style={{
                              border: borderStyle,
                              background: bgStyle,
                              padding: "4px 3px",
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "2px",
                              minHeight: "44px",
                              borderRadius: "4px",
                              boxShadow: "0 1px 1px rgba(0,0,0,0.04)",
                              cursor: modalMode !== "view" && isFilled ? "pointer" : "default",
                            }}
                          >
                            <TruncatedWithTooltip
                              text={slot.timepoint}
                              style={{ textAlign: "center", fontSize: "0.55rem", color: "var(--text-muted)", fontWeight: 600, lineHeight: 1.15 }}
                            />
                            <TruncatedWithTooltip
                              text={displayCode}
                              style={{ textAlign: "center", fontSize: "0.58rem", fontWeight: 700, fontFamily: "monospace", lineHeight: 1.15, color: isSkipped ? "#b45309" : "#0f172a" }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ====== DESKTOP FORM LAYOUT (opens after list bag scan + confirm) ====== */
            <div>
              {isBagVerified && (
                <div style={{
                  marginBottom: "16px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-color, #e2e8f0)",
                  background: "var(--bg-subtle, #f8fafc)",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "12px",
                  alignItems: "center",
                }}>
                  {!isSiteUser && (
                    <div><div style={{ fontSize: "0.65rem", color: "#64748b" }}>Site</div><strong>{siteKey || "—"}</strong></div>
                  )}
                  <div><div style={{ fontSize: "0.65rem", color: "#64748b" }}>Participant</div><strong>{participantNo || "—"}</strong></div>
                  <div><div style={{ fontSize: "0.65rem", color: "#64748b" }}>Period</div><strong>{periodLabel || "—"}</strong></div>
                  <div><div style={{ fontSize: "0.65rem", color: "#64748b" }}>Batch</div><strong>{batchLabel || "—"}</strong></div>
                  <div><div style={{ fontSize: "0.65rem", color: "#64748b" }}>Bag</div><strong className="mono" style={{ color: "#059669" }}>{"\u2713"} {bagBarcode}</strong></div>
                  {modalMode === "create" ? (
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", marginLeft: "auto", flex: "1 1 280px", minWidth: "220px", maxWidth: "420px" }}>
                      <input
                        type="text"
                        className="admin-input font-mono"
                        placeholder="Scan aliquot barcode"
                        value={aliquotScanInput}
                        onChange={(e) => setAliquotScanInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (String(aliquotScanInput).trim()) void handleAliquotScan();
                          }
                        }}
                        aria-label="Scan aliquot barcode"
                        style={{
                          flex: "1 1 auto",
                          minWidth: 0,
                          height: "32px",
                          padding: "4px 10px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          background: "#fff",
                          color: "#0f172a",
                          fontSize: "0.8125rem",
                          fontFamily: "Consolas, ui-monospace, monospace",
                          boxSizing: "border-box",
                          outline: "none",
                          boxShadow: "none",
                          appearance: "none",
                          WebkitAppearance: "none",
                        }}
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = "var(--blue, #2563eb)";
                          e.currentTarget.style.boxShadow = "0 0 0 2px rgba(37, 99, 235, 0.15)";
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = "#cbd5e1";
                          e.currentTarget.style.boxShadow = "none";
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => {
                          if (String(aliquotScanInput).trim()) void handleAliquotScan();
                        }}
                        style={{
                          height: "32px",
                          padding: "0 14px",
                          borderRadius: "6px",
                          fontSize: "0.8125rem",
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        Scan
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={resetContextConfirmation}
                        style={{
                          height: "32px",
                          padding: "0 10px",
                          borderRadius: "6px",
                          fontSize: "0.8125rem",
                          flexShrink: 0,
                        }}
                      >
                        Rescan Bag
                      </button>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Aliquot slots — filled only when each aliquot barcode is scanned */}
              {isBagVerified && (
                <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "12px", marginTop: "16px" }}>
                  <label className="section-label" style={{ marginBottom: "8px", display: "block", fontWeight: 600 }}>
                    Expected Aliquot Slots
                  </label>
                  <div
                    className="bag-prep-aliquot-scroll"
                    style={{
                      maxHeight: "min(48vh, 360px)",
                      overflowY: "auto",
                      overflowX: "hidden",
                      WebkitOverflowScrolling: "touch",
                      paddingRight: "4px",
                    }}
                  >
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: "8px" }}>
                      {aliquotRows.map((slot, idx) => {
                        const isSkipped = slot.value === "SKIPPED";
                        const isFilled = slot.value && !isSkipped;
                        const borderStyle = isSkipped ? "2px solid #f59e0b" : isFilled ? "2px solid #10b981" : "1px solid var(--border-color)";
                        const bgStyle = isSkipped ? "#fef3c7" : isFilled ? "#ecfdf5" : "var(--bg-white)";
                        return (
                          <div key={idx} className="card" style={{ border: borderStyle, background: bgStyle, padding: "6px 8px", display: "flex", flexDirection: "column", justifyContent: "center", gap: "4px", minHeight: "52px", boxShadow: "0 1px 2px rgba(0,0,0,0.05)", borderRadius: "4px", position: "relative" }}>
                            {modalMode !== "view" && isFilled ? (
                              <button type="button" onClick={() => clearAliquotSlot(idx)} style={{ position: "absolute", top: "2px", right: "2px", border: "none", background: "rgba(239,68,68,0.12)", color: "#ef4444", borderRadius: "50%", width: "16px", height: "16px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "0.7rem", fontWeight: "bold", padding: 0, lineHeight: 1 }} title="Clear">{"\u00d7"}</button>
                            ) : null}
                            <TruncatedWithTooltip
                              text={slot.timepoint}
                              style={{ textAlign: "center", fontSize: "0.625rem", color: "var(--text-muted)", fontWeight: 600 }}
                            />
                            <TruncatedWithTooltip
                              text={slot.expectedCode || slot.value || "—"}
                              style={{
                                textAlign: "center",
                                fontSize: "0.725rem",
                                fontWeight: 700,
                                fontFamily: "monospace",
                                color: isSkipped ? "#b45309" : isFilled ? "#065f46" : "#0f172a",
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Actions footer — only after bag verified (avoids duplicate Cancel/Save on scan step) */}
              {(isBagVerified || modalMode !== "create") && (
              <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginTop: "16px", borderTop: "1px solid var(--border-color)", paddingTop: "12px" }}>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setShowForm(false)} style={{ fontSize: "0.75rem", height: "28px", padding: "0 12px" }}>
                  {modalMode === "view" ? "Close" : "Cancel"}
                </button>
                {modalMode !== "view" && (
                  <>
                    <button type="button" className="btn btn--primary btn--sm" disabled={!isSaveEnabled} onClick={() => handleSave("Pending")} style={{ fontSize: "0.75rem", height: "28px", padding: "0 12px" }}>
                      Save
                    </button>
                    {isSavePreparedEnabled && (
                      <button type="button" className="btn btn--primary btn--sm" style={{ background: "#059669", borderColor: "#059669", fontSize: "0.75rem", height: "28px", padding: "0 12px" }} onClick={() => handleSave("Prepared")}>
                        Prepare
                      </button>
                    )}
                  </>
                )}
              </div>
              )}
            </div>
          )}
        </div>

        <RemarkModal
          key={`missing-save-${remarkPrompt?.pendingCursor ?? 0}-${remarkPrompt?.pendingSlots?.[remarkPrompt?.pendingCursor ?? 0]?.index ?? ""}`}
          open={remarkPrompt?.type === "missingPreparedSave"}
          title={
            Array.isArray(remarkPrompt?.pendingSlots) && remarkPrompt.pendingSlots.length > 1
              ? `Missing Aliquot Remark (${(remarkPrompt.pendingCursor || 0) + 1}/${remarkPrompt.pendingSlots.length})`
              : "Missing Aliquot Remark"
          }
          placeholder="Enter remark for this missing aliquot…"
          submitLabel={
            Array.isArray(remarkPrompt?.pendingSlots)
              && (remarkPrompt.pendingCursor || 0) < remarkPrompt.pendingSlots.length - 1
              ? "Next"
              : "Mark Prepared"
          }
          required
          details={[
            { label: "Bag Barcode", value: bagBarcode || "—" },
            { label: "Subject", value: participantNo || "—" },
            {
              label: "Aliquot",
              value:
                remarkPrompt?.pendingSlots?.[remarkPrompt?.pendingCursor || 0]?.label
                || "—",
            },
            {
              label: "Expected",
              value:
                remarkPrompt?.pendingSlots?.[remarkPrompt?.pendingCursor || 0]?.code
                || "—",
            },
          ]}
          onClose={() => setRemarkPrompt(null)}
          onSubmit={(text) => void confirmRemarkPrompt(text)}
        />
      </div>
    );
  }

  return (
    <div className={`page page--bag-prep${isMobileOrTablet ? " page--bag-prep--mobile" : ""}`} data-tour="page-form">
      <BarcodeCameraModal
        open={cameraTarget != null}
        title="Scan Bag Barcode"
        onClose={() => setCameraTarget(null)}
        onDetected={(code) => {
          setCameraTarget(null);
          void handleDesktopListBagScan(code);
        }}
      />

      {scanAlert ? (
        <div className={`soft-alert-toast ${scanAlertToneClass(scanAlert)}`} role="status">
          {scanAlertText(scanAlert)}
        </div>
      ) : null}

      {listError ? (
        <div
          className="soft-alert-toast soft-alert-toast--warning"
          role="alert"
          style={{ position: "static", marginBottom: "12px" }}
        >
          {listError}
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            style={{ marginLeft: "12px" }}
            onClick={() => void reloadList()}
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* --- Filter Bar --- */}
      <div
        className="card"
        style={{
          marginBottom: isMobileOrTablet ? "8px" : "16px",
          padding: isMobileOrTablet ? "8px 10px" : "12px",
        }}
      >
        {isMobileOrTablet ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%" }}>
            {!isSiteUser && (
              <div>
                <label className="section-label" style={{ marginBottom: "4px", display: "block" }}>
                  Site
                </label>
                <ScrollableSelect
                  ariaLabel="Filter by site"
                  value={filterSite}
                  allowEmpty
                  placeholder="All Sites"
                  options={uniqueSites.map((s) => ({ value: s, label: s }))}
                  onChange={setFilterSite}
                />
              </div>
            )}

            {isTablet ? (
              <div
                className="bag-prep-filter-row bag-prep-filter-row--tablet"
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "flex-end",
                  gap: "8px",
                  width: "100%",
                  flexWrap: "nowrap",
                }}
              >
                <div style={{ flex: "1 1 0", minWidth: 0 }}>
                  <label className="section-label" style={{ marginBottom: "4px", display: "block" }}>
                    Participant
                  </label>
                  <ScrollableSelect
                    ariaLabel="Filter by participant"
                    value={filterSubject}
                    allowEmpty
                    placeholder="All Participants"
                    options={uniqueSubjects.map((s) => ({ value: s, label: s }))}
                    onChange={setFilterSubject}
                  />
                </div>
                <div style={{ flex: "1 1 0", minWidth: 0 }}>
                  <label className="section-label" style={{ marginBottom: "4px", display: "block" }}>
                    Period
                  </label>
                  <ScrollableSelect
                    ariaLabel="Filter by period"
                    value={filterPeriod}
                    allowEmpty
                    placeholder="All Periods"
                    options={uniquePeriods.map((d) => ({ value: d, label: d }))}
                    onChange={setFilterPeriod}
                  />
                </div>
                <div style={{ flex: "1 1 0", minWidth: 0 }}>
                  <label className="section-label" style={{ marginBottom: "4px", display: "block" }}>
                    Batch
                  </label>
                  <ScrollableSelect
                    ariaLabel="Filter by batch"
                    value={filterBatch}
                    allowEmpty
                    placeholder="All Batches"
                    options={uniqueBatches.map((b) => ({ value: b, label: b }))}
                    onChange={setFilterBatch}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn--primary btn--sm bag-prep-filter-row__create"
                  onClick={openCreate}
                >
                  + Create
                </button>
              </div>
            ) : (
              <>
                <div>
                  <label className="section-label" style={{ marginBottom: "4px", display: "block" }}>
                    Participant
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
                    <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                      <ScrollableSelect
                        ariaLabel="Filter by participant"
                        value={filterSubject}
                        allowEmpty
                        placeholder="All Participants"
                        options={uniqueSubjects.map((s) => ({ value: s, label: s }))}
                        onChange={setFilterSubject}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={openCreate}
                      style={{
                        height: "38px",
                        padding: "0 14px",
                        fontSize: "0.8125rem",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      + Create
                    </button>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <label className="section-label" style={{ marginBottom: "4px", display: "block" }}>
                      Period
                    </label>
                    <ScrollableSelect
                      ariaLabel="Filter by period"
                      value={filterPeriod}
                      allowEmpty
                      placeholder="All Periods"
                      options={uniquePeriods.map((d) => ({ value: d, label: d }))}
                      onChange={setFilterPeriod}
                    />
                  </div>

                  <div>
                    <label className="section-label" style={{ marginBottom: "4px", display: "block" }}>
                      Batch
                    </label>
                    <ScrollableSelect
                      ariaLabel="Filter by batch"
                      value={filterBatch}
                      allowEmpty
                      placeholder="All Batches"
                      options={uniqueBatches.map((b) => ({ value: b, label: b }))}
                      onChange={setFilterBatch}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <div style={{
              display: "flex",
              flexDirection: "row",
              flexWrap: "wrap",
              gap: "8px",
              flex: 1,
            }}>
              {!isSiteUser && (
                <div style={{ flex: "1 1 140px", minWidth: "120px", maxWidth: "200px" }}>
                  <ScrollableSelect
                    ariaLabel="Filter by site"
                    value={filterSite}
                    allowEmpty
                    placeholder="All Sites"
                    options={uniqueSites.map((x) => ({ value: x, label: x }))}
                    onChange={setFilterSite}
                  />
                </div>
              )}

                <div style={{ flex: "1 1 160px", minWidth: "130px", maxWidth: "220px" }}>
                  <ScrollableSelect
                    ariaLabel="Filter by participant"
                    value={filterSubject}
                    allowEmpty
                    placeholder="All Participants"
                    options={uniqueSubjects.map((x) => ({ value: x, label: x }))}
                    onChange={setFilterSubject}
                  />
                </div>

                <div style={{ flex: "1 1 120px", minWidth: "100px", maxWidth: "180px" }}>
                  <ScrollableSelect
                    ariaLabel="Filter by period"
                    value={filterPeriod}
                    allowEmpty
                    placeholder="All Periods"
                    options={uniquePeriods.map((x) => ({ value: x, label: x }))}
                    onChange={setFilterPeriod}
                  />
                </div>

                <div style={{ flex: "1 1 120px", minWidth: "100px", maxWidth: "180px" }}>
                  <ScrollableSelect
                    ariaLabel="Filter by batch"
                    value={filterBatch}
                    allowEmpty
                    placeholder="All Batches"
                    options={uniqueBatches.map((x) => ({ value: x, label: x }))}
                    onChange={setFilterBatch}
                  />
                </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => void handleOpenCommonExportLog()}
                disabled={listLoading}
                title="View dispatch audit logs"
                style={{
                  height: "32px",
                  padding: "0 14px",
                  borderRadius: "6px",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                Dispatch Audit
              </button>
              <input
                ref={bagScanRef}
                type="text"
                className="form-control font-mono"
                placeholder="Scan bag barcode"
                value={bagBarcode}
                onChange={(e) => {
                  setBagBarcode(e.target.value);
                  setIsBagVerified(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (String(bagBarcode).trim()) void handleDesktopListBagScan();
                    else setCameraTarget("bag");
                  }
                }}
                aria-label="Scan bag barcode"
                style={{
                  width: "220px",
                  height: "32px",
                  padding: "4px 10px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "0.8125rem",
                  fontFamily: "monospace",
                  outline: "none",
                }}
              />
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => {
                  if (String(bagBarcode).trim()) void handleDesktopListBagScan();
                  else setCameraTarget("bag");
                }}
                style={{
                  height: "32px",
                  padding: "0 14px",
                  borderRadius: "6px",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                Scan
              </button>
            </div>
          </div>
        )}
      </div>

      {/* --- Master History List Table --- */}
      <div
        className={isMobileOrTablet ? undefined : "admin-card admin-card--participants-table"}
        style={{
          padding: isMobileOrTablet ? "0" : undefined,
          ...(isMobileOrTablet ? { background: "transparent", border: "none", boxShadow: "none" } : {}),
        }}
      >
        {isMobileOrTablet ? (
          <div className="bag-prep-card-list">
            {listRecords.length === 0 ? (
              <div className="empty-state" style={{ padding: "24px", textAlign: "center", fontSize: "0.8125rem" }}>
                {listError
                  ? "Could not load bag preparations. Check API / DB (vPeriod column) and retry."
                  : "No bag preparations in database yet."}
              </div>
            ) : (
              listRecords.map((row) => {
                const statusKey = !row.isActive
                  ? "inactive"
                  : String(row.status || "Pending").trim().toLowerCase();
                return (
                  <article
                    key={row.bagPreparationNo}
                    className={`bag-prep-card bag-prep-card--${statusKey}${row.isActive ? "" : " bag-prep-card--inactive"}`}
                  >
                    <span className="bag-prep-card__accent" aria-hidden="true" />
                    <div className="bag-prep-card__body">
                      <div className="bag-prep-card__top">
                        <div className="bag-prep-card__identity">
                          <h3 className="bag-prep-card__barcode">{row.bagBarcode}</h3>
                          <div className="bag-prep-card__status-row">
                            <span className={`status-badge status-badge--compact ${bagPrepStatusClass(row)}`}>
                              {bagPrepStatusLabel(row)}
                            </span>
                          </div>
                        </div>
                        <div className="bag-prep-card__actions">
                          {row.isActive && row.status === "Pending" ? (
                            <button
                              type="button"
                              className="btn btn--primary btn--sm"
                              style={{ padding: "2px 10px", fontSize: "0.6875rem", height: "28px" }}
                              onClick={() => void openEdit(row)}
                            >
                              Edit
                            </button>
                          ) : null}
                          {row.isActive && row.status !== "Pending" ? (
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              style={{ padding: "2px 10px", fontSize: "0.6875rem", height: "28px" }}
                              onClick={() => void openView(row)}
                            >
                              View
                            </button>
                          ) : null}
                          <BagPrepRowMenu
                            items={buildBagPrepMenuItems(row, {
                              includeView: false,
                              includeViewAliquots: true,
                              onViewAliquots: () => setViewAliquotsRecord(row),
                              onMarkPrepared: () => requestMarkPrepared(row),
                              onDispatch: () => requestSendBag(row),
                              onExportLog: () => void handleOpenRowExportLog(row),
                              onInactivate: () => handleInactivate(row.bagPreparationNo),
                              onReactivate: () => handleReactivate(row.bagPreparationNo),
                              onAudit: () => setAuditRecord(row),
                            })}
                          />
                        </div>
                      </div>

                      <div className="bag-prep-card__meta">
                        <div className="bag-prep-card__meta-item">
                          <span className="bag-prep-card__meta-label">Subject</span>
                          <span className="bag-prep-card__meta-value">{row.subjectCode || "—"}</span>
                        </div>
                        {!isSiteUser ? (
                          <div className="bag-prep-card__meta-item">
                            <span className="bag-prep-card__meta-label">Site</span>
                            <span className="bag-prep-card__meta-value">{row.siteCode || "—"}</span>
                          </div>
                        ) : null}
                        <div className="bag-prep-card__meta-item">
                          <span className="bag-prep-card__meta-label">Period</span>
                          <span className="bag-prep-card__meta-value">{row.period || "—"}</span>
                        </div>
                        <div className="bag-prep-card__meta-item">
                          <span className="bag-prep-card__meta-label">Batch</span>
                          <span className="bag-prep-card__meta-value">{row.batchNumber || "—"}</span>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        ) : (
          <>
            <div className="admin-table-wrapper admin-table-wrapper--scroll">
              <table className="admin-table">
                <thead className="admin-thead">
                  <tr>
                    <th className="admin-th">Actions</th>
                    <th className="admin-th">Bag Barcode</th>
                    {!isSiteUser && <th className="admin-th">Site</th>}
                    <th className="admin-th">Subject</th>
                    <th className="admin-th">Period</th>
                    <th className="admin-th">Batch</th>
                    <th className="admin-th">Aliquots Barcodes</th>
                    <th className="admin-th">Status</th>
                    <th className="admin-th">Performed By</th>
                    <th className="admin-th">Performed On (UTC)</th>
                    <th className="admin-th">Performed On (Offset)</th>
                  </tr>
                </thead>
                <tbody>
                  {listLoading ? (
                    <tr>
                      <td colSpan={isSiteUser ? 10 : 11} className="admin-td" style={{ textAlign: "center", padding: "1.5rem", color: "#94a3b8" }}>
                        Loading bag preparations…
                      </td>
                    </tr>
                  ) : listRecords.length === 0 ? (
                    <tr>
                      <td colSpan={isSiteUser ? 10 : 11} className="admin-td" style={{ textAlign: "center", padding: "1.5rem", color: "#94a3b8" }}>
                        {listError
                          ? "Could not load bag preparations. Check API / DB (vPeriod column) and retry."
                          : "No bag preparations in database yet."}
                      </td>
                    </tr>
                  ) : (
                    listRecords.map((row) => (
                      <tr
                        key={row.bagPreparationNo}
                        className={`admin-tr ${row.isActive ? "admin-tr--active" : "admin-tr--inactive"}`}
                      >
                        <td className="admin-td">
                          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                            {row.status !== "Pending" && (
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm"
                                style={{ padding: "2px 8px", fontSize: "0.6875rem", height: "24px" }}
                                onClick={() => void openView(row)}
                              >
                                View
                              </button>
                            )}
                            {row.isActive && row.status === "Pending" && (
                              <button
                                type="button"
                                className="btn btn--primary btn--sm"
                                style={{ padding: "2px 8px", fontSize: "0.6875rem", height: "24px" }}
                                onClick={() => void openEdit(row)}
                              >
                                Edit
                              </button>
                            )}
                            <BagPrepRowMenu
                              items={buildBagPrepMenuItems(row, {
                                includeView: false,
                                includeViewAliquots: false,
                                onMarkPrepared: () => requestMarkPrepared(row),
                                onDispatch: () => requestSendBag(row),
                                onExportLog: () => void handleOpenRowExportLog(row),
                                onInactivate: () => handleInactivate(row.bagPreparationNo),
                                onReactivate: () => handleReactivate(row.bagPreparationNo),
                                onAudit: () => setAuditRecord(row),
                              })}
                            />
                          </div>
                        </td>
                        <td className="admin-td" style={{ fontWeight: 400 }}>
                          {row.bagBarcode}
                        </td>
                        {!isSiteUser && <td className="admin-td">{row.siteCode}</td>}
                        <td className="admin-td">{row.subjectCode}</td>
                        <td className="admin-td">{row.period}</td>
                        <td className="admin-td">{row.batchNumber}</td>
                        <td className="admin-td" style={{ textAlign: "center" }}>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            style={{ padding: "2px 8px", fontSize: "0.6875rem", height: "24px" }}
                            onClick={() => setViewAliquotsRecord(row)}
                          >
                            View
                          </button>
                        </td>
                        <td className="admin-td">
                          <span className={`status-badge status-badge--compact ${bagPrepStatusClass(row)}`}>
                            {bagPrepStatusLabel(row)}
                          </span>
                        </td>
                        <td className="admin-td">{row.recordedSign || "—"}</td>
                        <td className="admin-td" style={{ whiteSpace: "nowrap" }}>
                          {formatPerformedOn(row.recordedOnUtc)}
                        </td>
                        <td className="admin-td">{row.recordedAtOffset || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="config-data-table__pagination participants-table__pagination">
              <div className="config-data-table__pagination-meta">
                <span>
                  Showing {filteredRecords.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–
                  {Math.min(currentPage * pageSize, filteredRecords.length)} of {filteredRecords.length}
                </span>
              </div>
              <div className="config-data-table__pager">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={currentPage === 1 || filteredRecords.length === 0}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <span>
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={currentPage === totalPages || filteredRecords.length === 0}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}

        {/* --- Aliquots Grid View Popup Modal --- */}
        {viewAliquotsRecord && (
          <div className="modal-backdrop" style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
            padding: "16px"
          }}>
            <div className="card" style={{
              maxWidth: "800px",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)"
            }}>
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderBottom: "1px solid var(--border-color, #cbd5e1)",
                paddingBottom: "12px",
                marginBottom: "16px"
              }}>
                <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700 }}>
                  Aliquots: {viewAliquotsRecord.bagBarcode}
                </h3>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setViewAliquotsRecord(null)}
                  style={{ fontSize: "1.25rem", padding: "0 8px", minWidth: "24px", height: "24px" }}
                >
                  &times;
                </button>
              </div>

              <div style={{ flex: 1, overflowY: "auto" }}>

                {/* Aliquot boxes grid (8 columns, fallback to 2 columns on mobile) */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(8, 1fr)",
                  gap: "6px",
                  marginBottom: "8px"
                }}>
                  {viewAliquotSlots.map((slot, idx) => {
                    const token = String(slot.value || "").trim().toUpperCase();
                    const isSkipped = token === "SKIPPED";
                    const isFilled = !!token && !isSkipped && token !== "PENDING";
                    const borderStyle = isSkipped
                      ? "2px solid #f59e0b"
                      : isFilled
                        ? "2px solid #10b981"
                        : "1px solid var(--border-color)";
                    const bgStyle = isSkipped
                      ? "#fef3c7"
                      : isFilled
                        ? "#ecfdf5"
                        : "var(--bg-white)";

                    return (
                      <div
                        key={idx}
                        className="card"
                        style={{
                          border: borderStyle,
                          background: bgStyle,
                          padding: "6px 4px",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "center",
                          gap: "4px",
                          minHeight: "52px",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                          borderRadius: "4px",
                        }}
                      >
                        <TruncatedWithTooltip
                          text={slot.timepoint}
                          style={{ textAlign: "center", fontSize: "0.625rem", color: "var(--text-muted)", fontWeight: 600 }}
                        />
                        <TruncatedWithTooltip
                          text={slot.code}
                          style={{ textAlign: "center", fontSize: "0.725rem", fontWeight: 700, fontFamily: "monospace" }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: "16px",
                borderTop: "1px solid var(--border-color, #cbd5e1)",
                paddingTop: "12px"
              }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setViewAliquotsRecord(null)}
                  style={{ height: "36px", padding: "0 16px" }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        <PasswordConfirmModal
          open={!!sendConfirmRecord}
          title="Dispatch Bag"
          message="Enter your password to dispatch this bag."
          details={
            sendConfirmRecord
              ? [
                  { label: "Period", value: sendConfirmRecord.period || "—" },
                  { label: "Subject", value: sendConfirmRecord.subjectCode || "—" },
                  { label: "Batch", value: sendConfirmRecord.batchNumber || "—" },
                  { label: "Bag Barcode", value: sendConfirmRecord.bagBarcode || "—" },
                ]
              : undefined
          }
          confirmLabel="Verify & Dispatch"
          onClose={() => setSendConfirmRecord(null)}
          onValidatePassword={validatePassword}
          onConfirm={confirmSendBag}
        />

        <RemarkModal
          key={`remark-${remarkPrompt?.type || ""}-${remarkPrompt?.pendingCursor ?? 0}-${remarkPrompt?.pendingSlots?.[remarkPrompt?.pendingCursor ?? 0]?.index ?? ""}`}
          open={!!remarkPrompt}
          title={
            remarkPrompt?.type === "inactivate"
              ? "Inactivate Bag Preparation"
              : remarkPrompt?.type === "reactivate"
                ? "Reactivate Bag Preparation"
                : Array.isArray(remarkPrompt?.pendingSlots) && remarkPrompt.pendingSlots.length > 1
                  ? `Missing Aliquot Remark (${(remarkPrompt.pendingCursor || 0) + 1}/${remarkPrompt.pendingSlots.length})`
                  : "Missing Aliquot Remark"
          }
          placeholder={
            remarkPrompt?.type === "inactivate" || remarkPrompt?.type === "reactivate"
              ? "Enter reason for this change…"
              : "Enter remark for this missing aliquot…"
          }
          submitLabel={
            remarkPrompt?.type === "inactivate"
              ? "Inactivate"
              : remarkPrompt?.type === "reactivate"
                ? "Reactivate"
                : Array.isArray(remarkPrompt?.pendingSlots)
                    && (remarkPrompt.pendingCursor || 0) < remarkPrompt.pendingSlots.length - 1
                  ? "Next"
                  : "Mark Prepared"
          }
          required
          details={
            remarkPrompt?.type === "missingPrepared" || remarkPrompt?.type === "missingPreparedSave"
              ? [
                  ...(remarkPrompt?.record
                    ? [
                        { label: "Bag Barcode", value: remarkPrompt.record.bagBarcode || "—" },
                        { label: "Subject", value: remarkPrompt.record.subjectCode || "—" },
                        { label: "Period", value: remarkPrompt.record.period || "—" },
                        { label: "Batch", value: remarkPrompt.record.batchNumber || "—" },
                      ]
                    : [
                        { label: "Bag Barcode", value: bagBarcode || "—" },
                        { label: "Subject", value: participantNo || "—" },
                      ]),
                  {
                    label: "Aliquot",
                    value:
                      remarkPrompt?.pendingSlots?.[remarkPrompt?.pendingCursor || 0]?.label
                      || "—",
                  },
                  {
                    label: "Expected",
                    value:
                      remarkPrompt?.pendingSlots?.[remarkPrompt?.pendingCursor || 0]?.code
                      || "—",
                  },
                ]
              : remarkPrompt?.record
                ? [
                    { label: "Bag Barcode", value: remarkPrompt.record.bagBarcode || "—" },
                    { label: "Subject", value: remarkPrompt.record.subjectCode || "—" },
                    { label: "Period", value: remarkPrompt.record.period || "—" },
                    { label: "Batch", value: remarkPrompt.record.batchNumber || "—" },
                  ]
                : undefined
          }
          onClose={() => setRemarkPrompt(null)}
          onSubmit={(text) => void confirmRemarkPrompt(text)}
        />

        {auditRecord ? (
          <AuditHistoryModal
            open
            title={`Audit \u00B7 Bag ${auditRecord.bagBarcode || auditRecord.bagPreparationNo}`}
            onClose={() => setAuditRecord(null)}
          >
            <DbAuditHistoryTableBody
              auditBatchTargets={[
                {
                  tableName: "BagPreparation",
                  recordId: String(auditRecord.bagPreparationNo),
                  fieldNames: ["vStatus", "IsActive", "vMissingRemark"],
                },
              ]}
              allowedFieldNames={["vStatus", "IsActive", "vMissingRemark"]}
              emptyMessage="No status, active, or missing-remark audit entries yet."
            />
          </AuditHistoryModal>
        ) : null}

        <BagExportLogModal
          open={exportLogOpen}
          onClose={() => {
            setExportLogOpen(false);
            setExportLogScope(null);
            setExportingLogId(null);
          }}
          logs={exportLogs}
          loading={exportLogsLoading}
          exportingId={exportingLogId}
          onExport={handleReexportLog}
          title="Dispatch Audit"
          showFilters={!exportLogScope}
          filterBagPreparationNo={exportLogScope?.bagPreparationNo ?? null}
          filterBagBarcode={exportLogScope?.bagBarcode ?? null}
        />
      </div>
    </div>
  );
}

export default BagPreparationPage;
