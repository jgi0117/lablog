import type { DataBackend } from '../data/repositories'
import type { Experiment, ID } from '../domain/types'
import type { ExperimentBundle } from './analysis'

/** 실험들의 단계·조건·결과를 함께 읽어 분석용 묶음으로 만든다. */
export async function loadBundles(db: DataBackend, experiments: Experiment[]): Promise<ExperimentBundle[]> {
  return Promise.all(
    experiments.map(async (experiment) => {
      const [steps, items] = await Promise.all([db.steps.listByExperiment(experiment.id), db.dataItems.listByExperiment(experiment.id)])
      return { experiment, steps, items }
    }),
  )
}

export async function loadProjectBundles(db: DataBackend, projectId: ID): Promise<ExperimentBundle[]> {
  const { items } = await db.experiments.list({ projectId }, 'updated_desc')
  return loadBundles(db, items)
}

export async function loadAllBundles(db: DataBackend): Promise<ExperimentBundle[]> {
  const { items } = await db.experiments.list({}, 'updated_desc')
  return loadBundles(db, items)
}
