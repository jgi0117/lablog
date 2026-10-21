import type { Requirement } from '../domain/types'
import { type Cell, type Column, type Matrix, type MatrixRow } from './analysis'
import { eulreul, iga, wagwa } from './josa'
import {
  compareGroups,
  correlationMatrix,
  describeStrength,
  formatP,
  pearson,
  regressStandardized,
  spearman,
  summarize,
  type GroupComparison,
  type PairStat,
  type Summary,
} from './stats'
import { describeRequirement } from './requirements'
import { achievementProfile } from './achievementProfile'

/**
 * 실험 × 항목 표(Matrix)에서 "무엇이 결과를 움직이는가"를 읽어 내는 계산 모음.
 * 화면은 이 결과를 그대로 보여 주기만 한다. 모든 계산은 순수 함수이고, 근거가 모자라면 결과를 내지 않는다.
 */

/** 분석에 쓸 만큼 숫자 값이 있는 최소 실험 수 */
export const MIN_N = 5

const num = (c: Cell | undefined): number | null => (c && c.num !== null ? c.num : null)

export function columnValues(m: Matrix, key: string): (number | null)[] {
  return m.rows.map((r) => num(r.cells[key]))
}

export interface ColumnSummary {
  column: Column
  summary: Summary | null
  /** 이 항목이 숫자가 아니거나 비어 있는 실험 수(항목 자체가 없는 실험 포함) */
  missing: number
  /** 이상치 후보 개수 */
  outliers: number
  /** 서로 다른 숫자 값의 개수 */
  distinct: number
}

/** 숫자 값이 하나라도 있는 모든 항목의 요약 통계 */
export function columnSummaries(m: Matrix): ColumnSummary[] {
  const out: ColumnSummary[] = []
  for (const column of m.columns) {
    const values = columnValues(m, column.key)
    const nums = values.filter((v): v is number => v !== null)
    if (nums.length === 0) continue
    out.push({
      column,
      summary: summarize(nums),
      missing: values.length - nums.length,
      outliers: m.rows.filter((r) => r.cells[column.key]?.outlier).length,
      distinct: new Set(nums).size,
    })
  }
  return out
}

/** 숫자 값이 minN건 이상이고 값이 모두 같지는 않은 항목 */
export function numericColumns(m: Matrix, minN = MIN_N): Column[] {
  return columnSummaries(m)
    .filter((s) => (s.summary?.n ?? 0) >= minN && s.distinct > 1)
    .map((s) => s.column)
}

// ---------- 영향 주는 조건 ----------

export interface Driver {
  column: Column
  /** 이 조건과 결과 둘 다 숫자인 실험 수 */
  n: number
  r: number
  p: number
  rho: number
  rhoP: number
  /** 다른 조건을 고정했을 때의 표준화 계수(다중회귀에 들어간 조건만) */
  beta: number | null
  betaP: number | null
}

export interface DriverResult {
  target: Column
  drivers: Driver[]
  regression: { n: number; r2: number; adjR2: number; used: Column[] } | null
}

/**
 * 한 결과 항목에 대해 조건마다 상관(피어슨, 스피어먼)을 구하고 |r| 큰 순으로 줄 세운다.
 * 숫자 값이 minN건 이상인 조건만 본다. 상관이 큰 조건(최대 6개)을 한꺼번에 넣은 다중회귀도 함께 구해,
 * "다른 조건을 고정하고도 남는 영향"을 보여 준다(재료끼리 함께 움직이는 경우의 착시를 줄인다).
 */
