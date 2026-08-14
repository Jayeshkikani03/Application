export function subjectInitials(subject) {
  return subject?.initials ?? "ABC";
}

export function getSiteRandomizationNumber(subject) {
  if (!subject) return "";
  return subject.randomizationNumber ?? subject.barcode ?? "";
}

export function extractSiteRandomizationFromSubjectNumber(subjectNumber) {
  if (!subjectNumber) return "";
  const match = String(subjectNumber).match(/(\d+-\d+)$/);
  return match ? match[1] : subjectNumber;
}

export function resolveSiteRandomizationNumber({ subject, subjectId, subjects, subjectNumber } = {}) {
  const resolvedSubject = subject ?? (subjectId && subjects ? subjects.find((item) => item.id === subjectId) : null);
  const fromSubject = getSiteRandomizationNumber(resolvedSubject);
  if (fromSubject) return fromSubject;
  return extractSiteRandomizationFromSubjectNumber(subjectNumber);
}

export function formatParticipantDisplay(subject, fallbackSubjectNumber) {
  return resolveSiteRandomizationNumber({ subject, subjectNumber: fallbackSubjectNumber });
}

export function formatParticipantDropdownLabel(subject) {
  if (!subject) return "";
  return getSiteRandomizationNumber(subject) || extractSiteRandomizationFromSubjectNumber(subject.subjectNumber);
}
