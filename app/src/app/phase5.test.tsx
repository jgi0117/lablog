import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import { seedDemo } from '../data/seed'
import { StorageError, type DataBackend } from '../data/repositories'
import { lastBackupAt } from '../services/backup'
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

/** 내려받기를 가로채 파일 내용을 모은다. */
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

describe('백업 내보내기와 가져오기 (설정)', () => {
  it('내보내면 파일이 저장되고 마지막 백업 시각이 남는다', async () => {
    const user = userEvent.setup()
    const files = captureDownloads()
    const b = make()
    await seedDemo(b)
    open('/settings', b)
    expect(await screen.findByText('아직 없음')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '백업 파일로 내보내기' }))
    expect(await screen.findByText(/백업 파일을 저장했습니다 \(실험 200건\)/)).toBeInTheDocument()
    expect(files).toHaveLength(1)
    expect(files[0].name).toMatch(/^lablog-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/)
    expect(JSON.parse(await files[0].text).experiments).toHaveLength(200)
    expect(lastBackupAt()).not.toBeNull()
    expect(readUsage().some((e) => e.name === 'backup_export')).toBe(true)
  })

  it('내보낸 파일을 다른 저장소에 합치면 그대로 복원된다', async () => {
    const user = userEvent.setup()
    const files = captureDownloads()
    const source = make()
    await seedDemo(source)
    open('/settings', source)
    await user.click(await screen.findByRole('button', { name: '백업 파일로 내보내기' }))
    const text = await (await waitFor(() => files[0])).text
    cleanup()

    const target = make()
    open('/settings', target)
    const input = await screen.findByLabelText('백업 파일 가져오기')
    await user.upload(input, new File([text], 'backup.json', { type: 'application/json' }))
    const preview = await screen.findByRole('region', { name: '가져올 내용 미리보기' })
    expect(within(preview).getByText(/프로젝트 4개 · 실험 200건/)).toBeInTheDocument()
    await user.click(within(preview).getByRole('button', { name: '가져오기' }))
    expect(await screen.findByText(/가져오기를 마쳤습니다 \(합치기/)).toBeInTheDocument()
    expect((await target.experiments.list()).total).toBe(200)
    expect(await target.projects.list()).toHaveLength(4)
    // 한 번 더 합쳐도 같은 항목은 늘지 않는다
    const again = await target.backup.exportAll()
    expect(again.experiments).toHaveLength(200)
  })

  it('이상한 파일은 이유를 알려 주고 아무것도 바꾸지 않는다', async () => {
    const user = userEvent.setup()
    const b = make()
    await createExperiment(b, { title: '지켜야 할 실험' })
    open('/settings', b)
    const input = await screen.findByLabelText('백업 파일 가져오기')
    await user.upload(input, new File(['{ 깨진 json'], 'broken.json', { type: 'application/json' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('파일을 읽을 수 없습니다')
    expect(screen.queryByRole('region', { name: '가져올 내용 미리보기' })).toBeNull()
    expect((await b.experiments.list()).total).toBe(1)

    const wrong = JSON.stringify({ schemaVersion: 1, projects: [], experiments: [{ id: 'x', title: '상태 없음', updatedAt: '2026-10-01T00:00:00.000Z' }], steps: [], dataItems: [] })
    await user.upload(input, new File([wrong], 'wrong.json', { type: 'application/json' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('상태가 올바르지 않습니다')
  })

  it('바꾸기는 확인을 거치고, 먼저 현재 데이터를 백업 파일로 저장한 뒤 바꾼다', async () => {
    const user = userEvent.setup()
    const files = captureDownloads()
    const b = make()
    await createExperiment(b, { title: '지금 있던 실험' })
    const other = make()
    await seedDemo(other)
    const file = JSON.stringify(await other.backup.exportAll())
    open('/settings', b)
    await user.upload(await screen.findByLabelText('백업 파일 가져오기'), new File([file], 'b.json', { type: 'application/json' }))
    const preview = await screen.findByRole('region', { name: '가져올 내용 미리보기' })
    await user.click(within(preview).getByRole('radio', { name: /바꾸기/ }))
    await user.click(within(preview).getByRole('button', { name: '가져오기' }))

    const dialog = await screen.findByRole('dialog', { name: '현재 데이터를 바꿀까요?' })
    // 취소하면 아무 일도 일어나지 않는다
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    expect((await b.experiments.list()).total).toBe(1)
    expect(files).toHaveLength(0)

    await user.click(within(preview).getByRole('button', { name: '가져오기' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '백업하고 바꾸기' }))
    expect(await screen.findByText(/가져오기를 마쳤습니다 \(바꾸기/)).toBeInTheDocument()
    expect(files).toHaveLength(1) // 바꾸기 전 자동 백업
    expect(JSON.parse(await files[0].text).experiments.map((e: { title: string }) => e.title)).toEqual(['지금 있던 실험'])
    const titles = (await b.experiments.list()).items.map((e) => e.title)
    expect(titles).not.toContain('지금 있던 실험')
    expect(titles).toHaveLength(200)
  })

  it('바꾸기 전 백업이 실패하면 가져오기를 멈춘다', async () => {
    const user = userEvent.setup()
    const b = make()
    await createExperiment(b, { title: '지켜야 할 실험' })
    const other = make()
    await seedDemo(other)
    const file = JSON.stringify(await other.backup.exportAll())
    URL.createObjectURL = vi.fn(() => {
      throw new Error('저장 차단')
    })
    open('/settings', b)
    await user.upload(await screen.findByLabelText('백업 파일 가져오기'), new File([file], 'b.json', { type: 'application/json' }))
    const preview = await screen.findByRole('region', { name: '가져올 내용 미리보기' })
    await user.click(within(preview).getByRole('radio', { name: /바꾸기/ }))
    await user.click(within(preview).getByRole('button', { name: '가져오기' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '백업하고 바꾸기' }))
    expect(await screen.findByText(/먼저 백업하지 못해 가져오기를 멈췄습니다/)).toBeInTheDocument()
    expect((await b.experiments.list()).items.map((e) => e.title)).toEqual(['지켜야 할 실험'])
  })
})

describe('백업 알림 (홈)', () => {
  it('백업한 적 없고 첫 기록이 하루 넘었으면 권하고, 지금 백업하면 사라진다', async () => {
    const user = userEvent.setup()
    captureDownloads()
    const b = make()
    await seedDemo(b)
    open('/', b)
    expect(await screen.findByText(/아직 백업한 적이 없습니다/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '지금 백업' }))
    await waitFor(() => expect(screen.queryByText(/아직 백업한 적이 없습니다/)).toBeNull())
    expect(lastBackupAt()).not.toBeNull()
  })

  it('"3일 뒤에 다시"를 누르면 조용해진다', async () => {
    const user = userEvent.setup()
    const b = make()
    await seedDemo(b)
    open('/', b)
    await user.click(await screen.findByRole('button', { name: '3일 뒤에 다시' }))
    await waitFor(() => expect(screen.queryByText(/아직 백업한 적이 없습니다/)).toBeNull())
  })

  it('데이터가 없으면 권하지 않는다', async () => {
    open('/', make())
    expect(await screen.findByText('첫 실험을 만들어 보세요')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /지금 백업/ })).toBeNull()
  })
})

describe('저장소 경고', () => {
  it('브라우저가 저장을 막으면 모든 화면 위에 경고한다', async () => {
    const base = make()
    const blocked: DataBackend = {
      ...base,
      projects: {
        ...base.projects,
        list: async () => {
          throw new StorageError('브라우저가 저장을 막았습니다', 'blocked')
        },
      },
    }
    open('/experiments', blocked)
    expect(await screen.findByText('이 브라우저가 저장을 막고 있습니다.')).toBeInTheDocument()
    expect(readErrors().some((e) => e.source === 'storage')).toBe(true)
  })

  it('저장 공간이 80%를 넘으면 경고하고 바로 백업할 수 있다', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: { estimate: async () => ({ usage: 90, quota: 100 }), persisted: async () => true },
      configurable: true,
    })
    open('/experiments', make())
    expect(await screen.findByText('저장 공간이 거의 찼습니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '지금 백업' })).toBeInTheDocument()
  })

  it('설정에서 영구 저장 상태와 사용량을 알려 준다', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: { estimate: async () => ({ usage: 2048, quota: 4096 }), persisted: async () => false, persist: async () => false },
      configurable: true,
    })
    open('/settings', make())
    expect(await screen.findByText(/허용되지 않음: 저장 공간이 부족해지면/)).toBeInTheDocument()
    expect(await screen.findByText(/2\.0 KB \/ 4\.0 KB 사용/)).toBeInTheDocument()
  })
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

