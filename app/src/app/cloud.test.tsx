import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createLocalBackend } from '../data/local/localBackend'
import { createMemoryStore } from '../data/remote/memoryStore'
import { createRemoteBackend } from '../data/remote/remoteBackend'
import type { DataBackend } from '../data/repositories'
import { looksLikeServiceRoleKey, readSupabaseConfig } from '../data/supabase/client'
import { AccountContext, type Account } from './AccountContext'
import { LoginScreen, describeAuthError } from './LoginScreen'

beforeEach(async () => {
  localStorage.clear()
  await new Promise<void>((res) => {
    const r = indexedDB.deleteDatabase('lablog')
    r.onsuccess = r.onerror = r.onblocked = () => res()
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const jwt = (payload: object) => {
  const enc = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.signature`
}

describe('접속 정보와 키 점검', () => {
  it('없으면 null, 있으면 주소와 anon 키를 돌려준다', () => {
    expect(readSupabaseConfig({})).toBeNull()
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'https://a.supabase.co' })).toBeNull()
    const anon = jwt({ role: 'anon' })
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: ' https://a.supabase.co ', VITE_SUPABASE_ANON_KEY: ` ${anon} ` })).toEqual({ url: 'https://a.supabase.co', anonKey: anon })
  })

  it('service_role 키는 앱에 넣을 수 없다(두 형식 모두)', () => {
    expect(looksLikeServiceRoleKey(jwt({ role: 'service_role' }))).toBe(true)
    expect(looksLikeServiceRoleKey(jwt({ role: 'anon' }))).toBe(false)
    expect(looksLikeServiceRoleKey('sb_secret_abcdef')).toBe(true)
    expect(looksLikeServiceRoleKey('sb_publishable_abcdef')).toBe(false)
    expect(looksLikeServiceRoleKey('아무 문자열')).toBe(false)
    expect(() => readSupabaseConfig({ VITE_SUPABASE_URL: 'https://a.supabase.co', VITE_SUPABASE_ANON_KEY: jwt({ role: 'service_role' }) })).toThrow('service_role')
  })
})

describe('로그인 화면', () => {
  const fakeClient = (auth: Record<string, unknown>) => ({ auth }) as never

  it('오류 문구를 한국어로 바꾼다', () => {
    expect(describeAuthError('Invalid login credentials')).toContain('이메일 또는 비밀번호')
    expect(describeAuthError('Email not confirmed')).toContain('확인')
    expect(describeAuthError('User already registered')).toContain('이미 가입')
    expect(describeAuthError('Password should be at least 6 characters')).toContain('6자')
    expect(describeAuthError('Failed to fetch')).toContain('연결')
    expect(describeAuthError('이상한 오류')).toContain('(이상한 오류)')
  })

  it('이메일이나 비밀번호가 비면 서버를 부르지 않고 알려 준다', async () => {
    const user = userEvent.setup()
    const signIn = vi.fn()
    render(<LoginScreen client={fakeClient({ signInWithPassword: signIn })} />)
    await user.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('이메일을 입력하세요')
    await user.type(screen.getByLabelText('이메일'), 'a@b.co')
    await user.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('비밀번호를 입력하세요')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('로그인 실패, 계정 만들기(확인 메일), 이메일 링크를 각각 안내한다', async () => {
    const user = userEvent.setup()
    const signInWithPassword = vi.fn().mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    const signUp = vi.fn().mockResolvedValue({ data: { session: null }, error: null })
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null })
    render(<LoginScreen allowSignup client={fakeClient({ signInWithPassword, signUp, signInWithOtp })} />)
    await user.type(screen.getByLabelText('이메일'), ' me@lab.co ')
    await user.type(screen.getByLabelText('비밀번호'), 'secret1')
    await user.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('이메일 또는 비밀번호가 맞지 않습니다')
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'me@lab.co', password: 'secret1' })

    await user.click(screen.getByRole('button', { name: '계정 만들기' }))
    expect(await screen.findByRole('status')).toHaveTextContent('확인 메일을 보냈습니다')
    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({ email: 'me@lab.co', password: 'secret1' }))

    await user.click(screen.getByRole('button', { name: '비밀번호 없이 이메일 링크로 로그인' }))
    expect(await screen.findByText(/로그인 링크를 이메일로 보냈습니다/)).toBeInTheDocument()
    expect(signInWithOtp).toHaveBeenCalledOnce()
  })
})

describe('가입을 닫은 로그인 화면', () => {
  it('기본은 계정 만들기 버튼이 없다', () => {
    render(<LoginScreen client={{ auth: {} } as never} />)
    expect(screen.queryByRole('button', { name: '계정 만들기' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '로그인' })).toBeInTheDocument()
  })
})

// ---------- 서버 저장소로 로그인한 상태의 앱 ----------

const account = (over: Partial<Account> = {}): Account => ({ userId: 'user-1', email: 'me@lab.co', displayName: '', setDisplayName: vi.fn().mockResolvedValue(undefined), updatePassword: vi.fn().mockResolvedValue(undefined), signOut: vi.fn().mockResolvedValue(undefined), ...over })

function openApp(path: string, backend: DataBackend, acc: Account | null = account()) {
  render(
    <AccountContext.Provider value={acc}>
      <MemoryRouter initialEntries={[path]}>
        <App backend={backend} />
      </MemoryRouter>
    </AccountContext.Provider>,
  )
}

const exp = { projectId: null, purpose: '', owner: '', tags: [], status: 'ready' as const, startedAt: null, completedAt: null, sourceExperimentId: null }

/** 이 브라우저(로컬)에 기록 몇 개를 만들어 둔다 */
async function seedLocal() {
  const b = createLocalBackend('lablog')
  const p = await b.projects.create({ name: '로컬 프로젝트', description: '' })
  const e = await b.experiments.create({ ...exp, projectId: p.id, title: '로컬 실험' })
  await b.steps.create({ experimentId: e.id, order: 1, content: '단계', done: false, doneAt: null, note: '' })
  await b.dataItems.create({ experimentId: e.id, kind: 'result', order: 1, name: '강도', value: '41', unit: 'MPa' })
  b.close()
}

function captureDownloads() {
  const files: { name: string; text: Promise<string> }[] = []
  URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
    files.push({
      name: '',
      text: new Promise((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.readAsText(b as Blob)
      }),
    })
    return 'blob:test'
  })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    files[files.length - 1].name = this.download
  })
  return files
}

describe('클라우드로 이전 마법사', () => {
  it('로컬 저장소를 쓰는 중이면 설정이 필요하다고 안내한다', async () => {
    openApp('/migrate', createRemoteBackend(createMemoryStore()), null)
    expect(await screen.findByText('지금은 로컬 저장소를 쓰고 있습니다')).toBeInTheDocument()
  })

  it('옮길 로컬 데이터가 없으면 그렇게 알린다', async () => {
    openApp('/migrate', createRemoteBackend(createMemoryStore()))
    expect(await screen.findByText('옮길 로컬 데이터가 없습니다')).toBeInTheDocument()
  })

  it('미리보기 → 백업 파일 저장 → 올리기 → 검증 결과, 로컬은 그대로 남는다', async () => {
    await seedLocal()
    const files = captureDownloads()
    const remote = createRemoteBackend(createMemoryStore())
    const user = userEvent.setup()
    openApp('/migrate', remote)
    const table = await screen.findByRole('region', { name: '건수 비교 표' })
    expect(within(table).getByRole('row', { name: /이 브라우저\(로컬\) 1 1 1 1 0 0/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '백업 파일 받고 4개 이전하기' }))
    expect(await screen.findByText(/이전을 마쳤고, 서버에서 다시 읽어 모든 행이 들어간 것을 확인했습니다/, {}, { timeout: 10000 })).toBeInTheDocument()
    // 올리기 전에 로컬 백업 파일을 받았다
    expect(files).toHaveLength(1)
    expect(files[0].name).toMatch(/^lablog-backup-.*\.json$/)
    expect(JSON.parse(await files[0].text).experiments).toHaveLength(1)
    // 서버에 들어갔고
    expect((await remote.experiments.list()).items.map((e) => e.title)).toEqual(['로컬 실험'])
    expect((await remote.projects.list()).map((p) => p.name)).toEqual(['로컬 프로젝트'])
    // 로컬은 그대로다
    const local = createLocalBackend('lablog')
    expect((await local.experiments.list()).total).toBe(1)
    local.close()
    expect(localStorage.getItem('lablog:cloud-migrated:user-1')).not.toBeNull()
  })

  it('이전한 뒤 로컬 데이터 지우기는 확인을 거치고 서버는 그대로 둔다', async () => {
    await seedLocal()
    captureDownloads()
    const remote = createRemoteBackend(createMemoryStore())
    const user = userEvent.setup()
    openApp('/migrate', remote)
    await user.click(await screen.findByRole('button', { name: /이전하기$/ }))
    await screen.findByText(/이전을 마쳤고/, {}, { timeout: 10000 })
    await user.click(screen.getByRole('button', { name: '로컬 데이터 지우기' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '로컬 데이터 지우기' }))
    expect(await screen.findByText('이 브라우저의 로컬 데이터를 지웠습니다.')).toBeInTheDocument()
    const local = createLocalBackend('lablog')
    expect((await local.experiments.list()).total).toBe(0)
    local.close()
    expect((await remote.experiments.list()).total).toBe(1)
  })

  it('이전이 실패하면 이유를 알리고 로컬은 그대로이며 다시 시도할 수 있다', async () => {
    await seedLocal()
    captureDownloads()
    const store = createMemoryStore()
    const original = store.upsert
    let broke = false
    store.upsert = async (t, rows) => {
      if (t === 'experiments' && !broke) {
        broke = true
        throw new Error('서버에 연결하지 못했습니다')
      }
      return original(t, rows)
    }
    const user = userEvent.setup()
    openApp('/migrate', createRemoteBackend(store))
    await user.click(await screen.findByRole('button', { name: /이전하기$/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('이전하지 못했습니다')
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    await user.click(await screen.findByRole('button', { name: /이전하기$/ }))
    expect(await screen.findByText(/이전을 마쳤고/, {}, { timeout: 10000 })).toBeInTheDocument()
  })
})

describe('이전 안내 줄과 설정', () => {
  it('옮기지 않은 로컬 기록이 있으면 안내하고, 나중에를 누르면 다시 묻지 않는다', async () => {
    await seedLocal()
    const user = userEvent.setup()
    openApp('/', createRemoteBackend(createMemoryStore()))
    expect(await screen.findByText(/아직 서버로 옮기지 않은 기록이 4개 있습니다/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '클라우드로 이전' })).toHaveAttribute('href', '/migrate')
    await user.click(screen.getByRole('button', { name: '나중에' }))
    expect(screen.queryByText(/아직 서버로 옮기지 않은 기록/)).toBeNull()
    cleanup()
    openApp('/', createRemoteBackend(createMemoryStore()))
    await screen.findByRole('heading', { name: '오늘의 실험' })
    expect(screen.queryByText(/아직 서버로 옮기지 않은 기록/)).toBeNull()
  })

  it('로컬 데이터가 없거나 로컬 저장소를 쓰는 중이면 안내 줄이 없다', async () => {
    openApp('/', createRemoteBackend(createMemoryStore()))
    await screen.findByRole('heading', { name: '오늘의 실험' })
    expect(screen.queryByText(/아직 서버로 옮기지 않은 기록/)).toBeNull()
    cleanup()
    await seedLocal()
    openApp('/', createLocalBackend(`lablog-x-${Date.now()}`), null)
    await screen.findByRole('heading', { name: '오늘의 실험' })
    expect(screen.queryByText(/아직 서버로 옮기지 않은 기록/)).toBeNull()
  })

  it('설정의 저장 위치: 서버면 계정과 로그아웃, 로컬이면 안내', async () => {
    const user = userEvent.setup()
    const acc = account()
    openApp('/settings', createRemoteBackend(createMemoryStore()), acc)
    const section = (await screen.findByRole('heading', { name: '저장 위치' })).closest('section') as HTMLElement
    expect(section).toHaveTextContent('서버 저장소(Supabase)')
    expect(section).toHaveTextContent('me@lab.co')
    await user.click(within(section).getByRole('button', { name: '로그아웃' }))
    expect(acc.signOut).toHaveBeenCalledOnce()
    cleanup()
    openApp('/settings', createLocalBackend(`lablog-y-${Date.now()}`), null)
    const local = (await screen.findByRole('heading', { name: '저장 위치' })).closest('section') as HTMLElement
    expect(local).toHaveTextContent('이 브라우저(로컬 저장소)')
    expect(within(local).queryByRole('button', { name: '로그아웃' })).toBeNull()
  })

  it('서버 저장소에서는 "이 브라우저에만 저장" 백업 알림을 하지 않는다', async () => {
    const remote = createRemoteBackend(createMemoryStore())
    await remote.experiments.create({ ...exp, title: '서버의 실험' })
    openApp('/', remote)
    await screen.findByText('서버의 실험', { exact: false })
    await waitFor(() => expect(screen.queryByText(/아직 백업한 적이 없습니다/)).toBeNull())
  })
})

describe('프로필(표시 이름)과 비밀번호', () => {
  it('설정에서 표시 이름을 저장하고 비밀번호를 바꾼다', async () => {
    const user = userEvent.setup()
    const setDisplayName = vi.fn().mockResolvedValue(undefined)
    const updatePassword = vi.fn().mockResolvedValue(undefined)
    openApp('/settings', createLocalBackend('lablog-profile'), account({ displayName: '지은', setDisplayName, updatePassword }))
    const input = await screen.findByLabelText('표시 이름')
    expect(input).toHaveValue('지은')
    await user.clear(input)
    await user.type(input, '김연구')
    await user.click(screen.getByRole('button', { name: '이름 저장' }))
    expect(setDisplayName).toHaveBeenCalledWith('김연구')
    expect(await screen.findByText('표시 이름을 저장했습니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '비밀번호 변경' })).toBeDisabled()
    await user.type(screen.getByLabelText('새 비밀번호'), 'newsecret')
    await user.click(screen.getByRole('button', { name: '비밀번호 변경' }))
    expect(updatePassword).toHaveBeenCalledWith('newsecret')
  })

  it('새 실험의 담당자는 표시 이름으로 채워진다', async () => {
    const user = userEvent.setup()
    const backend = createLocalBackend('lablog-owner')
    openApp('/experiments/new', backend, account({ displayName: '김연구' }))
    await user.type(await screen.findByLabelText(/제목/), '담당자 시험')
    await user.click(screen.getByRole('button', { name: '실험 만들기' }))
    await vi.waitFor(async () => {
      const list = await backend.experiments.list({})
      expect(list.items.find((e) => e.title === '담당자 시험')?.owner).toBe('김연구')
    })
  })
})