export function rankDrivers(m: Matrix, targetKey: string, minN = MIN_N): DriverResult | null {
  const target = m.columns.find((c) => c.key === targetKey)
  if (!target) return null
  const y = columnValues(m, targetKey)
  const drivers: Driver[] = []
  for (const column of m.columns) {
    if (column.kind !== 'condition' || column.key === targetKey) continue
    const x = columnValues(m, column.key)
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i < x.length; i++) {
      if (x[i] !== null && y[i] !== null) {
        xs.push(x[i] as number)
        ys.push(y[i] as number)
      }
    }
    if (xs.length < minN) continue
    const c = pearson(xs, ys)
    const s = spearman(xs, ys)
    if (!c || !s) continue
    drivers.push({ column, n: c.n, r: c.r, p: c.p, rho: s.rho, rhoP: s.p, beta: null, betaP: null })
  }
  drivers.sort((a, b) => Math.abs(b.r) - Math.abs(a.r))

  let regression: DriverResult['regression'] = null
  for (let k = Math.min(6, drivers.length); k >= 1 && !regression; k--) {
    const chosen = drivers.slice(0, k)
    const idx: number[] = []
    for (let i = 0; i < y.length; i++) {
      if (y[i] !== null && chosen.every((d) => num(m.rows[i].cells[d.column.key]) !== null)) idx.push(i)
    }
    const fit = regressStandardized(
      idx.map((i) => chosen.map((d) => num(m.rows[i].cells[d.column.key]) as number)),
      idx.map((i) => y[i] as number),
    )
    if (!fit) continue
    regression = { n: fit.n, r2: fit.r2, adjR2: fit.adjR2, used: chosen.map((d) => d.column) }
    chosen.forEach((d, j) => {
      d.beta = fit.coefs[j].beta
      d.betaP = fit.coefs[j].p
    })
  }
  return { target, drivers, regression }
}

// ---------- 상관 행렬 ----------

export interface CorrelationView {
  columns: Column[]
  cells: (PairStat | null)[][]
}

/** 숫자 항목 사이의 상관 행렬. 항목이 너무 많으면 결과 항목과 변동이 큰 항목을 먼저 남겨 maxColumns개로 줄인다. */
export function correlationView(m: Matrix, maxColumns = 12, minN = MIN_N): CorrelationView | null {
  let cols = numericColumns(m, minN)
  if (cols.length < 2) return null
  if (cols.length > maxColumns) {
    cols = [...cols.filter((c) => c.kind === 'result'), ...cols.filter((c) => c.kind === 'condition')].slice(0, maxColumns)
  }
  // 결과가 아래쪽·오른쪽에 모이도록 조건 먼저
  cols = [...cols.filter((c) => c.kind === 'condition'), ...cols.filter((c) => c.kind === 'result')]
  const cells = correlationMatrix(
    cols.map((c) => ({ key: c.key, values: columnValues(m, c.key) })),
    minN,
  )
  return { columns: cols, cells }
}

// ---------- 그룹 비교 ----------

export interface GroupView extends GroupComparison {
  by: Column
  target: Column
}

/** 조건 값별로 결과를 나눠 비교한다. 값 종류가 2~12개이고 각 집단이 2건 이상일 때만 의미가 있다. */
export function compareBy(m: Matrix, byKey: string, targetKey: string): GroupView | null {
  const by = m.columns.find((c) => c.key === byKey)
  const target = m.columns.find((c) => c.key === targetKey)
  if (!by || !target || by.key === target.key) return null
  const groups = new Map<number, number[]>()
  for (const r of m.rows) {
    const g = num(r.cells[byKey])
    const v = num(r.cells[targetKey])
    if (g === null || v === null) continue
    const list = groups.get(g)
    if (list) list.push(v)
    else groups.set(g, [v])
  }
  if (groups.size < 2 || groups.size > 12) return null
  const unit = by.unit ? ` ${by.unit}` : ''
  const cmp = compareGroups(
    [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([g, values]) => ({ label: `${g}${unit}`, values })),
  )
  return cmp ? { ...cmp, by, target } : null
}

