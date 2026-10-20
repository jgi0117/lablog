import type { Requirement } from '../domain/types'
import { normalizeName, type Cell, type Column, type Matrix, type MatrixRow } from './analysis'

/**
 * 고객 요구 특성(Requirement)을 실험 값과 맞춰 달성 여부를 판정한다.
 * 신제품 개발은 "고객이 요청한 특성을 만족하는 조건을 찾는 일"이라서, 프로젝트가 요구를 들고 있고
 * 실험의 같은 이름 항목(조건 또는 결과)을 읽어 실험마다, 배합(조건 묶음)마다, 프로젝트 전체로 판정한다.
 */

export type Verdict = 'pass' | 'fail' | 'unknown' | 'na'

const f = (n: number) => String(Number(n.toPrecision(6)))

/** 사람이 읽는 한 줄. 예) "재령 28 일일 때 압축강도 ≥ 40 MPa" */
export function describeRequirement(r: Requirement): string {
  const unit = r.unit ? ` ${r.unit}` : ''
  let rule = ''
  if (r.kind === 'min') rule = `≥ ${f(r.min ?? 0)}${unit}`
  else if (r.kind === 'max') rule = `≤ ${f(r.max ?? 0)}${unit}`
  else if (r.kind === 'range') rule = `${f(r.min ?? 0)} ~ ${f(r.max ?? 0)}${unit}`
  else rule = `${f(r.target ?? 0)}${unit} ± ${f(r.tolerance ?? 0)}`
  const when = r.at ? `${r.at.name} ${f(r.at.value)}일 때 ` : ''
  return `${when}${r.name} ${rule}`
}

/** 한계값이 빠졌거나 순서가 뒤집힌 요구는 판정할 수 없다. 이유를 돌려주고, 괜찮으면 null. */
export function validateRequirement(r: Requirement): string | null {
  if (!r.name.trim()) return '항목 이름을 입력하세요'
  if (r.kind === 'min' && r.min === undefined) return '이상 값을 입력하세요'
  if (r.kind === 'max' && r.max === undefined) return '이하 값을 입력하세요'
  if (r.kind === 'range') {
    if (r.min === undefined || r.max === undefined) return '범위의 최소와 최대를 모두 입력하세요'
    if (r.min > r.max) return '최소가 최대보다 클 수 없습니다'
  }
  if (r.kind === 'target' && r.target === undefined) return '목표값을 입력하세요'
  if (r.kind === 'target' && (r.tolerance ?? 0) < 0) return '허용 오차는 0 이상이어야 합니다'
  if (r.at && !r.at.name.trim()) return '적용 조건의 항목 이름을 입력하세요'
  return null
}

/**
 * 값이 요구를 만족하는지와, 얼마나 모자란지(shortfall: 0이면 만족, 클수록 멀다. 목표 크기에 대한 비율).
 */
export function checkValue(r: Requirement, v: number): { ok: boolean; shortfall: number } {
  const rel = (gap: number, base: number) => gap / Math.max(Math.abs(base), 1e-9)
  let gap = 0
  let base = 1
  if (r.kind === 'min') {
    base = r.min ?? 0
    gap = base - v
  } else if (r.kind === 'max') {
    base = r.max ?? 0
    gap = v - base
  } else if (r.kind === 'range') {
    const lo = r.min ?? 0
    const hi = r.max ?? 0
    base = (lo + hi) / 2
    gap = v < lo ? lo - v : v > hi ? v - hi : 0
  } else {
    base = r.target ?? 0
    gap = Math.abs(v - base) - (r.tolerance ?? 0)
  }
  return gap <= 1e-12 ? { ok: true, shortfall: 0 } : { ok: false, shortfall: rel(gap, base) }
}

/** 요구 이름과 같은 항목(조건 또는 결과). 둘 다 있으면 결과를 우선한다. */
export function columnFor(m: Matrix, name: string): Column | undefined {
  const key = normalizeName(name)
  const hits = m.columns.filter((c) => normalizeName(c.name) === key)
  return hits.find((c) => c.kind === 'result') ?? hits[0]
}

const cellNum = (c: Cell | undefined): number | null => (c && c.num !== null ? c.num : null)

export interface RowVerdict {
  verdict: Verdict
  value: number | null
  shortfall: number
}

/** 한 실험을 한 요구에 대해 판정한다. 적용 조건이 다르면 na, 값이 없거나 숫자가 아니면 unknown. */
export function evaluateRow(m: Matrix, row: MatrixRow, r: Requirement): RowVerdict {
  if (r.at) {
    const atCol = columnFor(m, r.at.name)
    const atVal = atCol ? cellNum(row.cells[atCol.key]) : null
    if (atVal === null || atVal !== r.at.value) return { verdict: 'na', value: null, shortfall: 0 }
  }
  const col = columnFor(m, r.name)
  const v = col ? cellNum(row.cells[col.key]) : null
  if (v === null) return { verdict: 'unknown', value: null, shortfall: 0 }
  const c = checkValue(r, v)
  return { verdict: c.ok ? 'pass' : 'fail', value: v, shortfall: c.shortfall }
}

export interface RequirementProgress {
  requirement: Requirement
  /** 이 요구를 판정할 수 있는 실험 수(적용 조건에 맞고 값이 있는 것) */
  judged: number
  passing: number
  /** 요구에 가장 가까운 실험(만족하는 것 중에서는 가장 여유 있는 것은 따로 구하지 않고, 값이 가장 가까운 것) */
  best: { row: MatrixRow; value: number; shortfall: number } | null
  status: 'achieved' | 'not-yet' | 'no-data'
}

