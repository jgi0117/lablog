import { checkGoal, inputsOf, levelsOf, outputsOf, type Goal, type ID, type Project, type Run, type Variable } from '../domain/types'

/**
 * 조건 → 결과 예측 모델과 목표를 만족할 조건 제안. 외부 라이브러리 없이 브라우저 안에서 계산한다.
 * - 결과마다 랜덤 포레스트와 능형회귀를 5겹 교차검증으로 시험해 더 잘 맞히는 쪽을 쓴다.
 * - 예측은 평균과 불확실성(교차검증 오차 ⊕ 나무들의 흩어짐)으로 돌려준다.
 * - 제안은 관측 범위 안에서 "필수 목표를 모두 만족할 확률"이 큰 조건을 찾고, 탐색 가중치를 주면 모델이 잘 모르는 곳도 섞는다.
 */

// ---------- 난수·분포 ----------

export function makeRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2)
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y)
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
function sd(v: number[]): number {
  if (v.length < 2) return 0
  const m = mean(v)
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1))
}
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

// ---------- 데이터 ----------

export const MIN_TRAIN = 8
export const MIN_R2 = 0.3

export interface Dataset {
  /** 입력 + level 변수 가운데 값이 달라지는 것 */
  features: Variable[]
  targets: Variable[]
  runs: Run[]
  X: number[][]
  Y: (number | null)[][]
  medians: number[]
  /** 관측 범위(변수의 min·max가 있으면 그것과 합친다) */
  bounds: [number, number][]
}

export function buildDataset(p: Project, runs: Run[], minN = MIN_TRAIN): Dataset {
  const done = runs.filter((r) => r.status === 'done')
  const cand = [...inputsOf(p), ...levelsOf(p)]
  const features = cand.filter((v) => {
    const vals = done.map((r) => r.x[v.id]).filter((x): x is number => Number.isFinite(x))
    return vals.length >= minN && new Set(vals).size > 1
  })
  const targets = outputsOf(p).filter((v) => {
    const vals = done.map((r) => r.y[v.id]).filter((x): x is number => Number.isFinite(x))
    return vals.length >= minN && new Set(vals).size > 1
  })
  const rows = done.filter((r) => features.some((f) => Number.isFinite(r.x[f.id])))
  const medians = features.map((f) => {
    const vals = rows.map((r) => r.x[f.id]).filter((x): x is number => Number.isFinite(x)).sort((a, b) => a - b)
    return vals.length ? quantile(vals, 0.5) : 0
  })
  const X = rows.map((r) => features.map((f, j) => (Number.isFinite(r.x[f.id]) ? r.x[f.id] : medians[j])))
  const Y = rows.map((r) => targets.map((t) => (Number.isFinite(r.y[t.id]) ? r.y[t.id] : null)))
  const bounds = features.map((f, j): [number, number] => {
    const col = X.map((r) => r[j])
    let lo = Math.min(...col)
    let hi = Math.max(...col)
    if (f.role === 'input' && f.min !== undefined && f.max !== undefined && f.min < f.max) {
      lo = Math.max(lo, f.min)
      hi = Math.min(hi, f.max)
      if (lo >= hi) {
        lo = f.min
        hi = f.max
      }
    }
    return [lo, hi]
  })
  return { features, targets, runs: rows, X, Y, medians, bounds }
}

// ---------- 랜덤 포레스트 ----------

type Node = { f: number; t: number; l: Node; r: Node } | { v: number }
interface ForestOptions {
  trees: number
  minLeaf: number
  maxThresholds: number
}
const FOREST: ForestOptions = { trees: 80, minLeaf: 2, maxThresholds: 24 }

