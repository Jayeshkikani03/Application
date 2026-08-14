import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { useLab } from "../context/LabContext";
import { ScrollableSelect } from "../components/shared/ScrollableSelect";
import { formatDoseDisplayLabel, formatTimepointDisplayLabel } from "../utils/visitDisplay";

import { resolveExpectedAliquotBarcodes } from "../services/workflowService";
import { UI_LABELS, selectParticipantForBarcodeSheetMessage } from "../constants/displayLabels";
import {
  formatParticipantDropdownLabel,
  getSiteRandomizationNumber,
} from "../utils/participantDisplay";

const ALIQUOT_TUBE_LABEL = "Aliquot Tube";

function isTimepointBarcodeActivity(activity) {
  return activity.barcode && activity.pkOffsetMinutes !== null;
}

function subjectMeta(subject, extra = []) {
  return [
    `${UI_LABELS.siteRandomizationNo} ${getSiteRandomizationNumber(subject)}`,
    `Cohort: ${subject.cohort}`,
    ...extra,
  ].join(" | ");
}

function BarcodeSvg({ value }) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!svgRef.current || !value) return;
    JsBarcode(svgRef.current, value, {
      format: "CODE128",
      displayValue: true,
      font: "Consolas",
      fontSize: 14,
      height: 54,
      margin: 8,
      width: 1.6,
    });
  }, [value]);

  return <svg ref={svgRef} className="barcode-card__svg" aria-label={`Barcode ${value}`} />;
}

function BarcodeCard({ barcode, label, meta, onSelect }) {
  const cardContent = (
    <>
      <div className="barcode-card__meta">
        <strong>{label}</strong>
        {meta && <span>{meta}</span>}
      </div>
      <BarcodeSvg value={barcode} />
    </>
  );

  if (onSelect) {
    return (
      <button type="button" className="barcode-card barcode-card--clickable" onClick={onSelect}>
        {cardContent}
      </button>
    );
  }

  return (
    <article className="barcode-card">
      {cardContent}
    </article>
  );
}

function BarcodeSection({ title, items, onSelectBarcode }) {
  if (items.length === 0) return null;

  return (
    <section className="barcode-section">
      <h2>{title}</h2>
      <div className="barcode-grid">
        {items.map((item) => (
          <BarcodeCard key={`${title}-${item.barcode}-${item.label}`} {...item} onSelect={onSelectBarcode ? () => onSelectBarcode(item) : undefined} />
        ))}
      </div>
    </section>
  );
}

