import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import { seedDemo } from '../data/seed'
import type { Requirement } from '../domain/types'
import { buildMatrix } from '../domain/analysis/analysis'
import { projectStatus } from '../domain/analysis/requirements'
import { loadProjectBundles } from '../shared/application/projectData'

const opened: LocalBackend[] = []
let seq = 0

function make(): LocalBackend {
  const b = createLocalBackend(`lablog-req-${Date.now()}-${seq++}`)
  opened.push(b)
  return b
}

async function demoBackend(): Promise<LocalBackend> {
  const b = make()
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

beforeEach(() => localStorage.clear())
afterEach(async () => {
  cleanup()
  await new Promise((r) => setTimeout(r, 20))
  while (opened.length) opened.pop()?.close()
})

const exp = { projectId: null, purpose: '', owner: '', tags: [], status: 'done' as const, startedAt: null, completedAt: null, sourceExperimentId: null }

/** 요구가 있는 작은 프로젝트: 두께(조건)를 바꿔 헤이즈(결과)를 잰다. 고객 요구는 헤이즈 1% 이하. */
async function smallProject(b: LocalBackend, hazes: number[]) {
  const reqs: Requirement[] = [{ id: 'q1', name: '헤이즈', unit: '%', kind: 'max', max: 1, priority: 'must' }]
  const p = await b.projects.create({ name: '컬러 필름', description: '', customer: '한빛디스플레이', requirements: reqs })
  for (const [i, h] of hazes.entries()) {
    const e = await b.experiments.create({ ...exp, projectId: p.id, title: `컬러 필름 #${i + 1}`, startedAt: new Date(2026, 8, i + 1).toISOString() })
    await b.dataItems.create({ experimentId: e.id, kind: 'condition', order: 1, name: '두께', value: String(3 + i), unit: 'µm' })
    await b.dataItems.create({ experimentId: e.id, kind: 'result', order: 1, name: '헤이즈', value: String(h), unit: '%' })
  }
  return p
}

describe('고객 요구 입력 탭', () => {
  it('프로젝트에 이미 있는 요구와 고객을 보여 준다', async () => {
    const b = await demoBackend()
    open('/projects/demo-project-1/requirements', b)
    expect(await screen.findByLabelText('고객 또는 요청 부서 (선택)')).toHaveValue('한빛건설 구조팀 (예시)')
    expect(screen.getByLabelText('요구 1 · 항목 이름')).toHaveValue('압축강도')
    expect(screen.getByLabelText('요구 3 · 항목 이름')).toHaveValue('시멘트')
    expect(screen.getByRole('link', { name: /고객 요구 \(3\)/ })).toBeInTheDocument()
  })

  it('요구를 추가하면 자동 저장되고 아래 현황이 바로 바뀐다', async () => {
    const user = userEvent.setup()
    const b = make()
    const p = await b.projects.create({ name: '새 프로젝트', description: '' })
    open(`/projects/${p.id}/requirements`, b)
    await user.click(await screen.findByRole('button', { name: '+ 요구 특성 추가' }))
    await user.type(screen.getByLabelText('요구 1 · 항목 이름'), '슬럼프')
    // 값이 없으면 저장되지 않고 이유를 알려 준다
    expect(screen.getByText(/이상 값을 입력하세요/)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('조건'), 'range')
    await user.type(screen.getByLabelText('최소'), '150')
    await user.type(screen.getByLabelText('최대'), '210')
    await user.type(screen.getByLabelText('단위'), 'mm')
    await waitFor(async () => expect((await b.projects.list())[0].requirements).toMatchObject([{ name: '슬럼프', kind: 'range', min: 150, max: 210, unit: 'mm', priority: 'must' }]), { timeout: 4000 })
    expect(await screen.findByText('슬럼프 150 ~ 210 mm')).toBeInTheDocument()
    expect(screen.getByText('데이터 없음')).toBeInTheDocument()
  })

  it('덜 쓴 줄은 저장하지 않고, 지우면 저장에서도 빠진다', async () => {
    const user = userEvent.setup()
    const b = await demoBackend()
    open('/projects/demo-project-1/requirements', b)
    await user.click(await screen.findByRole('button', { name: '+ 요구 특성 추가' }))
    expect(screen.getAllByText(/채워질 때까지 저장되지 않습니다/)).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: '요구 3 지우기' }))
    await waitFor(async () => expect((await b.projects.list()).find((p) => p.id === 'demo-project-1')?.requirements).toHaveLength(2), { timeout: 4000 })
  })

  it('특정 조건일 때만 적용(재령 28일 등)을 켜고 저장한다', async () => {
    const user = userEvent.setup()
    const b = make()
    const p = await b.projects.create({ name: '새 프로젝트', description: '' })
    open(`/projects/${p.id}/requirements`, b)
    await user.click(await screen.findByRole('button', { name: '+ 요구 특성 추가' }))
    await user.type(screen.getByLabelText('요구 1 · 항목 이름'), '압축강도')
    await user.type(screen.getByLabelText('이상'), '40')
    await user.click(screen.getByRole('checkbox', { name: /특정 조건일 때만 적용/ }))
    await user.type(screen.getByLabelText('요구 1 적용 조건 이름'), '재령')
    await user.clear(screen.getByLabelText('요구 1 적용 조건 값'))
    await user.type(screen.getByLabelText('요구 1 적용 조건 값'), '28')
    await waitFor(async () => expect((await b.projects.list())[0].requirements?.[0].at).toEqual({ name: '재령', value: 28 }), { timeout: 4000 })
    expect(await screen.findByText('재령 28일 때 압축강도 ≥ 40')).toBeInTheDocument()
  })
})

