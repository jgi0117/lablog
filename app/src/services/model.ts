import type { Requirement } from '../domain/types'
import { normalizeName, type Column, type Matrix, type MatrixRow } from './analysis'
import { columnFor } from './requirements'
import { mean, quantile, sd } from './stats'

/**
 * 조건 → 결과 예측 모델과, 고객 요구를 만족할 조건 제안.
 *
 * 신제품 개발의 일은 "고객 요구를 만족하는 조건을 찾는 것"이다. 통계 분석은 "무엇이 결과를 움직이는가"까지 알려 주지만,
 * "그래서 다음 실험은 어떤 조건으로 해야 하는가"는 사람이 머릿속으로 짐작해야 했다. 이 모듈은 그 짐작을 대신한다.
 * 1) 모아 둔 실험으로 결과마다 예측 모델을 만들고(랜덤 포레스트 또는 능형회귀, 교차검증으로 고른다),
 * 2) 새 조건의 결과를 불확실성과 함께 예측하며,
 * 3) 관측 범위 안에서 필수 요구를 모두 만족할 가능성이 가장 큰 조건 몇 가지를 제안한다.
 * 외부 라이브러리 없이 이 기기 안에서만 계산하고, 근거(실험 수, 교차검증 R²)를 항상 함께 돌려준다.
 */

// ---------- 난수 ----------

/** 같은 데이터면 같은 결과가 나오도록 씨앗을 쓰는 난수(mulberry32) */
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

/** 표준정규 누적분포 Φ(z) (오차함수 근사, 오차 1.5e-7) */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2)
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y)
}

// ---------- 데이터 ----------

/** 모델을 만들려면 결과 값이 있는 실험이 이만큼은 있어야 한다 */
export const MIN_TRAIN = 10
/** 교차검증 R²가 이보다 작으면 "믿기 어려움"으로 표시하고 제안에 쓰지 않는다 */
export const MIN_R2 = 0.3

export interface Dataset {
  /** 숫자 조건(입력) */
  features: Column[]
  /** 숫자 결과(출력) */
  targets: Column[]
  rows: MatrixRow[]
  /** 실험 × 조건. 빈 칸은 그 조건의 중앙값으로 채운다 */
  X: number[][]
  /** 실험 × 결과. 없으면 null */
  Y: (number | null)[][]
  medians: number[]
  /** 이상치 후보를 뺀 관측 범위. 제안은 이 범위 안에서만 한다 */
  bounds: [number, number][]
  /** 입력한 값의 소수 자릿수(제안 값을 사람이 적은 정밀도로 맞춘다) */
  decimals: number[]
}

const num = (row: MatrixRow, key: string): number | null => {
  const c = row.cells[key]
  return c && c.num !== null ? c.num : null
}

function decimalsOf(values: string[]): number {
  let d = 0
  for (const v of values) {
    const m = /\.(\d+)$/.exec(v.trim())
    if (m) d = Math.max(d, m[1].length)
  }
  return Math.min(d, 4)
}

