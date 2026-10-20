import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import { seedBulk, seedSample } from '../data/seed'
import { BACKUP_SCHEMA_VERSION, NotFoundError, type BackupFile } from '../data/repositories'
import { createExperiment } from '../services/experimentService'
import { parseFilters, toExperimentFilter, toParams } from '../hooks/useListFilters'

const opened: LocalBackend[] = []
let seq = 0

function backendWith(): LocalBackend {
  const b = createLocalBackend(`lablog-p4-${Date.now()}-${seq++}`)
  opened.push(b)
  return b
}

function open(path: string, backend: LocalBackend) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App backend={backend} />
    </MemoryRouter>,
  )
}

const cards = () => document.querySelectorAll('.card')

beforeEach(() => {
  try {
    localStorage.clear()
  } catch {
    // 무시
  }
})

afterEach(async () => {
  cleanup()
  await new Promise((r) => setTimeout(r, 20))
  while (opened.length) opened.pop()?.close()
})

describe('필터 ↔ 주소 변환', () => {
  it('기본값은 주소에 담지 않고, 잘못된 값은 기본값으로 돌린다', () => {
    expect(toParams(parseFilters(new URLSearchParams())).toString()).toBe('')
    const f = parseFilters(new URLSearchParams('status=weird&period=5&sort=x&page=-3'))
    expect(f).toMatchObject({ status: '', period: '', sort: 'updated_desc', page: 1 })
  })

  it('필터를 저장소 조회 조건으로 바꾼다 (기간은 마지막 수정 기준)', () => {
    const now = new Date('2026-11-20T00:00:00.000Z')
    const out = toExperimentFilter({ project: 'p1', tag: '합성', status: 'running', period: '7' }, now)
    expect(out).toEqual({ projectId: 'p1', tag: '합성', status: 'running', from: '2026-11-13T00:00:00.000Z' })
  })
})

