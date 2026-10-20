import type { DataItem, Deviation, Entity, Experiment, Project, Step, Template } from '../../domain/types'
import type { TableName } from '../remote/store'

/**
 * 앱의 도메인 모양(camelCase)과 DB 열(snake_case)을 서로 바꾼다. docs/phase9/erd.md의 표와 같다.
 * 열을 하나씩 적어 둔 이유: 앱에 필드가 늘어도 DB에 열이 없으면 서버가 거절하므로, 모르는 필드가 조용히 새어 나가지 않게 한다.
 */

type Row = Record<string, unknown>

/** 서버 표 이름 */
export const TABLE_NAME: Record<TableName, string> = {
  projects: 'projects',
  experiments: 'experiments',
  steps: 'steps',
  dataItems: 'data_items',
  templates: 'templates',
  deviations: 'deviations',
}

/** 앱 필드 이름 → DB 열 이름 (조회 조건에 쓴다) */
const COLUMN: Record<string, string> = {
  id: 'id',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  deletedAt: 'deleted_at',
  version: 'version',
  projectId: 'project_id',
  experimentId: 'experiment_id',
  stepId: 'step_id',
  sourceExperimentId: 'source_experiment_id',
  startedAt: 'started_at',
  completedAt: 'completed_at',
  status: 'status',
  kind: 'kind',
  name: 'name',
}

export function columnOf(field: string): string {
  const c = COLUMN[field]
  if (!c) throw new Error(`조회 조건에 쓸 수 없는 필드입니다: ${field}`)
  return c
}

/** DB의 시각(예: 2026-10-19T05:32:08.123+00:00)을 앱의 모양(…Z)으로 맞춘다. 앱은 글자 비교로 최신을 판단한다. */
export function isoOf(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const t = new Date(String(v))
  return Number.isNaN(t.getTime()) ? String(v) : t.toISOString()
}

const iso = (v: unknown): string => isoOf(v) ?? ''
const common = (r: Row) => ({
  id: String(r.id),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  deletedAt: isoOf(r.deleted_at),
  version: Number(r.version),
})
const commonRow = (e: Entity) => ({ id: e.id, created_at: e.createdAt, updated_at: e.updatedAt, deleted_at: e.deletedAt, version: e.version })

/** 앱 엔티티 → DB 행. owner_id는 서버가 로그인 사용자로 채우므로 넣지 않는다. */
export function toRow(table: TableName, entity: Entity): Row {
  switch (table) {
    case 'projects': {
      const p = entity as Project
      return { ...commonRow(p), name: p.name, description: p.description, customer: p.customer ?? '', requirements: p.requirements ?? [] }
    }
    case 'experiments': {
      const e = entity as Experiment
      return {
        ...commonRow(e),
        project_id: e.projectId,
        title: e.title,
        purpose: e.purpose,
        assignee: e.owner,
        tags: e.tags,
        status: e.status,
        started_at: e.startedAt,
        completed_at: e.completedAt,
        source_experiment_id: e.sourceExperimentId,
      }
    }
    case 'steps': {
      const s = entity as Step
      return { ...commonRow(s), experiment_id: s.experimentId, step_order: s.order, content: s.content, done: s.done, done_at: s.doneAt, note: s.note }
    }
    case 'dataItems': {
      const d = entity as DataItem
      return { ...commonRow(d), experiment_id: d.experimentId, kind: d.kind, item_order: d.order, name: d.name, value: d.value, unit: d.unit }
    }
    case 'templates': {
      const t = entity as Template
      return { ...commonRow(t), name: t.name, steps: t.steps, default_conditions: t.defaultConditions, result_items: t.resultItems }
    }
    case 'deviations': {
      const d = entity as Deviation
      return { ...commonRow(d), experiment_id: d.experimentId, step_id: d.stepId, change: d.change, reason: d.reason }
    }
  }
}

/** DB 행 → 앱 엔티티 */
export function fromRow<T extends Entity>(table: TableName, r: Row): T {
  const c = common(r)
  switch (table) {
    case 'projects': {
      const customer = String(r.customer ?? '')
      const requirements = Array.isArray(r.requirements) ? r.requirements : []
      // 로컬 저장소와 같은 모양으로: 비어 있으면 필드를 두지 않는다
      return { ...c, name: String(r.name), description: String(r.description ?? ''), ...(customer ? { customer } : {}), ...(requirements.length > 0 ? { requirements } : {}) } as unknown as T
    }
    case 'experiments':
      return {
        ...c,
        projectId: (r.project_id as string | null) ?? null,
        title: String(r.title),
        purpose: String(r.purpose ?? ''),
        owner: String(r.assignee ?? ''),
        tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
        status: r.status as Experiment['status'],
        startedAt: isoOf(r.started_at),
        completedAt: isoOf(r.completed_at),
        sourceExperimentId: (r.source_experiment_id as string | null) ?? null,
      } as unknown as T
    case 'steps':
      return { ...c, experimentId: String(r.experiment_id), order: Number(r.step_order), content: String(r.content), done: r.done === true, doneAt: isoOf(r.done_at), note: String(r.note ?? '') } as unknown as T
    case 'dataItems':
      return { ...c, experimentId: String(r.experiment_id), kind: r.kind as DataItem['kind'], order: Number(r.item_order), name: String(r.name ?? ''), value: String(r.value ?? ''), unit: String(r.unit ?? '') } as unknown as T
    case 'templates':
      return {
        ...c,
        name: String(r.name),
        steps: Array.isArray(r.steps) ? r.steps : [],
        defaultConditions: Array.isArray(r.default_conditions) ? r.default_conditions : [],
        resultItems: Array.isArray(r.result_items) ? r.result_items : [],
      } as unknown as T
    case 'deviations':
      return { ...c, experimentId: String(r.experiment_id), stepId: (r.step_id as string | null) ?? null, change: String(r.change), reason: String(r.reason ?? '') } as unknown as T
  }
}