export function progressFor(m: Matrix, r: Requirement): RequirementProgress {
  let judged = 0
  let passing = 0
  let best: RequirementProgress['best'] = null
  for (const row of m.rows) {
    const ev = evaluateRow(m, row, r)
    if (ev.verdict === 'na' || ev.verdict === 'unknown') continue
    judged++
    if (ev.verdict === 'pass') passing++
    if (ev.value !== null && (best === null || ev.shortfall < best.shortfall)) best = { row, value: ev.value, shortfall: ev.shortfall }
  }
  return { requirement: r, judged, passing, best, status: judged === 0 ? 'no-data' : passing > 0 ? 'achieved' : 'not-yet' }
}

// ---------- 배합(조건 묶음) 단위 ----------

export interface Recipe {
  /** 조건 값이 같은 실험의 묶음. 적용 조건(예: 재령)은 묶는 기준에서 뺀다 */
  rows: MatrixRow[]
  verdicts: { requirement: Requirement; verdict: Verdict; value: number | null; shortfall: number }[]
  /** 꼭 필요한(must) 요구 중 만족한 개수와 전체 */
  mustMet: number
  mustTotal: number
  /** 못 맞춘 must 요구의 모자란 정도 합(작을수록 가깝다). 판정 못 한 요구는 1로 센다 */
  distance: number
  achieved: boolean
}

/**
 * 실험을 "배합"(적용 조건을 뺀 모든 조건의 값이 같은 묶음)으로 묶어, 배합 하나가 요구를 모두 만족하는지 본다.
 * 예) 같은 배합의 7일·28일 시험을 함께 보고 "7일 ≥ 20 이고 28일 ≥ 40"을 한 배합이 만족하는지.
 * 적용 조건이 없는 요구는 배합의 실험 중 하나라도 만족하면 만족한 것으로 본다(조건 제한은 배합 안에서 같다).
 */
export function recipes(m: Matrix, reqs: Requirement[]): Recipe[] {
  const atNames = new Set(reqs.filter((r) => r.at).map((r) => normalizeName(r.at!.name)))
  const keyCols = m.columns.filter((c) => c.kind === 'condition' && !atNames.has(normalizeName(c.name)))
  const groups = new Map<string, MatrixRow[]>()
  for (const row of m.rows) {
    const key = keyCols.map((c) => row.cells[c.key]?.value.trim() ?? '').join('|')
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }
  const musts = reqs.filter((r) => r.priority === 'must')
  return [...groups.values()].map((rows) => {
    const verdicts = reqs.map((requirement) => {
      let best: RowVerdict | null = null
      for (const row of rows) {
        const ev = evaluateRow(m, row, requirement)
        if (ev.verdict === 'na' || ev.verdict === 'unknown') continue
        if (best === null || (ev.verdict === 'pass' && best.verdict !== 'pass') || (ev.verdict === best.verdict && ev.shortfall < best.shortfall)) best = ev
      }
      return best ? { requirement, verdict: best.verdict, value: best.value, shortfall: best.shortfall } : { requirement, verdict: 'unknown' as Verdict, value: null, shortfall: 0 }
    })
    const mustVerdicts = verdicts.filter((v) => v.requirement.priority === 'must')
    const mustMet = mustVerdicts.filter((v) => v.verdict === 'pass').length
    const distance = mustVerdicts.reduce((s, v) => s + (v.verdict === 'pass' ? 0 : v.verdict === 'fail' ? v.shortfall : 1), 0)
    return { rows, verdicts, mustMet, mustTotal: musts.length, distance, achieved: musts.length > 0 && mustMet === musts.length }
  })
}

export interface ProjectRequirementStatus {
  items: RequirementProgress[]
  /** 필수 요구를 모두 만족한 배합 */
  achievedRecipes: Recipe[]
  /** 아직 없을 때 가장 가까운 배합(만족한 must가 많고 모자란 정도가 작은 것) */
  closest: Recipe | null
  mustTotal: number
  mustAchieved: number
  /** 필수 요구가 하나도 없으면 null */
  overall: 'achieved' | 'in-progress' | 'no-data' | null
}

export function projectStatus(m: Matrix, reqs: Requirement[]): ProjectRequirementStatus {
  const items = reqs.map((r) => progressFor(m, r))
  const musts = items.filter((i) => i.requirement.priority === 'must')
  const all = recipes(m, reqs)
  const achievedRecipes = all.filter((r) => r.achieved)
  const rank = (r: Recipe) => [-r.mustMet, r.distance]
  const closest =
    achievedRecipes.length > 0 || musts.length === 0
      ? null
      : (all.filter((r) => r.rows.some((row) => row.experiment.status !== 'ready')).sort((a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1] - rank(b)[1])[0] ?? null)
  const mustAchieved = musts.filter((i) => i.status === 'achieved').length
  return {
    items,
    achievedRecipes,
    closest,
    mustTotal: musts.length,
    mustAchieved,
    overall: musts.length === 0 ? null : achievedRecipes.length > 0 ? 'achieved' : items.every((i) => i.status === 'no-data') ? 'no-data' : 'in-progress',
  }
}

/** 실험 한 건이 판정 가능한 요구 중 몇 개를 만족하는지(실험 화면의 한 줄 요약용) */
export function rowSummary(m: Matrix, row: MatrixRow, reqs: Requirement[]): { pass: number; fail: number; unknown: number; applicable: number } {
  let pass = 0
  let fail = 0
  let unknown = 0
  for (const r of reqs) {
    const ev = evaluateRow(m, row, r)
    if (ev.verdict === 'pass') pass++
    else if (ev.verdict === 'fail') fail++
    else if (ev.verdict === 'unknown') unknown++
  }
  return { pass, fail, unknown, applicable: pass + fail + unknown }
}
