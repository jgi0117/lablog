import type { DataBackend } from '../data/repositories'
import { safeGet, safeSet } from './safeStorage'

const KEY = 'lablog:example-seeded'

/** 예시 데이터(UCI 콘크리트)의 프로젝트·실험 id는 이 머리말로 시작한다. */
const EXAMPLE_PROJECT = /^demo-project-/
const EXAMPLE_EXPERIMENT = /^concrete-/

/**
 * 이 브라우저에서 처음 열었을 때, 데이터가 하나도 없으면 예시 데이터를 한 번 넣는다.
 * 이미 기록이 있거나(휴지통 포함) 한 번 처리했으면 아무것도 하지 않는다. 사용자가 예시를 지워도 다시 넣지 않는다.
 * 넣었으면 true.
 */
export async function seedFirstRun(backend: DataBackend, seed: (b: DataBackend) => Promise<number>): Promise<boolean> {
  if (safeGet(KEY)) return false
  const page = { limit: 1, offset: 0 }
  const [live, trash, projects] = await Promise.all([
    backend.experiments.list({}, 'updated_desc', page),
    backend.experiments.list({ deleted: 'only' }, 'updated_desc', page),
    backend.projects.list(),
  ])
  if (live.total > 0 || trash.total > 0 || projects.length > 0) {
    safeSet(KEY, 'existing')
    return false
  }
  await seed(backend)
  safeSet(KEY, 'seeded')
  return true
}

/** 예시 데이터가 남아 있는 개수(프로젝트, 실험). */
export async function countExampleData(backend: DataBackend): Promise<{ projects: number; experiments: number }> {
  const [projects, experiments] = await Promise.all([backend.projects.list(), backend.experiments.list()])
  return {
    projects: projects.filter((p) => EXAMPLE_PROJECT.test(p.id)).length,
    experiments: experiments.items.filter((e) => EXAMPLE_EXPERIMENT.test(e.id)).length,
  }
}

/**
 * 예시 데이터를 지운다. 예시 실험은 휴지통을 거치지 않고 바로 삭제하고(딸린 단계·조건·결과·달라진 점 포함),
 * 예시 프로젝트는 목록에서 뺀다. 직접 만든 실험은 건드리지 않는다. 지운 실험 수를 돌려준다.
 */
export async function removeExampleData(backend: DataBackend): Promise<number> {
  const all = (await backend.experiments.list()).items.filter((e) => EXAMPLE_EXPERIMENT.test(e.id))
  for (const e of all) {
    await backend.experiments.softDelete(e.id)
    await backend.experiments.purge(e.id)
  }
  for (const p of await backend.projects.list()) {
    if (EXAMPLE_PROJECT.test(p.id)) await backend.projects.softDelete(p.id)
  }
  return all.length
}
