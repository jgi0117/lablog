import { describe, expect, it } from 'vitest'
import csv from '../data/concrete/concrete.csv?raw'
import { demoDb } from '../data/demo'
import { checkGoal, describeGoal, inputsOf, levelsOf, type Goal, type Project, type Run } from '../domain/types'
import { parseBackup, parseCsv, runsToCsv, splitHeader, tableToProject, tableToRuns } from './csv'
import { checkGoals, checkPredicted, defaultParams, fromVersion, predictAll, suggest, toVersion, trainModel, trainTarget, vectorOf } from './model'
import { designPoints, expandRuns, initialPlan, latinHypercube, levelCombos, modelPlan, nextRun, status } from './plan'
import { PROJECT_PREFIX, pool } from './pool'
import { newId } from './store'

const demo = demoDb()
const projectOf = (key: string) => demo.projects.find((p) => p.name.includes(key))!
const runsOf = (p: Project) => demo.runs.filter((r) => r.project === p.id)

/** 모델 검증용: 공개 데이터 1,030건 전체를 한 프로젝트로(재령은 측정 시점) */
function fullProject(): { project: Project; runs: Run[] } {
  const t = parseCsv(csv)
  const headers = ['시멘트 (kg/m³)', '고로슬래그 (kg/m³)', '플라이애시 (kg/m³)', '물 (kg/m³)', '고성능 감수제 (kg/m³)', '굵은 골재 (kg/m³)', '잔골재 (kg/m³)', '재령 (일)', '압축강도 (MPa)']
  const { project, runs } = tableToProject('전체', { headers, rows: t.rows }, { outputs: new Set([headers[8]]), levels: new Set([headers[7]]) })
  const vid = (n: string) => project.variables.find((v) => v.name === n)!.id
  project.variables.find((v) => v.name === '재령')!.levels = [7, 28]
  project.goals = [
    { id: 'g1', variable: vid('압축강도'), op: 'target', target: 40, tol: 3, at: { variable: vid('재령'), value: 28 }, must: true },
    { id: 'g2', variable: vid('압축강도'), op: '>=', lo: 20, at: { variable: vid('재령'), value: 7 }, must: true },
    { id: 'g3', variable: vid('시멘트'), op: '<=', hi: 400, must: false },
  ]
  return { project, runs }
}

describe('목표 판정', () => {
  const g: Goal = { id: 'g', variable: 'y', op: 'target', target: 10, tol: 1, must: true }
  it('목표값 ± 허용: 안이면 만족, 가까울수록 여유가 크다. 20은 10 목표를 만족하지 않는다', () => {
    expect(checkGoal(g, 10).ok).toBe(true)
    expect(checkGoal(g, 10.9).ok).toBe(true)
    expect(checkGoal(g, 20).ok).toBe(false)
    expect(checkGoal(g, 10).margin).toBeGreaterThan(checkGoal(g, 10.9).margin)
    expect(checkGoal(g, 10.9).margin).toBeGreaterThan(checkGoal(g, 12).margin)
  })
  it('예측값의 만족 확률은 목표값 위에서 가장 크고 멀어질수록 작아진다', () => {
    expect(checkPredicted(g, 10, 1).prob).toBeGreaterThan(checkPredicted(g, 11, 1).prob)
    expect(checkPredicted(g, 11, 1).prob).toBeGreaterThan(checkPredicted(g, 15, 1).prob)
    expect(checkPredicted(g, 10, 0.01).prob).toBeCloseTo(1, 3)
  })
})

