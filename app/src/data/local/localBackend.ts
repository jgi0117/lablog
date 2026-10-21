import { LablogDB } from './db'
import { createSearchIndex } from './searchIndex'
import { createLocalSupportingRepositories } from './supportingRepositories'
import { createProjectRepository } from './projectRepository'
import { guard, makeEntity, nowIso } from './util'
import { createChangeBus } from '../../services/changeBus'
import {
  ConflictError,
  NotFoundError,
  type DataBackend,
  type DataItemRepository,
  type ExperimentFilter,
  type ExperimentRepository,
  type ExperimentSort,
  type PageRequest,
  type PageResult,
  type SearchHit,
  type StepRepository,
} from '../repositories'
import { isPurgeable } from '../../domain/rules'
import type { DataItem, Entity, Experiment, ID, Step } from '../../domain/types'

export interface LocalBackend extends DataBackend {
  /** 테스트와 앱 종료 때 DB 연결을 닫는다. */
  close(): void
}

function checkVersion(entity: string, cur: Entity, expected?: number) {
  if (expected !== undefined && cur.version !== expected) {
    throw new ConflictError(entity, cur.id, cur.version)
  }
}

function bump<T extends Entity>(cur: T, patch: Partial<T>): T {
  return { ...cur, ...patch, updatedAt: nowIso(), version: cur.version + 1 }
}

/**
 * IndexedDB(Dexie) 구현. 목록·검색은 데이터를 읽어 메모리에서 거르고 정렬한다.
 * 실험 수백 건 규모에서는 충분하다. 느려지면 Phase 4~5에서 색인을 붙인다.
 */
