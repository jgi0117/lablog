import { lazy, Suspense } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './AppShell'
import { EmptyState } from '../shared/ui/EmptyState'
import { DataPage } from '../features/data-hub/pages/DataPage'
import { DeviationsPage } from '../features/experiments/pages/DeviationsPage'
import { ExperimentsPage } from '../features/experiments/pages/ExperimentsPage'
import { ExperimentLayout } from '../features/experiments/pages/ExperimentLayout'
import { HomePage } from '../features/home/pages/HomePage'
import { NewExperimentPage } from '../features/experiments/pages/NewExperimentPage'
import { OverviewPage } from '../features/experiments/pages/OverviewPage'
import { RunPage } from '../features/experiments/pages/RunPage'
import { StepsPage } from '../features/experiments/pages/StepsPage'
import { TrashPage } from '../features/trash/pages/TrashPage'

/** docs/planning/IA.md Site Map의 공개 주소 목록. */
export const APP_ROUTE_PATHS = [
  '/',
  '/projects',
  '/projects/:id',
  '/projects/:id/requirements',
  '/projects/:id/data',
  '/projects/:id/analysis',
  '/experiments',
  '/experiments/new',
  '/experiments/:id',
  '/experiments/:id/steps',
  '/experiments/:id/run',
  '/experiments/:id/data',
  '/experiments/:id/deviations',
  '/data',
  '/data/analysis',
  '/data/export',
  '/trash',
  '/migrate',
  '/settings',
] as const

// 처음 화면에 필요 없는 무거운 화면(차트, 설정)은 열 때 불러온다.
const ProjectsPage = lazy(() => import('../features/projects/pages/ProjectsPage').then((m) => ({ default: m.ProjectsPage })))
const ProjectLayout = lazy(() => import('../features/projects/pages/ProjectLayout').then((m) => ({ default: m.ProjectLayout })))
const ProjectOverviewPage = lazy(() => import('../features/projects/pages/ProjectOverviewPage').then((m) => ({ default: m.ProjectOverviewPage })))
const ProjectRequirementsPage = lazy(() => import('../features/requirements/pages/ProjectRequirementsPage').then((m) => ({ default: m.ProjectRequirementsPage })))
const ProjectDataPage = lazy(() => import('../features/projects/pages/ProjectDataPage').then((m) => ({ default: m.ProjectDataPage })))
const ProjectAnalysisPage = lazy(() => import('../features/projects/pages/ProjectAnalysisPage').then((m) => ({ default: m.ProjectAnalysisPage })))
const DataLayout = lazy(() => import('../features/data-hub/pages/DataLayout').then((m) => ({ default: m.DataLayout })))
const DataTablePage = lazy(() => import('../features/data-hub/pages/DataTablePage').then((m) => ({ default: m.DataTablePage })))
const DataAnalysisPage = lazy(() => import('../features/data-hub/pages/DataAnalysisPage').then((m) => ({ default: m.DataAnalysisPage })))
const DataExportPage = lazy(() => import('../features/data-hub/pages/DataExportPage').then((m) => ({ default: m.DataExportPage })))
const MigrationPage = lazy(() => import('../features/settings/pages/MigrationPage').then((m) => ({ default: m.MigrationPage })))
const SettingsPage = lazy(() => import('../features/settings/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))

function NotFound() {
  return (
    <EmptyState title="페이지를 찾을 수 없습니다" description="주소를 확인하거나 홈으로 돌아가세요.">
      <Link to="/" className="btn btn--primary">
        홈으로
      </Link>
    </EmptyState>
  )
}

function LegacyRouteRedirect({ from }: { from: 'search' | 'templates' }) {
  const location = useLocation()
  const params = new URLSearchParams(from === 'search' ? location.search : '')
  params.set('moved', from)
  return <Navigate replace to={`/experiments?${params.toString()}`} />
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
            <Route path="requirements" element={<ProjectRequirementsPage />} />
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
          <Route path="search" element={<LegacyRouteRedirect from="search" />} />
          <Route path="templates" element={<LegacyRouteRedirect from="templates" />} />
          <Route path="trash" element={<TrashPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="migrate" element={<MigrationPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
