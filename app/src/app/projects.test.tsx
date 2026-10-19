import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import { seedDemo } from '../data/seed'
import { describeCorrelation } from '../pages/ProjectAnalysisPage'
import { createExperiment } from '../services/experimentService'

const opened: LocalBackend[] = []
let seq = 0

async function demoBackend(): Promise<LocalBackend> {
  const b = createLocalBackend(`lablog-proj-${Date.now()}-${seq++}`)
  opened.push(b)
  await seedDemo(b)
  return b
}

function open(path: string, backend: LocalBackend) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App backend={backend} />
    </MemoryRouter>,
  )
}

const HC = '/projects/demo-project-1'

beforeEach(() => {
  try {
    localStorage.clear()
  } catch {
    // 무시
  }
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await new Promise((r) => setTimeout(r, 20))
  while (opened.length) opened.pop()?.close()
})

describe('프로젝트 목록', () => {
  it('프로젝트마다 실험 수, 상태, 확인할 것 개수를 보여 준다', async () => {
    open('/projects', await demoBackend())
    const hc = (await screen.findByRole('heading', { name: '하드코팅 필름 HC-300' })).closest('a') as HTMLElement
    expect(within(hc).getByText('실험 10건')).toBeInTheDocument()
    expect(within(hc).getByText('완료 8')).toBeInTheDocument()
    expect(within(hc).getByText(/빠진 것·확인할 것 5건/)).toBeInTheDocument()
    const ag = screen.getByRole('heading', { name: 'AG 방현 필름' }).closest('a') as HTMLElement
    expect(within(ag).getByText('확인할 것 없음')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /접이식 유연 코팅/ })).toBeInTheDocument()
  })

  it('프로젝트를 만들면 그 프로젝트 화면으로 이동한다', async () => {
    const user = userEvent.setup()
    const b = createLocalBackend(`lablog-proj-new-${Date.now()}`)
    opened.push(b)
    open('/projects', b)
    expect(await screen.findByText('아직 프로젝트가 없습니다')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: '+ 프로젝트 만들기' })[0])
    await user.click(screen.getByRole('button', { name: '만들기' })) // 이름 없이
    expect(await screen.findByRole('alert')).toHaveTextContent('프로젝트 이름을 입력하세요')
    await user.type(screen.getByLabelText('프로젝트 이름'), '컬러 필름 개발')
    await user.click(screen.getByRole('button', { name: '만들기' }))
    expect(await screen.findByRole('heading', { name: '컬러 필름 개발' })).toBeInTheDocument()
    expect(screen.getByText('이 프로젝트에는 아직 실험이 없습니다')).toBeInTheDocument()
  })
})

