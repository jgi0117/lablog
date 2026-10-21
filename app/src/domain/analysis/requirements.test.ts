import { describe, expect, it } from 'vitest'
import type { DataItem, Experiment, Requirement, Step } from '../types'
import { buildMatrix, type ExperimentBundle } from './analysis'
import {
  checkValue,
  columnFor,
  describeRequirement,
  evaluateRow,
  progressFor,
  projectStatus,
  recipes,
  rowSummary,
  validateRequirement,
} from './requirements'

const base = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, version: 1 }
type Row = [name: string, value: string, unit?: string]

let n = 0
function bundle(conds: Row[], results: Row[], status: Experiment['status'] = 'done'): ExperimentBundle {
  const id = `e${++n}`
  const experiment: Experiment = {
    ...base,
    id,
    projectId: 'p',
    title: `실험 ${n}`,
    purpose: '',
    owner: '',
    tags: [],
    status,
    startedAt: `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`,
    completedAt: null,
    sourceExperimentId: null,
  }
  const items: DataItem[] = [
    ...conds.map(([name, value, unit = ''], i): DataItem => ({ ...base, id: `${id}-c${i}`, experimentId: id, kind: 'condition', order: i + 1, name, value, unit })),
    ...results.map(([name, value, unit = ''], i): DataItem => ({ ...base, id: `${id}-r${i}`, experimentId: id, kind: 'result', order: i + 1, name, value, unit })),
  ]
  return { experiment, steps: [] as Step[], items }
}

const req = (o: Partial<Requirement> & Pick<Requirement, 'name' | 'kind'>): Requirement => ({ id: `r-${o.name}-${o.kind}-${o.at?.value ?? ''}`, unit: '', priority: 'must', ...o })

describe('요구 설명과 검증', () => {
  it('한 줄로 읽히게 쓴다', () => {
    expect(describeRequirement(req({ name: '압축강도', kind: 'min', min: 40, unit: 'MPa' }))).toBe('압축강도 ≥ 40 MPa')
    expect(describeRequirement(req({ name: '물', kind: 'max', max: 180, unit: 'kg/m³' }))).toBe('물 ≤ 180 kg/m³')
    expect(describeRequirement(req({ name: '슬럼프', kind: 'range', min: 150, max: 210, unit: 'mm' }))).toBe('슬럼프 150 ~ 210 mm')
    expect(describeRequirement(req({ name: '두께', kind: 'target', target: 5, tolerance: 0.5, unit: 'µm' }))).toBe('두께 5 µm ± 0.5')
    expect(describeRequirement(req({ name: '압축강도', kind: 'min', min: 40, unit: 'MPa', at: { name: '재령', value: 28 } }))).toBe('재령 28일 때 압축강도 ≥ 40 MPa')
  })

  it('빠진 값, 뒤집힌 범위, 음수 허용 오차를 거른다', () => {
    expect(validateRequirement(req({ name: ' ', kind: 'min', min: 1 }))).toContain('이름')
    expect(validateRequirement(req({ name: 'a', kind: 'min' }))).toContain('이상')
    expect(validateRequirement(req({ name: 'a', kind: 'max' }))).toContain('이하')
    expect(validateRequirement(req({ name: 'a', kind: 'range', min: 5 }))).toContain('최소와 최대')
    expect(validateRequirement(req({ name: 'a', kind: 'range', min: 9, max: 5 }))).toContain('클 수 없습니다')
    expect(validateRequirement(req({ name: 'a', kind: 'target' }))).toContain('목표값')
    expect(validateRequirement(req({ name: 'a', kind: 'target', target: 1, tolerance: -1 }))).toContain('0 이상')
    expect(validateRequirement(req({ name: 'a', kind: 'min', min: 0, at: { name: '', value: 1 } }))).toContain('적용 조건')
    expect(validateRequirement(req({ name: 'a', kind: 'range', min: 1, max: 1 }))).toBeNull()
  })
})