describe('실험 목록', () => {
  it('상태 칩과 태그로 거르고, 초기화하면 전체가 돌아온다', async () => {
    const user = userEvent.setup()
    const backend = backendWith()
    await seedSample(backend)
    open('/experiments', backend)
    await waitFor(() => expect(cards()).toHaveLength(5))

    await user.click(screen.getByRole('button', { name: '진행' }))
    await waitFor(() => expect(cards()).toHaveLength(2))

    await user.selectOptions(screen.getByLabelText('태그'), '측정')
    await waitFor(() => expect(cards()).toHaveLength(1))
    expect(screen.getByText('AG 방현 필름 헤이즈 측정')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '필터 초기화' }))
    await waitFor(() => expect(cards()).toHaveLength(5))
  })

  it('조건에 맞는 실험이 없으면 안내와 초기화 버튼을 보여 준다', async () => {
    const user = userEvent.setup()
    const backend = backendWith()
    await seedSample(backend)
    open('/experiments?status=ready&tag=합성', backend)
    expect(await screen.findByText('조건에 맞는 실험이 없습니다')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: '필터 초기화' })[0])
    await waitFor(() => expect(cards()).toHaveLength(5))
  })

  it('12개씩 나누어 보여 주고 이전·다음으로 이동한다', async () => {
    const user = userEvent.setup()
    const backend = backendWith()
    await seedBulk(backend, 30, 1)
    open('/experiments', backend)
    await waitFor(() => expect(cards()).toHaveLength(12))
    expect(screen.getByText('1–12 / 30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이전' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByText('13–24 / 30')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByText('25–30 / 30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled()
  }, 30000)

  it('이름순 정렬', async () => {
    const user = userEvent.setup()
    const backend = backendWith()
    await seedSample(backend)
    open('/experiments', backend)
    await waitFor(() => expect(cards()).toHaveLength(5))
    await user.selectOptions(screen.getByRole('combobox', { name: /정렬/ }), '이름순')
    await waitFor(() => {
      const titles = [...document.querySelectorAll('.card__title')].map((n) => n.textContent)
      expect(titles).toEqual([...titles].sort((a, b) => (a ?? '').localeCompare(b ?? '', 'ko')))
    })
  })

  it('마지막으로 쓴 필터를 기억해서 다시 열면 복원한다', async () => {
    const user = userEvent.setup()
    const backend = backendWith()
    await seedSample(backend)
    open('/experiments', backend)
    await waitFor(() => expect(cards()).toHaveLength(5))
    await user.click(screen.getByRole('button', { name: '완료' }))
    await waitFor(() => expect(cards()).toHaveLength(2))
    cleanup()
    open('/experiments', backend)
    await waitFor(() => expect(cards()).toHaveLength(2))
  })
})

describe('실험 목록 검색', () => {
  it('제목·목적 키워드를 주소에 유지하며 목록을 좁힌다', async () => {
    const backend = backendWith()
    await seedSample(backend)
    open(`/experiments?q=${encodeURIComponent('HC-300')}`, backend)
    expect(await screen.findByRole('searchbox', { name: '실험 검색' })).toHaveValue('HC-300')
    await waitFor(() => expect(cards()).toHaveLength(2))
  })

  it('검색어와 프로젝트 필터를 함께 적용한다', async () => {
    const user = userEvent.setup()
    const backend = backendWith()
    await seedSample(backend)
    open('/experiments', backend)
    await user.type(await screen.findByRole('searchbox', { name: '실험 검색' }), '조건 탐색')
    await waitFor(() => expect(cards()).toHaveLength(2))
    const project = (await backend.projects.list()).find((row) => row.name === 'AG 방현 필름')!
    await user.selectOptions(screen.getByLabelText('프로젝트'), project.id)
    expect(await screen.findByText('조건에 맞는 실험이 없습니다')).toBeInTheDocument()
  })

  it('이전 검색 주소는 실험 목록으로 이동하고 안내한다', async () => {
    const backend = backendWith()
    await seedSample(backend)
    open(`/search?q=${encodeURIComponent('HC-300')}`, backend)
    expect(await screen.findByText('검색은 실험 목록의 제목·목적 검색으로 이동했습니다.')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: '실험 검색' })).toHaveValue('HC-300')
  })
})

describe('휴지통 (E5)', () => {
  it('삭제한 실험을 복원한다', async () => {
    const user = userEvent.setup()
    const backend = backendWith()
    const exp = await createExperiment(backend, { title: '지운 실험' })
    await backend.experiments.softDelete(exp.id)
    open('/trash', backend)
    expect(await screen.findByText('지운 실험')).toBeInTheDocument()
    expect(screen.getByText(/30일 뒤 영구 삭제/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '지운 실험 복원' }))
    expect(await screen.findByText('휴지통이 비어 있습니다')).toBeInTheDocument()
    expect((await backend.experiments.get(exp.id)).deletedAt).toBeNull()
  })

  it('영구 삭제는 확인창을 거치고, 취소하면 남는다', async () => {
    const user = userEvent.setup()
    const backend = backendWith()
    const exp = await createExperiment(backend, { title: '완전히 지울 실험' })
    await backend.experiments.softDelete(exp.id)
    open('/trash', backend)
    await user.click(await screen.findByRole('button', { name: '완전히 지울 실험 영구 삭제' }))
    const dialog = screen.getByRole('dialog', { name: '영구 삭제할까요?' })
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await backend.experiments.get(exp.id)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '완전히 지울 실험 영구 삭제' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '영구 삭제' }))
    await waitFor(async () => {
      await expect(backend.experiments.get(exp.id)).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  it('앱을 열 때 30일이 지난 항목은 자동으로 영구 삭제된다', async () => {
    const backend = backendWith()
    const exp = await createExperiment(backend, { title: '오래된 휴지통 실험' })
    await backend.experiments.softDelete(exp.id)
    // 보관 기간 경과를 만들기 위해 삭제 시각을 31일 전으로 되돌린 백업을 가져온다.
    const file = await backend.backup.exportAll()
    file.experiments = file.experiments.map((e) => ({ ...e, deletedAt: new Date(Date.now() - 31 * 86400000).toISOString() }))
    await backend.backup.importAll(file, 'replace')
    open('/', backend)
    await waitFor(async () => {
      await expect(backend.experiments.get(exp.id)).rejects.toBeInstanceOf(NotFoundError)
    })
  })
})

