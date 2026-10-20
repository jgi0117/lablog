import { useRef } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useBackupExport } from '../hooks/useBackupExport'
import { ErrorBoundary } from './ErrorBoundary'
import { ExternalChangeBanner } from './ExternalChangeBanner'
import { MigrationBanner } from './MigrationBanner'
import { StorageBanner } from './StorageBanner'

const NAV = [
  { to: '/', label: '홈', end: true },
  { to: '/projects', label: '프로젝트', end: false },
  { to: '/experiments', label: '실험', end: false },
  { to: '/data', label: '데이터', end: false },
]

/**
 * 왼쪽 메뉴(좁은 화면에서는 아래), 상단 + 새 실험과 설정. 수행 모드는 이 셸을 쓰지 않는다.
 * 한 화면에서 오류가 나도 메뉴는 남도록 본문만 오류 경계로 감싼다.
 */
export function AppShell() {
  const location = useLocation()
  const exportNow = useBackupExport()
  const main = useRef<HTMLElement>(null)

  return (
    <div className="shell">
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault()
          main.current?.focus()
        }}
      >
        본문으로 건너뛰기
      </a>
      <nav className="rail" aria-label="메인 메뉴">
        <div className="rail__logo" aria-hidden="true">
          L
        </div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => `rail__item${isActive ? ' is-active' : ''}`}
          >
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="shell__body">
        <header className="topbar">
          <span className="topbar__context">프로젝트와 실험 기록</span>
          <Link to="/experiments/new" className="btn btn--primary">
            + 새 실험
          </Link>
          <Link to="/settings" className="topbar__link">
            설정
          </Link>
        </header>
        <StorageBanner />
        <MigrationBanner />
        <ExternalChangeBanner />
        <main id="main" ref={main} tabIndex={-1} className="shell__main">
          <ErrorBoundary resetKey={location.pathname} onExport={() => void exportNow()}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
