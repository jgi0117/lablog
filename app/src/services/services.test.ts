import { describe, expect, it } from 'vitest'
import { demoDb } from '../data/demo'
import { checkGoal, describeGoal, inputsOf, levelsOf, type Project, type Run } from '../domain/types'
import { parseBackup, parseCsv, runsToCsv, splitHeader, tableToProject, tableToRuns } from './csv'
import { checkGoals, predictAll, suggest, trainModel, vectorOf } from './model'
import { designPoints, expandRuns, initialPlan, latinHypercube, levelCombos, modelPlan, nextRun, status } from './plan'
import { newId } from './store'

const demo = demoDb()
const projectOf = (key: string) => demo.projects.find((p) => p.name.includes(key))!
const runsOf = (p: Project) => demo.runs.filter((r) => r.project === p.id)

describe('예시 데이터', () => {
  it('콘크리트 1,030건이 네 프로젝트로 나뉘고 모두 완료 실험이다', () => {
    expect(demo.projects).toHaveLength(4)
    expect(demo.runs).toHaveLength(1030)
    expect(demo.runs.every((r) => r.status === 'done')).toBe(true)
    const sm = projectOf('SM-00')
    expect(inputsOf(sm).map((v) => v.name)).toEqual(['시멘트', '고로슬래그', '플라이애시', '물', '고성능 감수제', '굵은 골재', '잔골재'])
    expect(levelsOf(sm)[0].name).toBe('재령')
    expect(levelsOf(sm)[0].levels).toEqual([7, 28])
    expect(describeGoal(sm, sm.goals[0])).toBe('재령 28일일 때 압축강도 ≥ 30 MPa')
  })

  it('현황: SM은 목표 달성, HB는 진행 중이고 가장 가까운 조건을 알려 준다', () => {
    const sm = projectOf('SM-00')
    const s = status(sm, runsOf(sm))
    expect(s.overall).toBe('achieved')
    expect(s.achieved.length).toBeGreaterThan(0)
    const hb = projectOf('HB-50')
    const h = status(hb, runsOf(hb))
    expect(h.overall).toBe('in-progress')
    expect(h.closest).not.toBeNull()
    expect(h.closest!.verdicts.find((v) => v.goal.must && v.ok === false)).toBeDefined()
  })
})

