import { lazy, Suspense } from "react";
import { Capacitor } from "@capacitor/core";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { PermissionProvider } from "./context/PermissionContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PermissionGate } from "./components/PermissionGate";
import { DefaultHomeRedirect } from "./components/DefaultHomeRedirect";
import { AuthenticatedLayout } from "./components/layout/AuthenticatedLayout";
import { ViewportProvider } from "./components/layout/ViewportProvider";
import ActivityExecutionPage from "./pages/ActivityExecutionPage";
import CentrifugationPage from "./pages/CentrifugationPage";
import AliquotPage from "./pages/AliquotPage";
import BagPreparationPage from "./pages/BagPreparationPage";
import BarcodeGenerationPage from "./pages/BarcodeGenerationPage";
import ActivityConfigurationPage from "./pages/ActivityConfigurationPage";
import ExportLogPage from "./pages/ExportLogPage";
import ReviewPage from "./pages/ReviewPage";
import ReviewDetailPage from "./pages/ReviewDetailPage";
import QueriesPage from "./pages/QueriesPage";
import LoginPage from "./pages/LoginPage";
import { ProjectSettingsProvider, useProjectSettings } from "./context/ProjectSettingsContext.jsx";
import { isActivityMappingCrfVisible } from "./features/visitCrfMapping/visitCrfMappingConfig.js";
import "./styles/app.css";

const ParametersPage = lazy(() => import("./features/parameters/pages/ParametersPage"));
const ProjectParametersPage = lazy(() => import("./features/projectParameters/pages/ProjectParametersPage"));
const OperationMasterPage = lazy(() => import("./features/parameters/pages/OperationMasterPage"));
const ProfilePage = lazy(() => import("./features/users/pages/ProfilePage"));
const RoleMatrixPage = lazy(() => import("./features/users/pages/RoleMatrixPage"));
const ExternalApiDetailsPage = lazy(() => import("./features/externalApi/pages/ExternalApiDetailsPage"));
const LlmProviderConfigPage = lazy(() => import("./features/llmConfig/pages/LlmProviderConfigPage"));
const LlmPromptManagePage = lazy(() => import("./features/llmPrompts/pages/LlmPromptManagePage"));
const TaskLogPage = lazy(() => import("./features/taskLog/pages/TaskLogPage"));
const ApkUploadPage = lazy(() => import("./features/apk/pages/ApkUploadPage"));
const ApkDownloadPage = lazy(() => import("./features/apk/pages/ApkDownloadPage"));
const ParticipantsPage = lazy(() => import("./features/participants/pages/ParticipantsPage"));
const ParticipantDetailPage = lazy(() => import("./features/participants/pages/ParticipantDetailPage"));
const VisitCrfMappingPage = lazy(() => import("./features/visitCrfMapping/pages/VisitCrfMappingPage"));
const VisitCrfFillPage = lazy(() => import("./features/visitCrf/pages/VisitCrfFillPage"));
const ActivityMappingCrfPage = lazy(() => import("./features/visitCrf/pages/ActivityMappingCrfPage"));

