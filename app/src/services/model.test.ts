import { describe, expect, it } from 'vitest'
import csv from '../data/concrete/concrete.csv?raw'
import { CONCRETE_PROJECTS, buildConcreteBackup, parseConcreteCsv } from '../data/concreteDemo'
import type { Requirement } from '../domain/types'
import { buildMatrix } from './analysis'
import { bundlesFromBackup } from './projectData'
import { checkRequirements, normalCdf, predictAll, suggest, trainModel, vectorOf } from './model'

const rows = parseConcreteCsv(csv)
const full = buildConcreteBackup(rows, 'full')
const matrixOf = (projectId: string | null) => buildMatrix(bundlesFromBackup(full, (e) => (projectId ? e.projectId === projectId : true)))
const projectOf = (key: string) => CONCRETE_PROJECTS.find((p) => p.key === key)!

describe('예측 모델 (공개 콘크리트 데이터)', () => {
  const m = matrixOf(null)
  const t0 = Date.now()
  const model = trainModel(m)
  const ms = Date.now() - t0

  it('전체 1,030건으로 압축강도 모델을 몇 초 안에 만들고 교차검증 R²가 0.8을 넘는다', () => {
    expect([...model.dataset.features.map((f) => f.name)].sort()).toEqual(['고로슬래그', '고성능 감수제', '굵은 골재', '물', '시멘트', '잔골재', '재령', '플라이애시'].sort())
    const tm = model.models.find((x) => x.target.name === '압축강도')!
    expect(tm.n).toBeGreaterThanOrEqual(1000)
    expect(tm.kind).toBe('forest')
    expect(tm.r2).toBeGreaterThan(0.8)
    expect(tm.cv.ridge).toBeLessThan(tm.r2)
    expect(tm.reliable).toBe(true)
    expect(ms).toBeLessThan(15000)
  })

  it('모델이 가장 의지하는 조건은 시멘트·재령·물 가운데 있다', () => {
    const tm = model.models[0]
    expect(['시멘트', '재령', '물']).toContain(tm.importance[0].column.name)
    expect(tm.importance.reduce((s, i) => s + i.share, 0)).toBeCloseTo(1, 6)
  })

  it('조건을 넣으면 예측값과 구간이 나오고, 재령이 길수록 강도가 높다', () => {
    const base = { 시멘트: 350, 고로슬래그: 0, 플라이애시: 0, 물: 180, '고성능 감수제': 5, '굵은 골재': 1000, 잔골재: 800 }
    const p7 = predictAll(model, vectorOf(model, { ...base, 재령: 7 }).x)[0]
    const p28 = predictAll(model, vectorOf(model, { ...base, 재령: 28 }).x)[0]
    expect(p28.mean).toBeGreaterThan(p7.mean)
    expect(p28.sd).toBeGreaterThan(0)
    expect(p28.lo).toBeLessThan(p28.mean)
    expect(p28.hi).toBeGreaterThan(p28.mean)
  })

  it('관측 범위를 벗어난 조건과 빠진 조건을 알려 준다', () => {
    const v = vectorOf(model, { 시멘트: 9999, 물: 180 })
    expect(v.outOfRange.map((c) => c.name)).toEqual(['시멘트'])
    expect(v.missing.map((c) => c.name)).toContain('재령')
  })

  it('정규 누적분포가 교과서 값과 맞는다', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6)
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3)
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3)
  })
})

