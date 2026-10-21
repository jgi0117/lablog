import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import { seedDemo } from '../data/seed'
import type { Experiment } from '../domain/types'
import { parseBackup } from '../features/settings/application/backup'
import {
  conditionsToText,
  parseConditionLines,
  parseLines,
  parseResultLines,
  resultsToText,
  saveAsTemplate,
  startFromTemplate,
} from '../features/experiments/application/templateService'

const opened: LocalBackend[] = []
let seq = 0

function make(): LocalBackend {
  const b = createLocalBackend(`lablog-p8-${Date.now()}-${seq++}`)
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

beforeEach(() => {
  localStorage.clear()
})

afterEach(async () => {
  cleanup()
  await new Promise((r) => setTimeout(r, 20))
  while (opened.length) opened.pop()?.close()
})

/** 완료된 실험 하나: 절차 2개(체크·메모 있음), 조건 1개, 결과 1개(값 있음). */
async function finishedExperiment(b: LocalBackend, title = 'HC-300 코팅 #7'): Promise<Experiment> {
  const e = await b.experiments.create({ projectId: null, title, purpose: '목적', owner: '', tags: ['하드코팅'], status: 'done', startedAt: null, completedAt: null, sourceExperimentId: null })
  const at = new Date().toISOString()
  await b.steps.create({ experimentId: e.id, order: 1, content: '코팅액 도포', done: true, doneAt: at, note: '줄무늬 없음' })
  await b.steps.create({ experimentId: e.id, order: 2, content: '80°C 건조', done: true, doneAt: at, note: '' })
  await b.dataItems.create({ experimentId: e.id, kind: 'condition', order: 1, name: '건조 온도', value: '80', unit: '°C' })
  await b.dataItems.create({ experimentId: e.id, kind: 'result', order: 1, name: '연필경도', value: '3H', unit: '' })
  return e
}

describe('템플릿 서비스', () => {
  it('실험에서 템플릿을 만들면 절차와 조건 값, 결과 항목 이름만 담는다', async () => {
    const b = make()
    const e = await finishedExperiment(b)
    const t = await saveAsTemplate(b, ' 표준 코팅 ', await b.steps.listByExperiment(e.id), await b.dataItems.listByExperiment(e.id))
    expect(t.name).toBe('표준 코팅')
    expect(t.steps).toEqual([{ content: '코팅액 도포' }, { content: '80°C 건조' }])
    expect(t.defaultConditions).toEqual([{ name: '건조 온도', value: '80', unit: '°C' }])
    expect(t.resultItems).toEqual([{ name: '연필경도', unit: '' }])
    expect(JSON.stringify(t)).not.toContain('줄무늬')
    expect(JSON.stringify(t)).not.toContain('3H')
  })

  it('이름이 비었거나 절차가 없으면 만들지 않는다', async () => {
    const b = make()
    const e = await finishedExperiment(b)
    const steps = await b.steps.listByExperiment(e.id)
    await expect(saveAsTemplate(b, '  ', steps, [])).rejects.toThrow('이름')
    await expect(saveAsTemplate(b, '이름', [], [])).rejects.toThrow('절차')
    expect(await b.templates.list()).toEqual([])
  })

  it('템플릿으로 시작하면 준비 상태의 새 실험이 절차·조건과 빈 결과 칸을 갖는다', async () => {
    const b = make()
    const e = await finishedExperiment(b)
    const t = await saveAsTemplate(b, '표준', await b.steps.listByExperiment(e.id), await b.dataItems.listByExperiment(e.id))
    const exp = await startFromTemplate(b, t, { title: '  새 실험  ', tags: ['a'] })
    expect(exp).toMatchObject({ title: '새 실험', status: 'ready', tags: ['a'] })
    const steps = await b.steps.listByExperiment(exp.id)
    expect(steps.map((s) => [s.order, s.content, s.done, s.note])).toEqual([
      [1, '코팅액 도포', false, ''],
      [2, '80°C 건조', false, ''],
    ])
    const items = await b.dataItems.listByExperiment(exp.id)
    expect(items.map((i) => [i.kind, i.name, i.value])).toEqual([
      ['condition', '건조 온도', '80'],
      ['result', '연필경도', ''],
    ])
    // 원본은 그대로
    expect((await b.dataItems.listByExperiment(e.id)).find((i) => i.kind === 'result')?.value).toBe('3H')
  })

  it('편집 화면의 글자 입력을 목록으로 바꾸고 되돌린다', () => {
    expect(parseLines(' 가 \n\n나\n')).toEqual(['가', '나'])
    const c = parseConditionLines('온도 | 80 | °C\n시간 | 30\n압력')
    expect(c).toEqual([
      { name: '온도', value: '80', unit: '°C' },
      { name: '시간', value: '30', unit: '' },
      { name: '압력', value: '', unit: '' },
    ])
    expect(conditionsToText(c)).toBe('온도 | 80 | °C\n시간 | 30\n압력')
    const r = parseResultLines('연필경도 | H\n헤이즈')
    expect(r).toEqual([
      { name: '연필경도', unit: 'H' },
      { name: '헤이즈', unit: '' },
    ])
    expect(resultsToText(r)).toBe('연필경도 | H\n헤이즈')
  })
})

describe('복제 (Journey 3 Step 1, E1)', () => {
  it('개요에서 원본을 고른 등록 화면으로 이동하고, 결과·체크·메모를 비워 생성한다', async () => {
    const user = userEvent.setup()
    const b = make()
    const original = await finishedExperiment(b)
    const project = await b.projects.create({ name: '코팅 프로젝트', description: '' })
    const e = await b.experiments.update(original.id, { projectId: project.id })
    open(`/experiments/${e.id}`, b)
    await user.click(await screen.findByRole('link', { name: '이 실험에서 새로 시작' }))
    const preview = await screen.findByRole('note', { name: '이어받기 미리보기' })
    await waitFor(() => expect(preview).toHaveTextContent('결과 값·단계 체크·메모는 비워서 시작합니다.'))
    await user.type(screen.getByLabelText('제목 (필수)'), '이어받은 실험')
    await user.click(screen.getByRole('button', { name: '실험 만들기' }))
    const all = (await b.experiments.list()).items
    const copy = all.find((x) => x.sourceExperimentId === e.id) as Experiment
    expect(copy).toBeTruthy()
    expect(copy.status).toBe('ready')
    const steps = await b.steps.listByExperiment(copy.id)
    expect(steps.every((s) => !s.done && s.note === '')).toBe(true)
    const items = await b.dataItems.listByExperiment(copy.id)
    expect(items.find((i) => i.kind === 'result')?.value).toBe('')
    expect(items.find((i) => i.kind === 'condition')?.value).toBe('80')
    // 원본은 변하지 않는다
    expect((await b.experiments.get(e.id)).status).toBe('done')
    expect((await b.steps.listByExperiment(e.id)).every((s) => s.done)).toBe(true)
  })
})

describe('템플릿 UI 제거와 데이터 보존', () => {
  it('이전 템플릿 주소는 실험 목록으로 안내하고 데이터는 남긴다', async () => {
    const b = make()
    await b.templates.create({ name: '보존할 템플릿', steps: [{ content: '하나' }], defaultConditions: [], resultItems: [] })
    open('/templates', b)
    expect(await screen.findByText('템플릿 대신 기존 실험 이어받기를 사용하세요.')).toBeInTheDocument()
    expect(await b.templates.list()).toHaveLength(1)
  })

  it('실험 개요에는 템플릿 생성 대신 기존 실험 이어받기 진입점이 있다', async () => {
    const b = make()
    const e = await finishedExperiment(b)
    open(`/experiments/${e.id}`, b)
    expect(await screen.findByRole('link', { name: '이 실험에서 새로 시작' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '템플릿으로 저장' })).toBeNull()
  })

  it('새 실험 화면은 저장된 템플릿을 노출하지 않는다', async () => {
    const b = make()
    await b.templates.create({ name: '숨긴 템플릿', steps: [{ content: '하나' }], defaultConditions: [], resultItems: [] })
    open('/experiments/new', b)
    await screen.findByRole('heading', { name: '새 실험' })
    expect(screen.queryByLabelText('템플릿에서 시작')).toBeNull()
  })
})

describe('달라진 점 기록 (Journey 3 Step 3)', () => {
  it('수행 모드에서 버튼 하나와 입력만으로 기록하고, 달라진 점 탭에서 본다', async () => {
    const user = userEvent.setup()
    const b = make()
    const e = await finishedExperiment(b)
    await b.experiments.update(e.id, { status: 'running' })
    open(`/experiments/${e.id}/run`, b)

    await user.click(await screen.findByRole('button', { name: '+ 달라진 점 기록' }))
    // 입력칸이 바로 포커스를 받는다(탭 두 번 이내)
    const change = screen.getByLabelText('달라진 내용')
    expect(change).toHaveFocus()
    await user.type(change, '건조 온도를 70°C로 낮춤')
    await user.type(screen.getByLabelText('사유 (선택)'), '기재 변형')
    await user.click(screen.getByRole('button', { name: '기록' }))

    await waitFor(async () => expect(await b.deviations.listByExperiment(e.id)).toHaveLength(1))
    const [d] = await b.deviations.listByExperiment(e.id)
    expect(d).toMatchObject({ change: '건조 온도를 70°C로 낮춤', reason: '기재 변형', experimentId: e.id })
    // 지금 보던 단계가 대상으로 미리 골라져 있었다
    expect(d.stepId).not.toBeNull()
    expect(await screen.findByLabelText('기록한 달라진 점')).toHaveTextContent('건조 온도를 70°C로 낮춤')
  })

  it('달라진 내용이 비어 있으면 기록하지 않고 알려 준다', async () => {
    const user = userEvent.setup()
    const b = make()
    const e = await finishedExperiment(b)
    open(`/experiments/${e.id}/deviations`, b)
    await user.click(await screen.findByRole('button', { name: '기록' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('무엇이 달라졌는지')
    expect(await b.deviations.listByExperiment(e.id)).toEqual([])
  })

  it('달라진 점 탭에서 기록·확인·지우기, 탭 이름에 개수가 보인다', async () => {
    const user = userEvent.setup()
    const b = make()
    const e = await finishedExperiment(b)
    open(`/experiments/${e.id}/deviations`, b)
    expect(await screen.findByText('기록된 달라진 점이 없습니다')).toBeInTheDocument()
    await user.type(screen.getByLabelText('달라진 내용'), '농도 5% 낮춤')
    await user.click(screen.getByRole('button', { name: '기록' }))
    expect(await screen.findByText('농도 5% 낮춤')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /달라진 점 \(1\)/ })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /기록 지우기/ }))
    expect(await screen.findByText('달라진 점 기록을 지웠습니다')).toBeInTheDocument()
    await waitFor(async () => expect(await b.deviations.listByExperiment(e.id)).toEqual([]))
  })
})

