import { Link, NavLink, Route, Routes, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { EmptyState } from '../components/EmptyState'
import { HomePage } from '../pages/HomePage'
import { PlaceholderPage } from '../pages/PlaceholderPage'

function ExperimentTabs() {
  const { id = '' } = useParams()
  const tabs = [
    { to: `/experiments/${id}`, label: '개요', end: true },
    { to: `/experiments/${id}/steps`, label: '절차', end: false },
    { to: `/experiments/${id}/data`, label: '조건·결과', end: false },
  ]
  return (
    <nav className="tabs" aria-label="실험 상세 탭">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tabs__item${isActive ? ' is-active' : ''}`}>
          {t.label}
        </NavLink>
      ))}
      <Link to={`/experiments/${id}/run`} className="btn btn--primary tabs__run">
        수행 모드 시작
      </Link>
    </nav>
  )
}

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
      <Route path="/experiments/:id/run" element={<PlaceholderPage title="수행 모드" phase="Phase 3" />} />
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="experiments" element={<PlaceholderPage title="실험" phase="Phase 4" />} />
        <Route path="experiments/new" element={<PlaceholderPage title="새 실험" phase="Phase 3" />} />
        <Route path="experiments/:id" element={<><ExperimentTabs /><PlaceholderPage title="실험 개요" phase="Phase 3" /></>} />
        <Route path="experiments/:id/steps" element={<><ExperimentTabs /><PlaceholderPage title="절차" phase="Phase 3" /></>} />
        <Route path="experiments/:id/data" element={<><ExperimentTabs /><PlaceholderPage title="조건·결과" phase="Phase 3" /></>} />
        <Route path="search" element={<PlaceholderPage title="검색" phase="Phase 4" />} />
        <Route path="templates" element={<PlaceholderPage title="템플릿" phase="Phase 8 (s3)" />} />
        <Route path="trash" element={<PlaceholderPage title="휴지통" phase="Phase 4" />} />
        <Route path="settings" element={<PlaceholderPage title="설정" phase="Phase 5" />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