describe('값 판정', () => {
  it('이상·이하·범위·목표값을 경계 포함으로 판정하고 모자란 정도를 비율로 준다', () => {
    const min = req({ name: 'a', kind: 'min', min: 40 })
    expect(checkValue(min, 40)).toEqual({ ok: true, shortfall: 0 })
    expect(checkValue(min, 30)).toEqual({ ok: false, shortfall: 0.25 })
    const max = req({ name: 'a', kind: 'max', max: 200 })
    expect(checkValue(max, 200).ok).toBe(true)
    expect(checkValue(max, 220)).toEqual({ ok: false, shortfall: 0.1 })
    const range = req({ name: 'a', kind: 'range', min: 100, max: 200 })
    expect(checkValue(range, 150).ok).toBe(true)
    expect(checkValue(range, 100).ok).toBe(true)
    expect(checkValue(range, 90).ok).toBe(false)
    expect(checkValue(range, 230).shortfall).toBeCloseTo(30 / 150, 10)
    const target = req({ name: 'a', kind: 'target', target: 5, tolerance: 0.5 })
    expect(checkValue(target, 5.5).ok).toBe(true)
    expect(checkValue(target, 4.4)).toMatchObject({ ok: false })
    expect(checkValue(target, 4.4).shortfall).toBeCloseTo(0.1 / 5, 10)
  })
})

describe('실험 판정', () => {
  const rows = [
    bundle([['재령', '28', '일']], [['압축강도', '45', 'MPa']]),
    bundle([['재령', '28', '일']], [['압축강도', '35', 'MPa']]),
    bundle([['재령', '7', '일']], [['압축강도', '25', 'MPa']]),
    bundle([['재령', '28', '일']], [['압축강도', '', 'MPa']]),
    bundle([['재령', '28', '일']], [['압축강도', '—', 'MPa']]),
  ]
  const m = buildMatrix(rows)
  const strength28 = req({ name: '압축강도', kind: 'min', min: 40, at: { name: '재령', value: 28 } })

  it('항목 이름은 띄어쓰기와 대소문자를 무시하고 맞춘다', () => {
    expect(columnFor(m, ' 압축 강도 ')?.name).toBe('압축강도')
    expect(columnFor(m, '없는 항목')).toBeUndefined()
  })

  it('적용 조건에 맞는 실험만 판정하고, 비었거나 숫자가 아니면 unknown, 다른 재령은 na', () => {
    const v = m.rows.map((r) => evaluateRow(m, r, strength28).verdict)
    expect(v).toEqual(['pass', 'fail', 'na', 'unknown', 'unknown'])
    expect(evaluateRow(m, m.rows[0], strength28).value).toBe(45)
  })

  it('조건 항목에 대한 제약도 판정한다(원가 제한 같은)', () => {
    const cost = req({ name: '재령', kind: 'max', max: 14 })
    expect(m.rows.map((r) => evaluateRow(m, r, cost).verdict)).toEqual(['fail', 'fail', 'pass', 'fail', 'fail'])
  })

  it('요구별 달성 현황: 판정한 실험 수, 만족한 수, 가장 가까운 실험', () => {
    const p = progressFor(m, strength28)
    expect(p).toMatchObject({ judged: 2, passing: 1, status: 'achieved' })
    expect(p.best?.value).toBe(45)
    const hard = progressFor(m, req({ name: '압축강도', kind: 'min', min: 60, at: { name: '재령', value: 28 } }))
    expect(hard).toMatchObject({ judged: 2, passing: 0, status: 'not-yet' })
    expect(hard.best?.value).toBe(45) // 가장 가까운 값
    expect(progressFor(m, req({ name: '없는 항목', kind: 'min', min: 1 }))).toMatchObject({ judged: 0, status: 'no-data', best: null })
  })

  it('실험 한 건의 요약: 만족·미달·판정 불가 개수', () => {
    const reqs = [strength28, req({ name: '압축강도', kind: 'min', min: 20, at: { name: '재령', value: 7 } })]
    expect(rowSummary(m, m.rows[0], reqs)).toEqual({ pass: 1, fail: 0, unknown: 0, applicable: 1 })
    expect(rowSummary(m, m.rows[1], reqs)).toEqual({ pass: 0, fail: 1, unknown: 0, applicable: 1 })
    expect(rowSummary(m, m.rows[3], reqs)).toEqual({ pass: 0, fail: 0, unknown: 1, applicable: 1 })
  })
})

