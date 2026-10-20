import { isPurgeable } from '../../domain/rules'
import type { DataItem, Deviation, Entity, Experiment, ID, Project, Step, Template } from '../../domain/types'
import { createSearchEngine } from '../local/searchIndex'
import { makeEntity, nowIso } from '../local/util'
import {
  BACKUP_SCHEMA_VERSION,
  ConflictError,
  NotFoundError,
  StorageError,
  type BackupFile,
  type DataBackend,
  type DataItemRepository,
  type DeviationRepository,
  type ExperimentFilter,
  type ExperimentRepository,
  type ExperimentSort,
  type PageRequest,
  type PageResult,
  type ProjectRepository,
  type SearchHit,
  type StepRepository,
  type TemplateRepository,
} from '../repositories'
import type { Query, RemoteStore, TableName } from './store'

/** 서버 저장소 위의 DataBackend. 규칙은 로컬 구현과 같고(같은 계약 테스트를 통과한다), 읽고 쓰는 곳만 다르다. */
export interface RemoteBackendOptions {
  /** 검색용으로 읽어 둔 내용을 믿는 시간(ms). 다른 기기에서 고친 것이 이 시간 안에는 검색에 안 보일 수 있다. */
  searchCacheMs?: number
  /** 한 번에 보내는 행 수(가져오기). 서버의 요청 크기 한도를 넘지 않게 나눈다. */
  batchSize?: number
}

const bump = <T extends Entity, P extends object>(cur: T, patch: P): T => ({ ...cur, ...patch, updatedAt: nowIso(), version: cur.version + 1 })

const chunk = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** 서버가 준 오류를 앱 공통 오류로 바꾼다. 앱이 이미 아는 오류는 그대로 둔다. */
async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (e) {
    if (e instanceof StorageError || e instanceof NotFoundError || e instanceof ConflictError) throw e
    if (e instanceof Error && e.name === 'RemoteError') throw new StorageError(e.message, 'unknown')
    throw e
  }
}

