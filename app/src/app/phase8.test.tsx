import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import type { Experiment } from '../domain/types'
import { parseBackup } from '../services/backup'
import {
  conditionsToText,
  parseConditionLines,
  parseLines,
  parseResultLines,
  resultsToText,
  saveAsTemplate,
  startFromTemplate,
} from '../services/templateService'

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
  it('개요의 버튼 한 번으로 복제하고, 결과·체크·메모는 비워진 채 새 실험이 열린다', async () => {
    const user = userEvent.setup()
    const b = make()
    const e = await finishedExperiment(b)
    open(`/experiments/${e.id}`, b)
    await user.click(await screen.findByRole('button', { name: '복제하여 새 실험' }))

    expect(await screen.findByText(/결과 값과 체크·메모는 비워졌습니다/)).toBeInTheDocument()
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

describe('템플릿 화면', () => {
  it('개요에서 템플릿으로 저장하면 목록에 나타나고, 거기서 새 실험을 시작한다', async () => {
    const user = userEvent.setup()
    const b = make()
    const e = await finishedExperiment(b)
    open(`/experiments/${e.id}`, b)
    await user.click(await screen.findByRole('button', { name: '템플릿으로 저장' }))
    await user.type(screen.getByLabelText('템플릿 이름'), '표준 도포·건조')
    await user.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(async () => expect(await b.templates.list()).toHaveLength(1))

    await user.click(await screen.findByRole('button', { name: '템플릿 보기' }))
    expect(await screen.findByRole('heading', { name: '표준 도포·건조' })).toBeInTheDocument()
    expect(screen.getByText('절차 2개 · 조건 1개 · 결과 항목 1개')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: '이 템플릿으로 새 실험' }))
    await user.type(await screen.findByLabelText('제목 (필수)'), '템플릿 첫 실험')
    expect(screen.getByLabelText('템플릿에서 시작')).toHaveValue((await b.templates.list())[0].id)
    await user.click(screen.getByRole('button', { name: /만들고 절차 입력하기/ }))
    expect(await screen.findByLabelText('2번째 단계')).toHaveValue('80°C 건조')
    const made = (await b.experiments.list()).items.find((x) => x.title === '템플릿 첫 실험') as Experiment
    expect((await b.dataItems.listByExperiment(made.id)).map((i) => i.name)).toEqual(['건조 온도', '연필경도'])
  })

  it('템플릿을 편집해 저장하고, 삭제하면 사라진다', async () => {
    const user = userEvent.setup()
    const b = make()
    const t = await b.templates.create({ name: '고칠 템플릿', steps: [{ content: '하나' }], defaultConditions: [], resultItems: [] })
    open('/templates', b)
    const card = (await screen.findByRole('heading', { name: '고칠 템플릿' })).closest('li') as HTMLElement
    await user.click(within(card).getByText('편집'))
    const steps = within(card).getByLabelText(/절차/)
    await user.clear(steps)
    await user.type(steps, '가{Enter}나')
    await user.click(within(card).getByRole('button', { name: '저장' }))
    await waitFor(async () => expect((await b.templates.get(t.id)).steps).toEqual([{ content: '가' }, { content: '나' }]))

    await user.click(within(card).getByRole('button', { name: '템플릿 삭제' }))
    await user.click(within(card).getByRole('button', { name: '정말 삭제' }))
    await waitFor(async () => expect(await b.templates.list()).toEqual([]))
    expect(await screen.findByText('저장한 템플릿이 없습니다')).toBeInTheDocument()
  })

  it('이름 없이는 새 템플릿을 만들 수 없다', async () => {
    const user = userEvent.setup()
    const b = make()
    open('/templates', b)
    await user.click(await screen.findByRole('button', { name: '+ 새 템플릿' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('이름')
    expect(await b.templates.list()).toEqual([])
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
    await user.click(screen.getByRole('button', { name: /기록 지우기/ }))
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
