import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { backendKind, getBackend } from './data'
import { seedFirstRun } from './services/firstRun'
import './styles/global.css'

// 서버 저장소를 쓸 때만 불러와서, 로컬 저장소 사용자는 Supabase 코드를 받지 않는다.
const SupabaseGate = lazy(() => import('./app/SupabaseGate').then((m) => ({ default: m.SupabaseGate })))

/**
 * 처음 여는 브라우저에서 데이터가 없으면 예시 데이터를 한 번 넣고 시작한다(첫 화면이 비어 보이지 않게).
 * 실패해도 앱은 그대로 열린다. E2E 시험은 빈 상태에서 시작해야 해서 VITE_AUTO_EXAMPLE=off로 끈다.
 */
async function start() {
  const cloud = backendKind() === 'supabase'
  // 예시 데이터 자동 입력은 로컬 저장소에서만 한다(서버 저장소에 1,000건을 마음대로 넣지 않는다).
  if (!cloud && import.meta.env.VITE_AUTO_EXAMPLE !== 'off') {
    try {
      const { seedDemo, seedExampleProjects } = await import('./data/seed')
      await seedFirstRun(getBackend(), seedDemo, seedExampleProjects)
    } catch {
      // 저장소를 열 수 없는 경우 등은 앱 안의 저장소 경고가 안내한다.
    }
  }
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        {cloud ? (
          <Suspense fallback={<p className="muted loading">불러오는 중…</p>}>
            <SupabaseGate />
          </Suspense>
        ) : (
          <App />
        )}
      </BrowserRouter>
    </StrictMode>,
  )
}

void start()
