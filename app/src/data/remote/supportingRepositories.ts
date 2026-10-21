import type { DataItem, Deviation, Entity, Experiment, ID, Project, Step, Template } from '../../domain/types'
import { makeEntity, nowIso } from '../local/util'
import { BACKUP_SCHEMA_VERSION, ConflictError, NotFoundError, StorageError, type BackupFile, type DataBackend, type DeviationRepository, type TemplateRepository } from '../repositories'
import type { RemoteStore, TableName } from './store'

const bump = <T extends Entity, P extends object>(current: T, patch: P): T => ({ ...current, ...patch, updatedAt: nowIso(), version: current.version + 1 })
const chunk = <T>(list: T[], size: number): T[][] => {
  const output: T[][] = []
  for (let index = 0; index < list.length; index += size) output.push(list.slice(index, index + size))
  return output
}
async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof StorageError || error instanceof NotFoundError || error instanceof ConflictError) throw error
    if (error instanceof Error && error.name === 'RemoteError') throw new StorageError(error.message, 'unknown')
    throw error
  }
}

export function createRemoteSupportingRepositories(
  store: RemoteStore,
  options: { batchSize: number; touched: () => void },
) {
  const { batchSize, touched } = options
  const getExperiment = async (id: ID): Promise<Experiment> => {
    const experiment = await store.get<Experiment>('experiments', id)
    if (!experiment) throw new NotFoundError('Experiment', id)
    return experiment
  }
  const visibleParent = async (id: ID) => {
    const experiment = await store.get<Experiment>('experiments', id)
    return !!experiment && experiment.deletedAt === null
  }
  async function modify<T extends Entity>(table: TableName, entity: string, id: ID, change: (current: T) => T | null, expectedVersion?: number): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await store.get<T>(table, id)
      if (!current) throw new NotFoundError(entity, id)
      if (expectedVersion !== undefined && current.version !== expectedVersion) throw new ConflictError(entity, id, current.version)
      const next = change(current)
      if (next === null) return current
      if (await store.update<T>(table, next, current.version)) {
        touched()
        return next
      }
      if (expectedVersion !== undefined) {
        const latest = await store.get<T>(table, id)
        if (!latest) throw new NotFoundError(entity, id)
        throw new ConflictError(entity, id, latest.version)
      }
    }
    throw new StorageError('다른 곳에서 계속 고치고 있어 저장하지 못했습니다. 잠시 뒤 다시 시도하세요.', 'unknown')
  }

  const templates: TemplateRepository = {
    list: () =>
      guard(async () => {
        const all = await store.select<Template>('templates', { eq: { deletedAt: null } })
        return all.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      }),
    get: (id) =>
      guard(async () => {
        const t = await store.get<Template>('templates', id)
        if (!t || t.deletedAt !== null) throw new NotFoundError('Template', id)
        return t
      }),
    create: (input) =>
      guard(async () => {
        const t = makeEntity<Template>(input)
        await store.insert('templates', [t])
        return t
      }),
    update: (id, patch, expectedVersion) =>
      guard(() =>
        modify<Template>(
          'templates',
          'Template',
          id,
          (cur) => {
            if (cur.deletedAt !== null) throw new NotFoundError('Template', id)
            return bump(cur, patch)
          },
          expectedVersion,
        ),
      ),
    softDelete: (id) =>
      guard(async () => {
        await modify<Template>('templates', 'Template', id, (cur) => {
          if (cur.deletedAt !== null) throw new NotFoundError('Template', id)
          return bump(cur, { deletedAt: nowIso() })
        })
      }),
  }

  const deviations: DeviationRepository = {
    listByExperiment: (experimentId) =>
      guard(async () => {
        if (!(await visibleParent(experimentId))) return []
        const all = await store.select<Deviation>('deviations', { eq: { experimentId } })
        return all.filter((d) => d.deletedAt === null).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      }),
    create: (input) =>
      guard(async () => {
        await getExperiment(input.experimentId)
        const d = makeEntity<Deviation>(input)
        await store.insert('deviations', [d])
        return d
      }),
    update: (id, patch, expectedVersion) => guard(() => modify<Deviation>('deviations', 'Deviation', id, (cur) => bump(cur, patch), expectedVersion)),
    remove: (id) =>
      guard(async () => {
        if (!(await store.get<Deviation>('deviations', id))) throw new NotFoundError('Deviation', id)
        await store.remove('deviations', { eq: { id } })
      }),
  }

  /** 가져올 때 원본 실험이 먼저 들어가도록 줄 세운다(서버의 외래 키가 순서를 요구한다). 파일에 없는 원본은 비운다. */
  const orderBySource = (rows: Experiment[]): Experiment[] => {
    const ids = new Set(rows.map((e) => e.id))
    const byId = new Map(rows.map((e) => [e.id, e]))
    const out: Experiment[] = []
    const seen = new Set<ID>()
    const visit = (e: Experiment, depth = 0) => {
      if (seen.has(e.id)) return
      seen.add(e.id)
      const src = e.sourceExperimentId
      if (src && depth < 1000) {
        const parent = byId.get(src)
        if (parent) visit(parent, depth + 1)
      }
      out.push(src && !ids.has(src) ? { ...e, sourceExperimentId: null } : e)
    }
    for (const e of rows) visit(e)
    return out
  }

  const backup: DataBackend['backup'] = {
    exportAll: () =>
      guard(async (): Promise<BackupFile> => {
        const [p, e, s, d, t, v] = await Promise.all([
          store.select<Project>('projects'),
          store.select<Experiment>('experiments'),
          store.select<Step>('steps'),
          store.select<DataItem>('dataItems'),
          store.select<Template>('templates'),
          store.select<Deviation>('deviations'),
        ])
        return { schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: nowIso(), projects: p, experiments: e, steps: s, dataItems: d, templates: t, deviations: v }
      }),
    importAll: (file, mode) =>
      guard(async () => {
        if (file.schemaVersion > BACKUP_SCHEMA_VERSION) {
          throw new Error('이 백업 파일은 더 새로운 버전에서 만들어졌습니다. 앱을 업데이트한 뒤 가져오세요.')
        }
        let imported = 0
        const put = async <T extends Entity>(table: TableName, incoming: T[], prepare: (rows: T[]) => T[] = (r) => r) => {
          let take = incoming
          if (mode === 'merge') {
            const existing = new Map((await store.select<T>(table)).map((x) => [x.id, x]))
            take = incoming.filter((x) => {
              const cur = existing.get(x.id)
              return !cur || x.updatedAt > cur.updatedAt
            })
          }
          for (const part of chunk(prepare(take), batchSize)) await store.upsert(table, part)
          imported += take.length
        }
        if (mode === 'replace') {
          // 딸린 것부터 지운다
          // 템플릿은 버전 1 파일(목록 없음)로 바꾸기를 해도 지우지 않는다(로컬 저장소와 같다)
          const tables: TableName[] = ['deviations', 'dataItems', 'steps', 'experiments', ...(file.templates !== undefined ? (['templates'] as TableName[]) : []), 'projects']
          for (const t of tables) {
            const rows = await store.select(t)
            for (const part of chunk(rows, 100)) await store.remove(t, { in: { field: 'id', values: part.map((r) => r.id) } })
          }
        }
        await put<Project>('projects', file.projects)
        await put<Experiment>('experiments', file.experiments, orderBySource)
        await put<Step>('steps', file.steps)
        await put<DataItem>('dataItems', file.dataItems)
        await put<Deviation>('deviations', file.deviations ?? [])
        if (file.templates !== undefined) await put<Template>('templates', file.templates)
        touched()
        return { imported }
      }),
  }


  return { templates, deviations, backup }
}