function growTree(X: number[][], y: number[], idx: number[], mtry: number, opt: ForestOptions, rand: () => number, imp: number[]): Node {
  const n = idx.length
  let sum = 0
  for (const i of idx) sum += y[i]
  const leaf = (): Node => ({ v: sum / n })
  if (n < 2 * opt.minLeaf) return leaf()
  let same = true
  for (let k = 1; k < n && same; k++) if (y[idx[k]] !== y[idx[0]]) same = false
  if (same) return leaf()
  const p = X[0].length
  const order = Array.from({ length: p }, (_, j) => j)
  for (let j = p - 1; j > 0; j--) {
    const k = Math.floor(rand() * (j + 1))
    ;[order[j], order[k]] = [order[k], order[j]]
  }
  const base = (sum * sum) / n
  let best: { f: number; t: number; gain: number } | null = null
  for (const f of order.slice(0, mtry)) {
    const uniq = [...new Set(idx.map((i) => X[i][f]))].sort((a, b) => a - b)
    if (uniq.length < 2) continue
    const thresholds: number[] = []
    if (uniq.length - 1 <= opt.maxThresholds) {
      for (let k = 0; k + 1 < uniq.length; k++) thresholds.push((uniq[k] + uniq[k + 1]) / 2)
    } else {
      for (let k = 1; k <= opt.maxThresholds; k++) {
        const q = quantile(uniq, k / (opt.maxThresholds + 1))
        if (thresholds[thresholds.length - 1] !== q) thresholds.push(q)
      }
    }
    for (const t of thresholds) {
      let sl = 0
      let nl = 0
      for (const i of idx) {
        if (X[i][f] <= t) {
          sl += y[i]
          nl++
        }
      }
      const nr = n - nl
      if (nl < opt.minLeaf || nr < opt.minLeaf) continue
      const sr = sum - sl
      const gain = (sl * sl) / nl + (sr * sr) / nr - base
      if (!best || gain > best.gain) best = { f, t, gain }
    }
  }
  if (!best || best.gain <= 1e-12) return leaf()
  imp[best.f] += best.gain
  const li: number[] = []
  const ri: number[] = []
  for (const i of idx) (X[i][best.f] <= best.t ? li : ri).push(i)
  return { f: best.f, t: best.t, l: growTree(X, y, li, mtry, opt, rand, imp), r: growTree(X, y, ri, mtry, opt, rand, imp) }
}

function predictTree(node: Node, x: number[]): number {
  let cur = node
  while ('f' in cur) cur = x[cur.f] <= cur.t ? cur.l : cur.r
  return cur.v
}

interface Forest {
  kind: 'forest'
  trees: Node[]
  importance: number[]
}

function fitForest(X: number[][], y: number[], rand: () => number, opt = FOREST): Forest {
  const n = y.length
  const p = X[0].length
  const mtry = Math.max(1, Math.round(p / 3))
  const importance = new Array<number>(p).fill(0)
  const trees: Node[] = []
  for (let t = 0; t < opt.trees; t++) {
    const idx = Array.from({ length: n }, () => Math.floor(rand() * n))
    trees.push(growTree(X, y, idx, mtry, opt, rand, importance))
  }
  const total = importance.reduce((a, b) => a + b, 0) || 1
  return { kind: 'forest', trees, importance: importance.map((v) => v / total) }
}

function forestPredict(f: Forest, x: number[]): { mean: number; sd: number } {
  const vals = f.trees.map((t) => predictTree(t, x))
  return { mean: mean(vals), sd: sd(vals) }
}

// ---------- 능형회귀 ----------

interface Ridge {
  kind: 'ridge'
  w: number[]
  b: number
  mu: number[]
  sig: number[]
  importance: number[]
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const a = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r
    if (Math.abs(a[piv][c]) < 1e-12) return null
    ;[a[c], a[piv]] = [a[piv], a[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = a[r][c] / a[c][c]
      if (f !== 0) for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k]
    }
  }
  return a.map((row, i) => row[n] / row[i])
}

