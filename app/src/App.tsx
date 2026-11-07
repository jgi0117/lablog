import { useEffect } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { NewProjectPage } from './pages/NewProjectPage'
import { ProjectPage } from './pages/ProjectPage'
import { DataPage } from './pages/DataPage'
import { ModelPage } from './pages/ModelPage'
import { SetupPage } from './pages/SetupPage'

/**
 * 상단 탭 셋: 프로젝트(목록 → 실험 화면), 데이터(모든 실험 표·차트), 모델(모아 학습한 모델·제안·예측).
 * 데이터와 모델은 프로젝트를 넘나들기 때문에 프로젝트 안이 아니라 옆에 둔다.
 */
/** 화면이 바뀌면 맨 위로 */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <div className="app">
      <ScrollToTop />
      <header className="top">
        <Link to="/" className="brand">
          lablog
        </Link>
        <nav>
          <NavLink to="/" end>
            프로젝트
          </NavLink>
          <NavLink to="/data">데이터</NavLink>
          <NavLink to="/model">모델</NavLink>
          <NavLink to="/new">+ 새 프로젝트</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route index element={<HomePage />} />
          <Route path="new" element={<NewProjectPage />} />
          <Route path="p/:id" element={<ProjectPage />} />
          <Route path="p/:id/setup" element={<SetupPage />} />
          <Route path="data" element={<DataPage />} />
          <Route path="model" element={<ModelPage />} />
          <Route path="*" element={<p className="muted">페이지가 없습니다. <Link to="/">홈으로</Link></p>} />
        </Routes>
      </main>
    </div>
  )
}
