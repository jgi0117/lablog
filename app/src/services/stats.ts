/**
 * 실험 데이터를 통계로 읽기 위한 작은 도구 모음. 외부 라이브러리 없이 순수 함수로 만들었고,
 * 모든 함수는 값이 모자라거나 계산할 수 없으면 null을 돌려준다(그럴듯한 숫자를 지어내지 않는다).
 * p-값은 정규 가정에 기대는 근사이며, 실험 수가 적으면 참고용이다.
 */

// ---------- 기술통계 ----------

export interface Summary {
  n: number
  mean: number
  sd: number
  min: number
  q1: number
  median: number
  q3: number
  max: number
  /** 변동계수(표준편차/평균). 평균이 0이면 null */
  cv: number | null
}

export function mean(v: number[]): number {
  return v.reduce((a, b) => a + b, 0) / v.length
}

/** 표본 표준편차(n-1). 값이 2개 미만이면 0 */
export function sd(v: number[]): number {
  if (v.length < 2) return 0
  const m = mean(v)
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1))
}

/** 정렬된 값의 분위수(선형 보간, 엑셀의 QUARTILE.INC와 같다) */
export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function summarize(values: number[]): Summary | null {
  const v = values.filter((x) => Number.isFinite(x))
  if (v.length === 0) return null
  const s = [...v].sort((a, b) => a - b)
  const m = mean(v)
  const d = sd(v)
  return {
    n: v.length,
    mean: m,
    sd: d,
    min: s[0],
    q1: quantile(s, 0.25),
    median: quantile(s, 0.5),
    q3: quantile(s, 0.75),
    max: s[s.length - 1],
    cv: m === 0 ? null : d / Math.abs(m),
  }
}

// ---------- 분포 함수(p-값용) ----------

function lgamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
  let y = x
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (const k of c) ser += k / ++y
  return -tmp + Math.log((2.5066282746310005 * ser) / x)
}

function betacf(a: number, b: number, x: number): number {
  const tiny = 1e-30
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let h = d
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 3e-12) break
  }
  return h
}

/** 정규화 불완전 베타 함수 I_x(a, b) */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b
}

/** t 분포의 양쪽 p-값 */
export function tTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) return NaN
  return incompleteBeta(df / (df + t * t), df / 2, 0.5)
}

/** F 분포의 오른쪽 꼬리 p-값 */
export function fSurvivalP(f: number, d1: number, d2: number): number {
  if (!Number.isFinite(f) || f < 0 || d1 <= 0 || d2 <= 0) return NaN
  return incompleteBeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2)
}

// ---------- 상관과 회귀 ----------

export interface Correlation {
  n: number
  r: number
  /** 상관이 0이라는 가정에서의 양쪽 p-값 */
  p: number
  slope: number
  intercept: number
  /** 결정계수 r² */
  r2: number
}

/** 쌍을 이룬 값에서 피어슨 상관과 단순회귀. 3쌍 미만이거나 한 쪽 값이 모두 같으면 null */
export function pearson(xs: number[], ys: number[]): Correlation | null {
  const n = Math.min(xs.length, ys.length)
  if (n < 3) return null
  const mx = mean(xs.slice(0, n))
  const my = mean(ys.slice(0, n))
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
    sxy += (xs[i] - mx) * (ys[i] - my)
  }
  if (sxx === 0 || syy === 0) return null
  const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)))
  const p = Math.abs(r) === 1 ? 0 : tTwoSidedP((r * Math.sqrt(n - 2)) / Math.sqrt(1 - r * r), n - 2)
  const slope = sxy / sxx
  return { n, r, p, slope, intercept: my - slope * mx, r2: r * r }
}

/** 같은 값은 평균 순위로 매긴 순위(1부터) */
export function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const out = new Array<number>(values.length)
  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) out[order[k].i] = avg
    i = j + 1
  }
  return out
}