function fitRidge(X: number[][], y: number[], lambda = 1): Ridge | null {
  const p = X[0].length
  const cols = Array.from({ length: p }, (_, j) => X.map((r) => r[j]))
  const mu = cols.map(mean)
  const sig = cols.map((c) => sd(c) || 1)
  const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sig[j]))
  const ym = mean(y)
  const A = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => Z.reduce((s, r) => s + r[a] * r[b], 0) + (a === b ? lambda : 0)))
  const rhs = Array.from({ length: p }, (_, a) => Z.reduce((s, r, i) => s + r[a] * (y[i] - ym), 0))
  const w = solve(A, rhs)
  if (!w) return null
  const total = w.reduce((s, v) => s + Math.abs(v), 0) || 1
  return { kind: 'ridge', w, b: ym, mu, sig, importance: w.map((v) => Math.abs(v) / total) }
}

function ridgePredict(r: Ridge, x: number[]): number {
  let s = r.b
  for (let j = 0; j < r.w.length; j++) s += r.w[j] * ((x[j] - r.mu[j]) / r.sig[j])
  return s
}

// ---------- 결과별 모델 ----------

export type ModelKind = 'forest' | 'ridge'
export const KIND_LABEL: Record<ModelKind, string> = { forest: '랜덤 포레스트', ridge: '선형 회귀' }

export interface TargetModel {
  target: Variable
  n: number
  kind: ModelKind
  /** 5겹 교차검증 R² */
  r2: number
  residSd: number
  mae: number
  ysd: number
  cv: Record<ModelKind, number | null>
  importance: { variable: Variable; share: number }[]
  reliable: boolean
  predictor: Forest | Ridge
}

export interface Model {
  dataset: Dataset
  models: TargetModel[]
  skipped: { target: Variable; reason: string }[]
  seed: number
}

function r2Of(y: number[], pred: number[]): number {
  const m = mean(y)
  let sse = 0
  let sst = 0
  for (let i = 0; i < y.length; i++) {
    sse += (y[i] - pred[i]) ** 2
    sst += (y[i] - m) ** 2
  }
  return sst === 0 ? 0 : 1 - sse / sst
}

function crossValidate(X: number[][], y: number[], kind: ModelKind, folds: number, seed: number): number[] | null {
  const n = y.length
  const rand = makeRandom(seed)
  const order = Array.from({ length: n }, (_, i) => i)
  for (let j = n - 1; j > 0; j--) {
    const k = Math.floor(rand() * (j + 1))
    ;[order[j], order[k]] = [order[k], order[j]]
  }
  const pred = new Array<number>(n).fill(0)
  const k = Math.min(folds, n)
  for (let f = 0; f < k; f++) {
    const test = new Set(order.filter((_, i) => i % k === f))
    const tr = order.filter((i) => !test.has(i))
    const Xt = tr.map((i) => X[i])
    const yt = tr.map((i) => y[i])
    if (kind === 'forest') {
      const m = fitForest(Xt, yt, makeRandom(seed + f + 1), { ...FOREST, trees: 50 })
      for (const i of test) pred[i] = forestPredict(m, X[i]).mean
    } else {
      const m = fitRidge(Xt, yt)
      if (!m) return null
      for (const i of test) pred[i] = ridgePredict(m, X[i])
    }
  }
  return pred
}

