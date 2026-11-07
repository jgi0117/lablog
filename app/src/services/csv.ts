import { emptyDb, inputsOf, levelsOf, outputsOf, type Db, type Goal, type ID, type Project, type Run, type Variable } from '../domain/types'
import { newId, now } from './store'

/**
 * 표(CSV) ↔ 프로젝트·실험 변환, 전체 백업(JSON) 내보내기·가져오기.
 * 예전 lablog(실험 노트, 백업 schemaVersion 2) 백업도 읽어서 조건·결과만 옮긴다.
 */

// ---------- CSV 읽기 ----------

export interface Table {
  headers: string[]
  rows: string[][]
}

export function parseCsv(text: string): Table {
  const t = text.replace(/^﻿/, '')
  const firstLine = t.split(/\r?\n/, 1)[0] ?? ''
  const delim = [',', '\t', ';'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''))
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim())
  return { headers, rows: nonEmpty.map((r) => headers.map((_, j) => (r[j] ?? '').trim())) }
}

export function toNumber(s: string): number | null {
  const t = s.replace(/,/g, '').replace(/^[≈~약]\s*/, '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** "이름 (단위)" 또는 "이름(단위)"를 나눈다 */
export function splitHeader(h: string): { name: string; unit: string } {
  const m = /^(.*?)\s*[(（[]([^()（）[\]]*)[)）\]]\s*$/.exec(h)
  if (m && m[1].trim()) return { name: m[1].trim(), unit: m[2].trim() }
  return { name: h.trim(), unit: '' }
}

function decimalsOf(values: string[]): number {
  let d = 0
  for (const v of values) {
    const m = /\.(\d+)$/.exec(v.trim())
    if (m) d = Math.max(d, m[1].length)
  }
  return Math.min(d, 4)
}

export interface TableOptions {
  outputs: Set<string>
  levels?: Set<string>
  goals?: Goal[]
  note?: string
  initialRuns?: number
}

/** 표를 프로젝트 하나와 완료 실험들로 바꾼다. 숫자 열만 쓴다. outputs 머리글은 출력, levels는 level, 나머지는 입력 */
export function tableToProject(name: string, table: Table, opts: TableOptions): { project: Project; runs: Run[] } {
  const numericCols = table.headers.map((_, j) => table.rows.some((r) => toNumber(r[j]) !== null))
  const variables: Variable[] = []
  const colVar: (Variable | null)[] = table.headers.map((h, j) => {
    if (!numericCols[j]) return null
    const { name: vname, unit } = splitHeader(h)
    const vals = table.rows.map((r) => toNumber(r[j])).filter((v): v is number => v !== null)
    const role: Variable['role'] = opts.outputs.has(h) ? 'output' : opts.levels?.has(h) ? 'level' : 'input'
    const v: Variable = { id: newId('v'), name: vname, unit, role, decimals: decimalsOf(table.rows.map((r) => r[j])) }
    if (role === 'input') {
      v.min = Math.min(...vals)
      v.max = Math.max(...vals)
    }
    if (role === 'level') v.levels = [...new Set(vals)].sort((a, b) => a - b).slice(0, 12)
    variables.push(v)
    return v
  })
  const project: Project = { id: newId('p'), name, note: opts.note ?? '', variables, goals: opts.goals ?? [], initialRuns: opts.initialRuns ?? 8, created: now(), updated: now() }
  const runs: Run[] = table.rows.map((r, i) => {
    const x: Record<ID, number> = {}
    const y: Record<ID, number> = {}
    colVar.forEach((v, j) => {
      if (!v) return
      const n = toNumber(r[j])
      if (n === null) return
      if (v.role === 'output') y[v.id] = n
      else x[v.id] = n
    })
    return { id: newId('r'), project: project.id, order: i + 1, x, y, status: Object.keys(y).length > 0 ? 'done' : 'planned', source: 'import', note: '', date: null }
  })
  return { project, runs }
}

/** 이미 있는 프로젝트에 표의 행을 완료 실험으로 더한다. 머리글은 변수 이름(단위 유무 무관)과 맞춘다 */
export function tableToRuns(p: Project, table: Table, startOrder: number): { runs: Run[]; matched: Variable[]; unmatched: string[] } {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
  const byName = new Map(p.variables.map((v) => [norm(v.name), v]))
  const colVar = table.headers.map((h) => byName.get(norm(splitHeader(h).name)) ?? byName.get(norm(h)) ?? null)
  const matched = colVar.filter((v): v is Variable => v !== null)
  const unmatched = table.headers.filter((_, j) => !colVar[j])
  let order = startOrder
  const runs: Run[] = []
  for (const r of table.rows) {
    const x: Record<ID, number> = {}
    const y: Record<ID, number> = {}
    colVar.forEach((v, j) => {
      if (!v) return
      const n = toNumber(r[j])
      if (n === null) return
      if (v.role === 'output') y[v.id] = n
      else x[v.id] = n
    })
    if (Object.keys(x).length === 0 && Object.keys(y).length === 0) continue
    runs.push({ id: newId('r'), project: p.id, order: order++, x, y, status: Object.keys(y).length > 0 ? 'done' : 'planned', source: 'import', note: '', date: null })
  }
  return { runs, matched, unmatched }
}

// ---------- CSV 쓰기 ----------

export function runsToCsv(p: Project, runs: Run[]): string {
  const vars = [...inputsOf(p), ...levelsOf(p), ...outputsOf(p)]
  const head = ['순서', '상태', ...vars.map((v) => (v.unit ? `${v.name} (${v.unit})` : v.name)), '날짜', '메모']
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = [head.map(esc).join(',')]
  for (const r of [...runs].sort((a, b) => a.order - b.order)) {
    const cells = [String(r.order), r.status === 'done' ? '완료' : r.status === 'planned' ? '계획' : '건너뜀', ...vars.map((v) => {
      const val = v.role === 'output' ? r.y[v.id] : r.x[v.id]
      return Number.isFinite(val) ? String(val) : ''
    }), r.date ?? '', r.note]
    lines.push(cells.map(esc).join(','))
  }
  return '﻿' + lines.join('\n')
}

// ---------- 전체 백업 ----------

export function exportDb(db: Db): string {
  return JSON.stringify({ app: 'lablog', ...db, exported: now() }, null, 1)
}

/** v3 백업 또는 예전 lablog 백업(schemaVersion 2)을 읽는다. 모양이 맞지 않으면 null */
export function parseBackup(text: string): Db | null {
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  if (o.version === 3 && Array.isArray(o.projects) && Array.isArray(o.runs)) return { version: 3, projects: o.projects as Project[], runs: o.runs as Run[] }
  if (Array.isArray(o.projects) && Array.isArray(o.experiments) && Array.isArray(o.dataItems)) return fromLegacy(o)
  return null
}

interface LegacyReq {
  name: string
  unit?: string
  kind: 'min' | 'max' | 'range' | 'target'
  min?: number
  max?: number
  target?: number
  tolerance?: number
  at?: { name: string; value: number }
  priority?: 'must' | 'nice'
}
interface LegacyProject {
  id: string
  name: string
  description?: string
  customer?: string
  requirements?: LegacyReq[]
  deletedAt?: string | null
}
interface LegacyExperiment {
  id: string
  projectId: string | null
  title?: string
  status?: string
  startedAt?: string | null
  completedAt?: string | null
  deletedAt?: string | null
}
interface LegacyItem {
  experimentId: string
  kind: 'condition' | 'result'
  name: string
  value: string
  unit?: string
}

/** 예전 실험 노트 백업: 프로젝트마다 조건 이름을 입력, 결과 이름을 출력으로 삼고 숫자 값만 옮긴다 */
function fromLegacy(o: Record<string, unknown>): Db {
  const projects = (o.projects as LegacyProject[]).filter((p) => !p.deletedAt)
  const experiments = (o.experiments as LegacyExperiment[]).filter((e) => !e.deletedAt)
  const items = o.dataItems as LegacyItem[]
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
  const db = emptyDb()
  for (const lp of projects) {
    const exps = experiments.filter((e) => e.projectId === lp.id)
    const byExp = new Map<string, LegacyItem[]>()
    for (const it of items) byExp.set(it.experimentId, [...(byExp.get(it.experimentId) ?? []), it])
    const reqs = lp.requirements ?? []
    const atNames = new Set(reqs.filter((r) => r.at).map((r) => norm(r.at!.name)))
    const vars = new Map<string, Variable>()
    const valuesByVar = new Map<string, string[]>()
    for (const e of exps) {
      for (const it of byExp.get(e.id) ?? []) {
        if (!it.name.trim()) continue
        const key = `${it.kind}:${norm(it.name)}`
        if (!vars.has(key)) {
          const role: Variable['role'] = it.kind === 'result' ? 'output' : atNames.has(norm(it.name)) ? 'level' : 'input'
          vars.set(key, { id: newId('v'), name: it.name.trim(), unit: (it.unit ?? '').trim(), role, decimals: 0 })
          valuesByVar.set(key, [])
        }
        valuesByVar.get(key)!.push(it.value)
      }
    }
    for (const [key, v] of vars) {
      const raw = valuesByVar.get(key) ?? []
      v.decimals = decimalsOf(raw)
      const nums = raw.map(toNumber).filter((n): n is number => n !== null)
      if (v.role === 'input' && nums.length) {
        v.min = Math.min(...nums)
        v.max = Math.max(...nums)
      }
      if (v.role === 'level') v.levels = [...new Set(reqs.filter((r) => r.at && norm(r.at.name) === norm(v.name)).map((r) => r.at!.value))].sort((a, b) => a - b)
    }
    const variables = [...vars.values()]
    const findVar = (name: string, prefer: Variable['role'][]) => {
      const hits = variables.filter((v) => norm(v.name) === norm(name))
      for (const role of prefer) {
        const h = hits.find((v) => v.role === role)
        if (h) return h
      }
      return hits[0]
    }
    const goals: Goal[] = []
    for (const r of reqs) {
      const v = findVar(r.name, ['output', 'input', 'level'])
      if (!v) continue
      const at = r.at ? findVar(r.at.name, ['level', 'input']) : undefined
      const g: Goal = { id: newId('g'), variable: v.id, op: '>=', must: r.priority !== 'nice' }
      if (r.kind === 'min') {
        g.op = '>='
        g.lo = r.min
      } else if (r.kind === 'max') {
        g.op = '<='
        g.hi = r.max
      } else if (r.kind === 'range') {
        g.op = 'between'
        g.lo = r.min
        g.hi = r.max
      } else {
        g.op = 'target'
        g.target = r.target ?? 0
        g.tol = r.tolerance ?? 0
      }
      if (at && r.at) g.at = { variable: at.id, value: r.at.value }
      goals.push(g)
    }
    const project: Project = {
      id: newId('p'),
      name: lp.name,
      note: [lp.customer ? `고객: ${lp.customer}` : '', lp.description ?? ''].filter(Boolean).join(' · '),
      variables,
      goals,
      initialRuns: 8,
      created: now(),
      updated: now(),
    }
    db.projects.push(project)
    let order = 1
    for (const e of [...exps].sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''))) {
      const x: Record<ID, number> = {}
      const y: Record<ID, number> = {}
      for (const it of byExp.get(e.id) ?? []) {
        const v = vars.get(`${it.kind}:${norm(it.name)}`)
        const n = toNumber(it.value)
        if (!v || n === null) continue
        if (v.role === 'output') y[v.id] = n
        else x[v.id] = n
      }
      if (Object.keys(x).length === 0 && Object.keys(y).length === 0) continue
      db.runs.push({ id: newId('r'), project: project.id, order: order++, x, y, status: Object.keys(y).length > 0 ? 'done' : 'planned', source: 'import', note: e.title ?? '', date: e.completedAt ?? null })
    }
  }
  return db
}

export function download(name: string, text: string, type = 'text/plain') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
