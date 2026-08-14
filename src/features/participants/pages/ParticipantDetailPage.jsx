import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AdminButton } from "@/components/shared/AdminButton";
import { SoftAlertToast } from "@/components/shared/SoftAlertToast";
import { formatDate } from "@/shared/format.js";
import { fetchSubjectDetail } from "../api/participantsApi.js";

function visitTitle(v) {
  const a = (v.studyVisitScheduleDescription || "").trim();
  const b = (v.visitScheduleDesc || "").trim();
  if (a) return a;
  if (b) return b;
  return `Visit ${v.visitNo}`;
}

function DetailRow({ label, value }) {
  return (
    <div className="participants-detail-row">
      <span className="participants-detail-row__label">{label}</span>
      <span className="participants-detail-row__value">{value}</span>
    </div>
  );
}

export default function ParticipantDetailPage() {
  const navigate = useNavigate();
  const { subjectId } = useParams();
  const [toast, setToast] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const subjectMstNo = Number.parseInt(String(subjectId || ""), 10);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!Number.isFinite(subjectMstNo) || subjectMstNo <= 0) {
        setNotFound(true);
        setDetail(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setNotFound(false);
      try {
        const row = await fetchSubjectDetail(subjectMstNo);
        if (cancelled) return;
        if (!row) {
          setNotFound(true);
          setDetail(null);
        } else {
          setDetail(row);
        }
      } catch (err) {
        if (!cancelled) {
          setToast({ message: err?.message || "Failed to load participant", variant: "error" });
          setNotFound(true);
          setDetail(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => { cancelled = true; };
  }, [subjectMstNo]);

  if (loading) {
    return (
      <div className="admin-wrap admin-wrap--participants-detail">
        <div className="admin-spinner" style={{ padding: "2rem" }}>Loading participant…</div>
      </div>
    );
  }

  if (notFound || !detail) {
    return (
      <div className="admin-wrap admin-wrap--participants-detail">
        <SoftAlertToast
          message={toast?.message}
          variant={toast?.variant ?? "error"}
          onClose={() => setToast(null)}
        />
        <div className="admin-card">
          <div className="admin-error-msg">Participant not found.</div>
          <AdminButton
            type="button"
            variant="secondary"
            style={{ marginTop: "0.75rem" }}
            onClick={() => navigate("/subjects")}
          >
            <i className="fas fa-arrow-left" /> Back to Participants
          </AdminButton>
        </div>
      </div>
    );
  }

  const s = detail;
  const headline = s.mySubjectNo || s.subjectId || "Participant";
  const siteLine = [s.siteCode || s.siteNo, s.siteDescription].filter(Boolean).join(" — ");

  return (
    <div className="admin-wrap admin-wrap--participants-detail">
      <SoftAlertToast
        message={toast?.message}
        variant={toast?.variant ?? "success"}
        onClose={() => setToast(null)}
      />

      <div className="admin-card participants-detail-header-card">
        <div className="participants-detail-header">
          <div>
            <h1 className="participants-detail-header__title">{headline}</h1>
            <div className="participants-detail-header__subtitle">
              {siteLine || s.siteNo} · {s.initials || "—"}
            </div>
          </div>
          <AdminButton type="button" variant="secondary" onClick={() => navigate("/subjects")}>
            <i className="fas fa-arrow-left" /> Back
          </AdminButton>
        </div>
      </div>

      <div className="participants-detail-grid">
        <div className="admin-card participants-detail-card">
          <h2 className="participants-detail-section-title">Demographics</h2>
          <DetailRow label="Date of Birth" value={formatDate(s.dob)} />
          <DetailRow label="Gender" value={s.gender || "—"} />
          <DetailRow label="Name" value={[s.firstName, s.surName].filter(Boolean).join(" ") || "—"} />
          <DetailRow label="Randomized" value={formatDate(s.randomizationDate)} />
          <DetailRow label="Randomization No." value={s.randomizationNo || "—"} />
          <DetailRow label="Site Randomization No." value={s.siteRandomizationNo || "—"} />
          <DetailRow
            label="Patient status"
            value={(
              <span className={`admin-pill ${s.isScreeningFailure ? "admin-pill--inactive" : "admin-pill--active"}`}>
                {s.patientStatus || "—"}
              </span>
            )}
          />
          <DetailRow label="Screening failure" value={s.isScreeningFailure ? "Yes" : "No"} />
        </div>

        <div className="admin-card participants-detail-card participants-detail-visits">
          <h2 className="participants-detail-section-title">Visits (PRMS)</h2>
          {(s.visits || []).length === 0 ? (
            <div className="participants-detail-empty">No visit schedule rows for this project.</div>
          ) : (
            <div className="participants-visit-list participants-visit-list--scroll">
              {(s.visits || []).map((visit) => {
                const done = Boolean(visit.isPrmsCompleted);
                return (
                  <div key={visit.studyVisitScheduleNo} className="participants-visit-item">
                    <div className={`participants-visit-item__dot ${done ? "participants-visit-item__dot--done" : "participants-visit-item__dot--pending"}`} />
                    <div className="participants-visit-item__body">
                      <div className="participants-visit-item__title">{visitTitle(visit)}</div>
                      <div className="participants-visit-item__meta">
                        Visit no. {visit.visitNo}
                        {visit.visitName ? ` · PRMS visit name: ${visit.visitName}` : ""}
                      </div>
                      {(visit.prmsVisitStatus || visit.visitDate || visit.expectingDate) ? (
                        <div className="participants-visit-item__dates">
                          {visit.prmsVisitStatus ? <>PRMS status: {visit.prmsVisitStatus}. </> : null}
                          {visit.visitDate ? <>Visit date: {formatDate(visit.visitDate)}. </> : null}
                          {visit.expectingDate ? <>Expected: {formatDate(visit.expectingDate)}.</> : null}
                        </div>
                      ) : null}
                    </div>
                    <span className={`admin-pill ${done ? "admin-pill--active" : "participants-visit-item__pill--pending"}`}>
                      {done ? "Completed" : "Pending"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