export function trainModel(p: Project, runs: Run[], opts: { seed?: number; folds?: number } = {}): Model {
  const seed = opts.seed ?? 7
  const folds = opts.folds ?? 5
  const dataset = buildDataset(p, runs)
  const models: TargetModel[] = []
  const skipped: Model['skipped'] = []
  const doneCount = runs.filter((r) => r.status === 'done').length
  if (dataset.features.length === 0) {
    for (const t of outputsOf(p)) skipped.push({ target: t, reason: doneCount < MIN_TRAIN ? `완료한 실험이 ${doneCount}건입니다. ${MIN_TRAIN}건부터 모델을 만듭니다` : '값이 달라지는 입력 조건이 없습니다' })
    return { dataset, models, skipped, seed }
  }
  for (const t of outputsOf(p)) {
    const ti = dataset.targets.findIndex((x) => x.id === t.id)
    if (ti < 0) {
      const have = runs.filter((r) => r.status === 'done' && Number.isFinite(r.y[t.id])).length
      skipped.push({ target: t, reason: have < MIN_TRAIN ? `값이 있는 실험이 ${have}건입니다. ${MIN_TRAIN}건부터 모델을 만듭니다` : '값이 모두 같아 모델을 만들 수 없습니다' })
      continue
    }
    const idx = dataset.runs.map((_, i) => i).filter((i) => dataset.Y[i][ti] !== null)
    const X = idx.map((i) => dataset.X[i])
    const y = idx.map((i) => dataset.Y[i][ti] as number)
    const cv: Record<ModelKind, number | null> = { forest: null, ridge: null }
    const preds: Partial<Record<ModelKind, number[]>> = {}
    for (const kind of ['forest', 'ridge'] as ModelKind[]) {
      const pr = crossValidate(X, y, kind, folds, seed)
      if (pr) {
        preds[kind] = pr
        cv[kind] = r2Of(y, pr)
      }
    }
    const kind: ModelKind = (cv.ridge ?? -Infinity) > (cv.forest ?? -Infinity) ? 'ridge' : 'forest'
    const pred = preds[kind]
    const predictor = pred ? (kind === 'forest' ? fitForest(X, y, makeRandom(seed)) : fitRidge(X, y)) : null
    if (!pred || !predictor) {
      skipped.push({ target: t, reason: '조건끼리 같은 정보라서 모델을 풀 수 없습니다' })
      continue
    }
    const resid = y.map((v, i) => v - pred[i])
    const r2 = cv[kind] ?? 0
    models.push({
      target: t,
      n: idx.length,
      kind,
      r2,
      residSd: Math.sqrt(resid.reduce((s, v) => s + v * v, 0) / resid.length),
      mae: mean(resid.map(Math.abs)),
      ysd: sd(y),
      cv,
      importance: dataset.features.map((variable, j) => ({ variable, share: predictor.importance[j] })).sort((a, b) => b.share - a.share),
      reliable: r2 >= MIN_R2,
      predictor,
    })
  }
  return { dataset, models, skipped, seed }
}

export function describeFit(r2: number): string {
  if (r2 >= 0.8) return '잘 맞힘'
  if (r2 >= 0.6) return '경향은 맞힘'
  if (r2 >= MIN_R2) return '방향만 참고'
  return '믿기 어려움'
}

// ---------- 예측 ----------

export interface Prediction {
  model: TargetModel
  mean: number
  sd: number
  lo: number
  hi: number
}

export function predictOne(tm: TargetModel, x: number[]): { mean: number; sd: number; epistemic: number } {
  if (tm.predictor.kind === 'forest') {
    const p = forestPredict(tm.predictor, x)
    return { mean: p.mean, sd: Math.sqrt(tm.residSd ** 2 + p.sd ** 2), epistemic: p.sd }
  }
  return { mean: ridgePredict(tm.predictor, x), sd: tm.residSd, epistemic: 0 }
}

/** 변수 id → 값을 입력 벡터로. 빠진 값은 중앙값. 범위 밖 변수도 알려 준다 */
export function vectorOf(model: Model, values: Record<ID, number | null | undefined>): { x: number[]; outOfRange: Variable[]; missing: Variable[] } {
  const { features, medians, bounds } = model.dataset
  const outOfRange: Variable[] = []
  const missing: Variable[] = []
  const x = features.map((f, j) => {
    const v = values[f.id]
    if (v === null || v === undefined || !Number.isFinite(v)) {
      missing.push(f)
      return medians[j]
    }
    if (v < bounds[j][0] - 1e-9 || v > bounds[j][1] + 1e-9) outOfRange.push(f)
    return v
  })
  return { x, outOfRange, missing }
}

export function predictAll(model: Model, x: number[]): Prediction[] {
  return model.models
    .filter((tm) => tm.reliable)
    .map((tm) => {
      const p = predictOne(tm, x)
      return { model: tm, mean: p.mean, sd: p.sd, lo: p.mean - 1.96 * p.sd, hi: p.mean + 1.96 * p.sd }
    })
}

