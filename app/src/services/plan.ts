import { checkGoal, inputsOf, levelsOf, type Goal, type ID, type Project, type Run } from '../domain/types'
import { makeRandom, suggest, type Model } from './model'

/**
 * 실험 순서를 앱이 정한다.
 * 1) 탐색: 입력 범위를 고르게 덮는 라틴 하이퍼큐브 설계로 처음 N개 조건을 짠다(가운데 한 점 먼저).
 * 2) 개선: 완료한 실험이 쌓여 모델이 믿을 만해지면, 목표를 만족할 확률이 높으면서 모델이 아직 모르는 조건을 3개씩 더 짠다.
 * level 변수(재령 등)가 있으면 조건 하나마다 각 level 값에서 한 번씩 잰다.
 * 사람은 계획된 실험 카드에 결과 숫자만 넣는다.
 */

const roundTo = (v: number, d: number) => Number(v.toFixed(d))

/** 0~1 라틴 하이퍼큐브 n점 × k차원 */
export function latinHypercube(n: number, k: number, rand: () => number): number[][] {
  const cols: number[][] = []
  for (let j = 0; j < k; j++) {
    const cells = Array.from({ length: n }, (_, i) => (i + rand()) / n)
    for (let i = n - 1; i > 0; i--) {
      const r = Math.floor(rand() * (i + 1))
      ;[cells[i], cells[r]] = [cells[r], cells[i]]
    }
    cols.push(cells)
  }
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i]))
}

/** 계획할 level 값 조합(없으면 빈 조합 하나) */
export function levelCombos(p: Project): Record<ID, number>[] {
  let combos: Record<ID, number>[] = [{}]
  for (const lv of levelsOf(p)) {
    const levels = lv.levels && lv.levels.length > 0 ? lv.levels : goalLevels(p, lv.id)
    if (levels.length === 0) continue
    combos = combos.flatMap((c) => levels.map((val) => ({ ...c, [lv.id]: val })))
  }
  return combos
}

/** 목표의 적용 조건에서 나온 level 값들(오름차순) */
export function goalLevels(p: Project, levelVar: ID): number[] {
  return [...new Set(p.goals.filter((g) => g.at?.variable === levelVar).map((g) => g.at!.value))].sort((a, b) => a - b)
}

/** 입력 조건 n개(가운데 점 + 라틴 하이퍼큐브). 범위가 없거나 같은 입력은 그 값으로 고정 */
export function designPoints(p: Project, n: number, seed = 1): Record<ID, number>[] {
  const inputs = inputsOf(p)
  const free = inputs.filter((v) => v.min !== undefined && v.max !== undefined && v.min < v.max)
  const fixedVal = (v: (typeof inputs)[number]) => roundTo(v.min ?? v.max ?? 0, v.decimals)
  const rand = makeRandom(seed)
  const points: Record<ID, number>[] = []
  const center: Record<ID, number> = {}
  for (const v of inputs) center[v.id] = free.includes(v) ? roundTo(((v.min as number) + (v.max as number)) / 2, v.decimals) : fixedVal(v)
  points.push(center)
  if (n > 1 && free.length > 0) {
    const cube = latinHypercube(n - 1, free.length, rand)
    for (const u of cube) {
      const x: Record<ID, number> = {}
      for (const v of inputs) {
        if (!free.includes(v)) x[v.id] = fixedVal(v)
        else {
          const j = free.indexOf(v)
          x[v.id] = roundTo((v.min as number) + u[j] * ((v.max as number) - (v.min as number)), v.decimals)
        }
      }
      points.push(x)
    }
  }
  return points
}

/** 조건 목록을 level 조합으로 펼쳐 계획 실험으로 만든다 */
export function expandRuns(p: Project, points: Record<ID, number>[], startOrder: number, source: Run['source'], newId: () => ID): Run[] {
  const combos = levelCombos(p)
  const out: Run[] = []
  let order = startOrder
  for (const x of points) {
    for (const lv of combos) {
      out.push({ id: newId(), project: p.id, order: order++, x: { ...x, ...lv }, y: {}, status: 'planned', source, note: '', date: null })
    }
  }
  return out
}

/** 처음 탐색 계획 */
export function initialPlan(p: Project, startOrder: number, newId: () => ID, seed = 1): Run[] {
  return expandRuns(p, designPoints(p, Math.max(1, p.initialRuns), seed), startOrder, 'plan', newId)
}

/** 모델이 짜는 다음 계획: 목표 만족 확률 + 탐색. 이미 계획한 조건은 피한다 */
export function modelPlan(p: Project, runs: Run[], model: Model, startOrder: number, newId: () => ID, n = 3): Run[] {
  const planned = runs.filter((r) => r.status === 'planned').map((r) => r.x)
  const res = suggest(model, p, { n, explore: 0.35, avoid: planned, seed: model.seed + runs.length })
  if (res.problem || res.candidates.length === 0) return []
  const inputs = inputsOf(p)
  const points = res.candidates.map((c) => {
    const x: Record<ID, number> = {}
    for (const v of inputs) {
      const hit = c.values.find((cv) => cv.variable.id === v.id)
      x[v.id] = hit ? hit.value : roundTo(v.min ?? 0, v.decimals)
    }
    // 데이터에서 값이 달라지지 않은 입력은 중앙값(= 고정값)으로
    for (const v of inputs) if (!(v.id in x) || !Number.isFinite(x[v.id])) x[v.id] = roundTo(v.min ?? 0, v.decimals)
    return x
  })
  return expandRuns(p, points, startOrder, 'model', newId)
}

