import { useEffect, useMemo, useState } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import App from '../App'
import { createRemoteBackend } from '../data/remote/remoteBackend'
import { createSupabaseClient, readSupabaseConfig } from '../data/supabase/client'
import { createSupabaseStore } from '../data/supabase/supabaseStore'
import { AccountContext, type Account } from './AccountContext'
import { LoginScreen } from './LoginScreen'

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="login">
      <section className="panel login__card" role="alert">
        <h1 className="page-title">{title}</h1>
        {children}
      </section>
    </main>
  )
}

/**
 * VITE_DATA_BACKEND=supabase일 때의 시작점. 접속 정보를 확인하고, 로그인한 계정이 있어야 서버 저장소로 앱을 연다.
 * 로그인이 풀리면(다른 곳에서 로그아웃, 토큰 만료) 로그인 화면으로 돌아간다.
 */
export function SupabaseGate() {
  const setup = useMemo<{ client: SupabaseClient } | { error: string }>(() => {
    try {
      const cfg = readSupabaseConfig()
      if (!cfg) return { error: 'missing' }
      return { client: createSupabaseClient(cfg) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [])
  const client = 'client' in setup ? setup.client : null
  const [session, setSession] = useState<Session | null | undefined>(undefined) // undefined: 아직 모름

  useEffect(() => {
    if (!client) return
    let alive = true
    client.auth.getSession().then(({ data }) => alive && setSession(data.session))
    const { data } = client.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [client])

  const userId = session?.user.id
  const [displayName, setName] = useState('')
  useEffect(() => {
    if (!client || !userId) return
    let alive = true
    void (async () => {
      try {
        const { data } = await client.from('profiles').select('display_name').eq('id', userId).maybeSingle()
        if (alive) setName((data?.display_name as string | undefined) ?? '')
      } catch {
        /* 프로필 표가 없어도(마이그레이션 전) 앱은 쓸 수 있다 */
      }
    })()
    return () => {
      alive = false
    }
  }, [client, userId])
  const backend = useMemo(() => (client && userId ? createRemoteBackend(createSupabaseStore(client)) : null), [client, userId])
  const account = useMemo<Account | null>(
    () =>
      client && session
        ? {
            userId: session.user.id,
            email: session.user.email ?? '',
            displayName,
            setDisplayName: async (name: string) => {
              const v = name.trim().slice(0, 60)
              const { error } = await client.from('profiles').upsert({ id: session.user.id, display_name: v, updated_at: new Date().toISOString() })
              if (error) throw new Error(error.message)
              setName(v)
            },
            updatePassword: async (password: string) => {
              const { error } = await client.auth.updateUser({ password })
              if (error) throw new Error(error.message)
            },
            signOut: async () => void (await client.auth.signOut()),
          }
        : null,
    [client, session, displayName],
  )

  if (!client) {
    const missing = 'error' in setup && setup.error === 'missing'
    return (
      <Notice title="서버 저장소 설정이 필요합니다">
        {missing ? (
          <>
            <p>
              <code>VITE_DATA_BACKEND=supabase</code>로 켰지만 접속 정보가 없습니다. <code>app/.env.local</code> 파일에 Supabase 프로젝트의 주소와 공개용(anon) 키를 넣고 개발 서버를 다시 시작하세요.
            </p>
            <pre className="export__code">{'VITE_DATA_BACKEND=supabase\nVITE_SUPABASE_URL=https://프로젝트-id.supabase.co\nVITE_SUPABASE_ANON_KEY=공개용-anon-키'}</pre>
            <p className="muted">로컬 저장소로 돌아가려면 <code>VITE_DATA_BACKEND=local</code>로 바꾸세요. 자세한 순서는 docs/phase9/02-설정-가이드.md에 있습니다.</p>
          </>
        ) : (
          <p>{'error' in setup ? setup.error : ''}</p>
        )}
      </Notice>
    )
  }
  if (session === undefined) return <p className="muted loading">불러오는 중…</p>
  if (!session || !backend || !account) return <LoginScreen client={client} />
  return (
    <AccountContext.Provider value={account}>
      <App key={account.userId} backend={backend} />
    </AccountContext.Provider>
  )
}
