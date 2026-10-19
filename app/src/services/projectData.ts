import type { BackupFile, DataBackend } from '../data/repositories'
import type { DataItem, Experiment, ID, Step } from '../domain/types'
import type { ExperimentBundle } from './analysis'

/**
 * 백업(전체 읽기) 한 번에서 분석용 묶음을 만든다. 실험마다 따로 읽는 것보다 훨씬 빠르다.
 * 휴지통의 실험은 뺀다. 순서는 최근 수정순, 단계는 순서대로, 조건·결과는 종류별 순서대로.
 */
export function bundlesFromBackup(file: BackupFile, filter: (e: Experiment) => boolean = () => true): ExperimentBundle[] {
  const stepsBy = new Map<ID, Step[]>()
  for (const s of file.steps) {
    const list = stepsBy.get(s.experimentId)
    if (list) list.push(s)
    else stepsBy.set(s.experimentId, [s])
  }
  const itemsBy = new Map<ID, DataItem[]>()
  for (const d of file.dataItems) {
    const list = itemsBy.get(d.experimentId)
    if (list) list.push(d)
    else itemsBy.set(d.experimentId, [d])
  }
  return file.experiments
    .filter((e) => e.deletedAt === null && filter(e))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((experiment) => ({
      experiment,
      steps: [...(stepsBy.get(experiment.id) ?? [])].sort((a, b) => a.order - b.order),
      items: [...(itemsBy.get(experiment.id) ?? [])].sort((a, b) => a.kind.localeCompare(b.kind) || a.order - b.order),
    }))
}

export async function loadProjectBundles(db: DataBackend, projectId: ID): Promise<ExperimentBundle[]> {
  return bundlesFromBackup(await db.backup.exportAll(), (e) => e.projectId === projectId)
}

export async function loadAllBundles(db: DataBackend): Promise<ExperimentBundle[]> {
  return bundlesFromBackup(await db.backup.exportAll())
}

/** 백업 권유 판단용: 가장 최근에 바뀐 시각과 가장 오래된 생성 시각 */
export function dataTimestamps(bundles: ExperimentBundle[]): { newestChange: string | null; oldestCreated: string | null } {
  let newest: string | null = null
  let oldest: string | null = null
  const see = (updatedAt: string, createdAt: string) => {
    if (newest === null || updatedAt > newest) newest = updatedAt
    if (oldest === null || createdAt < oldest) oldest = createdAt
  }
  for (const b of bundles) {
    see(b.experiment.updatedAt, b.experiment.createdAt)
    for (const s of b.steps) see(s.updatedAt, s.createdAt)
    for (const d of b.items) see(d.updatedAt, d.createdAt)
  }
  return { newestChange: newest, oldestCreated: oldest }
}