/** 실험 × 항목 표에서 모델에 쓸 숫자 조건과 결과를 고른다. */
export function buildDataset(m: Matrix, minN = MIN_TRAIN): Dataset {
  const rowsAll = m.rows
  const usable = (c: Column) => {
    const vals = rowsAll.map((r) => num(r, c.key)).filter((v): v is number => v !== null)
    return vals.length >= minN && new Set(vals).size > 1
  }
  const features = m.columns.filter((c) => c.kind === 'condition' && usable(c))
  const targets = m.columns.filter((c) => c.kind === 'result' && usable(c))
  // 조건이 하나도 없는 실험은 뺀다
  const rows = rowsAll.filter((r) => features.some((f) => num(r, f.key) !== null))
  const medians = features.map((f) => {
    const vals = rows.map((r) => num(r, f.key)).filter((v): v is number => v !== null).sort((a, b) => a - b)
    return vals.length ? quantile(vals, 0.5) : 0
  })
  const X = rows.map((r) => features.map((f, j) => num(r, f.key) ?? medians[j]))
  const Y = rows.map((r) => targets.map((t) => num(r, t.key)))
  const bounds = features.map((f): [number, number] => {
    const vals = rows.filter((r) => !r.cells[f.key]?.outlier).map((r) => num(r, f.key)).filter((v): v is number => v !== null)
    const all = vals.length ? vals : rows.map((r) => num(r, f.key)).filter((v): v is number => v !== null)
    return [Math.min(...all), Math.max(...all)]
  })
  const decimals = features.map((f) => decimalsOf(rows.map((r) => r.cells[f.key]?.value ?? '')))
  return { features, targets, rows, X, Y, medians, bounds, decimals }
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

// ---------- 능형회귀(선형) ----------

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
export const KIND_LABEL: Record<ModelKind, string> = { forest: '랜덤 포레스트', ridge: '선형(능형) 회귀' }

export interface TargetModel {
  target: Column
  /** 학습에 쓴 실험 수(이 결과 값이 있는 실험) */
  n: number
  kind: ModelKind
  /** 5겹 교차검증 결정계수. 학습에 쓰지 않은 실험을 얼마나 맞히는지 */
  r2: number
  /** 교차검증 잔차의 표준편차(예측 구간의 바탕) */
  residSd: number
  /** 교차검증 평균 절대 오차 */
  mae: number
  /** 결과 값의 표준편차(오차를 견줄 기준) */
  ysd: number
  /** 두 모델의 교차검증 R² */
  cv: Record<ModelKind, number | null>
  /** 모델이 얼마나 의지하는 조건인지(합 1) */
  importance: { column: Column; share: number }[]
  /** 교차검증 R²가 MIN_R2 이상이면 예측과 제안에 쓴다 */
  reliable: boolean
  predictor: Forest | Ridge
}

export interface Model {
  dataset: Dataset
  models: TargetModel[]
  /** 실험이 모자라거나 값이 모두 같아 모델을 만들지 못한 결과 */
  skipped: { target: Column; reason: string }[]
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

/**
 * 결과마다 모델을 만든다. 랜덤 포레스트와 선형 회귀를 모두 교차검증하고 더 잘 맞히는 쪽을 고른다.
 * 실험 수가 적으면 선형 쪽이 이기는 일이 많고, 곡선·상호작용이 있으면 포레스트가 이긴다.
 */
export function trainModel(m: Matrix, opts: { seed?: number; folds?: number } = {}): Model {
  const seed = opts.seed ?? 7
  const folds = opts.folds ?? 5
  const dataset = buildDataset(m)
  const models: TargetModel[] = []
  const skipped: Model['skipped'] = []
  if (dataset.features.length === 0) {
    for (const t of dataset.targets) skipped.push({ target: t, reason: '숫자 조건이 없어 모델을 만들 수 없습니다' })
    return { dataset, models, skipped, seed }
  }
  dataset.targets.forEach((target, ti) => {
    const idx = dataset.rows.map((_, i) => i).filter((i) => dataset.Y[i][ti] !== null)
    if (idx.length < MIN_TRAIN) {
      skipped.push({ target, reason: `값이 있는 실험이 ${idx.length}건이라 ${MIN_TRAIN}건은 있어야 합니다` })
      return
    }
    const X = idx.map((i) => dataset.X[i])
    const y = idx.map((i) => dataset.Y[i][ti] as number)
    const cv: Record<ModelKind, number | null> = { forest: null, ridge: null }
    const preds: Partial<Record<ModelKind, number[]>> = {}
    for (const kind of ['forest', 'ridge'] as ModelKind[]) {
      const p = crossValidate(X, y, kind, folds, seed)
      if (p) {
        preds[kind] = p
        cv[kind] = r2Of(y, p)
      }
    }
    const kind: ModelKind = (cv.ridge ?? -Infinity) > (cv.forest ?? -Infinity) ? 'ridge' : 'forest'
    const pred = preds[kind]
    if (!pred) {
      skipped.push({ target, reason: '조건끼리 같은 정보라서 모델을 풀 수 없습니다' })
      return
    }
    const resid = y.map((v, i) => v - pred[i])
    const predictor = kind === 'forest' ? fitForest(X, y, makeRandom(seed)) : fitRidge(X, y)
    if (!predictor) {
      skipped.push({ target, reason: '모델을 풀 수 없습니다' })
      return
    }
    const r2 = cv[kind] ?? 0
    models.push({
      target,
      n: idx.length,
      kind,
      r2,
      residSd: Math.sqrt(resid.reduce((s, v) => s + v * v, 0) / resid.length),
      mae: mean(resid.map(Math.abs)),
      ysd: sd(y),
      cv,
      importance: dataset.features.map((column, j) => ({ column, share: predictor.importance[j] })).sort((a, b) => b.share - a.share),
      reliable: r2 >= MIN_R2,
      predictor,
    })
  })
  return { dataset, models, skipped, seed }
}

/** 교차검증 R²를 사람 말로 */
export function describeFit(r2: number): string {
  if (r2 >= 0.8) return '새 조건에서도 잘 맞히는 편'
  if (r2 >= 0.6) return '경향은 맞히지만 오차가 있음'
  if (r2 >= MIN_R2) return '대략의 방향만 참고'
  return '믿기 어려움(조건으로 설명되지 않음)'
}

// ---------- 예측 ----------

export interface Prediction {
  model: TargetModel
  mean: number
  /** 예측의 표준편차(교차검증 오차와 모델 내부 흔들림을 합친 것) */
  sd: number
  /** 대략 95% 구간 */
  lo: number
  hi: number
}

export function predictOne(tm: TargetModel, x: number[]): { mean: number; sd: number } {
  if (tm.predictor.kind === 'forest') {
    const p = forestPredict(tm.predictor, x)
    return { mean: p.mean, sd: Math.sqrt(tm.residSd ** 2 + p.sd ** 2) }
  }
  return { mean: ridgePredict(tm.predictor, x), sd: tm.residSd }
}

/** 조건 이름 → 값(없는 조건은 중앙값)으로 입력 벡터를 만든다. 관측 범위를 벗어난 조건도 함께 알려 준다 */
export function vectorOf(model: Model, values: Record<string, number | null | undefined>): { x: number[]; outOfRange: Column[]; missing: Column[] } {
  const { features, medians, bounds } = model.dataset
  const outOfRange: Column[] = []
  const missing: Column[] = []
  const byName = new Map(Object.entries(values).map(([k, v]) => [normalizeName(k), v]))
  const x = features.map((f, j) => {
    const v = byName.get(normalizeName(f.name))
    if (v === null || v === undefined || !Number.isFinite(v)) {
      missing.push(f)
      return medians[j]
    }
    if (v < bounds[j][0] || v > bounds[j][1]) outOfRange.push(f)
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

// ---------- 요구 판정(예측값으로) ----------

/** 예측값이 요구를 만족할 확률. margin은 요구 경계까지의 여유(음수면 미달) */
export function checkPredicted(r: Requirement, mu: number, sigma: number): { ok: boolean; prob: number; margin: number } {
  let margin = 0
  if (r.kind === 'min') margin = mu - (r.min ?? 0)
  else if (r.kind === 'max') margin = (r.max ?? 0) - mu
  else if (r.kind === 'range') margin = Math.min(mu - (r.min ?? 0), (r.max ?? 0) - mu)
  else margin = (r.tolerance ?? 0) - Math.abs(mu - (r.target ?? 0))
  const s = Math.max(sigma, 1e-9)
  return { ok: margin >= 0, prob: normalCdf(margin / s), margin }
}

export interface RequirementCheck {
  requirement: Requirement
  /** 조건 항목에 거는 요구(예: 시멘트 ≤ 400)는 입력값을 그대로 판정한다 */
  onCondition: boolean
  mean: number
  sd: number
  prob: number
  ok: boolean
}

interface ReqBinding {
  requirement: Requirement
  /** 결과 모델(있으면) */
  model: TargetModel | null
  /** 조건 항목에 거는 요구이면 그 조건의 번호 */
  featureIndex: number | null
  /** 적용 조건(재령 등)의 조건 번호와 값 */
  at: { index: number; value: number } | null
  /** 판정할 수 없는 이유 */
  reason: string | null
}

function bind(model: Model, m: Matrix, r: Requirement): ReqBinding {
  const { features } = model.dataset
  const fi = (name: string) => features.findIndex((f) => normalizeName(f.name) === normalizeName(name))
  let at: ReqBinding['at'] = null
  if (r.at) {
    const i = fi(r.at.name)
    if (i < 0) return { requirement: r, model: null, featureIndex: null, at: null, reason: `적용 조건 "${r.at.name}"이(가) 숫자 조건으로 쌓여 있지 않아 예측하지 않습니다` }
    at = { index: i, value: r.at.value }
  }
  const col = columnFor(m, r.name)
  if (col?.kind === 'result') {
    const tm = model.models.find((x) => x.target.key === col.key)
    if (!tm) {
      const sk = model.skipped.find((s) => s.target.key === col.key)
      return { requirement: r, model: null, featureIndex: null, at, reason: sk ? sk.reason : `"${r.name}"은(는) 숫자 결과로 쌓여 있지 않습니다` }
    }
    if (!tm.reliable) return { requirement: r, model: null, featureIndex: null, at, reason: `"${r.name}" 모델의 교차검증 R²가 ${tm.r2.toFixed(2)}로 낮아 예측을 믿기 어렵습니다` }
    return { requirement: r, model: tm, featureIndex: null, at, reason: null }
  }
  const j = fi(r.name)
  if (j >= 0) return { requirement: r, model: null, featureIndex: j, at, reason: null }
  return { requirement: r, model: null, featureIndex: null, at, reason: `"${r.name}"은(는) 숫자 조건·결과로 쌓여 있지 않습니다` }
}

function evaluate(b: ReqBinding, x: number[]): RequirementCheck {
  const r = b.requirement
  if (b.featureIndex !== null) {
    const v = x[b.featureIndex]
    const c = checkPredicted(r, v, 1e-9)
    return { requirement: r, onCondition: true, mean: v, sd: 0, prob: c.ok ? 1 : 0, ok: c.ok }
  }
  const tm = b.model as TargetModel
  const xi = b.at ? x.map((v, j) => (j === b.at!.index ? b.at!.value : v)) : x
  const p = predictOne(tm, xi)
  const c = checkPredicted(r, p.mean, p.sd)
  return { requirement: r, onCondition: false, mean: p.mean, sd: p.sd, prob: c.prob, ok: c.ok }
}

export interface Unmodeled {
  requirement: Requirement
  reason: string
}

/** 입력한 조건이 프로젝트의 요구를 만족할지 예측으로 판정한다. 적용 조건(재령 등)은 요구마다 그 값으로 바꿔 넣는다 */
export function checkRequirements(model: Model, m: Matrix, reqs: Requirement[], x: number[]): { checks: RequirementCheck[]; unmodeled: Unmodeled[] } {
  const checks: RequirementCheck[] = []
  const unmodeled: Unmodeled[] = []
  for (const r of reqs) {
    const b = bind(model, m, r)
    if (b.reason) unmodeled.push({ requirement: r, reason: b.reason })
    else checks.push(evaluate(b, x))
  }
  return { checks, unmodeled }
}

// ---------- 조건 제안 ----------

export interface Suggestion {
  /** 제안하는 조건 값(적용 조건과 고정한 조건은 뺀다) */
  values: { column: Column; value: number }[]
  checks: RequirementCheck[]
  /** 필수 요구를 모두 만족할 확률(독립 가정) */
  prob: number
  /** 예측 평균이 필수 요구를 모두 만족하는가 */
  allOk: boolean
  /** 가장 비슷한 과거 실험과 정규화한 거리(0이면 같은 조건) */
  nearest: { row: MatrixRow; distance: number } | null
  /** 이미 해 본 조건과 거의 같은가 */
  known: boolean
}

export interface SuggestResult {
  candidates: Suggestion[]
  /** 예측에 넣지 못한 요구와 이유 */
  unmodeled: Unmodeled[]
  /** 제안에서 움직인 조건과 탐색 범위 */
  ranges: { column: Column; lo: number; hi: number }[]
  /** 고정하거나 적용 조건이라 움직이지 않은 조건(적용 조건은 값이 null) */
  fixed: { column: Column; value: number | null }[]
  /** 탐색할 수 없을 때의 이유 */
  problem: string | null
}

export interface SuggestOptions {
  n?: number
  samples?: number
  seed?: number
  /** 바꾸지 않을 조건과 그 값(이름 기준) */
  fixed?: Record<string, number>
}

const round = (v: number, d: number) => Number(v.toFixed(d))

/**
 * 필수 요구를 모두 만족할 가능성이 가장 큰 조건을 찾는다.
 * 관측 범위 안에서 무작위로 조건을 많이 뽑고(이미 해 본 조건도 함께), 요구마다 만족 확률을 곱해 점수를 매긴 뒤
 * 상위 후보를 조금씩 흔들어 다듬는다. 과거 실험과 너무 먼 조건은 점수를 깎아, 모델이 본 적 없는 곳을 피한다.
 * 조건 항목에 거는 요구(시멘트 ≤ 400 등)는 탐색 범위를 좁히는 데 쓴다.
 */
export function suggest(model: Model, m: Matrix, reqs: Requirement[], opts: SuggestOptions = {}): SuggestResult {
  const n = opts.n ?? 3
  const samples = opts.samples ?? 1500
  const rand = makeRandom(opts.seed ?? model.seed + 11)
  const { features, bounds, decimals, X, rows } = model.dataset
  const p = features.length
  const bindings = reqs.map((r) => bind(model, m, r))
  const unmodeled = bindings.filter((b) => b.reason).map((b) => ({ requirement: b.requirement, reason: b.reason as string }))
  const active = bindings.filter((b) => !b.reason)
  const musts = active.filter((b) => b.requirement.priority === 'must')
  const empty = (problem: string | null): SuggestResult => ({ candidates: [], unmodeled, ranges: [], fixed: [], problem })
  if (p === 0) return empty('숫자 조건이 없어 제안할 수 없습니다')
  if (musts.filter((b) => b.model).length === 0) return empty('예측할 수 있는 필수 요구(결과 항목)가 없어 제안할 수 없습니다')

  // 움직일 조건과 범위
  const fixedIdx = new Map<number, number | null>()
  for (const b of active) if (b.at) fixedIdx.set(b.at.index, null)
  const fixedByName = new Map(Object.entries(opts.fixed ?? {}).map(([k, v]) => [normalizeName(k), v]))
  features.forEach((f, j) => {
    const v = fixedByName.get(normalizeName(f.name))
    if (v !== undefined && Number.isFinite(v)) fixedIdx.set(j, v)
  })
  const lo = bounds.map((b) => b[0])
  const hi = bounds.map((b) => b[1])
  for (const b of active) {
    if (b.featureIndex === null || b.requirement.priority !== 'must') continue
    const r = b.requirement
    const j = b.featureIndex
    if (r.kind === 'min' || r.kind === 'range') lo[j] = Math.max(lo[j], r.min ?? lo[j])
    if (r.kind === 'max' || r.kind === 'range') hi[j] = Math.min(hi[j], r.max ?? hi[j])
    if (r.kind === 'target') {
      lo[j] = Math.max(lo[j], (r.target ?? 0) - (r.tolerance ?? 0))
      hi[j] = Math.min(hi[j], (r.target ?? 0) + (r.tolerance ?? 0))
    }
  }
  const free = features.map((_, j) => j).filter((j) => !fixedIdx.has(j))
  for (const j of free) if (lo[j] > hi[j]) return empty(`"${features[j].name}"의 요구 범위가 지금까지 실험한 범위와 겹치지 않습니다`)
  if (free.length === 0) return empty('움직일 수 있는 조건이 없습니다')
  const span = features.map((_, j) => Math.max(hi[j] - lo[j], 1e-9))

  const base = features.map((_, j) => {
    const fv = fixedIdx.get(j)
    return fv === null || fv === undefined ? model.dataset.medians[j] : fv
  })
  // 과거 실험(움직이는 조건만 비교)
  const known = X.map((row) => row.map((v, j) => (free.includes(j) ? v : base[j])))
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
    return bi < 0 ? null : { row: rows[bi], distance: bd }
  }
  const clip = (x: number[]) => {
    for (const j of free) x[j] = round(Math.min(hi[j], Math.max(lo[j], x[j])), decimals[j])
    return x
  }
  const score = (x: number[]) => {
    let s = 0
    for (const b of active) {
      const c = evaluate(b, x)
      const lp = Math.log(Math.max(c.prob, 1e-6))
      s += b.requirement.priority === 'must' ? lp : 0.2 * lp
    }
    const nr = nearestOf(x)
    return s - 0.5 * (nr ? nr.distance : 0)
  }

  const pool: number[][] = []
  const seen = new Set<string>()
  const push = (x: number[]) => {
    const key = free.map((j) => x[j]).join('|')
    if (seen.has(key)) return
    seen.add(key)
    pool.push(x)
  }
  for (const k of known) {
    if (free.every((j) => k[j] >= lo[j] - 1e-9 && k[j] <= hi[j] + 1e-9)) push(clip([...k]))
  }
  for (let i = 0; i < samples; i++) {
    const x = [...base]
    for (const j of free) x[j] = lo[j] + rand() * (hi[j] - lo[j])
    push(clip(x))
  }
  let scored = pool.map((x) => ({ x, s: score(x) })).sort((a, b) => b.s - a.s)
  // 상위 후보를 조금씩 흔들어 다듬는다
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
  // 서로 다른 후보를 고른다
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
    const mustChecks = checks.filter((c) => c.requirement.priority === 'must')
    const nearest = nearestOf(x)
    return {
      values: free.map((j) => ({ column: features[j], value: x[j] })),
      checks,
      prob: mustChecks.reduce((s, c) => s * c.prob, 1),
      allOk: mustChecks.every((c) => c.ok),
      nearest,
      known: nearest !== null && nearest.distance < 0.02,
    }
  })
  return {
    candidates,
    unmodeled,
    ranges: free.map((j) => ({ column: features[j], lo: lo[j], hi: hi[j] })),
    fixed: features.map((f, j) => ({ column: f, value: fixedIdx.get(j) ?? null })).filter((_, j) => fixedIdx.has(j)),
    problem: null,
  }
}