// ---------- 현황 ----------

export interface GoalProgress {
  goal: Goal
  judged: number
  passing: number
  best: { run: Run; value: number; margin: number } | null
}

export interface Recipe {
  /** level 변수를 뺀 입력 값이 같은 완료 실험 묶음 */
  key: string
  x: Record<ID, number>
  runs: Run[]
  mustMet: number
  mustTotal: number
  /** 못 맞춘 필수 목표의 모자란 정도 합(작을수록 가깝다) */
  distance: number
  achieved: boolean
  verdicts: { goal: Goal; ok: boolean | null; value: number | null }[]
}

export interface Status {
  done: number
  planned: number
  goals: GoalProgress[]
  recipes: Recipe[]
  achieved: Recipe[]
  closest: Recipe | null
  overall: 'achieved' | 'in-progress' | 'no-data' | 'no-goal'
  /** 필수 목표를 모두 만족한 조건이 나와 실험이 끝났는가 */
  finished: boolean
}

function valueFor(p: Project, r: Run, g: Goal): number | null {
  if (g.at && r.x[g.at.variable] !== g.at.value) return null
  const v = p.variables.find((x) => x.id === g.variable)
  if (!v) return null
  const val = v.role === 'output' ? r.y[v.id] : r.x[v.id]
  return Number.isFinite(val) ? val : null
}

export function status(p: Project, runs: Run[]): Status {
  const done = runs.filter((r) => r.status === 'done')
  const planned = runs.filter((r) => r.status === 'planned')
  const goals: GoalProgress[] = p.goals.map((goal) => {
    let judged = 0
    let passing = 0
    let best: GoalProgress['best'] = null
    for (const r of done) {
      const v = valueFor(p, r, goal)
      if (v === null) continue
      judged++
      const c = checkGoal(goal, v)
      if (c.ok) passing++
      if (!best || c.margin > best.margin) best = { run: r, value: v, margin: c.margin }
    }
    return { goal, judged, passing, best }
  })
  const levelIds = new Set(levelsOf(p).map((v) => v.id))
  const keyOf = (r: Run) =>
    inputsOf(p)
      .filter((v) => !levelIds.has(v.id))
      .map((v) => `${v.id}=${r.x[v.id]}`)
      .join('|')
  const groups = new Map<string, Run[]>()
  for (const r of done) {
    const k = keyOf(r)
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  const musts = p.goals.filter((g) => g.must)
  const recipes: Recipe[] = [...groups.entries()].map(([key, rs]) => {
    const verdicts = p.goals.map((goal) => {
      let bestV: { ok: boolean; value: number; margin: number } | null = null
      for (const r of rs) {
        const v = valueFor(p, r, goal)
        if (v === null) continue
        const c = checkGoal(goal, v)
        if (!bestV || c.margin > bestV.margin) bestV = { ok: c.ok, value: v, margin: c.margin }
      }
      return { goal, ok: bestV ? bestV.ok : null, value: bestV ? bestV.value : null, margin: bestV ? bestV.margin : null }
    })
    const mv = verdicts.filter((v) => v.goal.must)
    const mustMet = mv.filter((v) => v.ok === true).length
    const distance = mv.reduce((s, v) => s + (v.ok === true ? 0 : v.ok === false ? Math.abs(v.margin ?? 1) : 1), 0)
    const x: Record<ID, number> = {}
    for (const v of inputsOf(p)) if (!levelIds.has(v.id)) x[v.id] = rs[0].x[v.id]
    return { key, x, runs: rs, mustMet, mustTotal: musts.length, distance, achieved: musts.length > 0 && mustMet === musts.length, verdicts: verdicts.map(({ goal, ok, value }) => ({ goal, ok, value })) }
  })
  const achieved = recipes.filter((r) => r.achieved)
  const closest = achieved.length > 0 || musts.length === 0 ? null : ([...recipes].sort((a, b) => b.mustMet - a.mustMet || a.distance - b.distance)[0] ?? null)
  const overall: Status['overall'] = musts.length === 0 ? 'no-goal' : achieved.length > 0 ? 'achieved' : goals.every((g) => g.judged === 0) ? 'no-data' : 'in-progress'
  return { done: done.length, planned: planned.length, goals, recipes, achieved, closest, overall, finished: overall === 'achieved' }
}

/** 다음에 할 실험: 계획 중 순서가 가장 빠른 것 */
export function nextRun(runs: Run[]): Run | null {
  return runs.filter((r) => r.status === 'planned').sort((a, b) => a.order - b.order)[0] ?? null
}
