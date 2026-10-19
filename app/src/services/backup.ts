import { BACKUP_SCHEMA_VERSION, type BackupFile } from '../data/repositories'
import type { DataItem, Experiment, Project, Step } from '../domain/types'
import { safeGet, safeSet } from './safeStorage'

export interface BackupSummary {
  projects: number
  experiments: number
  steps: number
  dataItems: number
  exportedAt: string
}

export type ParseResult = { ok: true; file: BackupFile; summary: BackupSummary } | { ok: false; error: string }

/** 백업 파일 하나의 최대 크기. 이보다 크면 잘못된 파일로 본다. */
export const MAX_BACKUP_CHARS = 100 * 1024 * 1024

const STATUSES = ['ready', 'running', 'done']
const KINDS = ['condition', 'result']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'
const strOr = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)

class Invalid extends Error {}

function common(o: Record<string, unknown>, where: string) {
  if (!str(o.id) || o.id === '') throw new Invalid(`${where}에 id가 없습니다.`)
  const at = strOr(o.updatedAt) || strOr(o.createdAt)
  if (!at || Number.isNaN(Date.parse(at))) throw new Invalid(`${where}에 올바른 수정 시각이 없습니다.`)
  return {
    id: o.id,
    createdAt: strOr(o.createdAt, at),
    updatedAt: at,
    deletedAt: strOrNull(o.deletedAt),
    version: typeof o.version === 'number' && o.version >= 1 ? Math.floor(o.version) : 1,
  }
}

function list(raw: unknown, name: string): Record<string, unknown>[] {
  if (!Array.isArray(raw)) throw new Invalid(`"${name}" 목록이 없습니다. 이 앱이 만든 백업 파일이 아닐 수 있습니다.`)
  return raw.map((r, i) => {
    if (!isObj(r)) throw new Invalid(`${name} ${i + 1}번째 항목이 올바르지 않습니다.`)
    return r
  })
}

function unique(items: { id: string }[], name: string) {
  const seen = new Set<string>()
  for (const x of items) {
    if (seen.has(x.id)) throw new Invalid(`${name}에 같은 id가 중복되어 있습니다.`)
    seen.add(x.id)
  }
}

/**
 * 백업 파일 글자를 검사하고 앱이 쓰는 모양으로 다듬는다.
 * 알려진 필드만 골라 담기 때문에, 파일에 이상한 필드가 섞여 있어도 저장소에 들어가지 않는다.
 * 실패하면 사용자가 이해할 수 있는 한국어 이유를 돌려준다. 가져오기 전에 반드시 이 검사를 거친다.
 */
