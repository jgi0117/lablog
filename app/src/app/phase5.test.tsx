import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import { seedDemo } from '../data/seed'
import { StorageError, type DataBackend } from '../data/repositories'
import { lastBackupAt } from '../services/backup'
import { readErrors } from '../services/errorLog'
import { createExperiment } from '../services/experimentService'
import { readUsage } from '../services/usage'

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
