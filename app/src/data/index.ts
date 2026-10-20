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
  throw new Error('서버 저장소(supabase)는 로그인한 뒤 SupabaseGate가 만듭니다. 이 함수는 로컬 저장소용입니다.')
}

/** 어느 저장소를 쓰는지. 'supabase'는 VITE_DATA_BACKEND=supabase일 때이고, 로그인 뒤 SupabaseGate가 서버 저장소를 만든다. */
export function backendKind(): 'local' | 'supabase' {
  return (import.meta.env.VITE_DATA_BACKEND ?? 'local') === 'supabase' ? 'supabase' : 'local'
}