describe('예시 데이터', () => {
  it('프로젝트 12개 + 참고 4개: 아홉은 끝났고 셋은 진행 중, 공개 데이터 1,030행을 모두 쓴다', () => {
    expect(demo.projects).toHaveLength(16)
    expect(demo.projects.filter((p) => p.reference)).toHaveLength(4)
    expect(demo.runs.every((r) => r.status === 'done')).toBe(true)
    expect(demo.runs.length).toBeGreaterThan(980) // 1,030행 중 같은 배합·같은 재령 중복 38행 제외
    // 같은 배합은 한 프로젝트에만
    const keys = demo.runs.map((r) => `${r.project}|${Object.entries(r.x).filter(([k]) => !k.includes('재령')).map(([, v]) => v).join(',')}`)
    expect(new Set(keys).size).toBe(keys.length)
    const finished = demo.projects.filter((p) => status(p, runsOf(p)).finished).map((p) => p.name)
    expect(finished).toHaveLength(9)
    for (const key of ['SM-25', 'SM-35', 'SM-45', 'ES-40', 'ES-50', 'LF-35', 'LF-45', 'HB-45', 'HB-60']) {
      const p = projectOf(key)
      const s = status(p, runsOf(p))
      expect(s.overall).toBe('achieved')
      expect(s.finished).toBe(true)
      expect(s.achieved).toHaveLength(1)
      const last = runsOf(p).at(-1)!
      expect(s.achieved[0].runs.map((r) => r.id)).toContain(last.id)
    }
    for (const key of ['SM-55', 'ES-60', 'HB-70']) {
      const p = projectOf(key)
      const h = status(p, runsOf(p))
      expect(h.overall).toBe('in-progress')
      expect(runsOf(p).length).toBeGreaterThanOrEqual(10)
      expect(h.closest!.verdicts.find((v) => v.goal.must && v.ok === false)).toBeDefined()
    }
  })

  it('같은 변수를 가진 프로젝트의 실험을 모아 학습하면 실험이 적은 프로젝트의 모델이 좋아진다', () => {
    const hb = projectOf('HB-45')
    const own = trainModel(hb, runsOf(hb))
    const pd = pool(demo, hb)
    expect(pd.projects).toHaveLength(16)
    expect(pd.runs.length).toBe(demo.runs.length)
    expect(pd.extras).toHaveLength(16)
    expect(pd.fixed[`${PROJECT_PREFIX}${hb.id}`]).toBe(1)
    expect(Object.values(pd.fixed).filter((v) => v === 1)).toHaveLength(1)
    const pooled = trainModel(hb, pd.runs, { extras: pd.extras, fixed: pd.fixed, pooledProjects: pd.projects.length })
    expect(pooled.models[0].n).toBe(demo.runs.length)
    expect(pooled.models[0].r2).toBeGreaterThan(0.7)
    expect(pooled.models[0].rmse).toBeCloseTo(Math.sqrt(pooled.models[0].mse), 9)
    expect(pooled.models[0].mae).toBeLessThan(pooled.models[0].rmse)
    expect(pooled.models[0].r2).toBeGreaterThan(own.models[0]?.r2 ?? -1)
    // 제안은 이 프로젝트의 표시 변수를 1로 고정하고, 제안 값에 표시 변수가 없다
    const res = suggest(pooled, hb, { n: 2 })
    expect(res.problem).toBeNull()
    expect(res.candidates[0].values.every((v) => !v.variable.id.startsWith(PROJECT_PREFIX))).toBe(true)
    // pool을 끄면 자기 실험만
    const alone = pool(demo, { ...hb, pool: false })
    expect(alone.runs).toHaveLength(runsOf(hb).length)
    expect(alone.extras).toHaveLength(0)
  })

  it('SM-35: 입력 7개, 재령은 측정 시점(28일), 목표는 압축강도 35 ± 3', () => {
    const sm = projectOf('SM-35')
    expect(inputsOf(sm).map((v) => v.name)).toEqual(['시멘트', '고로슬래그', '플라이애시', '물', '고성능 감수제', '굵은 골재', '잔골재'])
    expect(levelsOf(sm)[0].levels).toEqual([28])
    expect(describeGoal(sm, sm.goals[0])).toBe('재령 28일일 때 압축강도 35 ± 3 MPa')
    const cement = sm.variables.find((v) => v.name === '시멘트')!.id
    expect(runsOf(sm).every((r) => r.x[cement] <= 380)).toBe(true)
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
    expect(expandRuns(p, [{ a: 1, b: 100 }], 5, 'manual', () => newId('r')).map((r) => r.order)).toEqual([5, 6])
  })

  it('측정 시점 값이 비어 있으면 목표의 적용 조건에서 가져온다', () => {
    const { project } = fullProject()
    const p = { ...project, variables: project.variables.map((v) => (v.role === 'level' ? { ...v, levels: [] } : v)) }
    expect(levelCombos(p).map((c) => Object.values(c)[0])).toEqual([7, 28])
  })
})

