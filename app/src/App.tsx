import { useEffect } from 'react'
import { BackendProvider, useBackend } from './app/BackendContext'
import { AppRoutes } from './app/routes'
import { ToastProvider } from './components/Toast'
import type { DataBackend } from './data/repositories'

/** 앱을 열 때 한 번, 보관 기간(30일)이 지난 휴지통 실험을 영구 삭제한다. 실패해도 앱은 계속 동작한다. */
function Maintenance() {
  const backend = useBackend()
  useEffect(() => {
    backend.experiments.purgeExpired(new Date()).catch(() => {})
  }, [backend])
  return null
}

/** 라우터는 main.tsx가 감싼다. 테스트에서는 backend를 직접 넣을 수 있다. */
export default function App({ backend }: { backend?: DataBackend }) {
  return (
    <BackendProvider backend={backend}>
      <ToastProvider>
        <Maintenance />
        <AppRoutes />
      </ToastProvider>
    </BackendProvider>
  )
}