/** 스피어먼 순위상관(곡선이어도 한 방향으로 움직이면 크게 나온다) */
export function spearman(xs: number[], ys: number[]): { n: number; rho: number; p: number } | null {
  const c = pearson(ranks(xs), ranks(ys))
  return c ? { n: c.n, rho: c.r, p: c.p } : null
}

export interface MatrixColumn {
  key: string
  /** 실험마다의 값. 없으면 null */
  values: (number | null)[]
}

export interface PairStat {
  r: number
  n: number
  p: number
}

/** 열 사이 모든 쌍의 피어슨 상관. 둘 다 값이 있는 실험이 minN건 미만이면 그 칸은 null */
export function correlationMatrix(cols: MatrixColumn[], minN = 5): (PairStat | null)[][] {
  return cols.map((a, i) =>
    cols.map((b, j) => {
      if (i === j) return { r: 1, n: a.values.filter((v) => v !== null).length, p: 0 }
      const xs: number[] = []
      const ys: number[] = []
      for (let k = 0; k < a.values.length; k++) {
        const x = a.values[k]
        const y = b.values[k]
        if (x !== null && y !== null) {
          xs.push(x)
          ys.push(y)
        }
      }
      if (xs.length < minN) return null
      const c = pearson(xs, ys)
      return c ? { r: c.r, n: c.n, p: c.p } : null
    }),
  )
}

function invert(m: number[][]): number[][] | null {
  const n = m.length
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r
    if (Math.abs(a[piv][col]) < 1e-10) return null
    ;[a[col], a[piv]] = [a[piv], a[col]]
    const d = a[col][col]
    for (let c = 0; c < 2 * n; c++) a[col][c] /= d
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = a[r][col]
      if (f !== 0) for (let c = 0; c < 2 * n; c++) a[r][c] -= f * a[col][c]
    }
  }
  return a.map((row) => row.slice(n))
}

export interface Regression {
  n: number
  r2: number
  adjR2: number
  /** 표준화 계수: 다른 조건을 고정하고 이 조건이 표준편차 하나만큼 커질 때 결과가 움직이는 표준편차 수 */
  coefs: { beta: number; p: number }[]
}

/**
 * 여러 조건을 한꺼번에 넣은 다중선형회귀(표준화). 행은 실험, 열은 조건이다.
 * 실험이 조건 수의 3배 + 2건에 못 미치거나, 조건끼리 거의 같은 정보라서 풀 수 없으면 null.
 */
export function regressStandardized(X: number[][], y: number[]): Regression | null {
  const n = y.length
  const k = X[0]?.length ?? 0
  if (k === 0 || n < 3 * k + 2) return null
  const cols = Array.from({ length: k }, (_, j) => X.map((row) => row[j]))
  const z = (v: number[]) => {
    const m = mean(v)
    const s = sd(v)
    return s === 0 ? null : v.map((x) => (x - m) / s)
  }
  const zc = cols.map(z)
  const zy = z(y)
  if (!zy || zc.some((c) => c === null)) return null
  const Z = zc as number[][]
  const xtx = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => Z[a].reduce((s, v, i) => s + v * Z[b][i], 0)))
  const xty = Z.map((c) => c.reduce((s, v, i) => s + v * zy[i], 0))
  const inv = invert(xtx)
  if (!inv) return null
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * xty[j], 0))
  let rss = 0
  for (let i = 0; i < n; i++) {
    let pred = 0
    for (let j = 0; j < k; j++) pred += beta[j] * Z[j][i]
    rss += (zy[i] - pred) ** 2
  }
  const tss = zy.reduce((s, v) => s + v * v, 0)
  const df = n - k - 1
  const sigma2 = rss / df
  const r2 = Math.max(0, 1 - rss / tss)
  return {
    n,
    r2,
    adjR2: 1 - ((1 - r2) * (n - 1)) / df,
    coefs: beta.map((b, j) => {
      const se = Math.sqrt(sigma2 * inv[j][j])
      return { beta: b, p: se === 0 ? 0 : tTwoSidedP(b / se, df) }
    }),
  }
}

