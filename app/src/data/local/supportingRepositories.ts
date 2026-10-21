import { LablogDB } from './db'
import { createSearchIndex } from './searchIndex'
import { guard, makeEntity, nowIso } from './util'
import { BACKUP_SCHEMA_VERSION, ConflictError, NotFoundError, type BackupFile, type DataBackend, type DeviationRepository, type TemplateRepository } from '../repositories'
import type { Deviation, Entity, Experiment, ID, Template } from '../../domain/types'

function checkVersion(entity: string, current: Entity, expected?: number) {
  if (expected !== undefined && current.version !== expected) throw new ConflictError(entity, current.id, current.version)
}

function bump<T extends Entity>(current: T, patch: Partial<T>): T {
  return { ...current, ...patch, updatedAt: nowIso(), version: current.version + 1 }
}

export function createLocalSupportingRepositories(db: LablogDB, index: ReturnType<typeof createSearchIndex>) {
  const getExperiment = async (id: ID): Promise<Experiment> => {
    const experiment = await db.experiments.get(id)
    if (!experiment) throw new NotFoundError('Experiment', id)
    return experiment
  }
  const visibleParent = async (experimentId: ID) => {
    const experiment = await db.experiments.get(experimentId)
    return !!experiment && experiment.deletedAt === null
  }

  const templates: TemplateRepository = {
    list: () =>
      guard(async () => {
        const all = await db.templates.toArray()
        return all.filter((t) => t.deletedAt === null).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      }),
    get: (id) =>
      guard(async () => {
        const t = await db.templates.get(id)
        if (!t || t.deletedAt !== null) throw new NotFoundError('Template', id)
        return t
      }),
    create: (input) =>
      guard(async () => {
        const t = makeEntity<Template>(input)
        await db.templates.add(t)
        return t
      }),
    update: (id, patch, expectedVersion) =>
      guard(async () =>
        db.transaction('rw', db.templates, async () => {
          const cur = await db.templates.get(id)
          if (!cur || cur.deletedAt !== null) throw new NotFoundError('Template', id)
          checkVersion('Template', cur, expectedVersion)
          const next = bump<Template>(cur, patch)
          await db.templates.put(next)
          return next
        }),
      ),
    softDelete: (id) =>
      guard(async () => {
        const cur = await db.templates.get(id)
        if (!cur || cur.deletedAt !== null) throw new NotFoundError('Template', id)
        await db.templates.put(bump(cur, { deletedAt: nowIso() }))
      }),
  }

  const deviations: DeviationRepository = {
    listByExperiment: (experimentId) =>
      guard(async () => {
        if (!(await visibleParent(experimentId))) return []
        const all = await db.deviations.where('experimentId').equals(experimentId).toArray()
        return all.filter((d) => d.deletedAt === null).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      }),
    create: (input) =>
      guard(async () => {
        await getExperiment(input.experimentId)
        const d = makeEntity<Deviation>(input)
        await db.deviations.add(d)
        return d
      }),
    update: (id, patch, expectedVersion) =>
      guard(async () =>
        db.transaction('rw', db.deviations, async () => {
          const cur = await db.deviations.get(id)
          if (!cur) throw new NotFoundError('Deviation', id)
          checkVersion('Deviation', cur, expectedVersion)
          const next = bump<Deviation>(cur, patch)
          await db.deviations.put(next)
          return next
        }),
      ),
    remove: (id) =>
      guard(async () => {
        const cur = await db.deviations.get(id)
        if (!cur) throw new NotFoundError('Deviation', id)
        await db.deviations.delete(id)
      }),
  }

  const backup: DataBackend['backup'] = {
    exportAll: () =>
      guard(async (): Promise<BackupFile> => {
        const [p, e, s, d, t, v] = await Promise.all([
          db.projects.toArray(),
          db.experiments.toArray(),
          db.steps.toArray(),
          db.dataItems.toArray(),
          db.templates.toArray(),
          db.deviations.toArray(),
        ])
        return { schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: nowIso(), projects: p, experiments: e, steps: s, dataItems: d, templates: t, deviations: v }
      }),
    importAll: (file, mode) =>
      guard(async () => {
        if (file.schemaVersion > BACKUP_SCHEMA_VERSION) {
          throw new Error('이 백업 파일은 더 새로운 버전에서 만들어졌습니다. 앱을 업데이트한 뒤 가져오세요.')
        }
        return db.transaction('rw', [db.projects, db.experiments, db.steps, db.dataItems, db.templates, db.deviations], async () => {
          let imported = 0
          const load = async <T extends Entity>(
            table: { toArray(): Promise<T[]>; clear(): Promise<void>; bulkPut(items: T[]): Promise<unknown> },
            incoming: T[],
          ) => {
            if (mode === 'replace') {
              await table.clear()
              await table.bulkPut(incoming)
              imported += incoming.length
              return
            }
            const existing = new Map((await table.toArray()).map((x) => [x.id, x]))
            const take = incoming.filter((x) => {
              const cur = existing.get(x.id)
              return !cur || x.updatedAt > cur.updatedAt
            })
            await table.bulkPut(take)
            imported += take.length
          }
          index.invalidateAll()
          await load(db.projects, file.projects)
          await load(db.experiments, file.experiments)
          await load(db.steps, file.steps)
          await load(db.dataItems, file.dataItems)
          // 편차는 실험에 딸려 있어 항상 파일 기준으로 맞춘다. 템플릿은 버전 1 파일(목록 없음)이면 건드리지 않는다.
          await load(db.deviations, file.deviations ?? [])
          if (file.templates !== undefined) await load(db.templates, file.templates)
          return { imported }
        })
      }),
  }


  return { templates, deviations, backup }
}
