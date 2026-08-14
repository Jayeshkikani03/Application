import { LabProvider } from "../../context/LabContext";
import { ActivityConfigPdfImportProvider } from "../../context/ActivityConfigPdfImportContext";
import { ScanNavProvider } from "../../context/ScanNavContext";
import { TutorialProvider } from "../../shared/tutorial/TutorialProvider.jsx";
import { AppShell } from "./AppShell";

export function AuthenticatedLayout() {
  return (
    <LabProvider>
      <ActivityConfigPdfImportProvider>
        <ScanNavProvider>
          <TutorialProvider>
            <AppShell />
          </TutorialProvider>
        </ScanNavProvider>
      </ActivityConfigPdfImportProvider>
    </LabProvider>
  );
}
