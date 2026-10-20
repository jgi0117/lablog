import { useEffect, useRef, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
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
  { to: '/search', label: '검색', end: false },
  { to: '/templates', label: '템플릿', end: false },
]

/**
 * 왼쪽 메뉴(좁은 화면에서는 아래), 상단 전역 검색과 + 새 실험, 설정. 수행 모드는 이 셸을 쓰지 않는다.
 * 한 화면에서 오류가 나도 메뉴와 검색은 남도록 본문만 오류 경계로 감싼다.
 */
export function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const exportNow = useBackupExport()
  const input = useRef<HTMLInputElement>(null)
  const main = useRef<HTMLElement>(null)
  // 검색 화면에서는 현재 검색어를 검색창에 보여 준다.
  const currentQuery = location.pathname === '/search' ? (params.get('q') ?? '') : ''

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onSearch = (e: FormEvent) => {
    e.preventDefault()
    const q = input.current?.value.trim() ?? ''
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search')
  }

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
          <form className="topbar__search" role="search" onSubmit={onSearch}>
            <input
              key={currentQuery}
              ref={input}
              defaultValue={currentQuery}
              type="search"
              aria-label="전역 검색"
              placeholder="제목 · 단계 · 조건 · 결과 검색"
            />
            <kbd>Ctrl K</kbd>
          </form>
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
