import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface SupabaseConfig {
  url: string
  anonKey: string
}

/**
 * 접속 정보는 환경 변수에서 읽는다(.env.local). 공개용 anon 키만 쓴다.
 * service_role 키는 모든 보안(RLS)을 우회하므로 앱에 넣으면 안 된다. 실수로 넣었으면 알아채도록 막는다.
 */
export function readSupabaseConfig(env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>): SupabaseConfig | null {
  const url = (env.VITE_SUPABASE_URL ?? '').trim()
  const anonKey = (env.VITE_SUPABASE_ANON_KEY ?? '').trim()
  if (!url || !anonKey) return null
  if (looksLikeServiceRoleKey(anonKey)) {
    throw new Error('VITE_SUPABASE_ANON_KEY에 service_role 키가 들어 있습니다. 앱에는 공개용 anon 키만 넣어야 합니다. 키를 바꾸고(필요하면 Supabase에서 재발급) 다시 시작하세요.')
  }
  return { url, anonKey }
}

/** JWT 형태 키의 가운데(payload)를 읽어 role이 service_role인지 본다. 새 형식(sb_secret_...)도 막는다. */
export function looksLikeServiceRoleKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    const json = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return json?.role === 'service_role'
  } catch {
    return false
  }
}

export function createSupabaseClient(cfg: SupabaseConfig): SupabaseClient {
  return createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
}