describe('프로젝트 현황의 고객 요구 달성', () => {
  it('요구가 없으면 입력으로 안내한다', async () => {
    const b = make()
    const p = await b.projects.create({ name: '요구 없는 프로젝트', description: '' })
    open(`/projects/${p.id}`, b)
    expect(await screen.findByText(/아직 고객 요구 특성이 없습니다/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+ 고객 요구 특성 입력하기' })).toHaveAttribute('href', `/projects/${p.id}/requirements`)
  })

  it('달성한 요구와 달성한 배합을 알려 준다', async () => {
    const b = make()
    const p = await smallProject(b, [1.4, 0.9, 0.7])
    open(`/projects/${p.id}`, b)
    expect(await screen.findByText(/필수 요구를 모두 만족한 배합이 2개 있습니다/)).toBeInTheDocument()
    const table = screen.getByRole('region', { name: '고객 요구별 달성 표' })
    expect(within(table).getByRole('rowheader', { name: '헤이즈 ≤ 1 %' })).toBeInTheDocument()
    expect(within(table).getByText('달성')).toBeInTheDocument()
    expect(within(table).getByText('2 / 3건')).toBeInTheDocument()
    expect(screen.getAllByText(/한빛디스플레이/).length).toBeGreaterThan(0)
  })

  it('달성하지 못했으면 가장 가까운 배합과 모자란 값을 알려 준다', async () => {
    const b = make()
    const p = await smallProject(b, [1.9, 1.4, 1.2])
    open(`/projects/${p.id}`, b)
    expect(await screen.findByText(/필수 요구 1개 중 0개는 달성했지만, 모두 만족한 배합은 아직 없습니다/)).toBeInTheDocument()
    expect(screen.getByText(/가까운 배합/)).toBeInTheDocument()
    expect(screen.getByText(/현재 1\.2 % 로 모자랍니다/)).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '고객 요구별 달성 표' })).getByText('미달')).toBeInTheDocument()
  })

  it('예시 프로젝트는 서비스가 계산한 상태와 같은 결과를 보여 준다', async () => {
    const b = await demoBackend()
    const project = (await b.projects.list()).find((p) => p.id === 'demo-project-4')!
    const status = projectStatus(buildMatrix(await loadProjectBundles(b, project.id)), project.requirements ?? [])
    open('/projects/demo-project-4', b)
    const table = await screen.findByRole('region', { name: '고객 요구별 달성 표' })
    const chips = within(table).getAllByText(/^(달성|미달|데이터 없음)$/).map((c) => c.textContent)
    const label = (s: string) => (s === 'achieved' ? '달성' : s === 'not-yet' ? '미달' : '데이터 없음')
    expect(chips).toEqual(status.items.map((i) => label(i.status)))
    expect(document.querySelector('.req-banner')).toHaveTextContent(status.overall === 'achieved' ? '만족한 배합' : '모두 만족한 배합은 아직 없습니다')
  })
})