// ---------- 목표 판정(예측값으로) ----------

export function checkPredicted(g: Goal, mu: number, sigma: number): { ok: boolean; prob: number; margin: number } {
  let margin = 0
  if (g.op === '>=') margin = mu - (g.lo ?? 0)
  else if (g.op === '<=') margin = (g.hi ?? 0) - mu
  else margin = Math.min(mu - (g.lo ?? 0), (g.hi ?? 0) - mu)
  const s = Math.max(sigma, 1e-9)
  return { ok: margin >= 0, prob: normalCdf(margin / s), margin }
}

export interface GoalCheck {
  goal: Goal
  /** 입력 조건에 거는 목표는 값 그대로 판정한다 */
  onCondition: boolean
  mean: number
  sd: number
  epistemic: number
  prob: number
  ok: boolean
}

interface Binding {
  goal: Goal
  model: TargetModel | null
  featureIndex: number | null
  at: { index: number; value: number } | null
  reason: string | null
}

function bind(model: Model, p: Project, g: Goal): Binding {
  const { features } = model.dataset
  const fi = (id: ID) => features.findIndex((f) => f.id === id)
  let at: Binding['at'] = null
  if (g.at) {
    const i = fi(g.at.variable)
    if (i < 0) {
      // level 변수가 데이터에서 한 값뿐이면(예: 모두 28일) 그 값과 같을 때만 판정할 수 있다
      const lv = p.variables.find((v) => v.id === g.at!.variable)
      const vals = new Set(model.dataset.runs.map((r) => r.x[g.at!.variable]))
      if (!(vals.size === 1 && vals.has(g.at.value))) return { goal: g, model: null, featureIndex: null, at: null, reason: `"${lv?.name ?? ''}" 값이 ${g.at.value}인 실험이 없어 예측하지 않습니다` }
    } else at = { index: i, value: g.at.value }
  }
  const v = p.variables.find((x) => x.id === g.variable)
  if (!v) return { goal: g, model: null, featureIndex: null, at, reason: '목표의 변수를 찾을 수 없습니다' }
  if (v.role === 'output') {
    const tm = model.models.find((m) => m.target.id === v.id)
    if (!tm) {
      const sk = model.skipped.find((s) => s.target.id === v.id)
      return { goal: g, model: null, featureIndex: null, at, reason: sk?.reason ?? '모델이 없습니다' }
    }
    if (!tm.reliable) return { goal: g, model: null, featureIndex: null, at, reason: `"${v.name}" 모델의 교차검증 R²가 ${tm.r2.toFixed(2)}로 낮아 예측을 믿기 어렵습니다` }
    return { goal: g, model: tm, featureIndex: null, at, reason: null }
  }
  const j = fi(v.id)
  if (j >= 0) return { goal: g, model: null, featureIndex: j, at, reason: null }
  return { goal: g, model: null, featureIndex: null, at, reason: `"${v.name}"은(는) 값이 달라지지 않아 판정하지 않습니다` }
}

function evaluate(b: Binding, x: number[]): GoalCheck {
  if (b.featureIndex !== null) {
    const v = x[b.featureIndex]
    const c = checkGoal(b.goal, v)
    return { goal: b.goal, onCondition: true, mean: v, sd: 0, epistemic: 0, prob: c.ok ? 1 : 0, ok: c.ok }
  }
  const tm = b.model as TargetModel
  const xi = b.at ? x.map((v, j) => (j === b.at!.index ? b.at!.value : v)) : x
  const p = predictOne(tm, xi)
  const c = checkPredicted(b.goal, p.mean, p.sd)
  return { goal: b.goal, onCondition: false, mean: p.mean, sd: p.sd, epistemic: p.epistemic, prob: c.prob, ok: c.ok }
}

export interface Unmodeled {
  goal: Goal
  reason: string
}

