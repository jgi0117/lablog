import { createLocalBackend } from './local/localBackend'
import type { DataBackend } from './repositories'

let backend: DataBackend | null = null

/**
 * 앱 전체가 쓰는 저장소를 한 곳에서 고른다. 화면과 훅은 이 함수(또는 BackendProvider)로만 받는다.
 * VITE_DATA_BACKEND=local(기본) | supabase(Phase 9)
 */
export function getBackend(): DataBackend {
  if (backend) return backend
  const kind = import.meta.env.VITE_DATA_BACKEND ?? 'local'
  if (kind === 'local') {
    backend = createLocalBackend()
    return backend
  }
  throw new Error(`지원하지 않는 저장소입니다: ${kind} (supabase는 Phase 9에서 추가합니다)`)
}