describe('백업 파일 검사 (템플릿·편차)', () => {
  const at = '2026-10-01T00:00:00.000Z'
  const base = (extra: object, version = 2) =>
    JSON.stringify({
      schemaVersion: version,
      exportedAt: at,
      projects: [],
      experiments: [{ id: 'e1', title: '실험', status: 'ready', updatedAt: at }],
      steps: [],
      dataItems: [],
      ...extra,
    })

  it('버전 1 파일(템플릿·편차 목록 없음)도 가져올 수 있다', () => {
    const res = parseBackup(base({}, 1))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.summary).toMatchObject({ templates: 0, deviations: 0 })
  })

  it('템플릿과 편차를 읽고 알려진 필드만 담는다', () => {
    const res = parseBackup(
      base({
        templates: [{ id: 't1', name: 'T', updatedAt: at, steps: [{ content: '가', 이상한: 1 }], defaultConditions: [{ name: '온도', value: '80', unit: '°C' }], resultItems: [{ name: '경도' }], 위험: true }],
        deviations: [{ id: 'd1', experimentId: 'e1', change: '바꿈', updatedAt: at }],
      }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.file.templates).toEqual([
      { id: 't1', createdAt: at, updatedAt: at, deletedAt: null, version: 1, name: 'T', steps: [{ content: '가' }], defaultConditions: [{ name: '온도', value: '80', unit: '°C' }], resultItems: [{ name: '경도', unit: '' }] },
    ])
    expect(res.file.deviations?.[0]).toMatchObject({ stepId: null, reason: '', change: '바꿈' })
  })

  it('실험이 없는 편차, 이름 없는 템플릿, 중복 id는 거부한다', () => {
    expect(parseBackup(base({ deviations: [{ id: 'd1', experimentId: 'none', change: 'x', updatedAt: at }] }))).toMatchObject({ ok: false })
    expect(parseBackup(base({ templates: [{ id: 't1', updatedAt: at }] }))).toMatchObject({ ok: false, error: expect.stringContaining('이름') })
    const dup = { id: 'd1', experimentId: 'e1', change: 'x', updatedAt: at }
    expect(parseBackup(base({ deviations: [dup, dup] }))).toMatchObject({ ok: false, error: expect.stringContaining('중복') })
  })
})

describe('예시 데이터 지우기 (설정)', () => {
  it('확인을 거쳐 예시만 지우고, 지운 뒤에는 버튼이 사라진다', async () => {
    const user = userEvent.setup()
    const b = make()
    await seedDemo(b)
    const mine = await finishedExperiment(b, '내 실험')
    open('/settings', b)
    await user.click(await screen.findByRole('button', { name: '예시 데이터 지우기 (실험 200건)' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '예시 데이터 지우기' }))
    expect(await screen.findByText('예시 실험 200건을 지웠습니다', {}, { timeout: 15000 })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: /예시 데이터 지우기/ })).toBeNull(), { timeout: 5000 })
    expect((await b.experiments.list()).items.map((e) => e.id)).toEqual([mine.id])
  }, 30000)
})
