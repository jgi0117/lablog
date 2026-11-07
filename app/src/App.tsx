import { useEffect } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { NewProjectPage } from './pages/NewProjectPage'
import { ProjectPage } from './pages/ProjectPage'
import { DataPage } from './pages/DataPage'
import { ChartsPage } from './pages/ChartsPage'
import { ModelPage } from './pages/ModelPage'
import { SetupPage } from './pages/SetupPage'

/**
 * 홈(프로젝트 목록) → 프로젝트(다음 실험·현황) → 데이터(표) · 시각화 · 모델 · 설정.
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
          <NavLink to="/new">+ 새 프로젝트</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route index element={<HomePage />} />
          <Route path="new" element={<NewProjectPage />} />
          <Route path="p/:id" element={<ProjectPage />} />
          <Route path="p/:id/data" element={<DataPage />} />
          <Route path="p/:id/charts" element={<ChartsPage />} />
          <Route path="p/:id/model" element={<ModelPage />} />
          <Route path="p/:id/setup" element={<SetupPage />} />
          <Route path="*" element={<p className="muted">페이지가 없습니다. <Link to="/">홈으로</Link></p>} />
        </Routes>
      </main>
    </div>
  )
}
