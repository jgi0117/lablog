import { checkGoal, inputsOf, levelsOf, outputsOf, type Goal, type ID, type ModelVersion, type Project, type Run, type Variable } from '../domain/types'

/**
 * 조건 → 결과 예측 모델과 목표를 만족할 조건 제안. 외부 라이브러리 없이 브라우저 안에서 계산한다.
 * - 알고리즘 4종(랜덤 포레스트, 선형(능형) 회귀, k-최근접, 그래디언트 부스팅)과 파라미터를 골라 직접 학습할 수 있다.
 * - 학습한 모델은 함수 없이 숫자·배열만으로 되어 있어 그대로 저장(버전)하고 다시 불러 쓴다.
 * - 아무것도 고르지 않으면 "자동"(포레스트 vs 선형을 교차검증으로 고름)으로 학습한다.
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
  /** 입력 + level 변수(+ 프로젝트 표시 변수) 가운데 값이 달라지는 것 */
  features: Variable[]
  targets: Variable[]
  runs: Run[]
  X: number[][]
  Y: (number | null)[][]
  medians: number[]
  bounds: [number, number][]
}

export function buildDataset(p: Project, runs: Run[], minN = MIN_TRAIN, extras: Variable[] = []): Dataset {
  const done = runs.filter((r) => r.status === 'done')
  const cand = [...inputsOf(p), ...levelsOf(p), ...extras]
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

// ---------- 알고리즘 ----------

export type Algo = 'forest' | 'ridge' | 'knn' | 'gbm'

export interface Params {
  trees?: number
  minLeaf?: number
  maxDepth?: number
  lambda?: number
  k?: number
  depth?: number
  rate?: number
}

export interface ParamSpec {
  key: keyof Params
  label: string
  def: number
  min: number
  max: number
  step: number
}

export const ALGOS: Record<Algo, { label: string; short: string; params: ParamSpec[]; note: string }> = {
  forest: {
    label: '랜덤 포레스트',
    short: 'RF',
    params: [
      { key: 'trees', label: '나무 수', def: 80, min: 10, max: 500, step: 10 },
      { key: 'minLeaf', label: '잎 최소 실험 수', def: 2, min: 1, max: 20, step: 1 },
      { key: 'maxDepth', label: '최대 깊이 (0 = 제한 없음)', def: 0, min: 0, max: 30, step: 1 },
    ],
    note: '곡선·상호작용에 강함. 범위 밖은 평평. 불확실성 = 나무들의 흩어짐',
  },
  ridge: {
    label: '선형(능형) 회귀',
    short: '선형',
    params: [{ key: 'lambda', label: '규제 λ', def: 1, min: 0, max: 100, step: 0.5 }],
    note: '실험이 적을 때 안정적. 직선 관계만. 계수로 설명 쉬움',
  },
  knn: {
    label: 'k-최근접 이웃',
    short: 'kNN',
    params: [{ key: 'k', label: '이웃 수 k', def: 5, min: 1, max: 30, step: 1 }],
    note: '비슷한 과거 실험의 평균. 설명 직관적. 조건 수가 많으면 약해짐',
  },
  gbm: {
    label: '그래디언트 부스팅',
    short: 'GBM',
    params: [
      { key: 'trees', label: '나무 수', def: 150, min: 10, max: 1000, step: 10 },
      { key: 'depth', label: '나무 깊이', def: 3, min: 1, max: 8, step: 1 },
      { key: 'rate', label: '학습률', def: 0.1, min: 0.01, max: 1, step: 0.01 },
    ],
    note: '정확도 높은 편. 과적합 주의(교차검증 R²로 확인)',
  },
}

export function defaultParams(algo: Algo): Params {
  return Object.fromEntries(ALGOS[algo].params.map((s) => [s.key, s.def])) as Params
}

export const KIND_LABEL: Record<Algo, string> = { forest: '랜덤 포레스트', ridge: '선형 회귀', knn: 'k-최근접', gbm: '부스팅' }

type Node = { f: number; t: number; l: Node; r: Node } | { v: number }

interface TreeOpt {
  minLeaf: number
  maxDepth: number
  maxThresholds: number
  mtry: number
}

function growTree(X: number[][], y: number[], idx: number[], depth: number, opt: TreeOpt, rand: () => number, imp: number[]): Node {
  const n = idx.length
  let sum = 0
  for (const i of idx) sum += y[i]
  const leaf = (): Node => ({ v: sum / n })
  if (n < 2 * opt.minLeaf || (opt.maxDepth > 0 && depth >= opt.maxDepth)) return leaf()
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
  for (const f of order.slice(0, opt.mtry)) {
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
  return { f: best.f, t: best.t, l: growTree(X, y, li, depth + 1, opt, rand, imp), r: growTree(X, y, ri, depth + 1, opt, rand, imp) }
}

function predictTree(node: Node, x: number[]): number {
  let cur = node
  while ('f' in cur) cur = x[cur.f] <= cur.t ? cur.l : cur.r
  return cur.v
}

/** 학습한 모델. 함수 없이 숫자만이라 JSON으로 저장할 수 있다 */
export type Predictor =
  | { kind: 'forest'; trees: Node[]; importance: number[] }
  | { kind: 'ridge'; w: number[]; b: number; mu: number[]; sig: number[]; importance: number[] }
  | { kind: 'knn'; X: number[][]; y: number[]; mu: number[]; sig: number[]; k: number; importance: number[] }
  | { kind: 'gbm'; base: number; rate: number; trees: Node[]; importance: number[] }

function normalize(imp: number[]): number[] {
  const total = imp.reduce((a, b) => a + b, 0) || 1
  return imp.map((v) => v / total)
}

function fitForest(X: number[][], y: number[], prm: Params, rand: () => number): Predictor {
  const n = y.length
  const p = X[0].length
  const opt: TreeOpt = { minLeaf: prm.minLeaf ?? 2, maxDepth: prm.maxDepth ?? 0, maxThresholds: 24, mtry: Math.max(1, Math.round(p / 3)) }
  const importance = new Array<number>(p).fill(0)
  const trees: Node[] = []
  for (let t = 0; t < (prm.trees ?? 80); t++) {
    const idx = Array.from({ length: n }, () => Math.floor(rand() * n))
    trees.push(growTree(X, y, idx, 0, opt, rand, importance))
  }
  return { kind: 'forest', trees, importance: normalize(importance) }
}

function fitGbm(X: number[][], y: number[], prm: Params, rand: () => number): Predictor {
  const n = y.length
  const p = X[0].length
  const base = mean(y)
  const rate = prm.rate ?? 0.1
  const opt: TreeOpt = { minLeaf: 3, maxDepth: prm.depth ?? 3, maxThresholds: 24, mtry: p }
  const importance = new Array<number>(p).fill(0)
  const trees: Node[] = []
  const pred = new Array<number>(n).fill(base)
  const all = Array.from({ length: n }, (_, i) => i)
  for (let t = 0; t < (prm.trees ?? 150); t++) {
    const resid = y.map((v, i) => v - pred[i])
    const tree = growTree(X, resid, all, 0, opt, rand, importance)
    trees.push(tree)
    for (let i = 0; i < n; i++) pred[i] += rate * predictTree(tree, X[i])
  }
  return { kind: 'gbm', base, rate, trees, importance: normalize(importance) }
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

function standardizer(X: number[][]): { mu: number[]; sig: number[] } {
  const p = X[0].length
  const cols = Array.from({ length: p }, (_, j) => X.map((r) => r[j]))
  return { mu: cols.map(mean), sig: cols.map((c) => sd(c) || 1) }
}

function fitRidge(X: number[][], y: number[], prm: Params): Predictor | null {
  const p = X[0].length
  const { mu, sig } = standardizer(X)
  const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sig[j]))
  const ym = mean(y)
  const lambda = prm.lambda ?? 1
  const A = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => Z.reduce((s, r) => s + r[a] * r[b], 0) + (a === b ? lambda + 1e-9 : 0)))
  const rhs = Array.from({ length: p }, (_, a) => Z.reduce((s, r, i) => s + r[a] * (y[i] - ym), 0))
  const w = solve(A, rhs)
  if (!w) return null
  return { kind: 'ridge', w, b: ym, mu, sig, importance: normalize(w.map(Math.abs)) }
}

