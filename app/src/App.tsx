import { Link, NavLink, Route, Routes } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { NewProjectPage } from './pages/NewProjectPage'
import { ProjectPage } from './pages/ProjectPage'
import { DataPage } from './pages/DataPage'
import { SetupPage } from './pages/SetupPage'

/**
 * 화면은 넷이다. 홈(프로젝트 목록) → 프로젝트(다음 실험·현황) → 데이터(표) · 설정(변수·목표).
 */
export default function App() {
  return (
    <div className="app">
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
          <Route path="p/:id/setup" element={<SetupPage />} />
          <Route path="*" element={<p className="muted">페이지가 없습니다. <Link to="/">홈으로</Link></p>} />
        </Routes>
      </main>
    </div>
  )
}