describe('프로젝트 현황 (빠진 것 한눈에)', () => {
  it('심어 둔 문제를 종류별로 보여 주고 해당 실험으로 연결한다', async () => {
    open(HC, await demoBackend())
    const gaps = (await screen.findByRole('region', { name: /빠진 것 한눈에/ })) as HTMLElement
    expect(within(gaps).getByText('빈 결과')).toBeInTheDocument()
    expect(within(gaps).getByText('이상치 후보')).toBeInTheDocument()
    expect(within(gaps).getByText('멈춘 실험')).toBeInTheDocument()
    expect(within(gaps).getAllByText('빠진 항목')).toHaveLength(2)
    expect(within(gaps).getByText(/비어 있는 결과: 밀착성/)).toBeInTheDocument()
    expect(within(gaps).getAllByRole('link', { name: /#8$/ }).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /^현황 · 확인 5/ })).toBeInTheDocument()
  })

  it('진행 현황과 타임라인을 보여 준다', async () => {
    open(HC, await demoBackend())
    expect(await screen.findByRole('img', { name: /완료 8건, 진행 2건, 준비 0건/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /프로젝트 타임라인. 실험 10건/ })).toBeInTheDocument()
  })

  it('프로젝트 이름을 고치면 자동 저장된다', async () => {
    const user = userEvent.setup()
    const b = await demoBackend()
    open(HC, b)
    await user.click(await screen.findByText('이름·목표 수정'))
    const input = screen.getByLabelText('프로젝트 이름')
    await user.clear(input)
    await user.type(input, 'HC-300 하드코팅 (개정)')
    await waitFor(async () => expect((await b.projects.list()).some((p) => p.name === 'HC-300 하드코팅 (개정)')).toBe(true), { timeout: 3000 })
  })
})

describe('프로젝트 데이터 표', () => {
  it('실험 × 항목을 한 표로 모으고 이상치와 빈 값을 표시한다', async () => {
    open(`${HC}/data`, await demoBackend())
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('columnheader', { name: /건조 온도/ })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /헤이즈/ })).toBeInTheDocument()
    const row8 = within(table).getByRole('row', { name: /#8/ })
    expect(within(row8).getByText(/3\.9/)).toBeInTheDocument()
    expect(within(row8).getByText(/이상치 후보/)).toBeInTheDocument()
    expect(within(table).getAllByRole('row')).toHaveLength(2 + 10) // 머리글 2줄 + 실험 10건
  })

  it('CSV로 내보내면 파일 저장을 요청하고 안내한다', async () => {
    const user = userEvent.setup()
    const created: Blob[] = []
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => (created.push(b as Blob), 'blob:test'))
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    open(`${HC}/data`, await demoBackend())
    await user.click(await screen.findByRole('button', { name: 'CSV로 내보내기' }))
    expect(click).toHaveBeenCalledOnce()
    expect(created).toHaveLength(1)
    expect(await screen.findByText('CSV 파일을 저장했습니다')).toBeInTheDocument()
  })
})

describe('프로젝트 분석', () => {
  it('조건과 결과의 관계, 실험 순서 추세, 이상치 후보를 보여 준다', async () => {
    open(`${HC}/analysis`, await demoBackend())
    expect(await screen.findByRole('group', { name: /에 따른 .*점 \d+개, 상관계수 -?\d\.\d\d/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /실험 순서에 따른/ })).toBeInTheDocument()
    const out = screen.getByRole('region', { name: /이상치 후보/ })
    expect(within(out).getByText(/헤이즈 3\.9/)).toBeInTheDocument()
    expect(screen.getByText(/상관이 곧 원인을 뜻하지는 않으며/)).toBeInTheDocument()
  })

  it('가로축과 세로축을 바꾸면 차트가 바뀐다', async () => {
    const user = userEvent.setup()
    open(`${HC}/analysis`, await demoBackend())
    await screen.findByRole('group', { name: /상관계수/ })
    await user.selectOptions(screen.getByLabelText('가로축 (조건 또는 결과)'), 'UV 조사량 (mJ/cm²)')
    await user.selectOptions(screen.getByLabelText('세로축 (결과)'), '연필경도 (H)')
    const chart = await screen.findByRole('group', { name: /UV 조사량 \(mJ\/cm²\)에 따른 연필경도 \(H\)/ })
    expect(chart).toHaveAccessibleName(/상관계수 0\.[89]/)
  })

  it('수치가 3건 미만이면 분석 대신 안내한다', async () => {
    const b = createLocalBackend(`lablog-proj-few-${Date.now()}`)
    opened.push(b)
    const p = await b.projects.create({ name: '막 시작한 프로젝트', description: '' })
    const e = await b.experiments.create({ projectId: p.id, title: '첫 실험', purpose: '', owner: '', tags: [], status: 'done', startedAt: null, completedAt: null, sourceExperimentId: null })
    await b.dataItems.create({ experimentId: e.id, kind: 'condition', order: 1, name: '건조 온도', value: '80', unit: '°C' })
    await b.dataItems.create({ experimentId: e.id, kind: 'result', order: 1, name: '헤이즈', value: '0.7', unit: '%' })
    open(`/projects/${p.id}/analysis`, b)
    expect(await screen.findByText('분석할 수치가 아직 부족합니다')).toBeInTheDocument()
  })

  it('상관계수를 말로 풀어 쓴다', () => {
    expect(describeCorrelation(0.95)).toMatch(/강한 양의 관계/)
    expect(describeCorrelation(-0.6)).toMatch(/뚜렷한 음의 관계.*작아지는/)
    expect(describeCorrelation(0.1)).toMatch(/뚜렷한 관계가 보이지 않습니다/)
  })
})

describe('홈의 놓친 것', () => {
  it('모든 프로젝트의 빠진 것을 프로젝트 이름과 함께 모아 보여 준다', async () => {
    open('/', await demoBackend())
    expect(await screen.findByRole('heading', { name: '놓친 것 (5)' })).toBeInTheDocument()
    expect(screen.getAllByText(/^하드코팅 필름 HC-300 · HC-300 하드코팅 조건 탐색 #8/).length).toBeGreaterThan(0)
  })
})

describe('항목 이름 자동 완성', () => {
  it('같은 프로젝트에서 쓴 항목 이름을 제안하고, 이름이 같으면 단위를 채운다', async () => {
    const user = userEvent.setup()
    const b = await demoBackend()
    const e = await createExperiment(b, { title: 'HC-300 하드코팅 조건 탐색 #11', projectId: 'demo-project-1' })
    open(`/experiments/${e.id}/data`, b)
    await user.click(await screen.findByRole('button', { name: '+ 조건 추가' }))
    // 프로젝트의 기존 항목을 불러올 때까지 기다린다
    await waitFor(() => expect(document.querySelectorAll('#item-names-condition option').length).toBeGreaterThanOrEqual(4))
    const names = [...document.querySelectorAll('#item-names-condition option')].map((o) => (o as HTMLOptionElement).value)
    expect(names).toEqual(expect.arrayContaining(['코팅 두께', '건조 온도', 'UV 조사량', '건조 시간']))
    await user.type(screen.getByLabelText('조건 이름'), '건조 온도')
    await waitFor(() => expect(screen.getByLabelText('건조 온도 단위')).toHaveValue('°C'))
    await waitFor(async () => {
      const [item] = await b.dataItems.listByExperiment(e.id)
      expect([item.name, item.unit]).toEqual(['건조 온도', '°C'])
    })
  })

  it('프로젝트가 없는 실험은 제안 없이 동작한다', async () => {
    const user = userEvent.setup()
    const b = await demoBackend()
    const e = await createExperiment(b, { title: '프로젝트 없는 실험' })
    open(`/experiments/${e.id}/data`, b)
    await user.click(await screen.findByRole('button', { name: '+ 조건 추가' }))
    expect(document.querySelectorAll('#item-names-condition option')).toHaveLength(0)
  })
})

describe('이전 실험 이어받기', () => {
  it('마지막 실험의 절차와 조건·결과 항목을 가져오고 결과 값은 비운다', async () => {
    const user = userEvent.setup()
    const b = await demoBackend()
    open('/experiments/new?project=demo-project-1', b)
    expect(await screen.findByText(/마지막 실험\(/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeChecked()
    await user.type(screen.getByLabelText('제목 (필수)'), 'HC-300 하드코팅 조건 탐색 #11')
    await user.click(screen.getByRole('button', { name: /만들고 절차 입력하기/ }))
    await screen.findByRole('heading', { name: /#11/ })

    const made = (await b.experiments.list({ projectId: 'demo-project-1' })).items.find((e) => e.title.endsWith('#11'))!
    expect(made.status).toBe('ready')
    expect(made.sourceExperimentId).toBe('demo-hc10')
    const steps = await b.steps.listByExperiment(made.id)
    expect(steps).toHaveLength(9)
    expect(steps.every((s) => !s.done)).toBe(true)
    const items = await b.dataItems.listByExperiment(made.id)
    expect(items.filter((i) => i.kind === 'condition').map((i) => [i.name, i.value])).toEqual([
      ['코팅 두께', '5'],
      ['건조 온도', '90'],
      ['건조 시간', '2'],
      ['UV 조사량', '600'],
    ])
    // #10에는 결과가 아직 없어서 가져올 결과 항목이 없다. 결과 항목 이어받기는 완료한 실험에서 확인한다.
    expect(items.filter((i) => i.kind === 'result')).toEqual([])
  })

  it('체크를 풀면 빈 실험으로 시작한다', async () => {
    const user = userEvent.setup()
    const b = await demoBackend()
    open('/experiments/new?project=demo-project-1', b)
    await user.click(await screen.findByRole('checkbox'))
    await user.type(screen.getByLabelText('제목 (필수)'), '빈 실험')
    await user.click(screen.getByRole('button', { name: /만들고 절차 입력하기/ }))
    await screen.findByRole('heading', { name: /빈 실험/ })
    const made = (await b.experiments.list({ projectId: 'demo-project-1' })).items.find((e) => e.title === '빈 실험')!
    expect(await b.steps.listByExperiment(made.id)).toHaveLength(0)
  })
})