export function checkGoals(model: Model, p: Project, x: number[]): { checks: GoalCheck[]; unmodeled: Unmodeled[] } {
  const checks: GoalCheck[] = []
  const unmodeled: Unmodeled[] = []
  for (const g of p.goals) {
    const b = bind(model, p, g)
    if (b.reason) unmodeled.push({ goal: g, reason: b.reason })
    else checks.push(evaluate(b, x))
  }
  return { checks, unmodeled }
}

// ---------- 조건 제안 ----------

export interface Suggestion {
  /** 제안 조건(level 변수와 고정 변수는 뺀다) */
  values: { variable: Variable; value: number }[]
  checks: GoalCheck[]
  /** 필수 목표를 모두 만족할 확률 */
  prob: number
  allOk: boolean
  nearest: { run: Run; distance: number } | null
  known: boolean
  /** 모델이 이 조건을 얼마나 모르는지(0~1 정도, 결과 표준편차 대비) */
  novelty: number
}

export interface SuggestResult {
  candidates: Suggestion[]
  unmodeled: Unmodeled[]
  ranges: { variable: Variable; lo: number; hi: number }[]
  problem: string | null
}

export interface SuggestOptions {
  n?: number
  samples?: number
  seed?: number
  /** 탐색 가중치. 0이면 확률만 보고, 클수록 모델이 모르는 곳을 섞는다 */
  explore?: number
  /** 이미 계획해 둔 조건(피한다) */
  avoid?: Record<ID, number>[]
  fixed?: Record<ID, number>
}

const round = (v: number, d: number) => Number(v.toFixed(d))

