import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import { seedDemo } from '../data/seed'
import { type DataBackend } from '../data/repositories'
import { readErrors } from '../services/errorLog'
import { createExperiment } from '../services/experimentService'
import { loadAllBundles } from '../services/projectData'
import { logUsage, readUsage } from '../services/usage'

const opened: LocalBackend[] = []
let seq = 0

function make(name = `lablog-p5-${Date.now()}-${seq++}`, channel?: Parameters<typeof createLocalBackend>[1]): LocalBackend {
  const b = createLocalBackend(name, channel)
  opened.push(b)
  return b
}

function open(path: string, backend: DataBackend) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App backend={backend} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true })
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await new Promise((r) => setTimeout(r, 20))
  while (opened.length) opened.pop()?.close()
})

describe('여러 탭 (E6, E9)', () => {
  class FakeChannel extends EventTarget {
    static all: FakeChannel[] = []
    readonly name: string
    constructor(name: string) {
      super()
      this.name = name
      FakeChannel.all.push(this)
    }
    postMessage(data: unknown) {
      for (const c of FakeChannel.all) if (c !== this && c.name === this.name) c.dispatchEvent(new MessageEvent('message', { data }))
    }
    close() {
      FakeChannel.all = FakeChannel.all.filter((c) => c !== this)
    }
  }
  const channel = (name: string) => new FakeChannel(name) as unknown as BroadcastChannel
  beforeEach(() => {
    FakeChannel.all = []
  })

  it('다른 탭이 먼저 고친 항목을 내가 고치면 충돌을 알리고, 덮어쓰기를 고를 수 있다', async () => {
    const user = userEvent.setup()
    const name = `lablog-conflict-${Date.now()}`
    const tabA = make(name, { channel })
    const tabB = make(name, { channel })
    const exp = await createExperiment(tabA, { title: '원래 제목' })
    open(`/experiments/${exp.id}`, tabA)
    const title = await screen.findByLabelText('제목')

    await tabB.experiments.update(exp.id, { title: '다른 탭에서 바꾼 제목' }) // 다른 탭이 먼저 수정
    await user.clear(title)
    await user.type(title, '내가 바꾼 제목')

    const alert = await screen.findByText('다른 탭에서 이 항목을 먼저 수정했습니다.', undefined, { timeout: 3000 })
    expect(alert).toBeInTheDocument()
    expect((await tabA.experiments.get(exp.id)).title).toBe('다른 탭에서 바꾼 제목') // 아직 덮어쓰지 않았다
    await user.click(screen.getByRole('button', { name: '내 내용으로 덮어쓰기' }))
    await waitFor(async () => expect((await tabA.experiments.get(exp.id)).title).toBe('내가 바꾼 제목'))
    expect(screen.queryByText('다른 탭에서 이 항목을 먼저 수정했습니다.')).toBeNull()
  })

  it('다른 탭에서 데이터가 바뀌면 새로 고침을 권한다', async () => {
    const name = `lablog-extern-${Date.now()}`
    const tabA = make(name, { channel })
    const tabB = make(name, { channel })
    open('/experiments', tabA)
    await screen.findByRole('heading', { name: /^실험/ })
    expect(screen.queryByText('다른 탭에서 데이터가 바뀌었습니다.')).toBeNull()
    await createExperiment(tabB, { title: '다른 탭에서 만든 실험' })
    expect(await screen.findByText('다른 탭에서 데이터가 바뀌었습니다.', undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '새로 고침' })).toBeInTheDocument()
  })
})

describe('오류 경계', () => {
  function Boom({ explode }: { explode: boolean }): React.ReactElement {
    if (explode) throw new Error('화면 그리기 실패')
    return <p>정상 화면</p>
  }

  it('화면이 깨지면 안내와 복구 길을 보여 주고 오류를 기록한다', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onExport = vi.fn()
    const { rerender } = render(
      <ErrorBoundary resetKey="a" onExport={onExport}>
        <Boom explode />
      </ErrorBoundary>,
    )
    expect(screen.getByText('화면을 그리는 중 문제가 생겼습니다')).toBeInTheDocument()
    expect(screen.getByText(/입력한 내용은 이 브라우저에 저장되어 있습니다/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '데이터 내보내기' }))
    expect(onExport).toHaveBeenCalledOnce()
    expect(readErrors().at(-1)).toMatchObject({ source: 'render', message: '화면 그리기 실패' })

    // 다른 화면으로 이동하면(resetKey 변경) 다시 그린다
    rerender(
      <ErrorBoundary resetKey="b" onExport={onExport}>
        <Boom explode={false} />
      </ErrorBoundary>,
    )
    expect(await screen.findByText('정상 화면')).toBeInTheDocument()
  })
})