describe('모델과 제안 (공개 콘크리트 데이터 1,030건)', () => {
  const { project: full, runs } = fullProject()
  const t0 = Date.now()
  const model = trainModel(full, runs)
  const ms = Date.now() - t0

  it('압축강도 교차검증 R² > 0.8, 몇 초 안에 학습', () => {
    const m = model.models[0]
    expect(m.target.name).toBe('압축강도')
    expect(m.n).toBe(1030)
    expect(m.algo).toBe('forest')
    expect(m.r2).toBeGreaterThan(0.8)
    expect(m.reliable).toBe(true)
    expect(m.cv_pred).toHaveLength(1030)
    expect(ms).toBeLessThan(15000)
    expect(model.dataset.features.map((f) => f.name)).toContain('재령')
  })

  it('재령이 길수록 강도가 높게 예측하고, 목표 판정은 재령을 요구 값으로 바꿔 넣는다', () => {
    const vid = (n: string) => full.variables.find((v) => v.name === n)!.id
    const base = { [vid('시멘트')]: 350, [vid('고로슬래그')]: 0, [vid('플라이애시')]: 0, [vid('물')]: 180, [vid('고성능 감수제')]: 5, [vid('굵은 골재')]: 1000, [vid('잔골재')]: 800 }
    const p7 = predictAll(model, vectorOf(model, { ...base, [vid('재령')]: 7 }).x)[0]
    const p28 = predictAll(model, vectorOf(model, { ...base, [vid('재령')]: 28 }).x)[0]
    expect(p28.mean).toBeGreaterThan(p7.mean)
    const { checks, unmodeled } = checkGoals(model, full, vectorOf(model, { ...base, [vid('재령')]: 3 }).x)
    expect(unmodeled).toHaveLength(0)
    const g28 = checks.find((c) => c.goal.id === 'g1')!
    const g7 = checks.find((c) => c.goal.id === 'g2')!
    expect(g28.mean).toBeGreaterThan(g7.mean)
    expect(checks.find((c) => c.onCondition)!.ok).toBe(true)
  })

  it('제안: 목표값 40 ± 3에 가까운 조건 3개(재령은 제안 값에 없음), 확률이 크고 예측이 목표 근처다', () => {
    const res = suggest(model, full, { n: 3 })
    expect(res.problem).toBeNull()
    expect(res.candidates).toHaveLength(3)
    expect(res.candidates[0].allOk).toBe(true)
    expect(res.candidates[0].prob).toBeGreaterThan(0.3)
    const c28 = res.candidates[0].checks.find((c) => c.goal.id === 'g1')!
    expect(Math.abs(c28.mean - 40)).toBeLessThan(3)
    expect(res.candidates[0].values.map((v) => v.variable.name)).not.toContain('재령')
    for (const c of res.candidates)
      for (const v of c.values) {
        const r = res.ranges.find((x) => x.variable.id === v.variable.id)!
        expect(v.value).toBeGreaterThanOrEqual(r.lo)
        expect(v.value).toBeLessThanOrEqual(r.hi)
      }
  })

  it('모델 계획: 조건 3개 × 재령 2개 = 실험 6건, 이미 계획한 조건은 피한다', () => {
    const planned = modelPlan(full, runs, model, 2000, () => newId('r'), 3)
    expect(planned).toHaveLength(6)
    expect(planned.map((r) => r.order)).toEqual([2000, 2001, 2002, 2003, 2004, 2005])
    const age = levelsOf(full)[0].id
    expect(planned.map((r) => r.x[age])).toEqual([7, 28, 7, 28, 7, 28])
    expect(planned.every((r) => r.source === 'model' && r.status === 'planned')).toBe(true)
    const again = modelPlan(full, [...runs, ...planned], model, 3000, () => newId('r'), 3)
    const key = (r: Run) => inputsOf(full).map((v) => r.x[v.id]).join('|')
    expect(again.map(key).some((k) => planned.map(key).includes(k))).toBe(false)
  })

  it('예시 프로젝트(실험 20여 건)도 모델을 만들고, 입력에 건 목표가 제안 범위를 좁힌다', () => {
    const es = projectOf('ES-50')
    const m = trainModel(es, runsOf(es))
    expect(m.models).toHaveLength(1)
    const res = suggest(m, es, { n: 3 })
    if (!res.problem) {
      for (const c of res.candidates) {
        expect(c.values.find((v) => v.variable.name === '시멘트')!.value).toBeLessThanOrEqual(300)
        expect(c.values.find((v) => v.variable.name === '고로슬래그')!.value).toBeGreaterThanOrEqual(120)
      }
    }
  })

  it('완료 실험이 8건 미만이면 모델을 만들지 않고 이유를 남긴다', () => {
    const m = trainModel(full, runs.slice(0, 5))
    expect(m.models).toHaveLength(0)
    expect(m.skipped[0].reason).toContain('8건')
  })
})

