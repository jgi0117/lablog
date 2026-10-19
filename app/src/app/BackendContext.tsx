import { createContext, useContext, type ReactNode } from 'react'
import { getBackend } from '../data'
import type { DataBackend } from '../data/repositories'

const BackendContext = createContext<DataBackend | null>(null)

/** backend를 주지 않으면 앱 기본 저장소를 쓴다. 테스트에서는 테스트용 저장소를 넣는다. */
export function BackendProvider({ backend, children }: { backend?: DataBackend; children: ReactNode }) {
  return <BackendContext.Provider value={backend ?? getBackend()}>{children}</BackendContext.Provider>
}

export function useBackend(): DataBackend {
  const b = useContext(BackendContext)
  if (!b) throw new Error('BackendProvider 안에서만 useBackend를 쓸 수 있습니다')
  return b
}
