/**
 * User-facing terminology for the app UI.
 * Change labels here to update wording across all pages.
 */
export const UI_LABELS = {
  participant: "Participant",
  participants: "Participants",
  participantBarcode: "Participant Barcode",
  participantWristband: "Participant Wristband",
  participantBarcodeSheet: "Participant Barcode Sheet",
  allParticipants: "All participants",
  selectParticipant: "Select participant",
  anotherParticipant: "another participant",
  changeParticipant: "Change Participant",
  participantSelectionMode: "Participant selection mode",
  linkParticipantBarcode: "Link Participant Barcode",
  scanParticipantBarcode: "Scan Participant Barcode",
  siteRandomizationNo: "Site Randomization No.",
};

export function unknownParticipantBarcodeMessage(code) {
  return `Unknown participant barcode: ${code}`;
}

export function wrongParticipantScanMessage(code, ownerLabel) {
  return `Wrong participant scan. ${code} belongs to ${ownerLabel}. Scan/select that participant first.`;
}

export function participantSelectedMessage(participantNumber) {
  return `${participantNumber} selected. Run activities one by one for this participant.`;
}

export function selectParticipantBeforePkScanMessage() {
  return "Select or scan a participant before scanning PK tubes.";
}

export function scanParticipantOrPkMessage() {
  return "Scan a participant, PK parent, or expected aliquot barcode.";
}

export function selectParticipantToLinkBarcodeMessage() {
  return "Select a participant to link this barcode.";
}

export function participantAlreadyLinkedBarcodeMessage() {
  return "Selected participant already has a linked barcode. Choose another participant.";
}

export function unableToLinkParticipantBarcodeMessage() {
  return "Unable to link participant barcode.";
}

export function selectValidParticipantMessage() {
  return "Select a valid participant.";
}

export function selectParticipantForBarcodeSheetMessage() {
  return "Select a participant to generate barcode sheet.";
}

export function waitingForNextParticipantMessage() {
  return "Workflow complete or waiting for the next participant.";
}
