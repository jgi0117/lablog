import type { BackupFile, DataBackend } from '../../../data/repositories'
import { BACKUP_SCHEMA_VERSION } from '../../../data/repositories'

/**
 * 이 브라우저의 로컬 데이터를 서버(Supabase)로 옮긴다. 순서: 로컬 읽기 → 서버에 있는 것 확인 → 표별로 올리기 → 검증.
 * id를 그대로 쓰므로 중단했다가 다시 해도 중복되지 않고(멱등), 서버에 이미 있고 더 최신인 행은 덮어쓰지 않는다.
 * 로컬 데이터는 지우지 않는다. 사용자가 확인한 뒤 따로 지우게 한다.
 */

export type MigrationTable = 'projects' | 'experiments' | 'steps' | 'dataItems' | 'deviations' | 'templates'

export const TABLE_LABEL: Record<MigrationTable, string> = {
  projects: '프로젝트',
  experiments: '실험',
  steps: '단계',
  dataItems: '조건·결과',
  deviations: '달라진 점',
  templates: '템플릿',
}

/** 부모부터 올린다(외래 키 순서) */
const ORDER: MigrationTable[] = ['projects', 'experiments', 'steps', 'dataItems', 'deviations', 'templates']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID_KEYS = ['id', 'projectId', 'experimentId', 'stepId', 'sourceExperimentId'] as const

/** 문자열에서 늘 같은 UUID 모양 값을 만든다(암호용 아님). 다시 실행해도 같은 id가 나와서 이전이 멱등이다. */
export function stableUuid(text: string): string {
  const hex: string[] = []
  for (let seed = 0; seed < 4; seed++) {
    let h = (0x811c9dc5 ^ (seed * 0x9e3779b1)) >>> 0
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
    hex.push(h.toString(16).padStart(8, '0'))
  }
  const x = hex.join('')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-5${x.slice(13, 16)}-a${x.slice(17, 20)}-${x.slice(20, 32)}`
}

/** 예전 예시 데이터처럼 UUID가 아닌 id(예: "demo-project-1")를 서버가 받을 수 있는 UUID로 바꾼다. 참조하는 id도 같이 바꾼다. */
export function normalizeIds(file: BackupFile): BackupFile {
  const fix = (v: unknown) => (typeof v === 'string' && v !== '' && !UUID_RE.test(v) ? stableUuid(v) : v)
  const out = { ...file } as Record<string, unknown>
  for (const t of ORDER) {
    out[t] = ((file[t] ?? []) as unknown as Record<string, unknown>[]).map((r) => {
      const c = { ...r }
      for (const k of ID_KEYS) if (k in c) c[k] = fix(c[k])
      return c
    })
  }
  return out as unknown as BackupFile
}

export type Counts = Record<MigrationTable, number>

export function countsOf(file: BackupFile): Counts {
  return {
    projects: file.projects.length,
    experiments: file.experiments.length,
    steps: file.steps.length,
    dataItems: file.dataItems.length,
    deviations: (file.deviations ?? []).length,
    templates: (file.templates ?? []).length,
  }
}

export const totalOf = (c: Counts): number => ORDER.reduce((n, t) => n + c[t], 0)

type Rows = { id: string; updatedAt: string; version: number }[]
const rowsOf = (file: BackupFile, t: MigrationTable): Rows => (file[t] ?? []) as unknown as Rows

/** 한 표만 담은 가져오기 파일(나머지 목록은 비운다). 버전 1 파일처럼 템플릿·달라진 점 목록이 없으면 건드리지 않는 규칙을 쓰지 않도록 항상 목록을 준다. */
function sliceOf(file: BackupFile, t: MigrationTable): BackupFile {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: file.exportedAt,
    projects: [],
    experiments: [],
    steps: [],
    dataItems: [],
    deviations: [],
    templates: [],
    [t]: file[t] ?? [],
  } as BackupFile
}

export interface MigrationPreview {
  local: Counts
  remote: Counts
  /** 서버에 같은 id가 이미 있어 건너뛰거나 합쳐질 행 수(표 합계) */
  alreadyThere: number
}

/** 올리기 전에 건수를 미리 본다. 아무것도 바꾸지 않는다. */
export async function previewMigration(local: DataBackend, remote: DataBackend): Promise<MigrationPreview> {
  const [lf, rf] = await Promise.all([local.backup.exportAll().then(normalizeIds), remote.backup.exportAll()])
  let alreadyThere = 0
  for (const t of ORDER) {
    const have = new Set(rowsOf(rf, t).map((r) => r.id))
    alreadyThere += rowsOf(lf, t).filter((r) => have.has(r.id)).length
  }
  return { local: countsOf(lf), remote: countsOf(rf), alreadyThere }
}

export interface MigrationReport {
  local: Counts
  remoteBefore: Counts
  remoteAfter: Counts
  /** 로컬에는 있는데 서버에 없는 행(표별 개수). 모두 0이어야 한다. */
  missing: Counts
  /** 서버가 더 최신이라 로컬 내용을 올리지 않은 행 수 */
  keptNewerOnServer: number
  /** 올린 행 수(서버에 없었거나 로컬이 더 최신) */
  uploaded: number
  ok: boolean
}

export type Progress = (step: { table: MigrationTable | 'verify'; label: string; done: number; total: number }) => void

/**
 * 로컬 데이터를 서버에 올리고 검증한다. 어느 단계에서 실패하면 오류를 그대로 던진다
 * (이미 올라간 것은 남지만 다시 실행하면 이어서 올라간다).
 */
export async function migrateLocalToRemote(local: DataBackend, remote: DataBackend, onProgress: Progress = () => {}): Promise<MigrationReport> {
  const localFile = normalizeIds(await local.backup.exportAll())
  const remoteBeforeFile = await remote.backup.exportAll()
  const total = ORDER.length + 1
  let uploaded = 0
  for (const [i, t] of ORDER.entries()) {
    onProgress({ table: t, label: `${TABLE_LABEL[t]} ${rowsOf(localFile, t).length}개 올리는 중`, done: i, total })
    if (rowsOf(localFile, t).length > 0) {
      const { imported } = await remote.backup.importAll(sliceOf(localFile, t), 'merge')
      uploaded += imported
    }
  }
  onProgress({ table: 'verify', label: '올린 내용을 서버에서 다시 읽어 확인하는 중', done: ORDER.length, total })
  const after = await remote.backup.exportAll()

  const missing = Object.fromEntries(ORDER.map((t) => [t, 0])) as Counts
  let keptNewerOnServer = 0
  for (const t of ORDER) {
    const remoteBy = new Map(rowsOf(after, t).map((r) => [r.id, r]))
    for (const r of rowsOf(localFile, t)) {
      const there = remoteBy.get(r.id)
      if (!there) missing[t]++
      else if (there.updatedAt > r.updatedAt) keptNewerOnServer++
    }
  }
  onProgress({ table: 'verify', label: '확인을 마쳤습니다', done: total, total })
  return {
    local: countsOf(localFile),
    remoteBefore: countsOf(remoteBeforeFile),
    remoteAfter: countsOf(after),
    missing,
    keptNewerOnServer,
    uploaded,
    ok: totalOf(missing) === 0,
  }
}
