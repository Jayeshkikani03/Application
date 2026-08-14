import { resolveActiveProjectId } from "./barcodeGenerationService";

function resolveSubjectProjectId(subject) {
  if (subject?.projectId) return subject.projectId;
  const match = String(subject?.subjectNumber ?? "").match(/^(\d{4}-\d{2})/);
  return match?.[1] ?? "";
}

function getSubjectsForProject(state, projectId = null) {
  const resolvedProjectId = projectId ?? resolveActiveProjectId(state);
  return (state.subjects ?? []).filter(
    (subject) => resolveSubjectProjectId(subject) === resolvedProjectId
  );
}

function normalizeBarcodeCode(code) {
  return String(code ?? "").trim().toUpperCase();
}

function getSubjectForBarcodeRecord(state, barcode) {
  if (!barcode) return null;
  const subjectId = barcode.subjectId ?? barcode.pendingSubjectId;
  return (state.subjects ?? []).find((subject) => subject.id === subjectId) ?? null;
}

function findSubjectBarcodeForProject(state, code, projectId = null) {
  const resolvedProjectId = projectId ?? resolveActiveProjectId(state);
  const normalizedCode = normalizeBarcodeCode(code);
  const matches = (state.barcodes ?? []).filter(
    (barcode) => barcode.type === "subject" && normalizeBarcodeCode(barcode.code) === normalizedCode
  );
  if (!matches.length) return null;

  const projectMatch = matches.find((barcode) => {
    const subject = getSubjectForBarcodeRecord(state, barcode);
    return subject && resolveSubjectProjectId(subject) === resolvedProjectId;
  });
  return projectMatch ?? matches[0];
}

function findSubjectForBarcodeCode(state, code, projectId = null) {
  const barcode = findSubjectBarcodeForProject(state, code, projectId);
  return getSubjectForBarcodeRecord(state, barcode);
}

function belongsToProjectSubject(state, subjectId, projectId = null) {
  const resolvedProjectId = projectId ?? resolveActiveProjectId(state);
  const subject = (state.subjects ?? []).find((item) => item.id === subjectId);
  return !!subject && resolveSubjectProjectId(subject) === resolvedProjectId;
}

function filterSamplesForProject(state, samples, projectId = null) {
  const resolvedProjectId = projectId ?? resolveActiveProjectId(state);
  return (samples ?? []).filter(
    (sample) => sample?.subjectId && belongsToProjectSubject(state, sample.subjectId, resolvedProjectId)
  );
}

function filterPkBarcodesForProject(state, barcodes, projectId = null) {
  const resolvedProjectId = projectId ?? resolveActiveProjectId(state);
  const projectMatches = (barcodes ?? []).filter((barcode) => {
    const activity = barcode.activityId
      ? (state.activities ?? []).find((item) => item.id === barcode.activityId)
      : undefined;
    if (!activity?.subjectId) return false;
    return belongsToProjectSubject(state, activity.subjectId, resolvedProjectId);
  });
  return projectMatches.length ? projectMatches : barcodes ?? [];
}

function tagSubjectsWithProject(state) {
  let changed = false;
  const subjects = (state.subjects ?? []).map((subject) => {
    if (subject.projectId) return subject;
    const projectId = resolveSubjectProjectId(subject);
    if (!projectId) return subject;
    changed = true;
    return {
      ...subject,
      projectId,
    };
  });
  return changed ? { ...state, subjects } : state;
}

function buildAliquotLookup(run) {
  const lookup = new Map();
  for (const item of run?.aliquots ?? []) {
    const baseLabel = String(item.label ?? "").replace(/ Aliquot \d+$/i, "").trim();
    const key = `${item.participantLabel}|${baseLabel}`;
    const list = lookup.get(key) ?? [];
    list.push(item.barcode);
    lookup.set(key, list);
  }
  for (const [key, list] of lookup.entries()) {
    lookup.set(
      key,
      [...list].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    );
  }
  return lookup;
}

function findBarcodeRunForProject(state, projectId) {
  if (!projectId) return null;
  const runs = state.generatedBarcodeRuns ?? [];
  return runs.find((run) => run.projectId === projectId || run.projectCode === projectId) ?? null;
}

function resolveAliquotBarcodesFromRun(state, activity) {
  if (!activity) return [];
  const subject = (state.subjects ?? []).find((item) => item.id === activity.subjectId);
  const projectId = activity.projectId ?? resolveSubjectProjectId(subject);
  const run = findBarcodeRunForProject(state, projectId);
  if (!run) return [];

  const participantLabel = subject?.barcode ?? subject?.randomizationNumber ?? "";
  const timepoint = activity.timepoint ?? "";
  if (!participantLabel || !timepoint) return [];

  const aliquotLookup = buildAliquotLookup(run);
  return aliquotLookup.get(`${participantLabel}|${timepoint}`) ?? [];
}

export {
  belongsToProjectSubject,
  findSubjectBarcodeForProject,
  findSubjectForBarcodeCode,
  filterSamplesForProject,
  getSubjectsForProject,
  resolveSubjectProjectId,
  resolveAliquotBarcodesFromRun,
  tagSubjectsWithProject,
  filterPkBarcodesForProject,
};