function BarcodePage() {
  const { state } = useLab();
  const [subjectId, setSubjectId] = useState("");
  const [doseFilter, setDoseFilter] = useState("");
  const [timepointFilter, setTimepointFilter] = useState("");
  const [previewBarcode, setPreviewBarcode] = useState(null);
  const selectedSubject = state.subjects.find((subject) => subject.id === subjectId);

  const subjectVisits = useMemo(
    () => (selectedSubject ? state.visits.filter((visit) => visit.subjectId === selectedSubject.id) : []),
    [selectedSubject, state.visits]
  );

  const timepointOptions = useMemo(() => {
    if (!selectedSubject) return [];

    return [
      ...new Set(
        state.activities
          .filter(
            (activity) =>
              activity.subjectId === selectedSubject.id &&
              isTimepointBarcodeActivity(activity) &&
              (!doseFilter || activity.visitId === doseFilter)
          )
          .map((activity) => activity.timepoint)
      ),
    ];
  }, [doseFilter, selectedSubject, state.activities]);

  const barcodeGroups = useMemo(() => {
    if (!selectedSubject) {
      return { subject: [], pd: [], pk: [], aliquot: [] };
    }

    const visitsById = new Map(state.visits.map((visit) => [visit.id, visit]));

    const subject = [
      {
        barcode: selectedSubject.barcode,
        label: UI_LABELS.participantWristband,
        meta: subjectMeta(selectedSubject),
      },
    ];

    const pkActivities = state.activities
      .filter(
        (activity) =>
          activity.subjectId === selectedSubject.id &&
          isTimepointBarcodeActivity(activity) &&
          (!doseFilter || activity.visitId === doseFilter) &&
          (!timepointFilter || activity.timepoint === timepointFilter)
      )
      .map((activity) => {
        const visit = visitsById.get(activity.visitId);
        const visitMeta = formatDoseDisplayLabel(activity.dose ?? visit?.doseLabel);
        return {
          activity,
          visit,
          barcode: activity.barcode,
          label: formatTimepointDisplayLabel(activity.timepoint, activity.dose),
          meta: subjectMeta(selectedSubject, [`Dose: ${visitMeta}`]),
        };
      });

    const pk = pkActivities.map(({ activity, visit: _visit, ...item }) => item);

    const aliquot = pkActivities.flatMap(({ activity, visit }) =>
      resolveExpectedAliquotBarcodes(state, activity, activity.barcode).map((barcode) => {
        return {
          barcode,
          label: ALIQUOT_TUBE_LABEL,
          meta: subjectMeta(selectedSubject, [
            `Dose: ${formatDoseDisplayLabel(activity.dose ?? visit?.doseLabel)}`,
            `Timepoint: ${formatTimepointDisplayLabel(activity.timepoint, activity.dose)}`,
          ]),
        };
      })
    );

    return { subject, pk, aliquot };
  }, [doseFilter, selectedSubject, state.activities, state.visits, timepointFilter]);

  const handlePrint = () => {
    window.print();
  };

  const handleSubjectChange = (nextSubjectId) => {
    setSubjectId(nextSubjectId);
    setDoseFilter("");
    setTimepointFilter("");
    setPreviewBarcode(null);
  };

  const handleDoseChange = (nextDoseFilter) => {
    setDoseFilter(nextDoseFilter);
    setTimepointFilter("");
  };

  return (
    <div className="page page--barcodes">
      <div className="page-actions page-actions--end">
        <button type="button" className="btn btn--primary barcode-print-btn" disabled={!selectedSubject} onClick={handlePrint}>
          Download / Print PDF
        </button>
      </div>

      <section className="card barcode-filter-card">
        <div className="barcode-filter-grid">
          <label className="field">
            <span>{UI_LABELS.participant}</span>
            <ScrollableSelect
              value={subjectId}
              onChange={handleSubjectChange}
              options={state.subjects.map((subject) => ({
                value: subject.id,
                label: formatParticipantDropdownLabel(subject),
              }))}
              placeholder={UI_LABELS.selectParticipant}
            />
          </label>

          <label className="field">
            <span>Dose</span>
            <ScrollableSelect
              value={doseFilter}
              disabled={!selectedSubject}
              onChange={handleDoseChange}
              options={subjectVisits.map((visit) => ({
                value: visit.id,
                label: formatDoseDisplayLabel(visit.doseLabel ?? visit.dose),
              }))}
              placeholder="All doses"
            />
          </label>

          <label className="field">
            <span>Timepoint</span>
            <ScrollableSelect
              value={timepointFilter}
              disabled={!selectedSubject}
              onChange={setTimepointFilter}
              options={timepointOptions.map((timepoint) => {
                const activity = state.activities.find(
                  (item) =>
                    item.subjectId === selectedSubject?.id &&
                    item.timepoint === timepoint &&
                    isTimepointBarcodeActivity(item)
                );
                return {
                  value: timepoint,
                  label: formatTimepointDisplayLabel(timepoint, activity?.dose),
                };
              })}
              placeholder="All timepoints"
            />
          </label>
        </div>
      </section>

      {!selectedSubject ? (
        <section className="card">
          <p className="empty-state">{selectParticipantForBarcodeSheetMessage()}</p>
        </section>
      ) : (
        <div className="barcode-sheet">
          <div className="barcode-sheet__head">
            <div>
              <span className="section-label">{UI_LABELS.participantBarcodeSheet}</span>
              <h2>{formatParticipantDropdownLabel(selectedSubject)}</h2>
              <p>{UI_LABELS.siteRandomizationNo}</p>
            </div>
            <strong>eSource</strong>
          </div>

          <BarcodeSection title={UI_LABELS.participant} items={barcodeGroups.subject} onSelectBarcode={setPreviewBarcode} />
          <BarcodeSection title="PK Tubes" items={barcodeGroups.pk} onSelectBarcode={setPreviewBarcode} />
          <BarcodeSection title="Aliquot Tubes" items={barcodeGroups.aliquot} onSelectBarcode={setPreviewBarcode} />
        </div>
      )}

      {previewBarcode && (
        <div className="modal-backdrop barcode-preview-backdrop" role="presentation">
          <div className="modal barcode-preview-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="barcode-preview-modal__head">
              <div>
                <h3 className="modal__title">{previewBarcode.label}</h3>
                {previewBarcode.meta && <p>{previewBarcode.meta}</p>}
              </div>
              <button type="button" className="btn btn--ghost" onClick={() => setPreviewBarcode(null)}>
                Close
              </button>
            </div>
            <BarcodeCard {...previewBarcode} />
          </div>
        </div>
      )}
    </div>
  );
}

export default BarcodePage;