function fitKnn(X: number[][], y: number[], prm: Params): Predictor {
  const { mu, sig } = standardizer(X)
  return { kind: 'knn', X: X.map((r) => [...r]), y: [...y], mu, sig, k: Math.max(1, Math.min(prm.k ?? 5, y.length)), importance: new Array<number>(X[0].length).fill(0) }
}

export function fitAlgo(algo: Algo, prm: Params, X: number[][], y: number[], rand: () => number): Predictor | null {
  if (algo === 'forest') return fitForest(X, y, prm, rand)
  if (algo === 'gbm') return fitGbm(X, y, prm, rand)
  if (algo === 'knn') return fitKnn(X, y, prm)
  return fitRidge(X, y, prm)
}

/** 예측 평균과 모델 내부의 흔들림(epistemic). 선형·부스팅은 흔들림을 모른다(0) */
export function predictWith(m: Predictor, x: number[]): { mean: number; epistemic: number } {
  if (m.kind === 'forest') {
    const vals = m.trees.map((t) => predictTree(t, x))
    return { mean: mean(vals), epistemic: sd(vals) }
  }
  if (m.kind === 'gbm') {
    let s = m.base
    for (const t of m.trees) s += m.rate * predictTree(t, x)
    return { mean: s, epistemic: 0 }
  }
  if (m.kind === 'knn') {
    const z = x.map((v, j) => (v - m.mu[j]) / m.sig[j])
    const d = m.X.map((row, i) => ({ i, d: row.reduce((s, v, j) => s + ((v - m.mu[j]) / m.sig[j] - z[j]) ** 2, 0) }))
    d.sort((a, b) => a.d - b.d)
    const ys = d.slice(0, m.k).map((q) => m.y[q.i])
    return { mean: mean(ys), epistemic: sd(ys) }
  }
  let s = m.b
  for (let j = 0; j < m.w.length; j++) s += m.w[j] * ((x[j] - m.mu[j]) / m.sig[j])
  return { mean: s, epistemic: 0 }
}

