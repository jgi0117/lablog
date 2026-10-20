import { useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

/** 한국어 오류 문구. Supabase가 영어로 주는 흔한 경우만 바꾸고, 나머지는 원문을 괄호로 남긴다. */
export function describeAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return '이메일 또는 비밀번호가 맞지 않습니다. 계정은 운영자가 만들어 줍니다.'
  if (/email not confirmed/i.test(message)) return '이메일 확인이 끝나지 않았습니다. 받은 편지함의 확인 메일을 열어 주세요.'
  if (/user already registered/i.test(message)) return '이미 가입한 이메일입니다. "로그인"을 누르세요.'
  if (/password should be at least/i.test(message)) return '비밀번호가 너무 짧습니다. 6자 이상으로 정하세요.'
  if (/rate limit|too many/i.test(message)) return '요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.'
  if (/failed to fetch|networkerror|load failed/i.test(message)) return '서버에 연결하지 못했습니다. 인터넷 연결과 Supabase 주소(VITE_SUPABASE_URL)를 확인하세요.'
  return `로그인하지 못했습니다. (${message})`
}

/**
 * 서버 저장소를 쓸 때의 로그인 화면. 이메일과 비밀번호로 로그인하거나 계정을 만들고,
 * 비밀번호 없이 이메일로 받은 링크로 들어갈 수도 있다. 데이터는 로그인한 계정의 것만 보인다.
 */
export function LoginScreen({ client, allowSignup = import.meta.env.VITE_ALLOW_SIGNUP === 'true' }: { client: SupabaseClient; allowSignup?: boolean }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const check = (): boolean => {
    if (!email.trim() || !email.includes('@')) {
      setError('이메일을 입력하세요')
      return false
    }
    return true
  }

  const run = async (kind: 'in' | 'up' | 'link') => {
    setError('')
    setNotice('')
    if (!check()) return
    if (kind !== 'link' && password.length === 0) {
      setError('비밀번호를 입력하세요')
      return
    }
    setBusy(true)
    try {
      if (kind === 'in') {
        const { error: e } = await client.auth.signInWithPassword({ email: email.trim(), password })
        if (e) setError(describeAuthError(e.message))
      } else if (kind === 'up') {
        const { data, error: e } = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL } })
        if (e) setError(describeAuthError(e.message))
        else if (!data.session) setNotice('확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 "로그인"을 눌러 주세요.')
      } else {
        const { error: e } = await client.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL } })
        if (e) setError(describeAuthError(e.message))
        else setNotice('로그인 링크를 이메일로 보냈습니다. 메일을 열어 링크를 누르세요.')
      }
    } catch (e) {
      setError(describeAuthError(e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run('in')
  }

  return (
    <main className="login">
      <form className="panel login__card" onSubmit={submit} noValidate>
        <h1 className="page-title">lablog 로그인</h1>
        <p className="muted">실험 기록은 로그인한 계정의 서버 저장소에 저장되고, 어느 기기에서든 같은 계정으로 들어오면 이어서 볼 수 있습니다.</p>
        <div className="field">
          <label htmlFor="login-email">이메일</label>
          <input id="login-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="login-password">비밀번호</label>
          <input id="login-password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="req-hint" role="status">
            {notice}
          </p>
        )}
        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            로그인
          </button>
          {allowSignup && (
            <button type="button" className="btn" disabled={busy} onClick={() => void run('up')}>
              계정 만들기
            </button>
          )}
        </div>
        <p className="login__alt">
          <button type="button" className="link" disabled={busy} onClick={() => void run('link')}>
            비밀번호 없이 이메일 링크로 로그인
          </button>
        </p>
      </form>
    </main>
  )
}