describe('접근성 보조', () => {
  it('본문으로 건너뛰기 링크가 본문에 포커스를 준다', async () => {
    const user = userEvent.setup()
    open('/', make())
    await screen.findByRole('heading', { name: '오늘의 실험' })
    await user.click(screen.getByRole('link', { name: '본문으로 건너뛰기' }))
    expect(document.getElementById('main')).toHaveFocus()
  })

  it('수행 모드에서는 화면 꺼짐 방지를 설정에서 끌 수 있다', async () => {
    const user = userEvent.setup()
    open('/settings', make())
    const box = await screen.findByRole('checkbox', { name: /화면이 꺼지지 않게/ })
    expect(box).toBeChecked()
    await user.click(box)
    expect(JSON.parse(localStorage.getItem('lablog:settings') ?? '{}').wakeLock).toBe(false)
  })
})

describe('사용 기록 (설정과 KR 측정)', () => {
  it('실험 목록 검색은 전용 검색 사용 기록을 만들지 않는다', async () => {
    const user = userEvent.setup()
    const b = make()
    await seedDemo(b)
    open('/experiments?q=%EB%B0%B0%ED%95%A9', b)
    await screen.findByRole('searchbox', { name: '실험 검색' })
    await user.click((await screen.findAllByRole('link', { name: /배합 #\d+/ }))[0])
    await screen.findByRole('heading', { name: /배합 #\d+, 재령/ })
    expect(readUsage().map((e) => e.name)).not.toEqual(expect.arrayContaining(['search', 'open_from_search']))
  })

  it('끄면 기록하지 않고, 지우면 없어진다', async () => {
    const user = userEvent.setup()
    const b = make()
    logUsage('search', { ms: 10 })
    expect(readUsage().length).toBeGreaterThan(0)
    open('/settings', b)
    await user.click(await screen.findByRole('button', { name: '기록 지우기' }))
    expect(readUsage()).toEqual([])
    await user.click(screen.getByRole('checkbox', { name: '사용 기록 남기기' }))
    logUsage('search', { ms: 10 })
    expect(readUsage()).toEqual([])
  })

  it('홈을 열면 빠진 것 개수가 기록되고, 반복해서 열어도 쌓이지 않는다', async () => {
    const b = make()
    await seedDemo(b)
    open('/', b)
    await screen.findByRole('heading', { name: '놓친 것 (4)' })
    await waitFor(() => expect(readUsage().filter((e) => e.name === 'gaps_snapshot')).toHaveLength(1))
    expect(readUsage().find((e) => e.name === 'gaps_snapshot')?.data).toMatchObject({ total: 4 })
    cleanup()
    open('/', b)
    await screen.findByRole('heading', { name: '놓친 것 (4)' })
    expect(readUsage().filter((e) => e.name === 'gaps_snapshot')).toHaveLength(1)
  })

  it('실험을 완료하면 빠진 것이 있었는지 기록한다', async () => {
    const user = userEvent.setup()
    const b = make()
    const exp = await createExperiment(b, { title: '완료 기록' })
    await b.experiments.update(exp.id, { status: 'running' })
    await b.steps.create({ experimentId: exp.id, order: 1, content: '미완료 단계', done: false, doneAt: null, note: '' })
    open(`/experiments/${exp.id}/data?finish=1`, b)
    await user.click(await screen.findByRole('button', { name: '나중에 입력하고 완료' }))
    await waitFor(() => expect(readUsage().find((e) => e.name === 'complete')?.data).toMatchObject({ openSteps: 1, emptyResults: 0 }))
  })
})

describe('오류 기록 (설정)', () => {
  it('기록된 오류를 보여 주고 지울 수 있다', async () => {
    const user = userEvent.setup()
    const { logError } = await import('../services/errorLog')
    logError('test', new Error('예전에 난 오류'))
    open('/settings', make())
    expect(await screen.findByText('예전에 난 오류')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '오류 기록 지우기' }))
    expect(screen.getByText('기록된 오류가 없습니다.')).toBeInTheDocument()
    expect(readErrors()).toEqual([])
  })
})

describe('대량 데이터 성능', () => {
  it('실험 500건·단계 4,000개를 읽어 홈과 프로젝트에 필요한 묶음을 만드는 데 1.5초가 안 걸린다', async () => {
    const b = make()
    const at = new Date().toISOString()
    const base = { createdAt: at, updatedAt: at, deletedAt: null, version: 1 }
    const experiments = []
    const steps = []
    for (let i = 0; i < 500; i++) {
      const id = `perf-${i}`
      experiments.push({ ...base, id, projectId: `p${i % 5}`, title: `성능 실험 ${i}`, purpose: '', owner: '', tags: [], status: 'done' as const, startedAt: at, completedAt: at, sourceExperimentId: null })
      for (let k = 0; k < 8; k++) steps.push({ ...base, id: `${id}-s${k}`, experimentId: id, order: k + 1, content: `단계 ${k}`, done: true, doneAt: at, note: '' })
    }
    await b.backup.importAll({ schemaVersion: 1, exportedAt: at, projects: [], experiments, steps, dataItems: [] }, 'replace')
    const started = performance.now()
    const bundles = await loadAllBundles(b)
    const ms = performance.now() - started
    expect(bundles).toHaveLength(500)
    expect(bundles[0].steps).toHaveLength(8)
    expect(ms).toBeLessThan(1500)
    console.info(`전체 묶음 읽기(500건): ${ms.toFixed(0)}ms`)
  }, 60000)
})


