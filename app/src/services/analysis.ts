import type { DataItem, DataKind, Experiment, ID, Step } from '../domain/types'
import { isEmptyValue, parseNumber } from './validation'

/** 실험 한 건과 딸린 데이터. 프로젝트 화면의 모든 분석은 이 묶음에서 출발한다. */
export interface ExperimentBundle {
  experiment: Experiment
  steps: Step[]
  items: DataItem[]
}

// ---------- 이상치 ----------

/**
 * 수정 z 점수(중앙값과 MAD 기준)로 이상치 후보를 찾는다. 값이 5개 미만이면 판단하지 않는다.
 * 기준 3.5는 통계에서 흔히 쓰는 값이다. 후보일 뿐이며 사용자가 확인해야 한다.
 */
export function detectOutliers(values: number[], threshold = 3.5): boolean[] {
  const none = values.map(() => false)
  if (values.length < 5) return none
  const med = median(values)
  const devs = values.map((v) => Math.abs(v - med))
  const mad = median(devs)
  if (mad > 0) return devs.map((d) => (0.6745 * d) / mad > threshold)
  // 값 대부분이 같아 MAD가 0이면 평균 절대편차로 대신한다. 이 경우는 오탐이 쉬워서 기준을 더 엄격하게 둔다.
  const meanDev = devs.reduce((a, b) => a + b, 0) / devs.length
  if (meanDev === 0) return none
  return devs.map((d) => d / (1.253314 * meanDev) > threshold + 1.5)
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// ---------- 실험 × 항목 표 ----------

export interface Column {
  /** kind:정규화한 이름. 같은 항목을 실험마다 묶는 열쇠 */
  key: string
  kind: DataKind
  name: string
  /** 가장 많이 쓴 단위 */
  unit: string
  /** 이 항목이 있는 실험 수 */
  count: number
  /** 서로 다른 단위가 섞여 있으면 모두 */
  units: string[]
}

export interface Cell {
  value: string
  unit: string
  num: number | null
  empty: boolean
  outlier: boolean
}

export interface MatrixRow {
  experiment: Experiment
  cells: Record<string, Cell | undefined>
}

export interface Matrix {
  columns: Column[]
  rows: MatrixRow[]
}

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '')
}

export function columnKey(kind: DataKind, name: string): string {
  return `${kind}:${normalizeName(name)}`
}

/** 실험 순서: 시작 시각(없으면 만든 시각) 오름차순 */
export function orderOf(e: Experiment): string {
  return e.startedAt ?? e.createdAt
}