describe('배합 단위 판정', () => {
  // 시멘트·물이 같으면 같은 배합. 같은 배합의 7일과 28일 시험이 따로 실험으로 들어 있다.
  const A = [['시멘트', '300', 'kg/m³'], ['물', '180', 'kg/m³']] as Row[]
  const B = [['시멘트', '350', 'kg/m³'], ['물', '170', 'kg/m³']] as Row[]
  const C = [['시멘트', '400', 'kg/m³'], ['물', '160', 'kg/m³']] as Row[]
  const reqs = [
    req({ name: '압축강도', kind: 'min', min: 20, at: { name: '재령', value: 7 } }),
    req({ name: '압축강도', kind: 'min', min: 40, at: { name: '재령', value: 28 } }),
    req({ name: '시멘트', kind: 'max', max: 380, priority: 'nice' }),
  ]
  const data = [
    bundle([...A, ['재령', '7']], [['압축강도', '22']]),
    bundle([...A, ['재령', '28']], [['압축강도', '38']]), // A: 28일 미달
    bundle([...B, ['재령', '7']], [['압축강도', '24']]),
    bundle([...B, ['재령', '28']], [['압축강도', '46']]), // B: 둘 다 만족
    bundle([...C, ['재령', '28']], [['압축강도', '55']]), // C: 7일 데이터 없음, 시멘트 초과(희망)
  ]
  const m = buildMatrix(data)

  it('적용 조건(재령)을 뺀 조건이 같은 실험끼리 한 배합으로 묶는다', () => {
    const rs = recipes(m, reqs)
    expect(rs).toHaveLength(3)
    expect(rs.map((r) => r.rows.length).sort()).toEqual([1, 2, 2])
  })

  it('필수 요구를 모두 만족한 배합만 달성이고, 희망 요구는 달성 여부에 영향이 없다', () => {
    const rs = recipes(m, reqs)
    const byCement = (c: string) => rs.find((r) => r.rows[0].cells[m.columns.find((x) => x.name === '시멘트')!.key]?.value === c)!
    expect(byCement('350')).toMatchObject({ achieved: true, mustMet: 2, mustTotal: 2, distance: 0 })
    expect(byCement('300')).toMatchObject({ achieved: false, mustMet: 1 })
    expect(byCement('300').distance).toBeCloseTo(2 / 40, 10)
    // 400: 7일 값이 없어 판정 못 함(거리 1), 28일은 만족
    expect(byCement('400')).toMatchObject({ achieved: false, mustMet: 1 })
    expect(byCement('400').distance).toBe(1)
    expect(byCement('400').verdicts.find((v) => v.requirement.priority === 'nice')?.verdict).toBe('fail')
  })

  it('프로젝트 현황: 달성한 배합이 있으면 achieved, 요구별 달성도 같이 센다', () => {
    const s = projectStatus(m, reqs)
    expect(s.overall).toBe('achieved')
    expect(s.achievedRecipes).toHaveLength(1)
    expect(s.closest).toBeNull()
    expect(s.mustTotal).toBe(2)
    expect(s.mustAchieved).toBe(2)
    expect(s.items.map((i) => i.status)).toEqual(['achieved', 'achieved', 'achieved'])
  })

  it('달성한 배합이 아직 없으면 가장 가까운 배합을 알려 준다', () => {
    const strict = [reqs[0], req({ name: '압축강도', kind: 'min', min: 50, at: { name: '재령', value: 28 } })]
    const s = projectStatus(m, strict)
    expect(s.overall).toBe('in-progress')
    expect(s.achievedRecipes).toHaveLength(0)
    // 50 이상은 C(55)만 만족하지만 7일 값이 없다. 7일 20 이상을 만족하고 28일 46으로 가장 가까운 B가 앞선다.
    expect(s.closest?.mustMet).toBe(1)
    expect(s.closest).not.toBeNull()
  })

  it('필수 요구가 없으면 판정하지 않고, 값이 하나도 없으면 no-data', () => {
    expect(projectStatus(m, [reqs[2]]).overall).toBeNull()
    expect(projectStatus(m, [req({ name: '없는 항목', kind: 'min', min: 1 })]).overall).toBe('no-data')
  })
})