export function parseBackup(text: string): ParseResult {
  if (text.length > MAX_BACKUP_CHARS) return { ok: false, error: '파일이 너무 큽니다. 백업 파일이 맞는지 확인하세요.' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: '파일을 읽을 수 없습니다. 이 앱에서 내보낸 JSON 백업 파일을 고르세요.' }
  }
  try {
    if (!isObj(raw)) throw new Invalid('백업 파일의 형식이 올바르지 않습니다.')
    if (typeof raw.schemaVersion !== 'number') throw new Invalid('백업 파일의 버전 정보가 없습니다. 이 앱이 만든 파일이 아닐 수 있습니다.')
    if (raw.schemaVersion > BACKUP_SCHEMA_VERSION) {
      return { ok: false, error: '이 백업 파일은 더 새로운 버전의 앱에서 만들어졌습니다. 앱을 업데이트한 뒤 가져오세요.' }
    }
    if (raw.schemaVersion < 1) throw new Invalid('지원하지 않는 백업 버전입니다.')

    const projects: Project[] = list(raw.projects, 'projects').map((o, i) => {
      if (!str(o.name)) throw new Invalid(`프로젝트 ${i + 1}번째에 이름이 없습니다.`)
      return { ...common(o, `프로젝트 ${i + 1}번째`), name: o.name, description: strOr(o.description) }
    })
    const experiments: Experiment[] = list(raw.experiments, 'experiments').map((o, i) => {
      if (!str(o.title)) throw new Invalid(`실험 ${i + 1}번째에 제목이 없습니다.`)
      if (!str(o.status) || !STATUSES.includes(o.status)) throw new Invalid(`실험 "${o.title}"의 상태가 올바르지 않습니다.`)
      return {
        ...common(o, `실험 ${i + 1}번째`),
        projectId: strOrNull(o.projectId),
        title: o.title,
        purpose: strOr(o.purpose),
        owner: strOr(o.owner),
        tags: Array.isArray(o.tags) ? o.tags.filter(str) : [],
        status: o.status as Experiment['status'],
        startedAt: strOrNull(o.startedAt),
        completedAt: strOrNull(o.completedAt),
        sourceExperimentId: strOrNull(o.sourceExperimentId),
      }
    })
    const steps: Step[] = list(raw.steps, 'steps').map((o, i) => {
      if (!str(o.experimentId)) throw new Invalid(`단계 ${i + 1}번째에 실험 정보가 없습니다.`)
      if (typeof o.order !== 'number' || !str(o.content)) throw new Invalid(`단계 ${i + 1}번째의 내용이나 순서가 올바르지 않습니다.`)
      return {
        ...common(o, `단계 ${i + 1}번째`),
        experimentId: o.experimentId,
        order: o.order,
        content: o.content,
        done: o.done === true,
        doneAt: strOrNull(o.doneAt),
        note: strOr(o.note),
      }
    })
    const dataItems: DataItem[] = list(raw.dataItems, 'dataItems').map((o, i) => {
      if (!str(o.experimentId)) throw new Invalid(`조건·결과 ${i + 1}번째에 실험 정보가 없습니다.`)
      if (!str(o.kind) || !KINDS.includes(o.kind)) throw new Invalid(`조건·결과 ${i + 1}번째의 구분이 올바르지 않습니다.`)
      return {
        ...common(o, `조건·결과 ${i + 1}번째`),
        experimentId: o.experimentId,
        kind: o.kind as DataItem['kind'],
        order: typeof o.order === 'number' ? o.order : i + 1,
        name: strOr(o.name),
        value: strOr(o.value),
        unit: strOr(o.unit),
      }
    })

    unique(projects, '프로젝트')
    unique(experiments, '실험')
    unique(steps, '단계')
    unique(dataItems, '조건·결과')
    const ids = new Set(experiments.map((e) => e.id))
    const orphans = steps.filter((s) => !ids.has(s.experimentId)).length + dataItems.filter((d) => !ids.has(d.experimentId)).length
    if (orphans > 0) throw new Invalid(`속한 실험이 파일에 없는 단계·조건·결과가 ${orphans}개 있습니다. 파일이 일부만 저장되었을 수 있습니다.`)

    const exportedAt = strOr(raw.exportedAt)
    return {
      ok: true,
      file: { schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt, projects, experiments, steps, dataItems },
      summary: { projects: projects.length, experiments: experiments.length, steps: steps.length, dataItems: dataItems.length, exportedAt },
    }
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message }
    throw e
  }
}

export function serializeBackup(file: BackupFile): string {
  return JSON.stringify(file, null, 2)
}

/** 예: lablog-backup-2026-10-19-1432.json (기기 시간대 기준) */
export function backupFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `lablog-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`
}

// ---------- 마지막 백업과 알림 ----------
const LAST_KEY = 'lablog:last-backup'
const SNOOZE_KEY = 'lablog:backup-snooze'

export function lastBackupAt(): string | null {
  return safeGet(LAST_KEY)
}

export function recordBackup(now: Date = new Date()): void {
  safeSet(LAST_KEY, now.toISOString())
}

export function snoozeBackupReminder(days: number, now: Date = new Date()): void {
  safeSet(SNOOZE_KEY, new Date(now.getTime() + days * 86400000).toISOString())
}

export function backupSnoozedUntil(): string | null {
  return safeGet(SNOOZE_KEY)
}

export type BackupReminder = 'never' | 'stale' | null

export const BACKUP_STALE_DAYS = 7

/**
 * 백업을 권할지 정한다.
 * - 데이터가 있는데 한 번도 백업하지 않았고 첫 기록이 하루 넘었으면 'never'
 * - 마지막 백업 뒤에 바뀐 것이 있고 7일이 지났으면 'stale' (바뀐 게 없으면 권하지 않는다)
 * - "나중에"를 누르면 그 기간 동안은 조용히
 */
export function backupReminder(input: {
  now: Date
  hasData: boolean
  lastBackup: string | null
  newestChange: string | null
  oldestCreated: string | null
  snoozedUntil: string | null
}): BackupReminder {
  const { now, hasData, lastBackup, newestChange, oldestCreated, snoozedUntil } = input
  if (!hasData) return null
  if (snoozedUntil && now.getTime() < new Date(snoozedUntil).getTime()) return null
  if (!lastBackup) {
    return oldestCreated && now.getTime() - new Date(oldestCreated).getTime() >= 86400000 ? 'never' : null
  }
  const changedSince = !!newestChange && newestChange > lastBackup
  const age = now.getTime() - new Date(lastBackup).getTime()
  return changedSince && age >= BACKUP_STALE_DAYS * 86400000 ? 'stale' : null
}
