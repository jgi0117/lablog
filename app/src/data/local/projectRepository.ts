import { LablogDB } from './db'
import { guard, makeEntity, nowIso } from './util'
import { ConflictError, NotFoundError, type ProjectRepository } from '../repositories'
import type { Entity, Project } from '../../domain/types'

function checkVersion(current: Entity, expected?: number) {
  if (expected !== undefined && current.version !== expected) throw new ConflictError('Project', current.id, current.version)
}
function bump<T extends Entity>(current: T, patch: Partial<T>): T {
  return { ...current, ...patch, updatedAt: nowIso(), version: current.version + 1 }
}

export function createProjectRepository(db: LablogDB): ProjectRepository {
  return {
    list: () =>
      guard(async () => {
        const all = await db.projects.toArray()
        return all.filter((p) => p.deletedAt === null).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      }),
    create: (input) =>
      guard(async () => {
        const p = makeEntity<Project>(input)
        await db.projects.add(p)
        return p
      }),
    update: (id, patch, expectedVersion) =>
      guard(async () =>
        db.transaction('rw', db.projects, async () => {
          const cur = await db.projects.get(id)
          if (!cur) throw new NotFoundError('Project', id)
          checkVersion(cur, expectedVersion)
          const next = bump<Project>(cur as Project, patch)
          await db.projects.put(next)
          return next
        }),
      ),
    softDelete: (id) =>
      guard(async () => {
        const cur = await db.projects.get(id)
        if (!cur) throw new NotFoundError('Project', id)
        await db.projects.put(bump(cur, { deletedAt: nowIso() }))
      }),
  }

}
