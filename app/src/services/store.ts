import { useSyncExternalStore } from 'react'
import { emptyDb, type Db, type ID, type ModelVersion, type Project, type Run } from '../domain/types'

/**
 * 저장소: 메모리의 Db 하나를 localStorage에 통째로 저장한다(JSON 몇백 KB).
 * 화면은 useDb()로 읽고, 아래 mutate 함수로만 바꾼다. 바꾸면 즉시 저장하고 구독자에게 알린다.
 * 데이터는 이 브라우저 밖으로 나가지 않는다. 내보내기·가져오기는 csv.ts에 있다.
 */

export const STORAGE_KEY = 'lablog.v3'

let db: Db = load()
const listeners = new Set<() => void>()

function load(): Db {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyDb()
    const obj = JSON.parse(raw) as Partial<Db>
    if (obj.version !== 3 || !Array.isArray(obj.projects) || !Array.isArray(obj.runs)) return emptyDb()
    return { version: 3, projects: obj.projects, runs: obj.runs, models: Array.isArray(obj.models) ? obj.models : [] }
  } catch {
    return emptyDb()
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch {
    // 저장 공간이 없거나 비공개 창이면 메모리에서만 동작한다
  }
}

function commit(next: Db) {
  db = next
  persist()
  for (const l of listeners) l()
}

export function getDb(): Db {
  return db
}

export function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useDb(): Db {
  return useSyncExternalStore(subscribe, getDb, getDb)
}

let seq = 0
export function newId(prefix: string): ID {
  seq++
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export const now = () => new Date().toISOString()

// ---------- 바꾸기 ----------

export function replaceDb(next: Db) {
  commit({ version: 3, projects: [...next.projects], runs: [...next.runs], models: [...(next.models ?? [])] })
}

export function resetDb() {
  commit(emptyDb())
}

export function addProject(p: Project, runs: Run[] = []) {
  commit({ ...db, projects: [...db.projects, p], runs: [...db.runs, ...runs] })
}

export function updateProject(id: ID, patch: Partial<Project>) {
  commit({ ...db, projects: db.projects.map((p) => (p.id === id ? { ...p, ...patch, updated: now() } : p)) })
}

export function deleteProject(id: ID) {
  commit({ ...db, projects: db.projects.filter((p) => p.id !== id), runs: db.runs.filter((r) => r.project !== id) })
}

// ---------- 모델 버전 ----------

export const modelsOf = (d: Db, group: string) => (d.models ?? []).filter((m) => m.group === group)

export function addModelVersion(v: ModelVersion, apply: boolean) {
  const rest = (db.models ?? []).map((m) => (apply && m.group === v.group && m.target === v.target ? { ...m, applied: false } : m))
  commit({ ...db, models: [...rest, { ...v, applied: apply }] })
}

/** id의 버전을 적용(같은 group·target의 다른 버전은 해제). id가 null이면 자동으로 되돌린다 */
export function applyModelVersion(group: string, target: string, id: ID | null) {
  commit({ ...db, models: (db.models ?? []).map((m) => (m.group === group && m.target === target ? { ...m, applied: m.id === id } : m)) })
}

export function deleteModelVersion(id: ID) {
  commit({ ...db, models: (db.models ?? []).filter((m) => m.id !== id) })
}

export function addRuns(runs: Run[]) {
  if (runs.length === 0) return
  const pid = runs[0].project
  commit({
    ...db,
    runs: [...db.runs, ...runs],
    projects: db.projects.map((p) => (p.id === pid ? { ...p, updated: now() } : p)),
  })
}

export function updateRun(id: ID, patch: Partial<Run>) {
  commit({ ...db, runs: db.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)) })
}

export function deleteRuns(ids: ID[]) {
  const set = new Set(ids)
  commit({ ...db, runs: db.runs.filter((r) => !set.has(r.id)) })
}

/** 계획 실험을 beforeOrder 자리에 끼워 넣는다(그 뒤 계획은 밀린다). 바로 다음에 할 실험으로 만들 때 쓴다 */
export function insertPlanned(projectId: ID, newRuns: Run[], beforeOrder: number) {
  const k = newRuns.length
  if (k === 0) return
  const shifted = db.runs.map((r) => (r.project === projectId && r.status === 'planned' && r.order >= beforeOrder ? { ...r, order: r.order + k } : r))
  const placed = newRuns.map((r, i) => ({ ...r, order: beforeOrder + i }))
  commit({ ...db, runs: [...shifted, ...placed] })
}

/** 한 프로젝트의 계획(아직 안 한) 실험을 지우고 새 계획으로 바꾼다 */
export function replacePlanned(projectId: ID, planned: Run[]) {
  commit({ ...db, runs: [...db.runs.filter((r) => !(r.project === projectId && r.status === 'planned')), ...planned] })
}

export const runsOf = (d: Db, projectId: ID) => d.runs.filter((r) => r.project === projectId).sort((a, b) => a.order - b.order)
export const nextOrder = (d: Db, projectId: ID) => d.runs.filter((r) => r.project === projectId).reduce((m, r) => Math.max(m, r.order), 0) + 1
