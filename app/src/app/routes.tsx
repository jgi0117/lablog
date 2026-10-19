import { Link, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { EmptyState } from '../components/EmptyState'
import { DataPage } from '../pages/DataPage'
import { ExperimentsPage } from '../pages/ExperimentsPage'
import { ExperimentLayout } from '../pages/ExperimentLayout'
import { HomePage } from '../pages/HomePage'
import { NewExperimentPage } from '../pages/NewExperimentPage'
import { OverviewPage } from '../pages/OverviewPage'
import { PlaceholderPage } from '../pages/PlaceholderPage'
import { RunPage } from '../pages/RunPage'
import { SearchPage } from '../pages/SearchPage'
import { StepsPage } from '../pages/StepsPage'
import { TrashPage } from '../pages/TrashPage'

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
    <Routes>
      <Route path="/experiments/:id/run" element={<RunPage />} />
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="experiments" element={<ExperimentsPage />} />
        <Route path="experiments/new" element={<NewExperimentPage />} />
        <Route path="experiments/:id" element={<ExperimentLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="steps" element={<StepsPage />} />
          <Route path="data" element={<DataPage />} />
        </Route>
        <Route path="search" element={<SearchPage />} />
        <Route path="templates" element={<PlaceholderPage title="템플릿" phase="Phase 8 (s3)" />} />
        <Route path="trash" element={<TrashPage />} />
        <Route path="settings" element={<PlaceholderPage title="설정" phase="Phase 5" />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