/** 그룹 비교로 볼 만한 조건들(집단 차이가 설명하는 비율 η²가 큰 순) */
export function groupCandidates(m: Matrix, targetKey: string): GroupView[] {
  const out: GroupView[] = []
  for (const c of m.columns) {
    if (c.kind !== 'condition') continue
    const g = compareBy(m, c.key, targetKey)
    if (g) out.push(g)
  }
  return out.sort((a, b) => b.eta2 - a.eta2)
}

// ---------- 상위·하위 실험 ----------

export interface Ranked {
  row: MatrixRow
  value: number
}

export function rankedExperiments(m: Matrix, key: string, direction: 'high' | 'low', count = 5): Ranked[] {
  const list: Ranked[] = []
  for (const row of m.rows) {
    const v = num(row.cells[key])
    if (v !== null) list.push({ row, value: v })
  }
  list.sort((a, b) => (direction === 'high' ? b.value - a.value : a.value - b.value))
  return list.slice(0, count)
}

// ---------- 한눈에 읽는 인사이트 ----------

export interface Insight {
  kind: 'driver' | 'group' | 'extreme' | 'caution'
  text: string
}

const f = (n: number) => String(Number(n.toPrecision(3)))
const label = (c: Column) => c.name

/**
 * 한 결과 항목에 대해 사람이 먼저 알아야 할 것을 문장으로 뽑는다. 단정하지 않고 근거(r, p, n)를 함께 적는다.
 * 같은 데이터에서 여러 번 비교하면 우연히 유의해 보이는 것이 생기므로 그 주의도 덧붙인다.
 */