// ---------- 그룹 비교 ----------

export interface GroupStat extends Summary {
  label: string
}

export interface GroupComparison {
  groups: GroupStat[]
  /** 일원분산분석 F와 p-값(집단 평균이 모두 같다는 가정) */
  f: number
  p: number
  df1: number
  df2: number
  /** 효과 크기 η²: 결과의 흩어짐 중 집단 차이로 설명되는 비율 */
  eta2: number
}

/** 집단별 요약과 일원분산분석. 값이 2개 이상인 집단이 2개 미만이거나 전체 값이 집단 수 이하이면 null */
export function compareGroups(groups: { label: string; values: number[] }[]): GroupComparison | null {
  const usable = groups.filter((g) => g.values.length >= 2)
  const total = usable.reduce((s, g) => s + g.values.length, 0)
  if (usable.length < 2 || total <= usable.length) return null
  const all = usable.flatMap((g) => g.values)
  const grand = mean(all)
  let ssb = 0
  let ssw = 0
  for (const g of usable) {
    const m = mean(g.values)
    ssb += g.values.length * (m - grand) ** 2
    ssw += g.values.reduce((s, v) => s + (v - m) ** 2, 0)
  }
  const df1 = usable.length - 1
  const df2 = total - usable.length
  const sst = ssb + ssw
  const f = ssw === 0 ? (ssb === 0 ? 0 : Infinity) : ssb / df1 / (ssw / df2)
  return {
    groups: usable.map((g) => ({ label: g.label, ...(summarize(g.values) as Summary) })),
    f,
    p: ssw === 0 ? (ssb === 0 ? 1 : 0) : fSurvivalP(f, df1, df2),
    df1,
    df2,
    eta2: sst === 0 ? 0 : ssb / sst,
  }
}

// ---------- 분포 ----------

export interface Histogram {
  edges: number[]
  counts: number[]
}

/** 같은 폭의 구간으로 센 히스토그램. 구간 수는 스터지스 규칙(1 + log2 n)을 따르되 4~14개로 제한 */
export function histogram(values: number[], bins?: number): Histogram | null {
  const v = values.filter((x) => Number.isFinite(x))
  if (v.length === 0) return null
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  if (lo === hi) return { edges: [lo - 0.5, lo + 0.5], counts: [v.length] }
  const k = bins ?? Math.max(4, Math.min(14, Math.ceil(1 + Math.log2(v.length))))
  const w = (hi - lo) / k
  const counts = new Array<number>(k).fill(0)
  for (const x of v) counts[Math.min(k - 1, Math.floor((x - lo) / w))]++
  return { edges: Array.from({ length: k + 1 }, (_, i) => lo + i * w), counts }
}

// ---------- 해석 ----------

/** 상관의 크기를 말로. 사람이 숫자만 보고 오해하지 않게 한다. */
export function describeStrength(r: number): string {
  const a = Math.abs(r)
  return a >= 0.8 ? '매우 강한' : a >= 0.6 ? '강한' : a >= 0.4 ? '뚜렷한' : a >= 0.2 ? '약한' : '거의 없는'
}

/** p-값을 읽기 쉽게 */
export function formatP(p: number): string {
  if (!Number.isFinite(p)) return '—'
  if (p < 0.001) return 'p < 0.001'
  return `p = ${p.toFixed(3)}`
}

/** 산점도 아래에 붙이는 상관계수 설명. 숫자만 보여 주면 오해하기 쉽다. */
export function describeCorrelation(r: number): string {
  const a = Math.abs(r)
  if (a < 0.3) return '두 항목 사이에 뚜렷한 관계가 보이지 않습니다.'
  const strength = a >= 0.8 ? '강한' : a >= 0.5 ? '뚜렷한' : '약한'
  return `${strength} ${r > 0 ? '양의' : '음의'} 관계: 가로 값이 커질수록 세로 값이 ${r > 0 ? '커지는' : '작아지는'} 경향입니다.`
}