describe('조건 제안 (프로젝트 단위)', () => {
  it('SM 프로젝트: 필수 요구(7일·28일 강도)를 모두 만족하는 조건을 3개 제안하고, 재령은 움직이지 않는다', () => {
    const p = projectOf('SM')
    const m = matrixOf(p.id)
    const model = trainModel(m)
    const t0 = Date.now()
    const res = suggest(model, m, p.requirements)
    expect(Date.now() - t0).toBeLessThan(15000)
    expect(res.problem).toBeNull()
    expect(res.candidates).toHaveLength(3)
    expect(res.fixed.map((f) => f.column.name)).toEqual(['재령'])
    expect(res.ranges.map((r) => r.column.name)).not.toContain('재령')
    const best = res.candidates[0]
    expect(best.allOk).toBe(true)
    expect(best.prob).toBeGreaterThan(0.7)
    // 제안 값은 탐색 범위 안
    for (const v of best.values) {
      const r = res.ranges.find((x) => x.column.key === v.column.key)!
      expect(v.value).toBeGreaterThanOrEqual(r.lo)
      expect(v.value).toBeLessThanOrEqual(r.hi)
    }
    // 필수 요구마다 예측값이 들어 있고, 가장 비슷한 과거 실험을 알려 준다
    expect(best.checks.filter((c) => c.requirement.priority === 'must')).toHaveLength(2)
    expect(best.nearest).not.toBeNull()
    // 후보끼리는 서로 다르다
    const keys = res.candidates.map((c) => c.values.map((v) => v.value).join('|'))
    expect(new Set(keys).size).toBe(3)
  })

  it('ES 프로젝트: 조건에 거는 필수 요구(고로슬래그 ≥ 120, 시멘트 ≤ 300)가 탐색 범위를 좁힌다', () => {
    const p = projectOf('ES')
    const m = matrixOf(p.id)
    const res = suggest(trainModel(m), m, p.requirements)
    expect(res.problem).toBeNull()
    for (const c of res.candidates) {
      expect(c.values.find((v) => v.column.name === '시멘트')!.value).toBeLessThanOrEqual(300)
      expect(c.values.find((v) => v.column.name === '고로슬래그')!.value).toBeGreaterThanOrEqual(120)
      const cond = c.checks.filter((k) => k.onCondition)
      expect(cond.every((k) => k.ok)).toBe(true)
    }
  })

  it('HB 프로젝트: 아무도 못 넘은 요구(28일 ≥ 80)는 확률이 낮아도 가장 가능성이 큰 조건을 알려 준다', () => {
    const p = projectOf('HB')
    const m = matrixOf(p.id)
    const res = suggest(trainModel(m), m, p.requirements)
    expect(res.problem).toBeNull()
    expect(res.candidates.length).toBeGreaterThan(0)
    const c = res.candidates[0]
    expect(c.prob).toBeGreaterThanOrEqual(0)
    expect(c.prob).toBeLessThanOrEqual(1)
    const strength = c.checks.find((k) => k.requirement.name === '압축강도' && k.requirement.at?.value === 28)!
    expect(strength.mean).toBeGreaterThan(60)
  })

  it('입력 조건의 요구 판정: 적용 조건(재령)은 요구마다 그 값으로 바꿔 넣는다', () => {
    const p = projectOf('SM')
    const m = matrixOf(p.id)
    const model = trainModel(m)
    const x = vectorOf(model, { 시멘트: 500, 물: 160, '고성능 감수제': 10, '굵은 골재': 1000, 잔골재: 750, 재령: 3 }).x
    const { checks, unmodeled } = checkRequirements(model, m, p.requirements, x)
    expect(unmodeled).toHaveLength(0)
    const r28 = checks.find((c) => c.requirement.at?.value === 28)!
    const r7 = checks.find((c) => c.requirement.at?.value === 7)!
    expect(r28.mean).toBeGreaterThan(r7.mean)
    expect(r28.ok).toBe(true)
    // 시멘트 ≤ 400(희망)은 조건 자체로 판정한다
    const cement = checks.find((c) => c.requirement.name === '시멘트')!
    expect(cement.onCondition).toBe(true)
    expect(cement.ok).toBe(false)
  })

  it('예측할 수 없는 요구는 이유와 함께 따로 알려 준다', () => {
    const p = projectOf('SM')
    const m = matrixOf(p.id)
    const model = trainModel(m)
    const reqs: Requirement[] = [
      ...p.requirements,
      { id: 'x', name: '외관', unit: '', kind: 'min', min: 1, priority: 'must' },
      { id: 'y', name: '압축강도', unit: 'MPa', kind: 'min', min: 10, at: { name: '습도', value: 50 }, priority: 'must' },
    ]
    const res = suggest(model, m, reqs)
    expect(res.unmodeled.map((u) => u.requirement.id)).toEqual(['x', 'y'])
    expect(res.candidates.length).toBeGreaterThan(0)
  })

  it('실험이 10건 미만이면 모델을 만들지 않고 이유를 남긴다', () => {
    const p = projectOf('SM')
    const bundles = bundlesFromBackup(full, (e) => e.projectId === p.id).slice(0, 8)
    const m = buildMatrix(bundles)
    const model = trainModel(m)
    expect(model.models).toHaveLength(0)
    expect(model.skipped).toHaveLength(0) // 결과 열 자체가 10건 미만이라 데이터셋에 들어오지 않는다
    const res = suggest(model, m, p.requirements)
    expect(res.candidates).toHaveLength(0)
    expect(res.problem).not.toBeNull()
  })
})
