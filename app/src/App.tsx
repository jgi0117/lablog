import { BackendProvider } from './app/BackendContext'
import { AppRoutes } from './app/routes'
import { ToastProvider } from './components/Toast'
import type { DataBackend } from './data/repositories'

/** 라우터는 main.tsx가 감싼다. 테스트에서는 backend를 직접 넣을 수 있다. */
export default function App({ backend }: { backend?: DataBackend }) {
  return (
    <BackendProvider backend={backend}>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </BackendProvider>
  )
}