describe('실험 화면의 요구 판정', () => {
  it('실험 개요와 조건·결과 탭에 만족·미달을 보여 주고, 값을 고치면 바뀐다', async () => {
    const user = userEvent.setup()
    const b = make()
    const p = await smallProject(b, [1.4])
    const [e] = (await b.experiments.list({ projectId: p.id })).items
    open(`/experiments/${e.id}`, b)
    const bar = await screen.findByRole('region', { name: '고객 요구 판정' })
    expect(bar).toHaveTextContent('필수 1개 중 0개 만족')
    expect(bar).toHaveTextContent('✗ 미달')
    await user.click(screen.getByRole('link', { name: '조건·결과' }))
    const row = (await screen.findByLabelText('헤이즈 값')).closest('li') as HTMLElement
    expect(within(row).getByText(/✗ 요구 미달/)).toBeInTheDocument()
    const value = screen.getByLabelText('헤이즈 값')
    await user.clear(value)
    await user.type(value, '0.8')
    await waitFor(() => expect(within(row).getByText(/✓ 요구 만족/)).toBeInTheDocument(), { timeout: 5000 })
    expect(screen.getByRole('region', { name: '고객 요구 판정' })).toHaveTextContent('모두 만족')
  })

  it('프로젝트나 요구가 없는 실험에는 판정 줄이 없다', async () => {
    const b = make()
    const e = await b.experiments.create({ ...exp, title: '요구 없음' })
    open(`/experiments/${e.id}`, b)
    await screen.findByRole('heading', { name: '요구 없음' })
    expect(screen.queryByRole('region', { name: '고객 요구 판정' })).toBeNull()
  })
})

