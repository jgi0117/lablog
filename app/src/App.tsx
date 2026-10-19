import type { ReactNode } from 'react'
import { BackendProvider } from './app/BackendContext'
import { AppRoutes } from './app/routes'
import { StorageStatusProvider } from './app/StorageStatus'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './components/Toast'
import type { DataBackend } from './data/repositories'
import { useBackupExport } from './hooks/useBackupExport'

/** 앱 전체를 감싸는 마지막 안전망. 화면 하나가 아니라 셸 자체가 깨졌을 때를 위한 것이다. */
function AppBoundary({ children }: { children: ReactNode }) {
  const exportNow = useBackupExport()
  return <ErrorBoundary onExport={() => void exportNow()}>{children}</ErrorBoundary>
}

/** 라우터는 main.tsx가 감싼다. 테스트에서는 backend를 직접 넣을 수 있다. */
export default function App({ backend }: { backend?: DataBackend }) {
  return (
    <BackendProvider backend={backend}>
      <ToastProvider>
        <StorageStatusProvider>
          <AppBoundary>
            <AppRoutes />
          </AppBoundary>
        </StorageStatusProvider>
      </ToastProvider>
    </BackendProvider>
  )
}