export function createLocalBackend(name = 'lablog', options: { channel?: Parameters<typeof createChangeBus>[1] } = {}): LocalBackend {
  const db = new LablogDB(name)
  const index = createSearchIndex(db)
  // 이 탭에서 일어난 모든 변경을 다른 탭에 알린다. 받는 쪽은 onExternalChange로 듣는다.
  const bus = createChangeBus(`lablog-changes:${name}`, options.channel)
  for (const [table, key] of [
    [db.projects, 'projects'],
    [db.experiments, 'experiments'],
    [db.steps, 'steps'],
    [db.dataItems, 'dataItems'],
    [db.templates, 'templates'],
    [db.deviations, 'deviations'],
  ] as const) {
    table.hook('creating', (id) => {
      bus.post({ table: key, id: String(id) })
    })
    table.hook('updating', (_mods, id) => {
      bus.post({ table: key, id: String(id) })
    })
    table.hook('deleting', (id) => {
      bus.post({ table: key, id: String(id) })
    })
  }

  const getExperiment = async (id: ID): Promise<Experiment> => {
    const e = await db.experiments.get(id)
    if (!e) throw new NotFoundError('Experiment', id)
    return e
  }

  /** 휴지통에 있거나 사라진 실험의 딸린 데이터는 숨긴다. */
  const visibleParent = async (experimentId: ID): Promise<boolean> => {
    const e = await db.experiments.get(experimentId)
    return !!e && e.deletedAt === null
  }

  const projects = createProjectRepository(db)

  const experiments: ExperimentRepository = {
    list: (filter: ExperimentFilter = {}, sort: ExperimentSort = 'updated_desc', page?: PageRequest) =>
      guard(async (): Promise<PageResult<Experiment>> => {
        const mode = filter.deleted ?? 'exclude'
        let all = (await db.experiments.toArray()).filter((e) =>
          mode === 'only' ? e.deletedAt !== null : e.deletedAt === null,
        )
        if (filter.projectId) all = all.filter((e) => e.projectId === filter.projectId)
        if (filter.tag) all = all.filter((e) => e.tags.includes(filter.tag as string))
        if (filter.status) all = all.filter((e) => e.status === filter.status)
        if (filter.from) all = all.filter((e) => e.updatedAt >= (filter.from as string))
        if (filter.to) all = all.filter((e) => e.updatedAt <= (filter.to as string))
        all.sort((a, b) => {
          if (sort === 'title_asc') return a.title.localeCompare(b.title, 'ko')
          if (sort === 'started_desc') {
            return (b.startedAt ?? '').localeCompare(a.startedAt ?? '') || b.updatedAt.localeCompare(a.updatedAt)
          }
          return b.updatedAt.localeCompare(a.updatedAt)
        })
        const { limit, offset } = page ?? { limit: Number.MAX_SAFE_INTEGER, offset: 0 }
        return { items: all.slice(offset, offset + limit), total: all.length }
      }),

    get: (id) => guard(() => getExperiment(id)),

    create: (input) =>
      guard(async () => {
        const e = makeEntity<Experiment>(input)
        await db.experiments.add(e)
        return e
      }),

    update: (id, patch, expectedVersion) =>
      guard(async () =>
        db.transaction('rw', db.experiments, async () => {
          const cur = await getExperiment(id)
          checkVersion('Experiment', cur, expectedVersion)
          const next = bump<Experiment>(cur as Experiment, patch)
          await db.experiments.put(next)
          return next
        }),
      ),

    softDelete: (id) =>
      guard(async () => {
        const cur = await getExperiment(id)
        await db.experiments.put(bump(cur, { deletedAt: nowIso() }))
      }),

    restore: (id) =>
      guard(async () => {
        const cur = await getExperiment(id)
        await db.experiments.put(bump(cur, { deletedAt: null }))
      }),

    purge: (id) =>
      guard(async () =>
        db.transaction('rw', db.experiments, db.steps, db.dataItems, db.deviations, async () => {
          const cur = await getExperiment(id)
          if (cur.deletedAt === null) throw new Error('휴지통에 있는 실험만 영구 삭제할 수 있습니다')
          await db.steps.where('experimentId').equals(id).delete()
          await db.dataItems.where('experimentId').equals(id).delete()
          await db.deviations.where('experimentId').equals(id).delete()
          await db.experiments.delete(id)
        }),
      ),

    purgeExpired: (now) =>
      guard(async () =>
        db.transaction('rw', db.experiments, db.steps, db.dataItems, db.deviations, async () => {
          const targets = (await db.experiments.toArray()).filter((e) => isPurgeable(e.deletedAt, now))
          for (const e of targets) {
            await db.steps.where('experimentId').equals(e.id).delete()
            await db.dataItems.where('experimentId').equals(e.id).delete()
            await db.deviations.where('experimentId').equals(e.id).delete()
            await db.experiments.delete(e.id)
          }
          return targets.length
        }),
      ),

    search: (query, filter = {}) =>
      guard(async (): Promise<SearchHit[]> => {
        const { items } = await experiments.list({ ...filter, deleted: 'exclude' })
        return index.search(query, items)
      }),

    duplicate: (id, overrides) =>
      guard(async () =>
        db.transaction('rw', db.experiments, db.steps, db.dataItems, async () => {
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
          await db.experiments.add(copy)
          const srcSteps = await db.steps.where('experimentId').equals(id).sortBy('order')
          await db.steps.bulkAdd(
            srcSteps.map((s) =>
              makeEntity<Step>({ experimentId: copy.id, order: s.order, content: s.content, done: false, doneAt: null, note: '' }),
            ),
          )
          const srcData = await db.dataItems.where('experimentId').equals(id).toArray()
          // 조건은 값까지 가져오고, 결과는 항목 이름과 단위만 가져와 값을 비운다(결과를 빠뜨리지 않게).
          await db.dataItems.bulkAdd(
            srcData.map((d) =>
              makeEntity<DataItem>({
                experimentId: copy.id,
                kind: d.kind,
                order: d.order,
                name: d.name,
                value: d.kind === 'condition' ? d.value : '',
                unit: d.unit,
              }),
            ),
          )
          return copy
        }),
      ),
  }

  const steps: StepRepository = {
    listByExperiment: (experimentId) =>
      guard(async () => {
        if (!(await visibleParent(experimentId))) return []
        return db.steps.where('experimentId').equals(experimentId).sortBy('order')
      }),
    create: (input) =>
      guard(async () => {
        await getExperiment(input.experimentId)
        const s = makeEntity<Step>(input)
        await db.steps.add(s)
        return s
      }),
    update: (id, patch, expectedVersion) =>
      guard(async () =>
        db.transaction('rw', db.steps, async () => {
          const cur = await db.steps.get(id)
          if (!cur) throw new NotFoundError('Step', id)
          checkVersion('Step', cur, expectedVersion)
          const next = bump<Step>(cur as Step, patch)
          await db.steps.put(next)
          return next
        }),
      ),
    remove: (id) =>
      guard(async () => {
        const cur = await db.steps.get(id)
        if (!cur) throw new NotFoundError('Step', id)
        await db.steps.delete(id)
      }),
    reorder: (experimentId, orderedIds) =>
      guard(async () =>
        db.transaction('rw', db.steps, async () => {
          const current = await db.steps.where('experimentId').equals(experimentId).sortBy('order')
          const byId = new Map(current.map((s) => [s.id, s]))
          const sequence = [
            ...orderedIds.filter((id) => byId.has(id)),
            ...current.map((s) => s.id).filter((id) => !orderedIds.includes(id)),
          ]
          const out: Step[] = []
          for (let i = 0; i < sequence.length; i++) {
            const s = byId.get(sequence[i]) as Step
            const next = s.order === i + 1 ? s : bump(s, { order: i + 1 })
            if (next !== s) await db.steps.put(next)
            out.push(next)
          }
          return out
        }),
      ),
    setDone: (id, done) =>
      guard(async () =>
        db.transaction('rw', db.steps, async () => {
          const cur = await db.steps.get(id)
          if (!cur) throw new NotFoundError('Step', id)
          if (cur.done === done) return cur
          const next = bump(cur, { done, doneAt: done ? nowIso() : null })
          await db.steps.put(next)
          return next
        }),
      ),
  }

  const dataItems: DataItemRepository = {
    listByExperiment: (experimentId) =>
      guard(async () => {
        if (!(await visibleParent(experimentId))) return []
        const all = await db.dataItems.where('experimentId').equals(experimentId).toArray()
        return all.sort((a, b) => a.kind.localeCompare(b.kind) || a.order - b.order)
      }),
    create: (input) =>
      guard(async () => {
        await getExperiment(input.experimentId)
        const d = makeEntity<DataItem>(input)
        await db.dataItems.add(d)
        return d
      }),
    update: (id, patch, expectedVersion) =>
      guard(async () =>
        db.transaction('rw', db.dataItems, async () => {
          const cur = await db.dataItems.get(id)
          if (!cur) throw new NotFoundError('DataItem', id)
          checkVersion('DataItem', cur, expectedVersion)
          const next = bump<DataItem>(cur as DataItem, patch)
          await db.dataItems.put(next)
          return next
        }),
      ),
    remove: (id) =>
      guard(async () => {
        const cur = await db.dataItems.get(id)
        if (!cur) throw new NotFoundError('DataItem', id)
        await db.dataItems.delete(id)
      }),
  }

  const { templates, deviations, backup } = createLocalSupportingRepositories(db, index)

  return {
    projects,
    experiments,
    steps,
    dataItems,
    templates,
    deviations,
    backup,
    onExternalChange: (listener) => bus.subscribe(() => listener()),
    close: () => {
      bus.close()
      db.close()
    },
  }
}