describe('직접 학습과 버전', () => {
  const { project: full, runs } = fullProject()
  const base = trainModel(full, runs)
  const ds = base.dataset
  const target = ds.targets[0]

  it('알고리즘 4종을 같은 데이터로 학습하면 모두 R²가 나오고 저장할 수 있는 모양이다', () => {
    const all = ds.features.map((_, j) => j)
    for (const algo of ['forest', 'ridge', 'knn', 'gbm'] as const) {
      const tm = trainTarget(ds, target, { algo, params: defaultParams(algo), featureIdx: all, folds: 3 })
      expect('reason' in tm).toBe(false)
      if ('reason' in tm) continue
      expect(tm.r2).toBeGreaterThan(0.4)
      expect(tm.cv_pred).toHaveLength(tm.n)
      expect(JSON.parse(JSON.stringify(tm.predictor)).kind).toBe(algo)
    }
  })

  it('조건을 골라 학습하면 그 조건만 쓰고, 버전으로 저장했다가 되살리면 같은 예측을 한다', () => {
    const idx = ds.features.map((f, j) => (['시멘트', '물', '재령'].includes(f.name) ? j : -1)).filter((j) => j >= 0)
    const tm = trainTarget(ds, target, { algo: 'gbm', params: { trees: 60, depth: 3, rate: 0.1 }, featureIdx: idx, folds: 3 })
    if ('reason' in tm) throw new Error(tm.reason)
    expect(tm.featureIdx).toEqual(idx)
    expect(tm.importance.map((i) => i.variable.name).sort()).toEqual(['물', '시멘트', '재령'])
    const v = toVersion(tm, ds, { id: 'm1', group: 'g', version: 1, projects: [full.id], pooled: true })
    expect(v.features).toEqual(['시멘트', '물', '재령'])
    const back = fromVersion(ds, JSON.parse(JSON.stringify(v)))!
    expect(back.featureIdx).toEqual(idx)
    const x = ds.X[0]
    expect(predictAll({ ...base, models: [back] }, x)[0].mean).toBeCloseTo(predictAll({ ...base, models: [tm] }, x)[0].mean, 6)
    // 적용한 버전이 있으면 자동 대신 그것을 쓴다
    const m2 = trainModel(full, runs, { versions: [{ ...v, applied: true }] })
    expect(m2.models[0].versionId).toBe('m1')
    expect(m2.models[0].algo).toBe('gbm')
    // 조건 이름이 없는 데이터셋에는 되살리지 못한다
    expect(fromVersion(ds, { ...v, features: ['없는조건'] })).toBeNull()
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
    const out = runsToCsv(project, runs)
    expect(out).toContain('두께 (µm)')
    expect(out.split('\n')).toHaveLength(4)
    const more = tableToRuns(project, parseCsv('두께,헤이즈\n6,2\n'), 10)
    expect(more.runs).toHaveLength(1)
    expect(more.runs[0].order).toBe(10)
    expect(more.runs[0].y[project.variables[2].id]).toBe(2)
  })

  it('예전 실험 노트 백업(schemaVersion 2)을 조건·결과·요구만 옮겨 읽는다', () => {
    const legacy = {
      schemaVersion: 2,
      projects: [{ id: 'p', name: '컬러 필름', customer: '한빛', requirements: [{ name: '헤이즈', unit: '%', kind: 'target', target: 1, tolerance: 0.2, priority: 'must' }, { name: '두께', unit: 'µm', kind: 'range', min: 3, max: 5, priority: 'nice' }] }],
      experiments: [
        { id: 'e1', projectId: 'p', title: '#1', startedAt: '2026-01-01' },
        { id: 'e2', projectId: 'p', title: '#2', startedAt: '2026-01-02' },
      ],
      steps: [],
      dataItems: [
        { experimentId: 'e1', kind: 'condition', name: '두께', value: '3', unit: 'µm' },
        { experimentId: 'e1', kind: 'result', name: '헤이즈', value: '0.9', unit: '%' },
        { experimentId: 'e2', kind: 'condition', name: '두께', value: '5', unit: 'µm' },
        { experimentId: 'e2', kind: 'result', name: '헤이즈', value: '', unit: '%' },
      ],
    }
    const db = parseBackup(JSON.stringify(legacy))!
    expect(db.projects).toHaveLength(1)
    const p = db.projects[0]
    expect(p.variables.map((v) => `${v.name}:${v.role}`)).toEqual(['두께:input', '헤이즈:output'])
    expect(p.goals).toHaveLength(2)
    expect(p.goals[0]).toMatchObject({ op: 'target', target: 1, tol: 0.2, must: true })
    expect(p.goals[1]).toMatchObject({ op: 'between', lo: 3, hi: 5, must: false })
    expect(db.runs.map((r) => r.status)).toEqual(['done', 'planned'])
    expect(checkGoal(p.goals[0], db.runs[0].y[p.variables[1].id]).ok).toBe(true)
    expect(parseBackup('{}')).toBeNull()
    expect(parseBackup('nope')).toBeNull()
  })
})