describe('Journey 2: 지난 실험 찾기', () => {
  it('실험 목록에서 검색해 필터로 좁히고 실험을 열기까지 이어진다', async () => {
    const user = userEvent.setup()
    const backend = backendWith()
    await seedSample(backend)
    open('/experiments', backend)
    await screen.findByRole('searchbox', { name: '실험 검색' })

    const started = performance.now()
    await user.type(screen.getByRole('searchbox', { name: '실험 검색' }), 'HC-300')
    await waitFor(() => expect(cards()).toHaveLength(2))

    // 프로젝트로 좁힌다
    const projects = await backend.projects.list()
    const a = projects.find((p) => p.name === '하드코팅 필름 HC-300')
    await user.selectOptions(screen.getByLabelText('프로젝트'), a?.id ?? '')
    await waitFor(() => expect(cards()).toHaveLength(2))

    // 결과를 눌러 실험을 연다
    await user.click(screen.getByRole('link', { name: /HC-300 하드코팅 조건 탐색 #4/ }))
    expect(await screen.findByRole('heading', { name: /HC-300 하드코팅 조건 탐색 #4/ })).toBeInTheDocument()

    // KR1 기준: 검색부터 열기까지 10초 이내 (테스트 환경에서는 훨씬 짧다)
    expect(performance.now() - started).toBeLessThan(10000)
  })
})

describe('검색 성능 (대량 데이터)', () => {
  function bulkFile(n: number, stepsEach: number): BackupFile {
    const at = new Date().toISOString()
    const base = { createdAt: at, updatedAt: at, deletedAt: null, version: 1 }
    const experiments = []
    const steps = []
    for (let i = 0; i < n; i++) {
      const id = `bulk-${i}`
      experiments.push({
        ...base,
        id,
        projectId: null,
        title: `대량 실험 ${i}`,
        purpose: '',
        owner: '',
        tags: [],
        status: 'done' as const,
        startedAt: null,
        completedAt: null,
        sourceExperimentId: null,
      })
      for (let k = 0; k < stepsEach; k++) {
        steps.push({ ...base, id: `${id}-s${k}`, experimentId: id, order: k + 1, content: `단계 ${k + 1} 시약 ${i}`, done: true, doneAt: at, note: k === 3 ? `메모 ${i}` : '' })
      }
    }
    return { schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: at, projects: [], experiments, steps, dataItems: [] }
  }

  it('실험 500건·단계 4,000개: 처음 검색은 5초, 이후 검색은 0.5초 안에 끝난다', async () => {
    const backend = backendWith()
    await backend.backup.importAll(bulkFile(500, 8), 'replace')

    // 처음 검색: 색인을 만들기 위해 전체를 읽는다. 테스트의 가짜 IndexedDB는 실제 브라우저보다 느리다.
    let t = performance.now()
    const cold = await backend.experiments.search('시약 250')
    const coldMs = performance.now() - t
    expect(cold.length).toBeGreaterThan(0)
    expect(coldMs).toBeLessThan(5000)

    // 이후 검색: 메모리 색인만 훑는다.
    t = performance.now()
    const warm = await backend.experiments.search('시약 251')
    const warmMs = performance.now() - t
    expect(warm.length).toBeGreaterThan(0)
    expect(warmMs).toBeLessThan(500)
    console.info(`검색 성능(500건): 처음 ${coldMs.toFixed(0)}ms, 이후 ${warmMs.toFixed(0)}ms`)
  }, 60000)
})