export function suggest(model: Model, p: Project, opts: SuggestOptions = {}): SuggestResult {
  const n = opts.n ?? 3
  const samples = opts.samples ?? 1500
  const explore = opts.explore ?? 0
  const rand = makeRandom(opts.seed ?? model.seed + 11)
  const { features, bounds, X, runs } = model.dataset
  const bindings = p.goals.map((g) => bind(model, p, g))
  const unmodeled = bindings.filter((b) => b.reason).map((b) => ({ goal: b.goal, reason: b.reason as string }))
  const active = bindings.filter((b) => !b.reason)
  const musts = active.filter((b) => b.goal.must)
  const empty = (problem: string | null): SuggestResult => ({ candidates: [], unmodeled, ranges: [], problem })
  if (features.length === 0) return empty('값이 달라지는 입력 조건이 없어 제안할 수 없습니다')
  if (musts.filter((b) => b.model).length === 0) return empty('예측할 수 있는 필수 목표(출력)가 없어 제안할 수 없습니다')

  const fixedIdx = new Map<number, number | null>()
  for (const b of active) if (b.at) fixedIdx.set(b.at.index, null)
  features.forEach((f, j) => {
    if (f.role === 'level') fixedIdx.set(j, null)
    const v = opts.fixed?.[f.id]
    if (v !== undefined && Number.isFinite(v)) fixedIdx.set(j, v)
  })
  const lo = bounds.map((b) => b[0])
  const hi = bounds.map((b) => b[1])
  for (const b of active) {
    if (b.featureIndex === null || !b.goal.must) continue
    const g = b.goal
    const j = b.featureIndex
    if (g.op === '>=' || g.op === 'between') lo[j] = Math.max(lo[j], g.lo ?? lo[j])
    if (g.op === '<=' || g.op === 'between') hi[j] = Math.min(hi[j], g.hi ?? hi[j])
  }
  const free = features.map((_, j) => j).filter((j) => !fixedIdx.has(j))
  for (const j of free) if (lo[j] > hi[j]) return empty(`"${features[j].name}"의 목표 범위가 지금까지 실험한 범위와 겹치지 않습니다`)
  if (free.length === 0) return empty('움직일 수 있는 조건이 없습니다')
  const span = features.map((_, j) => Math.max(hi[j] - lo[j], 1e-9))
  const decimals = features.map((f) => f.decimals ?? 2)
  const base = features.map((_, j) => {
    const fv = fixedIdx.get(j)
    return fv === null || fv === undefined ? model.dataset.medians[j] : fv
  })
  const known = X.map((row) => row.map((v, j) => (free.includes(j) ? v : base[j])))
  const avoid = (opts.avoid ?? []).map((a) => features.map((f, j) => (free.includes(j) && Number.isFinite(a[f.id]) ? a[f.id] : base[j])))
  const dist = (a: number[], b: number[]) => {
    let s = 0
    for (const j of free) s += ((a[j] - b[j]) / span[j]) ** 2
    return Math.sqrt(s / free.length)
  }
  const nearestOf = (x: number[]) => {
    let bi = -1
    let bd = Infinity
    for (let i = 0; i < known.length; i++) {
      const d = dist(x, known[i])
      if (d < bd) {
        bd = d
        bi = i
      }
    }
    return bi < 0 ? null : { run: runs[bi], distance: bd }
  }
  const clip = (x: number[]) => {
    for (const j of free) x[j] = round(Math.min(hi[j], Math.max(lo[j], x[j])), decimals[j])
    return x
  }
  const ysdOf = (b: Binding) => (b.model ? b.model.ysd || 1 : 1)
  const score = (x: number[]) => {
    let s = 0
    let nov = 0
    for (const b of active) {
      const c = evaluate(b, x)
      const lp = Math.log(Math.max(c.prob, 1e-6))
      s += b.goal.must ? lp : 0.2 * lp
      if (b.model) nov = Math.max(nov, c.epistemic / ysdOf(b))
    }
    const nr = nearestOf(x)
    const d = nr ? nr.distance : 0
    let avoidPen = 0
    for (const a of avoid) avoidPen += Math.max(0, 0.15 - dist(x, a)) * 20
    return s - (explore > 0 ? 0 : 0.5 * d) + explore * (3 * nov + d) - avoidPen
  }

  const pool: number[][] = []
  const seen = new Set<string>()
  const push = (x: number[]) => {
    const key = free.map((j) => x[j]).join('|')
    if (seen.has(key)) return
    seen.add(key)
    pool.push(x)
  }
  for (const k of known) if (free.every((j) => k[j] >= lo[j] - 1e-9 && k[j] <= hi[j] + 1e-9)) push(clip([...k]))
  for (let i = 0; i < samples; i++) {
    const x = [...base]
    for (const j of free) x[j] = lo[j] + rand() * (hi[j] - lo[j])
    push(clip(x))
  }
  let scored = pool.map((x) => ({ x, s: score(x) })).sort((a, b) => b.s - a.s)
  const top = scored.slice(0, 15)
  for (const c of top) {
    let step = 0.08
    for (let r = 0; r < 30; r++) {
      const x = [...c.x]
      for (const j of free) x[j] += gaussian(rand) * step * span[j]
      clip(x)
      const s = score(x)
      if (s > c.s) {
        c.x = x
        c.s = s
      }
      step *= 0.94
    }
  }
  scored = [...top, ...scored.slice(15)].sort((a, b) => b.s - a.s)
  const picked: typeof scored = []
  for (const minD of [0.12, 0.05, 0]) {
    for (const c of scored) {
      if (picked.length >= n) break
      if (picked.every((q) => dist(q.x, c.x) >= minD)) picked.push(c)
    }
    if (picked.length >= n) break
  }
  const candidates: Suggestion[] = picked.map(({ x }) => {
    const checks = active.map((b) => evaluate(b, x))
    const mustChecks = checks.filter((c) => c.goal.must)
    const nearest = nearestOf(x)
    let nov = 0
    active.forEach((b, i) => {
      if (b.model) nov = Math.max(nov, checks[i].epistemic / ysdOf(b))
    })
    return {
      values: free.map((j) => ({ variable: features[j], value: x[j] })),
      checks,
      prob: mustChecks.reduce((s, c) => s * c.prob, 1),
      allOk: mustChecks.every((c) => c.ok),
      nearest,
      known: nearest !== null && nearest.distance < 0.02,
      novelty: nov,
    }
  })
  return { candidates, unmodeled, ranges: free.map((j) => ({ variable: features[j], lo: lo[j], hi: hi[j] })), problem: null }
}
