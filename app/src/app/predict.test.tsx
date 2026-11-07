import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import { seedDemo } from '../data/seed'
import type { Requirement } from '../domain/types'
import { conditionsHref, parseConditions } from '../services/prefill'

const opened: LocalBackend[] = []
let seq = 0

function make(): LocalBackend {
  const b = createLocalBackend(`lablog-predict-${Date.now()}-${seq++}`)
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

/** 두께(조건)를 바꿔 헤이즈(결과)를 재는 작은 프로젝트. 헤이즈는 두께에 거의 비례한다. */
async function smallProject(b: LocalBackend, n: number) {
  const reqs: Requirement[] = [{ id: 'q1', name: '헤이즈', unit: '%', kind: 'max', max: 1, priority: 'must' }]
  const p = await b.projects.create({ name: '컬러 필름', description: '', customer: '한빛디스플레이', requirements: reqs })
  for (let i = 0; i < n; i++) {
    const e = await b.experiments.create({ ...exp, projectId: p.id, title: `컬러 필름 #${i + 1}`, startedAt: new Date(2026, 8, i + 1).toISOString() })
    const t = 1 + (i % 7) * 0.5
    await b.dataItems.create({ experimentId: e.id, kind: 'condition', order: 1, name: '두께', value: String(t), unit: 'µm' })
    await b.dataItems.create({ experimentId: e.id, kind: 'result', order: 1, name: '헤이즈', value: (0.3 * t + (i % 3) * 0.05).toFixed(2), unit: '%' })
  }
  return p
}

describe('예측·제안 탭', () => {
  it('예시 프로젝트: 모델 표, 요구를 만족할 후보 3개, 새 실험 링크가 보인다', async () => {
    const b = await demoBackend()
    open('/projects/demo-project-1/predict', b)
    expect(await screen.findByRole('heading', { name: '모델이 어디까지 믿을 만한가' }, { timeout: 15000 })).toBeInTheDocument()
    const modelTable = screen.getByRole('region', { name: '결과별 모델 표' })
    expect(within(modelTable).getByRole('rowheader', { name: '압축강도 (MPa)' })).toBeInTheDocument()
    expect(within(modelTable).getByText(/랜덤 포레스트|선형\(능형\) 회귀/)).toBeInTheDocument()

    const cand = screen.getByRole('region', { name: '제안 조건 표' })
    expect(within(cand).getByText(/후보 3/)).toBeInTheDocument()
    expect(within(cand).getByRole('rowheader', { name: '시멘트 (kg/m³)' })).toBeInTheDocument()
    // 재령은 요구의 적용 조건이라 제안 값에 없고, 요구별 예측 줄에 7일·28일이 따로 있다
    expect(within(cand).queryByRole('rowheader', { name: '재령 (일)' })).not.toBeInTheDocument()
    expect(within(cand).getByRole('rowheader', { name: '재령 28일 때 압축강도 ≥ 30 MPa' })).toBeInTheDocument()
    expect(within(cand).getByRole('rowheader', { name: '재령 7일 때 압축강도 ≥ 20 MPa' })).toBeInTheDocument()
    const links = within(cand).getAllByRole('link', { name: '이 조건으로 새 실험' })
    expect(links).toHaveLength(3)
    const href = links[0].getAttribute('href') ?? ''
    expect(href).toMatch(/^\/experiments\/new\?project=demo-project-1&cond=/)
    const conds = parseConditions(decodeURIComponent(href.split('cond=')[1]))
    expect(conds.map((c) => c.name)).toContain('시멘트')
    expect(conds.map((c) => c.name)).not.toContain('재령')
    // 가장 비슷한 과거 실험 링크
    expect(within(cand).getByRole('rowheader', { name: '가장 비슷한 과거 실험' })).toBeInTheDocument()
  }, 30000)

  it('조건 값을 고치면 예측이 바뀌고, 범위를 벗어나면 알려 준다', async () => {
    const user = userEvent.setup()
    const b = await demoBackend()
    open('/projects/demo-project-1/predict', b)
    await screen.findByRole('heading', { name: '조건을 바꿔 보며 결과 예측하기' }, { timeout: 15000 })
    const table = screen.getByRole('region', { name: '예측 결과 표' })
    const before = within(table).getByRole('row', { name: /압축강도/ }).textContent
    const cement = screen.getByLabelText('시멘트 (kg/m³)')
    await user.clear(cement)
    await user.type(cement, '150')
    await waitFor(() => expect(within(screen.getByRole('region', { name: '예측 결과 표' })).getByRole('row', { name: /압축강도/ }).textContent).not.toBe(before))
    await user.clear(cement)
    await user.type(cement, '9000')
    expect(await screen.findByText(/시멘트이\(가\) 지금까지 실험한 범위를 벗어났습니다/)).toBeInTheDocument()
    // 처음 값으로 되돌리기
    await user.click(screen.getByRole('button', { name: '처음 값으로' }))
    expect(screen.queryByText(/범위를 벗어났습니다/)).not.toBeInTheDocument()
  }, 30000)

  it('작은 프로젝트: 실험이 10건 미만이면 안내만, 12건이면 모델과 제안이 나온다', async () => {
    const b = make()
    const small = await smallProject(b, 6)
    open(`/projects/${small.id}/predict`, b)
    expect(await screen.findByText('아직 예측할 만큼 데이터가 모이지 않았습니다')).toBeInTheDocument()
    cleanup()
    const b2 = make()
    const p = await smallProject(b2, 12)
    open(`/projects/${p.id}/predict`, b2)
    const cand = await screen.findByRole('region', { name: '제안 조건 표' })
    expect(within(cand).getByRole('rowheader', { name: '두께 (µm)' })).toBeInTheDocument()
    // 헤이즈 ≤ 1 이려면 두께가 작아야 한다(헤이즈 ≈ 0.3 × 두께)
    const cells = within(cand).getAllByRole('cell')
    const first = Number(cells[0].textContent)
    expect(first).toBeLessThanOrEqual(3.5)
  })

  it('현황 탭과 홈 카드에서 "다음 실험 조건 제안"으로 이어진다', async () => {
    const b = await demoBackend()
    open('/projects/demo-project-4', b)
    const link = await screen.findByRole('link', { name: '모델이 제안하는 다음 실험 조건 보기 →' })
    expect(link).toHaveAttribute('href', '/projects/demo-project-4/predict')
    cleanup()
    open('/', b)
    const cards = await screen.findAllByRole('link', { name: /다음 실험 조건 제안 보기/ })
    expect(cards.map((c) => c.getAttribute('href'))).toContain('/projects/demo-project-4/predict')
  })
})

describe('새 실험: 제안받은 조건 채우기', () => {
  it('주소의 조건을 안내하고, 만들면 조건 항목에 값이 들어간다(요구 항목도 함께)', async () => {
    const user = userEvent.setup()
    const b = await demoBackend()
    const href = conditionsHref('demo-project-1', [
      { name: '시멘트', value: '420', unit: 'kg/m³' },
      { name: '물', value: '160', unit: 'kg/m³' },
    ])
    open(href, b)
    expect(await screen.findByText(/제안받은 조건 2개\(시멘트 420, 물 160\)/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('제목 (필수)'), '제안 조건 시험')
    await user.click(screen.getByRole('button', { name: '만들고 절차 입력하기 →' }))
    const find = async () => (await b.experiments.list({ projectId: 'demo-project-1' }, 'updated_desc', { limit: 5, offset: 0 })).items.find((e) => e.title === '제안 조건 시험')
    await waitFor(async () => expect(await find()).toBeDefined())
    const made = (await find())!
    // 실험이 만들어진 뒤에 조건 값이 채워지므로 값이 들어올 때까지 기다린다
    let items = await b.dataItems.listByExperiment(made.id)
    const cond = (name: string) => items.find((i) => i.kind === 'condition' && i.name === name)
    await waitFor(async () => {
      items = await b.dataItems.listByExperiment(made.id)
      expect(cond('시멘트')?.value).toBe('420')
    })
    expect(cond('물')?.value).toBe('160')
    // 이어받은 다른 조건은 그대로 있고, 요구에 맞춘 결과 항목도 있다
    expect(cond('재령')).toBeDefined()
    expect(items.some((i) => i.kind === 'result' && i.name === '압축강도')).toBe(true)
  }, 30000)

  it('모양이 이상한 조건 매개변수는 무시한다', () => {
    expect(parseConditions('not json')).toEqual([])
    expect(parseConditions('{"a":1}')).toEqual([])
    expect(parseConditions('[{"name":" 두께 ","value":3,"unit":""},{"value":1}]')).toEqual([{ name: '두께', value: '3', unit: '' }])
  })
})