function mostCommon(list: string[]): string {
  const counts = new Map<string, number>()
  for (const x of list) counts.set(x, (counts.get(x) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? ''
}

/** 값 종류가 20개 이하(그리고 실험 수의 1/4 이하)이고 실험이 30건 이상이면 "정해 둔 수준"으로 보고 이상치 판단을 하지 않는다 */
const LEVELS_MAX_DISTINCT = 20
const LEVELS_MIN_N = 30

export function buildMatrix(bundles: ExperimentBundle[]): Matrix {
  const sorted = [...bundles].sort((a, b) => orderOf(a.experiment).localeCompare(orderOf(b.experiment)))
  const meta = new Map<string, { kind: DataKind; names: string[]; units: string[]; exps: Set<ID> }>()
  const rows: MatrixRow[] = sorted.map((b) => {
    const cells: Record<string, Cell | undefined> = {}
    for (const it of [...b.items].sort((a, c) => a.order - c.order)) {
      if (!it.name.trim()) continue
      const key = columnKey(it.kind, it.name)
      const m = meta.get(key) ?? { kind: it.kind, names: [], units: [], exps: new Set<ID>() }
      m.names.push(it.name.trim())
      if (it.unit.trim()) m.units.push(it.unit.trim())
      m.exps.add(b.experiment.id)
      meta.set(key, m)
      if (cells[key]) continue // 같은 항목이 두 번 있으면 첫 값만 쓴다.
      cells[key] = { value: it.value, unit: it.unit.trim(), num: parseNumber(it.value), empty: isEmptyValue(it.value), outlier: false }
    }
    return { experiment: b.experiment, cells }
  })

  const columns: Column[] = [...meta.entries()].map(([key, m]) => ({
    key,
    kind: m.kind,
    name: mostCommon(m.names),
    unit: mostCommon(m.units),
    count: m.exps.size,
    units: [...new Set(m.units)],
  }))
  // 조건을 먼저, 결과를 나중에. 같은 종류에서는 많이 쓴 항목부터.
  // 같은 횟수면 처음 입력한 순서를 따른다(시멘트, 슬래그, … 처럼 사람이 적은 차례가 유지된다).
  const firstSeen = new Map(columns.map((c, i) => [c.key, i]))
  columns.sort((a, b) =>
    a.kind === b.kind ? b.count - a.count || (firstSeen.get(a.key) ?? 0) - (firstSeen.get(b.key) ?? 0) : a.kind === 'condition' ? -1 : 1,
  )

  for (const col of columns) {
    const nums: { row: MatrixRow; v: number }[] = []
    for (const r of rows) {
      const c = r.cells[col.key]
      if (c && c.num !== null) nums.push({ row: r, v: c.num })
    }
    const values = nums.map((n) => n.v)
    // 재령처럼 몇 가지 값(수준)을 일부러 골라 반복하는 조건은 실험이 충분히 많으면 이상치로 보지 않는다(365일은 오류가 아니라 설계한 값이다).
    const designedLevels = values.length >= LEVELS_MIN_N && new Set(values).size <= Math.min(LEVELS_MAX_DISTINCT, values.length / 4)
    const flags = designedLevels ? values.map(() => false) : detectOutliers(values)
    nums.forEach((n, i) => {
      const c = n.row.cells[col.key]
      if (c) c.outlier = flags[i]
    })
  }
  return { columns, rows }
}

// ---------- 빠짐 점검 ----------

export type GapType = 'no-result' | 'empty-result' | 'open-steps' | 'stale' | 'missing-item' | 'outlier' | 'unit-mismatch'
export type Severity = 'high' | 'mid' | 'low'

export interface Gap {
  id: string
  type: GapType
  severity: Severity
  experimentId: ID
  experimentTitle: string
  message: string
}

export const GAP_LABEL: Record<GapType, string> = {
  'no-result': '결과 없음',
  'empty-result': '빈 결과',
  'open-steps': '미완료 단계',
  stale: '멈춘 실험',
  'missing-item': '빠진 항목',
  outlier: '이상치 후보',
  'unit-mismatch': '단위 불일치',
}

export const STALE_RUNNING_DAYS = 7
export const STALE_READY_DAYS = 14
const DAY = 86400000

/**
 * 한 프로젝트의 실험들에서 빠졌거나 의심스러운 것을 찾는다.
 * - 완료했는데 결과가 없거나 비어 있음, 미완료 단계가 남음
 * - 진행 중인데 7일 넘게 손대지 않음, 준비만 하고 14일 넘게 시작하지 않음
 * - 다른 실험은 대부분 쓰는 항목이 이 실험에는 없음
 * - 다른 실험과 많이 다른 값(이상치 후보), 같은 항목인데 단위가 다름
 */
export function findGaps(bundles: ExperimentBundle[], now: Date = new Date()): Gap[] {
  const gaps: Gap[] = []
  const matrix = buildMatrix(bundles)
  const add = (g: Omit<Gap, 'id'>) => gaps.push({ ...g, id: `${g.type}:${g.experimentId}:${gaps.length}` })

  for (const b of bundles) {
    const e = b.experiment
    const base = { experimentId: e.id, experimentTitle: e.title }
    const results = b.items.filter((i) => i.kind === 'result')
    const emptyResults = results.filter((r) => isEmptyValue(r.value))
    if (e.status === 'done') {
      if (results.length === 0) add({ ...base, type: 'no-result', severity: 'high', message: '결과를 기록하지 않고 완료했습니다.' })
      else if (emptyResults.length > 0) {
        add({ ...base, type: 'empty-result', severity: 'high', message: `비어 있는 결과: ${emptyResults.map((r) => r.name || '(이름 없음)').join(', ')}` })
      }
      const open = b.steps.filter((s) => !s.done).length
      if (open > 0) add({ ...base, type: 'open-steps', severity: 'mid', message: `완료했지만 미완료 단계가 ${open}개 남아 있습니다.` })
    }
    const idle = Math.floor((now.getTime() - new Date(e.updatedAt).getTime()) / DAY)
    if (e.status === 'running' && idle >= STALE_RUNNING_DAYS) {
      add({ ...base, type: 'stale', severity: 'mid', message: `진행 중인데 ${idle}일 동안 변경이 없습니다.` })
    }
    if (e.status === 'ready' && idle >= STALE_READY_DAYS) {
      add({ ...base, type: 'stale', severity: 'low', message: `준비만 해 두고 ${idle}일째 시작하지 않았습니다.` })
    }
  }

  // 빠진 항목: 같은 항목을 절반 이상의 실험(최소 2건)이 쓰는데 이 실험에는 없다.
  const active = matrix.rows.filter((r) => Object.keys(r.cells).length > 0 && r.experiment.status !== 'ready')
  for (const col of matrix.columns) {
    const usedBy = matrix.rows.filter((r) => r.cells[col.key]).length
    if (usedBy < 2 || usedBy < Math.ceil(active.length / 2)) continue
    for (const r of active) {
      if (r.cells[col.key]) continue
      // 결과 항목은 완료한 실험에서만 요구한다. 진행 중에는 아직 없는 게 정상이다.
      if (col.kind === 'result' && r.experiment.status !== 'done') continue
      add({
        experimentId: r.experiment.id,
        experimentTitle: r.experiment.title,
        type: 'missing-item',
        severity: 'mid',
        message: `다른 실험에는 ${col.kind === 'condition' ? '조건' : '결과'} "${col.name}"이(가) 있는데 이 실험에는 없습니다.`,
      })
    }
  }

  // 이상치 후보
  for (const col of matrix.columns) {
    const nums = matrix.rows.map((r) => r.cells[col.key]).filter((c): c is Cell => !!c && c.num !== null)
    for (const r of matrix.rows) {
      const c = r.cells[col.key]
      if (!c?.outlier) continue
      const others = nums.filter((n) => n !== c).map((n) => n.num as number)
      add({
        experimentId: r.experiment.id,
        experimentTitle: r.experiment.title,
        type: 'outlier',
        severity: 'mid',
        message: `${col.name} ${c.value}${c.unit ? ' ' + c.unit : ''}은(는) 다른 실험(${Math.min(...others)}~${Math.max(...others)})과 많이 다릅니다. 입력이나 측정을 확인하세요.`,
      })
    }
  }

  // 단위 불일치
  for (const col of matrix.columns) {
    if (col.units.length < 2) continue
    for (const r of matrix.rows) {
      const c = r.cells[col.key]
      if (c && c.unit && c.unit !== col.unit) {
        add({
          experimentId: r.experiment.id,
          experimentTitle: r.experiment.title,
          type: 'unit-mismatch',
          severity: 'high',
          message: `${col.name}의 단위가 ${c.unit}입니다. 다른 실험은 대부분 ${col.unit}를 씁니다.`,
        })
      }
    }
  }
  const order: Record<Severity, number> = { high: 0, mid: 1, low: 2 }
  return gaps.sort((a, b) => order[a.severity] - order[b.severity] || a.experimentTitle.localeCompare(b.experimentTitle, 'ko'))
}

// ---------- 차트 데이터 ----------

export interface Point {
  experimentId: ID
  title: string
  x: number
  y: number
  outlier: boolean
}

/** 두 항목이 모두 숫자인 실험만 점으로 만든다. */
export function scatterPoints(m: Matrix, xKey: string, yKey: string): Point[] {
  const out: Point[] = []
  for (const r of m.rows) {
    const x = r.cells[xKey]
    const y = r.cells[yKey]
    if (x?.num != null && y?.num != null) {
      out.push({ experimentId: r.experiment.id, title: r.experiment.title, x: x.num, y: y.num, outlier: !!(x.outlier || y.outlier) })
    }
  }
  return out
}

/** 실험 순서(시작 시각순)에 따른 한 항목의 값. x는 값이 있는 실험만 센 1부터의 순번. */
export function trendPoints(m: Matrix, key: string): Point[] {
  const out: Point[] = []
  for (const r of m.rows) {
    const c = r.cells[key]
    if (c?.num != null) out.push({ experimentId: r.experiment.id, title: r.experiment.title, x: out.length + 1, y: c.num, outlier: c.outlier })
  }
  return out
}

/** 피어슨 상관계수와 최소제곱 직선. 점이 3개 미만이거나 한 축 값이 모두 같으면 null. */
export function linearFit(points: { x: number; y: number }[]): { r: number; slope: number; intercept: number } | null {
  const n = points.length
  if (n < 3) return null
  const mx = points.reduce((a, p) => a + p.x, 0) / n
  const my = points.reduce((a, p) => a + p.y, 0) / n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const p of points) {
    sxx += (p.x - mx) ** 2
    syy += (p.y - my) ** 2
    sxy += (p.x - mx) * (p.y - my)
  }
  if (sxx === 0 || syy === 0) return null
  const slope = sxy / sxx
  return { r: sxy / Math.sqrt(sxx * syy), slope, intercept: my - slope * mx }
}

export interface TimelineBar {
  experiment: Experiment
  start: number
  end: number
  open: boolean
}

/** 시작 시각이 있는 실험의 기간 막대. 진행 중이면 지금까지. */
export function timelineBars(bundles: ExperimentBundle[], now: Date = new Date()): TimelineBar[] {
  return bundles
    .filter((b) => b.experiment.startedAt)
    .map((b) => {
      const e = b.experiment
      const start = new Date(e.startedAt as string).getTime()
      const end = e.status === 'done' && e.completedAt ? new Date(e.completedAt).getTime() : now.getTime()
      return { experiment: e, start, end: Math.max(end, start + 3600000), open: e.status !== 'done' }
    })
    .sort((a, b) => a.start - b.start)
}

export function statusCounts(bundles: ExperimentBundle[]): { ready: number; running: number; done: number } {
  const c = { ready: 0, running: 0, done: 0 }
  for (const b of bundles) c[b.experiment.status]++
  return c
}

// ---------- 눈금 ----------

/** 보기 좋은 눈금 값들. 예: (0.6, 3.9) → 0, 1, 2, 3, 4 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1
    min -= pad
    max += pad
  }
  const rough = (max - min) / Math.max(1, count)
  const pow = 10 ** Math.floor(Math.log10(rough))
  const frac = rough / pow
  const step = (frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10) * pow
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = start; v <= end + step / 2; v += step) out.push(Number(v.toPrecision(12)))
  return out
}

// ---------- CSV ----------

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** 프로젝트의 실험 × 항목 표를 CSV 글자로 만든다. 엑셀에서 한글이 깨지지 않도록 앞에 BOM을 붙인다. */
export function matrixToCsv(m: Matrix): string {
  const header = ['실험', '상태', '시작', ...m.columns.map((c) => `${c.name}${c.unit ? ` (${c.unit})` : ''}`)]
  const status = { ready: '준비', running: '진행', done: '완료' } as const
  const lines = [header, ...m.rows.map((r) => [r.experiment.title, status[r.experiment.status], (r.experiment.startedAt ?? '').slice(0, 10), ...m.columns.map((c) => r.cells[c.key]?.value ?? '')])]
  return '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n')
}