function VisitCrfMappingRoute({ children }) {
  const { loading, showActivityMappingCrf } = useProjectSettings();
  if (loading) return null;
  if (!isActivityMappingCrfVisible() || !showActivityMappingCrf) {
    return <Navigate to="/" replace />;
  }
  return children;
}
function getRuntimeBasePath() {
  if (Capacitor.isNativePlatform()) {
    return "";
  }

  const baseHref = document.querySelector("base")?.getAttribute("href") ?? "/";
  if (baseHref === "./" || baseHref === ".") {
    return "";
  }

  const path = new URL(baseHref, window.location.origin).pathname;
  if (!path || path === "/") return "/";
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

const routerBase = getRuntimeBasePath();

function App() {
  return (
    <AuthProvider>
      <ProjectSettingsProvider>
        <PermissionProvider>
            <ViewportProvider>
              <BrowserRouter basename={routerBase}>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route
                    path="/download-app"
                    element={
                      <Suspense fallback={null}>
                        <ApkDownloadPage />
                      </Suspense>
                    }
                  />
                  <Route
                    element={
                      <ProtectedRoute>
                        <AuthenticatedLayout />
                      </ProtectedRoute>
                    }
                  >
                      <Route element={<PermissionGate />}>
                        <Route index element={<DefaultHomeRedirect />} />
                        <Route path="execute" element={<ActivityExecutionPage />} />
                        <Route path="review" element={<ReviewPage />} />
                        <Route path="review/crf/:subjectMstNo/:appVisitCrfMappingNo" element={<VisitCrfMappingRoute><Suspense fallback={null}><ActivityMappingCrfPage /></Suspense></VisitCrfMappingRoute>} />
                        <Route path="review/:visitTrackerNo" element={<ReviewDetailPage />} />
                        <Route path="queries" element={<QueriesPage />} />
                        <Route path="subjects" element={<Suspense fallback={null}><ParticipantsPage /></Suspense>} />
                        <Route path="subjects/:subjectId" element={<Suspense fallback={null}><ParticipantDetailPage /></Suspense>} />
                        <Route path="centrifugation" element={<CentrifugationPage />} />
                        <Route path="aliquots" element={<AliquotPage />} />
                        <Route path="bag-preparation" element={<BagPreparationPage />} />
                        <Route path="bag-preparation/export-log" element={<ExportLogPage kind="bag" />} />
                        <Route path="barcode-generation" element={<BarcodeGenerationPage />} />
                        <Route path="activity-configuration" element={<ActivityConfigurationPage />} />
                        <Route path="activity-configuration/export-log" element={<ExportLogPage kind="timepoint" />} />
                        <Route path="activity-mapping" element={<VisitCrfMappingRoute><Suspense fallback={null}><VisitCrfMappingPage /></Suspense></VisitCrfMappingRoute>} />
                        <Route path="activity-fill" element={<VisitCrfMappingRoute><Suspense fallback={null}><VisitCrfFillPage /></Suspense></VisitCrfMappingRoute>} />
                        <Route path="activity-fill/open/:subjectMstNo/:appVisitCrfMappingNo" element={<VisitCrfMappingRoute><Suspense fallback={null}><ActivityMappingCrfPage /></Suspense></VisitCrfMappingRoute>} />
                        <Route path="visit-crf-mapping" element={<VisitCrfMappingRoute><Suspense fallback={null}><VisitCrfMappingPage /></Suspense></VisitCrfMappingRoute>} />
                        <Route path="visit-crf" element={<VisitCrfMappingRoute><Suspense fallback={null}><VisitCrfFillPage /></Suspense></VisitCrfMappingRoute>} />
                        <Route path="visit-crf/open/:subjectMstNo/:appVisitCrfMappingNo" element={<VisitCrfMappingRoute><Suspense fallback={null}><ActivityMappingCrfPage /></Suspense></VisitCrfMappingRoute>} />
                        <Route path="admin/parameters" element={<Suspense fallback={null}><ParametersPage /></Suspense>} />
                        <Route path="admin/project-parameters" element={<Suspense fallback={null}><ProjectParametersPage /></Suspense>} />
                        <Route path="admin/profiles" element={<Suspense fallback={null}><ProfilePage /></Suspense>} />
                        <Route path="admin/role-matrix" element={<Suspense fallback={null}><RoleMatrixPage /></Suspense>} />
                        <Route path="admin/operation-master" element={<Suspense fallback={null}><OperationMasterPage /></Suspense>} />
                        <Route path="admin/external-apis" element={<Suspense fallback={null}><ExternalApiDetailsPage /></Suspense>} />
                        <Route path="admin/llm-config" element={<Suspense fallback={null}><LlmProviderConfigPage /></Suspense>} />
                        <Route path="admin/llm-prompts" element={<Suspense fallback={null}><LlmPromptManagePage /></Suspense>} />
                        <Route path="admin/task-logs" element={<Suspense fallback={null}><TaskLogPage /></Suspense>} />
                        <Route path="admin/apk" element={<Suspense fallback={null}><ApkUploadPage /></Suspense>} />
                        <Route path="*" element={<DefaultHomeRedirect />} />
                      </Route>
                    </Route>
                  </Routes>
                </BrowserRouter>
              </ViewportProvider>
        </PermissionProvider>
      </ProjectSettingsProvider>
    </AuthProvider>
  );
}

export default App;