describe('실험 계획', () => {
  it('라틴 하이퍼큐브는 차원마다 각 구간에 한 점씩 둔다', () => {
    let seed = 1
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const pts = latinHypercube(10, 3, rand)
    expect(pts).toHaveLength(10)
    for (let j = 0; j < 3; j++) {
      const bins = pts.map((p) => Math.floor(p[j] * 10)).sort((a, b) => a - b)
      expect(bins).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    }
  })

  it('처음 계획: 가운데 점 + 범위 안의 조건 × 측정 시점, 고정 입력은 그 값', () => {
    const p: Project = {
      id: 'p1',
      name: '필름',
      note: '',
      variables: [
        { id: 'a', name: '두께', unit: 'µm', role: 'input', min: 2, max: 6, decimals: 1 },
        { id: 'b', name: '온도', unit: '°C', role: 'input', min: 100, max: 100, decimals: 0 },
        { id: 't', name: '경과', unit: '일', role: 'level', decimals: 0, levels: [1, 7] },
        { id: 'y', name: '헤이즈', unit: '%', role: 'output', decimals: 2 },
      ],
      goals: [{ id: 'g', variable: 'y', op: '<=', hi: 1, must: true }],
      initialRuns: 5,
      created: '',
      updated: '',
    }
    const pts = designPoints(p, 5, 3)
    expect(pts).toHaveLength(5)
    expect(pts[0]).toEqual({ a: 4, b: 100 })
    for (const x of pts) {
      expect(x.a).toBeGreaterThanOrEqual(2)
      expect(x.a).toBeLessThanOrEqual(6)
      expect(x.b).toBe(100)
      expect(Number.isInteger(x.a * 10)).toBe(true)
    }
    expect(levelCombos(p)).toEqual([{ t: 1 }, { t: 7 }])
    const runs = initialPlan(p, 1, () => newId('r'))
    expect(runs).toHaveLength(10)
    expect(runs.map((r) => r.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(runs[0].x).toEqual({ a: 4, b: 100, t: 1 })
    expect(runs[1].x).toEqual({ a: 4, b: 100, t: 7 })
    expect(runs.every((r) => r.status === 'planned' && r.source === 'plan')).toBe(true)
    expect(nextRun(runs)!.order).toBe(1)
  })

  it('측정 시점 값이 비어 있으면 목표의 적용 조건에서 가져온다', () => {
    const sm = projectOf('SM-00')
    const p = { ...sm, variables: sm.variables.map((v) => (v.role === 'level' ? { ...v, levels: [] } : v)) }
    expect(levelCombos(p).map((c) => Object.values(c)[0])).toEqual([7, 28])
  })
})

describe('모델과 제안 (공개 콘크리트 데이터)', () => {
  const sm = projectOf('SM-00')
  const runs = runsOf(sm)
  const t0 = Date.now()
  const model = trainModel(sm, runs)
  const ms = Date.now() - t0

  it('SM 232건: 압축강도 교차검증 R² > 0.8, 몇 초 안에 학습', () => {
    const m = model.models[0]
    expect(m.target.name).toBe('압축강도')
    expect(m.n).toBe(232)
    expect(m.r2).toBeGreaterThan(0.8)
    expect(m.reliable).toBe(true)
    expect(ms).toBeLessThan(10000)
    // 슬래그·플라이애시는 SM에서 항상 0이라 입력에서 빠진다
    expect(model.dataset.features.map((f) => f.name)).not.toContain('고로슬래그')
    expect(model.dataset.features.map((f) => f.name)).toContain('재령')
  })

  it('재령이 길수록 강도가 높게 예측하고, 목표 판정은 재령을 요구 값으로 바꿔 넣는다', () => {
    const vid = (n: string) => sm.variables.find((v) => v.name === n)!.id
    const base = { [vid('시멘트')]: 400, [vid('물')]: 180, [vid('고성능 감수제')]: 5, [vid('굵은 골재')]: 1000, [vid('잔골재')]: 800 }
    const p7 = predictAll(model, vectorOf(model, { ...base, [vid('재령')]: 7 }).x)[0]
    const p28 = predictAll(model, vectorOf(model, { ...base, [vid('재령')]: 28 }).x)[0]
    expect(p28.mean).toBeGreaterThan(p7.mean)
    const { checks, unmodeled } = checkGoals(model, sm, vectorOf(model, { ...base, [vid('재령')]: 3 }).x)
    expect(unmodeled).toHaveLength(0)
    const g28 = checks.find((c) => c.goal.at?.value === 28)!
    const g7 = checks.find((c) => c.goal.at?.value === 7)!
    expect(g28.mean).toBeGreaterThan(g7.mean)
    expect(g28.ok).toBe(true)
    expect(checks.find((c) => c.onCondition)!.ok).toBe(true) // 시멘트 400 ≤ 400
  })

  it('제안: 필수 목표를 모두 만족할 조건 3개, 재령은 제안 값에 없다', () => {
    const res = suggest(model, sm, { n: 3 })
    expect(res.problem).toBeNull()
    expect(res.candidates).toHaveLength(3)
    expect(res.candidates[0].allOk).toBe(true)
    expect(res.candidates[0].prob).toBeGreaterThan(0.7)
    expect(res.candidates[0].values.map((v) => v.variable.name)).not.toContain('재령')
    for (const c of res.candidates) for (const v of c.values) {
      const r = res.ranges.find((x) => x.variable.id === v.variable.id)!
      expect(v.value).toBeGreaterThanOrEqual(r.lo)
      expect(v.value).toBeLessThanOrEqual(r.hi)
    }
  })

  it('모델 계획: 조건 3개 × 재령 2개 = 실험 6건, 이미 계획한 조건은 피한다', () => {
    const planned = modelPlan(sm, runs, model, 1000, () => newId('r'), 3)
    expect(planned).toHaveLength(6)
    expect(planned.map((r) => r.order)).toEqual([1000, 1001, 1002, 1003, 1004, 1005])
    const age = levelsOf(sm)[0].id
    expect(planned.map((r) => r.x[age])).toEqual([7, 28, 7, 28, 7, 28])
    expect(planned.every((r) => r.source === 'model' && r.status === 'planned')).toBe(true)
    const again = modelPlan(sm, [...runs, ...planned], model, 2000, () => newId('r'), 3)
    const key = (r: Run) => inputsOf(sm).map((v) => r.x[v.id]).join('|')
    expect(again.map(key).some((k) => planned.map(key).includes(k))).toBe(false)
  })

  it('ES: 입력에 건 필수 목표(시멘트 ≤ 300, 슬래그 ≥ 120)가 제안 범위를 좁힌다', () => {
    const es = projectOf('ES-30')
    const res = suggest(trainModel(es, runsOf(es)), es, { n: 3 })
    expect(res.problem).toBeNull()
    for (const c of res.candidates) {
      expect(c.values.find((v) => v.variable.name === '시멘트')!.value).toBeLessThanOrEqual(300)
      expect(c.values.find((v) => v.variable.name === '고로슬래그')!.value).toBeGreaterThanOrEqual(120)
    }
  })

  it('완료 실험이 8건 미만이면 모델을 만들지 않고 이유를 남긴다', () => {
    const m = trainModel(sm, runs.slice(0, 5))
    expect(m.models).toHaveLength(0)
    expect(m.skipped[0].reason).toContain('8건')
  })
})

describe('CSV와 백업', () => {
  it('머리글의 단위를 읽고, 숫자 열만 변수로 삼아 프로젝트와 완료 실험을 만든다', () => {
    expect(splitHeader('두께 (µm)')).toEqual({ name: '두께', unit: 'µm' })
    expect(splitHeader('헤이즈')).toEqual({ name: '헤이즈', unit: '' })
    const t = parseCsv('두께 (µm),온도,비고,헤이즈 (%)\n3,100,양호,0.9\n"4.5",110,,1.2\n5,120,"a,b",\n')
    expect(t.headers).toEqual(['두께 (µm)', '온도', '비고', '헤이즈 (%)'])
    expect(t.rows).toHaveLength(3)
    const { project, runs } = tableToProject('필름', t, { outputs: new Set(['헤이즈 (%)']) })
    expect(project.variables.map((v) => `${v.name}:${v.role}`)).toEqual(['두께:input', '온도:input', '헤이즈:output'])
    expect(project.variables[0]).toMatchObject({ unit: 'µm', min: 3, max: 5, decimals: 1 })
    expect(runs.map((r) => r.status)).toEqual(['done', 'done', 'planned'])
    expect(runs[1].x[project.variables[0].id]).toBe(4.5)
    const csv = runsToCsv(project, runs)
    expect(csv).toContain('두께 (µm)')
    expect(csv.split('\n')).toHaveLength(4)
    const more = tableToRuns(project, parseCsv('두께,헤이즈\n6,2\n'), 10)
    expect(more.runs).toHaveLength(1)
    expect(more.runs[0].order).toBe(10)
    expect(more.runs[0].y[project.variables[2].id]).toBe(2)
  })

  it('예전 실험 노트 백업(schemaVersion 2)을 조건·결과·요구만 옮겨 읽는다', () => {
    const legacy = {
      schemaVersion: 2,
      projects: [{ id: 'p', name: '컬러 필름', customer: '한빛', requirements: [{ name: '헤이즈', unit: '%', kind: 'max', max: 1, priority: 'must' }, { name: '두께', unit: 'µm', kind: 'range', min: 3, max: 5, priority: 'nice' }] }],
      experiments: [
        { id: 'e1', projectId: 'p', title: '#1', startedAt: '2026-01-01' },
        { id: 'e2', projectId: 'p', title: '#2', startedAt: '2026-01-02' },
      ],
      steps: [],
      dataItems: [
        { experimentId: 'e1', kind: 'condition', name: '두께', value: '3', unit: 'µm' },
        { experimentId: 'e1', kind: 'result', name: '헤이즈', value: '0.8', unit: '%' },
        { experimentId: 'e2', kind: 'condition', name: '두께', value: '5', unit: 'µm' },
        { experimentId: 'e2', kind: 'result', name: '헤이즈', value: '', unit: '%' },
      ],
    }
    const db = parseBackup(JSON.stringify(legacy))!
    expect(db.projects).toHaveLength(1)
    const p = db.projects[0]
    expect(p.variables.map((v) => `${v.name}:${v.role}`)).toEqual(['두께:input', '헤이즈:output'])
    expect(p.goals).toHaveLength(2)
    expect(p.goals[0]).toMatchObject({ op: '<=', hi: 1, must: true })
    expect(p.goals[1]).toMatchObject({ op: 'between', lo: 3, hi: 5, must: false })
    expect(db.runs.map((r) => r.status)).toEqual(['done', 'planned'])
    expect(checkGoal(p.goals[0], db.runs[0].y[p.variables[1].id]).ok).toBe(true)
    expect(parseBackup('{}')).toBeNull()
    expect(parseBackup('nope')).toBeNull()
  })

  it('실험 묶음을 측정 시점으로 펼친다', () => {
    const sm = projectOf('SM-00')
    const rs = expandRuns(sm, [{ a: 1 }], 5, 'manual', () => newId('r'))
    expect(rs).toHaveLength(2)
    expect(rs.map((r) => r.order)).toEqual([5, 6])
  })
})