// ---------- 결과별 모델 ----------

export interface TargetModel {
  target: Variable
  /** 이 모델이 쓰는 조건: dataset.features의 번호 */
  featureIdx: number[]
  n: number
  algo: Algo
  params: Params
  folds: number
  r2: number
  residSd: number
  mae: number
  /** 교차검증 RMSE·MSE */
  rmse: number
  mse: number
  ysd: number
  importance: { variable: Variable; share: number }[]
  reliable: boolean
  predictor: Predictor
  cv_pred: number[]
  cv_actual: number[]
  /** 저장한 버전이면 그 id, 자동이면 null */
  versionId: string | null
  /** 자동일 때 함께 시험한 다른 알고리즘의 교차검증 R² */
  cv: Partial<Record<Algo, number>>
}

export interface Model {
  dataset: Dataset
  models: TargetModel[]
  skipped: { target: Variable; reason: string }[]
  seed: number
  fixed: Record<ID, number>
  pooledProjects: number
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

function crossValidate(X: number[][], y: number[], algo: Algo, prm: Params, folds: number, seed: number): number[] | null {
  const n = y.length
  const rand = makeRandom(seed)
  const order = Array.from({ length: n }, (_, i) => i)
  for (let j = n - 1; j > 0; j--) {
    const k = Math.floor(rand() * (j + 1))
    ;[order[j], order[k]] = [order[k], order[j]]
  }
  const pred = new Array<number>(n).fill(0)
  const k = Math.max(2, Math.min(folds, n))
  const cvPrm: Params = algo === 'forest' ? { ...prm, trees: Math.min(prm.trees ?? 80, 50) } : prm
  for (let f = 0; f < k; f++) {
    const test = new Set(order.filter((_, i) => i % k === f))
    const tr = order.filter((i) => !test.has(i))
    const m = fitAlgo(algo, cvPrm, tr.map((i) => X[i]), tr.map((i) => y[i]), makeRandom(seed + f + 1))
    if (!m) return null
    for (const i of test) pred[i] = predictWith(m, X[i]).mean
  }
  return pred
}

export interface TrainSpec {
  algo: Algo
  params: Params
  featureIdx: number[]
  folds: number
  seed?: number
}

/** 결과 하나를 지정한 알고리즘·조건으로 학습(교차검증 포함). 실패하면 이유 */
export function trainTarget(dataset: Dataset, target: Variable, spec: TrainSpec): TargetModel | { reason: string } {
  const ti = dataset.targets.findIndex((x) => x.id === target.id)
  if (ti < 0) return { reason: `값이 있는 실험이 ${MIN_TRAIN}건은 있어야 합니다` }
  if (spec.featureIdx.length === 0) return { reason: '조건을 하나는 골라야 합니다' }
  const seed = spec.seed ?? 7
  const idx = dataset.runs.map((_, i) => i).filter((i) => dataset.Y[i][ti] !== null)
  const X = idx.map((i) => spec.featureIdx.map((j) => dataset.X[i][j]))
  const y = idx.map((i) => dataset.Y[i][ti] as number)
  const pred = crossValidate(X, y, spec.algo, spec.params, spec.folds, seed)
  const predictor = pred ? fitAlgo(spec.algo, spec.params, X, y, makeRandom(seed)) : null
  if (!pred || !predictor) return { reason: '조건끼리 같은 정보라서 모델을 풀 수 없습니다' }
  const resid = y.map((v, i) => v - pred[i])
  const r2 = r2Of(y, pred)
  const mse = resid.reduce((s, v) => s + v * v, 0) / resid.length
  return {
    target,
    featureIdx: spec.featureIdx,
    n: idx.length,
    algo: spec.algo,
    params: spec.params,
    folds: spec.folds,
    r2,
    residSd: Math.sqrt(mse),
    mae: mean(resid.map(Math.abs)),
    rmse: Math.sqrt(mse),
    mse,
    ysd: sd(y),
    importance: spec.featureIdx.map((j, k) => ({ variable: dataset.features[j], share: predictor.importance[k] })).sort((a, b) => b.share - a.share),
    reliable: r2 >= MIN_R2,
    predictor,
    cv_pred: pred,
    cv_actual: y,
    versionId: null,
    cv: { [spec.algo]: r2 },
  }
}

export interface TrainOptions {
  seed?: number
  folds?: number
  extras?: Variable[]
  fixed?: Record<ID, number>
  pooledProjects?: number
  /** 저장한 버전. 적용(applied)된 것이 있으면 자동 대신 쓴다 */
  versions?: ModelVersion[]
}

/** 저장한 버전을 이 데이터셋에 맞춰 되살린다. 조건이 하나라도 없으면 null */
export function fromVersion(dataset: Dataset, v: ModelVersion): TargetModel | null {
  const target = dataset.targets.find((t) => t.name === v.target)
  if (!target) return null
  const featureIdx: number[] = []
  for (const name of v.features) {
    const j = dataset.features.findIndex((f) => (name.startsWith('proj:') ? f.id === name : f.name === name && !f.id.startsWith('proj:')))
    if (j < 0) return null
    featureIdx.push(j)
  }
  return {
    target,
    featureIdx,
    n: v.n,
    algo: v.algo,
    params: v.params as Params,
    folds: v.folds,
    r2: v.r2,
    residSd: v.residSd,
    mae: v.mae,
    rmse: v.rmse ?? v.residSd,
    mse: v.mse ?? v.residSd ** 2,
    ysd: v.ysd,
    importance: featureIdx.map((j, k) => ({ variable: dataset.features[j], share: v.importance[k] ?? 0 })).sort((a, b) => b.share - a.share),
    reliable: v.r2 >= MIN_R2,
    predictor: v.predictor as Predictor,
    cv_pred: v.cv_pred,
    cv_actual: v.cv_actual,
    versionId: v.id,
    cv: { [v.algo]: v.r2 },
  }
}

/**
 * 결과마다 모델을 만든다. 적용한 버전이 있으면 그것을, 없으면 자동(포레스트 vs 선형, 교차검증 R²가 큰 쪽).
 */
export function trainModel(p: Project, runs: Run[], opts: TrainOptions = {}): Model {
  const seed = opts.seed ?? 7
  const folds = opts.folds ?? 5
  const fixed = opts.fixed ?? {}
  const pooledProjects = opts.pooledProjects ?? 1
  const dataset = buildDataset(p, runs, MIN_TRAIN, opts.extras ?? [])
  const models: TargetModel[] = []
  const skipped: Model['skipped'] = []
  const doneCount = runs.filter((r) => r.status === 'done').length
  if (dataset.features.length === 0) {
    for (const t of outputsOf(p)) skipped.push({ target: t, reason: doneCount < MIN_TRAIN ? `완료 ${doneCount}건. ${MIN_TRAIN}건부터 학습` : '값이 달라지는 입력 조건 없음' })
    return { dataset, models, skipped, seed, fixed, pooledProjects }
  }
  const all = dataset.features.map((_, j) => j)
  for (const t of outputsOf(p)) {
    const applied = opts.versions?.find((v) => v.target === t.name && v.applied)
    if (applied) {
      const tm = fromVersion(dataset, applied)
      if (tm) {
        models.push(tm)
        continue
      }
    }
    if (!dataset.targets.some((x) => x.id === t.id)) {
      const have = runs.filter((r) => r.status === 'done' && Number.isFinite(r.y[t.id])).length
      skipped.push({ target: t, reason: have < MIN_TRAIN ? `값 있는 실험 ${have}건. ${MIN_TRAIN}건부터 학습` : '값이 모두 같음' })
      continue
    }
    const cands = (['forest', 'ridge'] as Algo[]).map((algo) => trainTarget(dataset, t, { algo, params: defaultParams(algo), featureIdx: all, folds, seed }))
    const ok = cands.filter((c): c is TargetModel => !('reason' in c))
    if (ok.length === 0) {
      skipped.push({ target: t, reason: (cands[0] as { reason: string }).reason })
      continue
    }
    const best = ok.sort((a, b) => b.r2 - a.r2)[0]
    best.cv = Object.fromEntries(ok.map((c) => [c.algo, c.r2]))
    models.push(best)
  }
  return { dataset, models, skipped, seed, fixed, pooledProjects }
}

/** 학습한 모델을 저장용 버전으로 */
export function toVersion(tm: TargetModel, dataset: Dataset, meta: { id: string; group: string; version: number; projects: ID[]; pooled: boolean; note?: string }): ModelVersion {
  return {
    id: meta.id,
    group: meta.group,
    version: meta.version,
    target: tm.target.name,
    features: tm.featureIdx.map((j) => (dataset.features[j].id.startsWith('proj:') ? dataset.features[j].id : dataset.features[j].name)),
    algo: tm.algo,
    params: tm.params as Record<string, number | undefined>,
    folds: tm.folds,
    pooled: meta.pooled,
    projects: meta.projects,
    n: tm.n,
    r2: tm.r2,
    mae: tm.mae,
    rmse: tm.rmse,
    mse: tm.mse,
    residSd: tm.residSd,
    ysd: tm.ysd,
    importance: tm.featureIdx.map((j) => tm.importance.find((i) => i.variable.id === dataset.features[j].id)?.share ?? 0),
    cv_pred: tm.cv_pred,
    cv_actual: tm.cv_actual,
    predictor: tm.predictor,
    trainedAt: new Date().toISOString(),
    applied: false,
    note: meta.note ?? '',
  }
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

/** 데이터셋 전체 벡터 x에서 이 모델이 쓰는 조건만 골라 예측 */
export function predictOne(tm: TargetModel, x: number[]): { mean: number; sd: number; epistemic: number } {
  const p = predictWith(tm.predictor, tm.featureIdx.map((j) => x[j]))
  return { mean: p.mean, sd: Math.sqrt(tm.residSd ** 2 + p.epistemic ** 2), epistemic: p.epistemic }
}

export function vectorOf(model: Model, values: Record<ID, number | null | undefined>): { x: number[]; outOfRange: Variable[]; missing: Variable[] } {
  const { features, medians, bounds } = model.dataset
  const outOfRange: Variable[] = []
  const missing: Variable[] = []
  const x = features.map((f, j) => {
    const v = values[f.id] ?? model.fixed[f.id]
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
  const s = Math.max(sigma, 1e-9)
  if (g.op === 'target' || g.op === 'between') {
    const lo = g.op === 'target' ? (g.target ?? 0) - (g.tol ?? 0) : (g.lo ?? 0)
    const hi = g.op === 'target' ? (g.target ?? 0) + (g.tol ?? 0) : (g.hi ?? 0)
    const margin = Math.min(mu - lo, hi - mu)
    return { ok: margin >= 0, prob: Math.max(0, normalCdf((hi - mu) / s) - normalCdf((lo - mu) / s)), margin }
  }
  const margin = g.op === '>=' ? mu - (g.lo ?? 0) : (g.hi ?? 0) - mu
  return { ok: margin >= 0, prob: normalCdf(margin / s), margin }
}

export interface GoalCheck {
  goal: Goal
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
      const lv = p.variables.find((v) => v.id === g.at!.variable)
      const vals = new Set(model.dataset.runs.map((r) => r.x[g.at!.variable]))
      if (!(vals.size === 1 && vals.has(g.at.value))) return { goal: g, model: null, featureIndex: null, at: null, reason: `"${lv?.name ?? ''}" ${g.at.value} 실험 없음` }
    } else at = { index: i, value: g.at.value }
  }
  const v = p.variables.find((x) => x.id === g.variable)
  if (!v) return { goal: g, model: null, featureIndex: null, at, reason: '목표의 변수 없음' }
  if (v.role === 'output') {
    const tm = model.models.find((m) => m.target.id === v.id)
    if (!tm) {
      const sk = model.skipped.find((s) => s.target.id === v.id)
      return { goal: g, model: null, featureIndex: null, at, reason: sk?.reason ?? '모델 없음' }
    }
    if (!tm.reliable) return { goal: g, model: null, featureIndex: null, at, reason: `"${v.name}" 모델 R² ${tm.r2.toFixed(2)} (0.3 미만)` }
    return { goal: g, model: tm, featureIndex: null, at, reason: null }
  }
  const j = fi(v.id)
  if (j >= 0) return { goal: g, model: null, featureIndex: j, at, reason: null }
  return { goal: g, model: null, featureIndex: null, at, reason: `"${v.name}" 값이 달라지지 않음` }
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
  values: { variable: Variable; value: number }[]
  checks: GoalCheck[]
  prob: number
  allOk: boolean
  nearest: { run: Run; distance: number } | null
  known: boolean
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
  explore?: number
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
  if (features.length === 0) return empty('값이 달라지는 입력 조건 없음')
  if (musts.filter((b) => b.model).length === 0) return empty('예측할 수 있는 필수 목표(출력) 없음')

  const fixedIdx = new Map<number, number | null>()
  for (const b of active) if (b.at) fixedIdx.set(b.at.index, null)
  features.forEach((f, j) => {
    if (f.role === 'level') fixedIdx.set(j, null)
    const v = opts.fixed?.[f.id] ?? model.fixed[f.id]
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
    if (g.op === 'target') {
      lo[j] = Math.max(lo[j], (g.target ?? 0) - (g.tol ?? 0))
      hi[j] = Math.min(hi[j], (g.target ?? 0) + (g.tol ?? 0))
    }
  }
  const free = features.map((_, j) => j).filter((j) => !fixedIdx.has(j))
  for (const j of free) if (lo[j] > hi[j]) return empty(`"${features[j].name}" 목표 범위가 실험 범위와 겹치지 않음`)
  if (free.length === 0) return empty('움직일 수 있는 조건 없음')
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