export function createRemoteBackend(store: RemoteStore, options: RemoteBackendOptions = {}): DataBackend {
  const batchSize = options.batchSize ?? 500
  const cacheMs = options.searchCacheMs ?? 30_000
  let searchStamp = 0

  const engine = createSearchEngine({
    load: async (ids, many) => {
      if (many) {
        const [steps, items] = await Promise.all([store.select<Step>('steps'), store.select<DataItem>('dataItems')])
        return { steps, items }
      }
      const parts = chunk(ids, 100)
      const steps = (await Promise.all(parts.map((p) => store.select<Step>('steps', { in: { field: 'experimentId', values: p } })))).flat()
      const items = (await Promise.all(parts.map((p) => store.select<DataItem>('dataItems', { in: { field: 'experimentId', values: p } })))).flat()
      return { steps, items }
    },
  })
  const touched = () => engine.invalidateAll()

  /**
   * 읽고 → 바꾸고 → version이 그대로일 때만 쓴다. expectedVersion을 주면 다를 때 ConflictError,
   * 안 주면(덮어쓰기) 그 사이 누가 고쳤을 때 다시 읽어 몇 번 더 시도한다.
   */
  async function modify<T extends Entity>(table: TableName, entity: string, id: ID, change: (cur: T) => T | null, expectedVersion?: number): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = await store.get<T>(table, id)
      if (!cur) throw new NotFoundError(entity, id)
      if (expectedVersion !== undefined && cur.version !== expectedVersion) throw new ConflictError(entity, id, cur.version)
      const next = change(cur)
      if (next === null) return cur // 바꿀 것이 없다
      if (await store.update<T>(table, next, cur.version)) {
        touched()
        return next
      }
      if (expectedVersion !== undefined) {
        const now = await store.get<T>(table, id)
        if (!now) throw new NotFoundError(entity, id)
        throw new ConflictError(entity, id, now.version)
      }
    }
    throw new StorageError('다른 곳에서 계속 고치고 있어 저장하지 못했습니다. 잠시 뒤 다시 시도하세요.', 'unknown')
  }

  const getExperiment = async (id: ID): Promise<Experiment> => {
    const e = await store.get<Experiment>('experiments', id)
    if (!e) throw new NotFoundError('Experiment', id)
    return e
  }
  const visibleParent = async (id: ID): Promise<boolean> => {
    const e = await store.get<Experiment>('experiments', id)
    return !!e && e.deletedAt === null
  }

  const projects: ProjectRepository = {
    list: () =>
      guard(async () => {
        const all = await store.select<Project>('projects', { eq: { deletedAt: null } })
        return all.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      }),
    create: (input) =>
      guard(async () => {
        const p = makeEntity<Project>(input)
        await store.insert('projects', [p])
        return p
      }),
    update: (id, patch, expectedVersion) => guard(() => modify<Project>('projects', 'Project', id, (cur) => bump(cur, patch), expectedVersion)),
    softDelete: (id) =>
      guard(async () => {
        await modify<Project>('projects', 'Project', id, (cur) => bump(cur, { deletedAt: nowIso() }))
      }),
  }

  const experiments: ExperimentRepository = {
    list: (filter: ExperimentFilter = {}, sort: ExperimentSort = 'updated_desc', page?: PageRequest) =>
      guard(async (): Promise<PageResult<Experiment>> => {
        const mode = filter.deleted ?? 'exclude'
        const query: Query = { eq: {} }
        if (mode === 'exclude') (query.eq as Record<string, null>).deletedAt = null
        else query.notNull = 'deletedAt'
        if (filter.projectId) (query.eq as Record<string, string>).projectId = filter.projectId
        if (filter.status) (query.eq as Record<string, string>).status = filter.status
        let all = await store.select<Experiment>('experiments', query)
        if (filter.tag) all = all.filter((e) => e.tags.includes(filter.tag as string))
        if (filter.from) all = all.filter((e) => e.updatedAt >= (filter.from as string))
        if (filter.to) all = all.filter((e) => e.updatedAt <= (filter.to as string))
        all.sort((a, b) => {
          if (sort === 'title_asc') return a.title.localeCompare(b.title, 'ko')
          if (sort === 'started_desc') return (b.startedAt ?? '').localeCompare(a.startedAt ?? '') || b.updatedAt.localeCompare(a.updatedAt)
          return b.updatedAt.localeCompare(a.updatedAt)
        })
        const { limit, offset } = page ?? { limit: Number.MAX_SAFE_INTEGER, offset: 0 }
        return { items: all.slice(offset, offset + limit), total: all.length }
      }),

    get: (id) => guard(() => getExperiment(id)),

    create: (input) =>
      guard(async () => {
        const e = makeEntity<Experiment>(input)
        await store.insert('experiments', [e])
        touched()
        return e
      }),

    update: (id, patch, expectedVersion) => guard(() => modify<Experiment>('experiments', 'Experiment', id, (cur) => bump(cur, patch), expectedVersion)),

    softDelete: (id) =>
      guard(async () => {
        await modify<Experiment>('experiments', 'Experiment', id, (cur) => bump(cur, { deletedAt: nowIso() }))
      }),

    restore: (id) =>
      guard(async () => {
        await modify<Experiment>('experiments', 'Experiment', id, (cur) => bump(cur, { deletedAt: null }))
      }),

    purge: (id) =>
      guard(async () => {
        const cur = await getExperiment(id)
        if (cur.deletedAt === null) throw new Error('휴지통에 있는 실험만 영구 삭제할 수 있습니다')
        // 서버는 외래 키로 함께 지우지만, 다른 구현과 같게 명시적으로 지운다.
        await store.remove('steps', { eq: { experimentId: id } })
        await store.remove('dataItems', { eq: { experimentId: id } })
        await store.remove('deviations', { eq: { experimentId: id } })
        await store.remove('experiments', { eq: { id } })
        touched()
      }),

    purgeExpired: (now) =>
      guard(async () => {
        const trash = await store.select<Experiment>('experiments', { notNull: 'deletedAt' })
        const targets = trash.filter((e) => isPurgeable(e.deletedAt, now))
        for (const e of targets) {
          await store.remove('steps', { eq: { experimentId: e.id } })
          await store.remove('dataItems', { eq: { experimentId: e.id } })
          await store.remove('deviations', { eq: { experimentId: e.id } })
          await store.remove('experiments', { eq: { id: e.id } })
        }
        if (targets.length > 0) touched()
        return targets.length
      }),

    search: (query, filter = {}) =>
      guard(async (): Promise<SearchHit[]> => {
        // 다른 기기에서 고친 내용이 영원히 안 보이지 않도록, 읽어 둔 지 오래되면 비우고 다시 읽는다.
        if (Date.now() - searchStamp > cacheMs) {
          engine.invalidateAll()
          searchStamp = Date.now()
        }
        const { items } = await experiments.list({ ...filter, deleted: 'exclude' })
        return engine.search(query, items)
      }),

    duplicate: (id, overrides) =>
      guard(async () => {
        const src = await getExperiment(id)
        const copy = makeEntity<Experiment>({
          projectId: src.projectId,
          title: overrides?.title ?? `${src.title} (복제)`,
          purpose: src.purpose,
          owner: src.owner,
          tags: [...src.tags],
          status: 'ready',
          startedAt: null,
          completedAt: null,
          sourceExperimentId: src.id,
        })
        await store.insert('experiments', [copy])
        const srcSteps = (await store.select<Step>('steps', { eq: { experimentId: id } })).sort((a, b) => a.order - b.order)
        await store.insert(
          'steps',
          srcSteps.map((s) => makeEntity<Step>({ experimentId: copy.id, order: s.order, content: s.content, done: false, doneAt: null, note: '' })),
        )
        const srcData = await store.select<DataItem>('dataItems', { eq: { experimentId: id } })
        // 조건은 값까지 가져오고, 결과는 항목 이름과 단위만 가져와 값을 비운다.
        await store.insert(
          'dataItems',
          srcData.map((d) => makeEntity<DataItem>({ experimentId: copy.id, kind: d.kind, order: d.order, name: d.name, value: d.kind === 'condition' ? d.value : '', unit: d.unit })),
        )
        touched()
        return copy
      }),
  }

  const steps: StepRepository = {
    listByExperiment: (experimentId) =>
      guard(async () => {
        if (!(await visibleParent(experimentId))) return []
        return (await store.select<Step>('steps', { eq: { experimentId } })).sort((a, b) => a.order - b.order)
      }),
    create: (input) =>
      guard(async () => {
        await getExperiment(input.experimentId)
        const s = makeEntity<Step>(input)
        await store.insert('steps', [s])
        touched()
        return s
      }),
    update: (id, patch, expectedVersion) => guard(() => modify<Step>('steps', 'Step', id, (cur) => bump(cur, patch), expectedVersion)),
    remove: (id) =>
      guard(async () => {
        if (!(await store.get<Step>('steps', id))) throw new NotFoundError('Step', id)
        await store.remove('steps', { eq: { id } })
        touched()
      }),
    reorder: (experimentId, orderedIds) =>
      guard(async () => {
        const current = (await store.select<Step>('steps', { eq: { experimentId } })).sort((a, b) => a.order - b.order)
        const byId = new Map(current.map((s) => [s.id, s]))
        const sequence = [...orderedIds.filter((id) => byId.has(id)), ...current.map((s) => s.id).filter((id) => !orderedIds.includes(id))]
        const out: Step[] = []
        for (let i = 0; i < sequence.length; i++) {
          const s = byId.get(sequence[i]) as Step
          out.push(s.order === i + 1 ? s : await modify<Step>('steps', 'Step', s.id, (cur) => bump(cur, { order: i + 1 })))
        }
        return out
      }),
    setDone: (id, done) =>
      guard(() => modify<Step>('steps', 'Step', id, (cur) => (cur.done === done ? null : bump(cur, { done, doneAt: done ? nowIso() : null })))),
  }

  const dataItems: DataItemRepository = {
    listByExperiment: (experimentId) =>
      guard(async () => {
        if (!(await visibleParent(experimentId))) return []
        return (await store.select<DataItem>('dataItems', { eq: { experimentId } })).sort((a, b) => a.kind.localeCompare(b.kind) || a.order - b.order)
      }),
    create: (input) =>
      guard(async () => {
        await getExperiment(input.experimentId)
        const d = makeEntity<DataItem>(input)
        await store.insert('dataItems', [d])
        touched()
        return d
      }),
    update: (id, patch, expectedVersion) => guard(() => modify<DataItem>('dataItems', 'DataItem', id, (cur) => bump(cur, patch), expectedVersion)),
    remove: (id) =>
      guard(async () => {
        if (!(await store.get<DataItem>('dataItems', id))) throw new NotFoundError('DataItem', id)
        await store.remove('dataItems', { eq: { id } })
        touched()
      }),
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

  return { projects, experiments, steps, dataItems, templates, deviations, backup }
}