export function buildInsights(m: Matrix, targetKey: string): Insight[] {
  const out: Insight[] = []
  const target = m.columns.find((c) => c.key === targetKey)
  if (!target) return out
  const unit = target.unit ? ` ${target.unit}` : ''
  const res = rankDrivers(m, targetKey)
  const sig = (res?.drivers ?? []).filter((d) => d.p < 0.05 && Math.abs(d.r) >= 0.2)
  if (res && sig.length > 0) {
    const top = sig[0]
    out.push({
      kind: 'driver',
      text: `${wagwa(label(target))} 가장 뚜렷하게 함께 움직이는 조건은 ${label(top.column)}입니다 (${describeStrength(top.r)} ${top.r > 0 ? '양의' : '음의'} 상관, r = ${top.r.toFixed(2)}, ${formatP(top.p)}, 실험 ${top.n}건). ${iga(label(top.column))} 클수록 ${label(target)}도 ${top.r > 0 ? '커지는' : '작아지는'} 경향입니다.`,
    })
    if (sig.length > 1) {
      out.push({
        kind: 'driver',
        text: `그 밖에 ${sig
          .slice(1, 4)
          .map((d) => `${label(d.column)}(r = ${d.r.toFixed(2)})`)
          .join(', ')}도 통계적으로 유의한 상관이 있습니다.`,
      })
    }
  } else if (res && res.drivers.length > 0) {
    out.push({ kind: 'driver', text: `${wagwa(label(target))} 뚜렷하게 상관된 조건이 아직 보이지 않습니다. 실험을 더 쌓거나 조건의 범위를 넓혀 보세요.` })
  }
  if (res?.regression) {
    const rg = res.regression
    out.push({
      kind: 'driver',
      text: `${eulreul(rg.used.map(label).join(', '))} 함께 고려하면 ${label(target)} 변동의 ${(rg.r2 * 100).toFixed(0)}%를 설명합니다 (보정 R² = ${rg.adjR2.toFixed(2)}, 실험 ${rg.n}건). 나머지는 이 표에 없는 요인이나 우연입니다.`,
    })
    const curved = res.drivers.filter((d) => d.rhoP < 0.05 && Math.abs(d.rho) - Math.abs(d.r) >= 0.2)
    if (curved.length > 0) {
      out.push({
        kind: 'driver',
        text: `${curved.map((d) => `${label(d.column)}(순위상관 ${d.rho.toFixed(2)} > 상관 ${d.r.toFixed(2)})`).join(', ')}은(는) 직선보다 곡선에 가까운 관계일 수 있습니다. 초반에 빠르게 늘고 뒤로 갈수록 완만해지는 모양이면 값에 로그를 씌워 보세요.`,
      })
    }
    const masked = res.drivers.filter((d) => d.beta !== null && d.betaP !== null && d.p < 0.05 && d.betaP >= 0.05)
    if (masked.length > 0) {
      out.push({
        kind: 'caution',
        text: `${masked.map((d) => label(d.column)).join(', ')}은(는) 단독으로는 상관이 있어 보이지만, 다른 조건을 함께 고려하면 영향이 뚜렷하지 않습니다. 다른 조건과 같이 움직였기 때문일 수 있습니다.`,
      })
    }
  }
  const groups = groupCandidates(m, targetKey).filter((g) => g.p < 0.05 && g.eta2 >= 0.1)
  if (groups.length > 0) {
    const g = groups[0]
    const best = [...g.groups].sort((a, b) => b.mean - a.mean)
    out.push({
      kind: 'group',
      text: `${label(g.by)}별로 나누면 ${label(target)} 평균이 다릅니다: ${best[0].label}에서 ${f(best[0].mean)}${unit}로 가장 높고 ${best[best.length - 1].label}에서 ${f(best[best.length - 1].mean)}${unit}로 가장 낮습니다 (${formatP(g.p)}, 차이가 설명하는 비율 η² = ${g.eta2.toFixed(2)}).`,
    })
  }
  const high = rankedExperiments(m, targetKey, 'high', 1)[0]
  const low = rankedExperiments(m, targetKey, 'low', 1)[0]
  if (high && low && high.row.experiment.id !== low.row.experiment.id) {
    out.push({
      kind: 'extreme',
      text: `${iga(label(target))} 가장 높은 실험은 "${high.row.experiment.title}" (${f(high.value)}${unit}), 가장 낮은 실험은 "${low.row.experiment.title}" (${f(low.value)}${unit})입니다.`,
    })
  }
  const n = m.rows.filter((r) => num(r.cells[targetKey]) !== null).length
  if (n < 20) {
    out.push({ kind: 'caution', text: `${label(target)} 값이 있는 실험이 ${n}건뿐이라 통계 결과가 흔들릴 수 있습니다. 경향을 확인하는 참고로만 보세요.` })
  }
  out.push({
    kind: 'caution',
    text: '상관이 곧 원인은 아닙니다. 여러 조건을 한꺼번에 비교하면 우연히 유의해 보이는 것이 섞일 수 있으니, 중요한 조건은 다른 조건을 고정한 실험으로 다시 확인하세요.',
  })
  return out
}

// ---------- 고객 요구를 달성한 조건 ----------

/** 필수 요구마다 달성 프로필에서 읽을 수 있는 문장 */
export function achievementInsights(m: Matrix, reqs: Requirement[]): Insight[] {
  const out: Insight[] = []
  for (const r of reqs.filter((x) => x.priority === 'must')) {
    const prof = achievementProfile(m, r)
    if (!prof) continue
    const top = prof.drivers.filter((d) => d.p < 0.05 && Math.abs(d.r) >= 0.2).slice(0, 3)
    if (top.length === 0) continue
    out.push({
      kind: 'driver',
      text: `"${describeRequirement(r)}"를 달성한 실험 ${prof.passing}건과 못 미친 ${prof.failing}건을 비교하면: ${top
        .map((d) => `${label(d.column)}는 달성한 쪽이 중앙값 ${f(d.passMedian)}${d.column.unit ? ` ${d.column.unit}` : ''}(대부분 ${f(d.passLow)}~${f(d.passHigh)}), 못 미친 쪽은 ${f(d.failMedian)}`)
        .join(' / ')}. 다음 실험은 이 범위에서 시작해 보세요.`,
    })
  }
  return out
}
