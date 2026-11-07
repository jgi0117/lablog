import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { demoDb } from './data/demo'
import { getDb, replaceDb } from './services/store'
import './styles.css'

// 처음 여는 브라우저(데이터 없음)에는 예시 데이터(콘크리트 1,030건)를 한 번 넣는다. 지운 뒤에는 다시 넣지 않는다.
const SEED_KEY = 'lablog.seeded'
try {
  if (getDb().projects.length === 0 && !localStorage.getItem(SEED_KEY)) {
    replaceDb(demoDb())
    localStorage.setItem(SEED_KEY, '1')
  }
} catch {
  // 저장소를 못 쓰면 빈 상태로 연다
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
