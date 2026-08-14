import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ConfigDataTable } from "@/components/shared/ConfigDataTable";
import { ScrollableSelect } from "@/components/shared/ScrollableSelect";
import { SoftAlertToast } from "@/components/shared/SoftAlertToast";
import { AdminButton } from "@/components/shared/AdminButton";
import { taskLogApi } from "../api/taskLogApi";

function formatBody(bodyText) {
  if (!bodyText) return "";
  try {
    const parsed = JSON.parse(bodyText);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(bodyText);
  }
}

function formatDateTimeMinutes(utcStr) {
  if (!utcStr) return "—";
  const d = new Date(utcStr);
  if (Number.isNaN(d.getTime())) return "—";

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = months[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");

  return `${day}-${month}-${year} ${hours}:${minutes}`;
}

function formatOffset(offsetStr) {
  if (!offsetStr) return "—";
  let s = String(offsetStr).trim();
  s = s.replace(/^\((.*)\)$/, "$1");
  if (/^[+-]\d{2}:\d{2}:00$/.test(s)) {
    s = s.slice(0, 6);
  }
  return s;
}

export default function TaskLogPage() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [taskNames, setTaskNames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  // Filters & Modals
  const [selectedTaskName, setSelectedTaskName] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [viewRow, setViewRow] = useState(null);
  const [viewItemRow, setViewItemRow] = useState(null);

  const showToast = (message, variant = "success") => {
    setToast({ message, variant });
  };

  // Load task name dropdown options on mount
  const loadTaskNames = useCallback(async () => {
    try {
      const names = await taskLogApi.getTaskNames();
      setTaskNames(Array.isArray(names) ? names : []);
    } catch (err) {
      console.error("Failed to load task names:", err);
    }
  }, []);

  // Fetch filtered task logs on filter selection
  const fetchTaskLogs = useCallback(async (taskNameOverride, statusOverride) => {
    const taskName = taskNameOverride !== undefined ? taskNameOverride : selectedTaskName;
    const status = statusOverride !== undefined ? statusOverride : selectedStatus;
    try {
      setLoading(true);
      setError(null);
      setHasSearched(true);
      const data = await taskLogApi.getTaskLogs({
        taskName,
        status,
        take: 500,
      });
      setLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Failed to load task logs.";
      setError(msg);
      showToast(msg, "error");
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [selectedTaskName, selectedStatus]);

  useEffect(() => {
    void loadTaskNames();
  }, [loadTaskNames]);

  const handleTaskNameChange = (val) => {
    setSelectedTaskName(val);
    void fetchTaskLogs(val, selectedStatus);
  };

  const handleStatusChange = (val) => {
    setSelectedStatus(val);
    void fetchTaskLogs(selectedTaskName, val);
  };

  const handleCopyBody = (row) => {
    const text = formatBody(row?.bodyText);
    if (!text) return;
    navigator.clipboard?.writeText(text)
      .then(() => showToast("Body copied to clipboard", "success"))
      .catch(() => showToast("Failed to copy body text", "error"));
  };

  // 4 Static Task Name Dropdown options
  const taskNameOptions = useMemo(
    () => [
      { value: "bagexport", label: "bagexport" },
      { value: "timepointexport", label: "timepointexport" },
      { value: "barcodeimport", label: "barcodeimport" },
      { value: "ActivityConfigPdfImport", label: "ActivityConfigPdfImport" },
    ],
    []
  );

  const statusOptions = useMemo(
    () => [
      { value: "all", label: "All Statuses" },
      { value: "success", label: "Success" },
      { value: "fail", label: "Fail / Failure" },
    ],
    []
  );

  // Dynamic Table Columns Definition based on selectedTaskName
  const columns = useMemo(() => {
    const list = [
      {
        key: "taskLogNo",
        label: "Log #",
        render: (row) => <span className="config-data-table__strong">#{row.taskLogNo}</span>,
        searchValue: (row) => String(row.taskLogNo ?? ""),
      },
      {
        key: "taskName",
        label: "Task Name",
        render: (row) => (
          <span className="config-data-table__strong" style={{ textTransform: "none", color: "var(--blue)" }}>
            {row.taskName || "—"}
          </span>
        ),
        searchValue: (row) => row.taskName ?? "",
      },
      {
        key: "projectCode",
        label: "Project Code",
        render: (row) => (
          <span style={{ color: "#000000", fontWeight: 500 }}>
            {row.projectCode || "—"}
          </span>
        ),
        searchValue: (row) => row.projectCode ?? "",
      },
      {
        key: "isSuccess",
        label: "Status",
        align: "center",
        searchValue: (row) => (row.isSuccess ? "Success" : "Fail"),
        render: (row) => (
          <span
            className={`status-badge status-badge--compact ${
              row.isSuccess ? "status--completed" : "status--missed"
            }`}
          >
            {row.isSuccess ? "Success" : "Fail"}
          </span>
        ),
      },
      {
        key: "msg",
        label: "Message",
        render: (row) => (
          <span className="config-data-table__wrap" title={row.msg}>
            {row.msg || "—"}
          </span>
        ),
        searchValue: (row) => row.msg ?? "",
      },
    ];

    // Conditional View Button Column: Timepoints Export for timepointexport
    if (selectedTaskName === "timepointexport") {
      list.push({
        key: "exportItemNames",
        label: "Timepoints Export",
        align: "center",
        render: (row) => (
          <AdminButton
            type="button"
            variant="secondary"
            style={{ padding: "3px 12px", fontSize: "0.8rem" }}
            onClick={(e) => {
              e.stopPropagation();
              setViewItemRow(row);
            }}
            title="View Timepoint Names"
          >
            View
          </AdminButton>
        ),
      });
    }
    // Conditional Column: Bag Barcode for bagexport (direct text, no popup)
    else if (selectedTaskName === "bagexport") {
      list.push({
        key: "exportItemNames",
        label: "Bag Barcode",
        render: (row) => (
          <span className="config-data-table__mono" style={{ fontSize: "0.85rem", color: "#000000", fontWeight: 500 }}>
            {row.exportItemNames || row.exportItemCsv || "—"}
          </span>
        ),
        searchValue: (row) => row.exportItemNames || row.exportItemCsv || "",
      });
    }

    list.push(
      {
        key: "actions",
        label: "Body",
        align: "center",
        render: (row) => (
          <AdminButton
            type="button"
            variant="secondary"
            style={{ padding: "3px 12px", fontSize: "0.8rem" }}
            onClick={(e) => {
              e.stopPropagation();
              setViewRow(row);
            }}
            title="View Body Payload"
          >
            View
          </AdminButton>
        ),
      },
      {
        key: "performedBy",
        label: "Performed By",
        align: "center",
        render: (row) => (
          <span style={{ color: "#000000", fontWeight: 500 }}>
            {row.performedBy || "System"}
          </span>
        ),
        searchValue: (row) => row.performedBy ?? "",
      },
      {
        key: "recordedOnUtc",
        label: "Performed On (UTC)",
        align: "center",
        render: (row) => {
          if (!row.recordedOnUtc) return "—";
          return (
            <span style={{ color: "#000000", fontWeight: 500, fontSize: "0.85rem" }}>
              {formatDateTimeMinutes(row.recordedOnUtc)}
            </span>
          );
        },
      },
      {
        key: "recordedAtOffset",
        label: "Performed On (Offset)",
        align: "center",
        render: (row) => (
          <span style={{ color: "#000000", fontSize: "0.85rem" }}>
            {formatOffset(row.recordedAtOffset)}
          </span>
        ),
        searchValue: (row) => row.recordedAtOffset ?? "",
      }
    );

    return list;
  }, [selectedTaskName]);

  return (
    <div className="admin-wrap admin-wrap--task-log">
      <SoftAlertToast
        title={toast?.variant === "error" ? "Error" : toast?.variant === "warning" ? "Warning" : "Success"}
        message={toast?.message}
        variant={toast?.variant ?? "success"}
        onClose={() => setToast(null)}
      />

      <div className="admin-card admin-card--task-log-header" style={{ padding: "0.5rem 0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate(-1)}
            aria-label="Back"
            title="Back"
            style={{ fontSize: "1.1rem", padding: "4px 10px", height: "36px" }}
          >
            ←
          </button>

          <div style={{ minWidth: "220px", flex: "0 1 260px" }}>
            <ScrollableSelect
              value={selectedTaskName}
              onChange={handleTaskNameChange}
              options={taskNameOptions}
              placeholder="Select Task Name"
              allowEmpty={false}
              searchable
              ariaLabel="Filter by Task Name"
            />
          </div>

          <div style={{ minWidth: "160px", flex: "0 1 180px" }}>
            <ScrollableSelect
              value={selectedStatus}
              onChange={handleStatusChange}
              options={statusOptions}
              placeholder="All Statuses"
              allowEmpty={false}
              ariaLabel="Filter by Status"
            />
          </div>
        </div>
      </div>

      <div className="admin-card admin-card--task-log-table">
        {error ? (
          <div className="admin-error-card" style={{ padding: "1.5rem", textAlign: "center" }}>
            <div className="admin-error-title">Failed to Load Task Logs</div>
            <div className="admin-error-msg">{error}</div>
            <AdminButton variant="primary" style={{ marginTop: "1rem" }} onClick={() => fetchTaskLogs()}>
              Retry Connection
            </AdminButton>
          </div>
        ) : (
          <ConfigDataTable
            columns={columns}
            rows={logs}
            emptyMessage={
              loading
                ? "Loading task logs..."
                : !hasSearched
                  ? "Select a filter to view task logs."
                  : "No task logs found matching the selected filters."
            }
            variant={columns.length === 10 ? "admin-task-log-10col" : "admin-task-log"}
            getRowKey={(row) => row.taskLogNo}
            searchable={hasSearched}
            searchPlaceholder="Search message, performer, or task..."
            paginated={hasSearched && logs.length > 0}
            defaultPageSize={10}
            pageSizeOptions={[10, 20, 50, 100]}
          />
        )}
      </div>

      {/* Body View Modal Popup */}
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
                aria-labelledby="task-log-body-title"
                style={{ maxWidth: "800px", width: "90vw" }}
              >
                <div className="admin-reason-modal-title" id="task-log-body-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Task Log Body — #{viewRow.taskLogNo} ({viewRow.taskName})</span>
                  {viewRow.bodyText ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => handleCopyBody(viewRow)}
                      style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                    >
                      Copy Body
                    </button>
                  ) : null}
                </div>

                <div className="admin-audit-modal__body">
                  <pre
                    className="code-block"
                    style={{
                      margin: 0,
                      maxHeight: "55dvh",
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontSize: "0.85rem",
                      padding: "1rem",
                      background: "#ffffff",
                      color: "#000000",
                      borderRadius: "6px",
                      border: "1px solid var(--border, #cbd5e1)",
                      fontFamily: "monospace",
                    }}
                  >
                    {formatBody(viewRow.bodyText) || "— No body payload content —"}
                  </pre>
                </div>

                <div className="admin-reason-actions admin-reason-actions--center" style={{ marginTop: "1rem" }}>
                  <button type="button" className="btn btn--secondary" onClick={() => setViewRow(null)}>
                    Close
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {/* Timepoints / Items View Modal Popup */}
      {viewItemRow
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
                aria-labelledby="task-log-items-title"
                style={{ maxWidth: "600px", width: "90vw" }}
              >
                <div className="admin-reason-modal-title" id="task-log-items-title">
                  {viewItemRow.taskName === "timepointexport"
                    ? `Timepoint Export Details — #${viewItemRow.taskLogNo}`
                    : `Exported Items Details — #${viewItemRow.taskLogNo}`}
                </div>

                <div className="admin-audit-modal__body" style={{ padding: "1rem" }}>
                  <div
                    style={{
                      background: "#ffffff",
                      color: "#000000",
                      padding: "1rem",
                      borderRadius: "6px",
                      border: "1px solid var(--border, #cbd5e1)",
                      maxHeight: "50dvh",
                      overflowY: "auto",
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: "0.75rem", fontSize: "0.875rem", color: "var(--text-muted, #475569)" }}>
                      {viewItemRow.taskName === "timepointexport" ? "Exported Timepoint Names:" : "Exported Bag Barcodes:"}
                    </div>

                    {viewItemRow.exportItemNames || viewItemRow.exportItemCsv ? (
                      <ul style={{ margin: 0, paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        {(viewItemRow.exportItemNames || viewItemRow.exportItemCsv)
                          .split(",")
                          .map((item, idx) => (
                            <li key={idx} style={{ fontSize: "0.9rem", fontWeight: 500, color: "#000000" }}>
                              {item.trim()}
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <div style={{ color: "#64748b", fontStyle: "italic" }}>No timepoint details available.</div>
                    )}
                  </div>
                </div>

                <div className="admin-reason-actions admin-reason-actions--center" style={{ marginTop: "1rem" }}>
                  <button type="button" className="btn btn--secondary" onClick={() => setViewItemRow(null)}>
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
