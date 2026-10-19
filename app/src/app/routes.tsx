import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { EmptyState } from '../components/EmptyState'
import { DataAnalysisPage } from '../pages/DataAnalysisPage'
import { DataExportPage } from '../pages/DataExportPage'
import { DataLayout } from '../pages/DataLayout'
import { DataPage } from '../pages/DataPage'
import { DataTablePage } from '../pages/DataTablePage'
import { DeviationsPage } from '../pages/DeviationsPage'
import { ExperimentsPage } from '../pages/ExperimentsPage'
import { ExperimentLayout } from '../pages/ExperimentLayout'
import { HomePage } from '../pages/HomePage'
import { NewExperimentPage } from '../pages/NewExperimentPage'
import { OverviewPage } from '../pages/OverviewPage'
import { RunPage } from '../pages/RunPage'
import { SearchPage } from '../pages/SearchPage'
import { StepsPage } from '../pages/StepsPage'
import { TemplatesPage } from '../pages/TemplatesPage'
import { TrashPage } from '../pages/TrashPage'

// 처음 화면에 필요 없는 무거운 화면(차트, 설정)은 열 때 불러온다.
const ProjectsPage = lazy(() => import('../pages/ProjectsPage').then((m) => ({ default: m.ProjectsPage })))
const ProjectLayout = lazy(() => import('../pages/ProjectLayout').then((m) => ({ default: m.ProjectLayout })))
const ProjectOverviewPage = lazy(() => import('../pages/ProjectOverviewPage').then((m) => ({ default: m.ProjectOverviewPage })))
const ProjectDataPage = lazy(() => import('../pages/ProjectDataPage').then((m) => ({ default: m.ProjectDataPage })))
const ProjectAnalysisPage = lazy(() => import('../pages/ProjectAnalysisPage').then((m) => ({ default: m.ProjectAnalysisPage })))
const SettingsPage = lazy(() => import('../pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))

function NotFound() {
  return (
    <EmptyState title="페이지를 찾을 수 없습니다" description="주소를 확인하거나 홈으로 돌아가세요.">
      <Link to="/" className="btn btn--primary">
        홈으로
      </Link>
    </EmptyState>
  )
}

/**
 * IA의 URL과 1:1. 수행 모드(/experiments/:id/run)만 셸 밖의 전체 화면이다.
 * 라우터는 호출하는 쪽(main.tsx 또는 테스트의 MemoryRouter)이 감싼다.
 */
export function AppRoutes() {
  return (
    <Suspense fallback={<p className="muted loading">불러오는 중…</p>}>
      <Routes>
        <Route path="/experiments/:id/run" element={<RunPage />} />
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectLayout />}>
            <Route index element={<ProjectOverviewPage />} />
            <Route path="data" element={<ProjectDataPage />} />
            <Route path="analysis" element={<ProjectAnalysisPage />} />
          </Route>
          <Route path="experiments" element={<ExperimentsPage />} />
          <Route path="experiments/new" element={<NewExperimentPage />} />
          <Route path="experiments/:id" element={<ExperimentLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="steps" element={<StepsPage />} />
            <Route path="data" element={<DataPage />} />
            <Route path="deviations" element={<DeviationsPage />} />
          </Route>
          <Route path="data" element={<DataLayout />}>
            <Route index element={<DataTablePage />} />
            <Route path="analysis" element={<DataAnalysisPage />} />
            <Route path="export" element={<DataExportPage />} />
          </Route>
          <Route path="search" element={<SearchPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="trash" element={<TrashPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