describe('새 실험: 요구에 맞춘 구성', () => {
  it('프로젝트를 고르면 제목을 제안하고, 비워 두면 그 제목으로 만들며 요구 항목을 빈칸으로 미리 만든다', async () => {
    const user = userEvent.setup()
    const b = make()
    const p = await smallProject(b, [1.4, 0.9])
    open(`/experiments/new?project=${p.id}`, b)
    const title = await screen.findByLabelText('제목 (필수)')
    await waitFor(() => expect(title).toHaveAttribute('placeholder', '비워 두면 “컬러 필름 #3”'))
    expect(screen.getAllByRole('note').some((note) => note.textContent?.includes('측정 항목 1개'))).toBe(true)
    await user.click(screen.getByRole('radio', { name: '빈 실험' })) // 이어받기 끄기: 요구 항목만 확인
    await user.click(screen.getByRole('button', { name: '실험 만들기' }))
    await screen.findByRole('heading', { name: '컬러 필름 #3' })
    const made = (await b.experiments.list({ projectId: p.id })).items.find((x) => x.title === '컬러 필름 #3')!
    const items = await b.dataItems.listByExperiment(made.id)
    expect(items.map((i) => [i.kind, i.name, i.value, i.unit])).toEqual([['result', '헤이즈', '', '%']])
  })

  it('이어받기로 만들어도 요구 항목이 빠지지 않는다', async () => {
    const user = userEvent.setup()
    const b = make()
    const p = await b.projects.create({ name: '코팅', description: '', requirements: [{ id: 'q', name: '밀착성', unit: '%', kind: 'min', min: 90, priority: 'must' }] })
    const prev = await b.experiments.create({ ...exp, projectId: p.id, title: '코팅 #1' })
    await b.dataItems.create({ experimentId: prev.id, kind: 'condition', order: 1, name: '온도', value: '80', unit: '°C' })
    open(`/experiments/new?project=${p.id}`, b)
    expect(await screen.findByRole('radio', { name: /마지막 실험에서 이어받기/ })).toBeChecked()
    await user.type(screen.getByLabelText('제목 (필수)'), '코팅 #2')
    await user.click(screen.getByRole('button', { name: '실험 만들기' }))
    await screen.findByRole('heading', { name: '코팅 #2' })
    const made = (await b.experiments.list({ projectId: p.id })).items.find((x) => x.title === '코팅 #2')!
    const items = await b.dataItems.listByExperiment(made.id)
    expect(items.map((i) => [i.kind, i.name, i.value])).toEqual([
      ['condition', '온도', '80'],
      ['result', '밀착성', ''],
    ])
  })

  it('프로젝트가 없으면 제안도 요구 안내도 없고, 제목이 비면 오류를 알린다', async () => {
    const user = userEvent.setup()
    const b = make()
    open('/experiments/new', b)
    const title = await screen.findByLabelText('제목 (필수)')
    expect(title.getAttribute('placeholder')).not.toContain('비워 두면')
    expect(screen.queryByRole('note')).toBeNull()
    await user.click(screen.getByRole('button', { name: '실험 만들기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('제목을 입력하세요')
  })
})

describe('데이터 표의 요구 표시와 거르기', () => {
  it('요구를 만족한 칸과 미달한 칸을 표시하고, 만족한 실험만 거를 수 있다', async () => {
    const user = userEvent.setup()
    const b = make()
    const p = await smallProject(b, [1.4, 0.9, 0.7])
    open(`/projects/${p.id}/data`, b)
    const table = await screen.findByRole('table')
    const cells = within(table).getAllByRole('cell').filter((c) => c.className.includes('cell--pass') || c.className.includes('cell--miss'))
    expect(cells.map((c) => (c.className.includes('cell--pass') ? '만족' : '미달'))).toEqual(['미달', '만족', '만족'])
    expect(within(cells[0]).getByText('(요구 미달)')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('고객 요구'), '필수 요구를 모두 만족한 것')
    expect(within(table).getAllByRole('rowheader').map((r) => r.textContent)).toEqual(['컬러 필름 #2', '컬러 필름 #3'])
    await user.selectOptions(screen.getByLabelText('고객 요구'), '미달이 있는 것')
    expect(within(table).getAllByRole('rowheader').map((r) => r.textContent)).toEqual(['컬러 필름 #1'])
  })

  it('요구가 없는 프로젝트에는 고객 요구 거르기가 없다', async () => {
    const b = make()
    const p = await b.projects.create({ name: '요구 없음', description: '' })
    const e = await b.experiments.create({ ...exp, projectId: p.id, title: 'a' })
    await b.dataItems.create({ experimentId: e.id, kind: 'condition', order: 1, name: 'x', value: '1', unit: '' })
    open(`/projects/${p.id}/data`, b)
    await screen.findByRole('table')
    expect(screen.queryByLabelText('고객 요구')).toBeNull()
  })
})

describe('홈의 프로젝트 현황', () => {
  it('프로젝트마다 요구 달성 상태와 다음에 할 일을 보여 준다', async () => {
    const b = make()
    await smallProject(b, [1.9, 1.4])
    await b.projects.create({ name: '요구 없는 프로젝트', description: '' })
    open('/', b)
    expect(await screen.findByRole('heading', { name: '프로젝트 현황 (2)' })).toBeInTheDocument()
    const cards = document.querySelectorAll('.project-summary .project-card')
    expect(cards).toHaveLength(2)
    const film = [...cards].find((c) => c.textContent?.includes('컬러 필름')) as HTMLElement
    expect(film).toHaveTextContent('진행 중')
    expect(film).toHaveTextContent('필수 요구 0/1')
    expect(within(film).getByRole('link', { name: /가장 가까운 배합에서 "헤이즈 ≤ 1 %"가 아직 부족합니다/ })).toBeInTheDocument()
    const none = [...cards].find((c) => c.textContent?.includes('요구 없는')) as HTMLElement
    expect(within(none).getByRole('link', { name: /고객이 요청한 특성을 입력하면/ })).toHaveAttribute('href', expect.stringMatching(/\/requirements$/))
    expect(screen.getByRole('link', { name: '전체 데이터 보기' })).toHaveAttribute('href', '/data')
  })
})

describe('분석: 요구를 달성한 조건', () => {
  it('달성한 실험과 못 미친 실험의 조건 차이를 한눈에 읽기에 더한다', async () => {
    const b = make()
    // 두께가 클수록 헤이즈가 낮아져(좋아져) 요구(1% 이하)를 달성하는 12건(달성 5건, 미달 7건)
    const reqs: Requirement[] = [{ id: 'q', name: '헤이즈', unit: '%', kind: 'max', max: 1, priority: 'must' }]
    const p = await b.projects.create({ name: '두께 탐색', description: '', requirements: reqs })
    for (let i = 0; i < 12; i++) {
      const e = await b.experiments.create({ ...exp, projectId: p.id, title: `두께 #${i + 1}`, startedAt: new Date(2026, 8, i + 1).toISOString() })
      await b.dataItems.create({ experimentId: e.id, kind: 'condition', order: 1, name: '두께', value: String(2 + i), unit: 'µm' })
      await b.dataItems.create({ experimentId: e.id, kind: 'condition', order: 2, name: '온도', value: String(80 + (i % 3)), unit: '°C' })
      await b.dataItems.create({ experimentId: e.id, kind: 'result', order: 1, name: '헤이즈', value: String(Math.round((2.4 - i * 0.2) * 100) / 100), unit: '%' })
    }
    open(`/projects/${p.id}/analysis`, b)
    const insights = await screen.findByRole('heading', { name: '한눈에 읽기' })
    const list = (insights.closest('section') as HTMLElement).textContent ?? ''
    expect(list).toContain('"헤이즈 ≤ 1 %"를 달성한 실험')
    expect(list).toContain('두께는 달성한 쪽이 중앙값')
    expect(list).toContain('다음 실험은 이 범위에서 시작해 보세요')
  })
})
