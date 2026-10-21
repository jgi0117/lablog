import type { Column, Matrix } from '../../../domain/analysis/analysis'
import { columnSummaries } from '../../../domain/analysis/insights'

/**
 * 실험 × 항목 표를 다른 도구(엑셀, 파이썬, R, 머신러닝)로 가져갈 수 있는 파일 글자로 만든다.
 * 열 이름은 "항목 (단위)" 모양이며, 같은 항목에 단위가 섞여 있으면 단위를 바꾸지 않고 그대로 내보내므로 데이터 사전에서 알려 준다.
 */

const STATUS_LABEL = { ready: '준비', running: '진행', done: '완료' } as const
const BOM = '﻿'

function cell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function toCsv(lines: string[][], bom: boolean): string {
  return (bom ? BOM : '') + lines.map((l) => l.map(cell).join(',')).join('\r\n')
}

export const columnLabel = (c: Column) => (c.unit ? `${c.name} (${c.unit})` : c.name)

export interface ExportOptions {
  /** 프로젝트 id → 이름. 없으면 프로젝트 열을 비운다 */
  projectNames?: Map<string, string>
  /** 열 일부만 내보낼 때 항목 key 목록. 없으면 모두 */
  columnKeys?: string[]
}

function pickColumns(m: Matrix, opts: ExportOptions): Column[] {
  if (!opts.columnKeys) return m.columns
  const want = new Set(opts.columnKeys)
  return m.columns.filter((c) => want.has(c.key))
}

const meta = (r: Matrix['rows'][number], names?: Map<string, string>) => [
  r.experiment.id,
  (r.experiment.projectId && names?.get(r.experiment.projectId)) || '',
  r.experiment.title,
  STATUS_LABEL[r.experiment.status],
  (r.experiment.startedAt ?? '').slice(0, 10),
]

/**
 * 넓은 형식: 실험 한 건이 한 줄, 조건·결과가 열이다. 엑셀로 열 때 한글이 깨지지 않도록 BOM을 붙인다.
 * numericOnly면 숫자로 읽히는 값만 담고(나머지는 빈칸), 숫자 값이 하나도 없는 열은 뺀다. 모델에 바로 넣는 용도다.
 */
export function wideCsv(m: Matrix, opts: ExportOptions & { numericOnly?: boolean; bom?: boolean } = {}): string {
  let cols = pickColumns(m, opts)
  if (opts.numericOnly) cols = cols.filter((c) => m.rows.some((r) => r.cells[c.key]?.num != null))
  const header = ['experiment_id', '프로젝트', '실험', '상태', '시작일', ...cols.map(columnLabel)]
  const rows = m.rows.map((r) => [
    ...meta(r, opts.projectNames),
    ...cols.map((c) => {
      const x = r.cells[c.key]
      if (!x) return ''
      return opts.numericOnly ? (x.num != null ? String(x.num) : '') : x.value
    }),
  ])
  return toCsv([header, ...rows], opts.bom ?? !opts.numericOnly)
}

/** 긴 형식(tidy): 값 하나가 한 줄. 항목 수가 실험마다 달라도 되고, 통계 패키지에서 그룹 분석하기 좋다. */
export function tidyCsv(m: Matrix, opts: ExportOptions = {}): string {
  const keep = new Set(pickColumns(m, opts).map((c) => c.key))
  const header = ['experiment_id', '프로젝트', '실험', '상태', '시작일', '구분', '항목', '값', '숫자값', '단위']
  const lines: string[][] = [header]
  for (const r of m.rows) {
    for (const c of m.columns) {
      const x = r.cells[c.key]
      if (!x || !keep.has(c.key)) continue
      lines.push([...meta(r, opts.projectNames), c.kind === 'condition' ? '조건' : '결과', c.name, x.value, x.num != null ? String(x.num) : '', x.unit])
    }
  }
  return toCsv(lines, true)
}

/** 데이터 사전: 항목마다 종류, 단위, 건수, 결측, 기본 통계. 내보낸 파일의 열이 무엇인지 설명한다. */
export function dictionaryCsv(m: Matrix, opts: ExportOptions = {}): string {
  const keep = new Set(pickColumns(m, opts).map((c) => c.key))
  const sums = new Map(columnSummaries(m).map((s) => [s.column.key, s]))
  const header = ['열 이름', '구분', '항목', '단위', '단위 종류', '실험 수', '숫자 값 수', '결측', '평균', '표준편차', '최소', '중앙값', '최대', '이상치 후보']
  const fmt = (n: number | undefined) => (n === undefined ? '' : String(Number(n.toPrecision(6))))
  const lines = m.columns
    .filter((c) => keep.has(c.key))
    .map((c) => {
      const s = sums.get(c.key)
      const sm = s?.summary
      return [
        columnLabel(c),
        c.kind === 'condition' ? '조건' : '결과',
        c.name,
        c.unit,
        c.units.length > 1 ? `섞여 있음: ${c.units.join(' / ')}` : '',
        String(c.count),
        String(sm?.n ?? 0),
        String(s?.missing ?? m.rows.length),
        fmt(sm?.mean),
        fmt(sm?.sd),
        fmt(sm?.min),
        fmt(sm?.median),
        fmt(sm?.max),
        String(s?.outliers ?? 0),
      ]
    })
  return toCsv([header, ...lines], true)
}

/** JSON: 실험마다 조건과 결과를 이름으로 묶은 객체. 웹이나 노트북에서 바로 읽기 쉽다. */
export function jsonExport(m: Matrix, opts: ExportOptions = {}): string {
  const cols = pickColumns(m, opts)
  const body = {
    exportedAt: new Date().toISOString(),
    columns: cols.map((c) => ({ name: c.name, kind: c.kind, unit: c.unit, units: c.units, experiments: c.count })),
    experiments: m.rows.map((r) => {
      const conditions: Record<string, { value: string; number: number | null; unit: string }> = {}
      const results: Record<string, { value: string; number: number | null; unit: string }> = {}
      for (const c of cols) {
        const x = r.cells[c.key]
        if (!x) continue
        ;(c.kind === 'condition' ? conditions : results)[c.name] = { value: x.value, number: x.num, unit: x.unit }
      }
      return {
        id: r.experiment.id,
        project: (r.experiment.projectId && opts.projectNames?.get(r.experiment.projectId)) || null,
        title: r.experiment.title,
        status: r.experiment.status,
        startedAt: r.experiment.startedAt,
        tags: r.experiment.tags,
        conditions,
        results,
      }
    }),
  }
  return JSON.stringify(body, null, 2)
}

/** 내려받은 분석용 CSV를 파이썬(pandas)으로 읽는 예. 파일 이름을 넣어 그대로 붙여 넣을 수 있게 한다. */
export function pandasSnippet(fileName: string, targetColumn?: string): string {
  const target = targetColumn ?? '압축강도 (MPa)'
  return [
    'import pandas as pd',
    '',
    `df = pd.read_csv("${fileName}")`,
    'print(df.describe())              # 기본 통계',
    `X = df.drop(columns=["experiment_id", "프로젝트", "실험", "상태", "시작일", "${target}"])`,
    `y = df["${target}"]`,
    'mask = y.notna()                  # 결과가 비어 있는 실험은 학습에서 뺀다',
    'X, y = X[mask], y[mask]',
  ].join('\n')
}
