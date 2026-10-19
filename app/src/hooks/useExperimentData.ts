import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { useBackend } from '../app/BackendContext'
import { NotFoundError } from '../data/repositories'
import type { DataItem, Deviation, Experiment, Step } from '../domain/types'

export type LoadStatus = 'loading' | 'ready' | 'notfound' | 'error'

export interface ExperimentData {
  status: LoadStatus
  experiment: Experiment | null
  steps: Step[]
  items: DataItem[]
  deviations: Deviation[]
  setExperiment: Dispatch<SetStateAction<Experiment | null>>
  setSteps: Dispatch<SetStateAction<Step[]>>
  setItems: Dispatch<SetStateAction<DataItem[]>>
  setDeviations: Dispatch<SetStateAction<Deviation[]>>
  reload: () => Promise<void>
}

/** 실험 한 건과 딸린 단계·조건·결과를 불러온다. 화면은 setX로 바로 갱신하고, 필요하면 reload로 다시 읽는다. */
export function useExperimentData(id: string): ExperimentData {
  const backend = useBackend()
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [experiment, setExperiment] = useState<Experiment | null>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const [items, setItems] = useState<DataItem[]>([])
  const [deviations, setDeviations] = useState<Deviation[]>([])

  const fetchAll = useCallback(async () => {
    const exp = await backend.experiments.get(id)
    if (exp.deletedAt) throw new NotFoundError('Experiment', id)
    const [s, d, v] = await Promise.all([
      backend.steps.listByExperiment(id),
      backend.dataItems.listByExperiment(id),
      backend.deviations.listByExperiment(id),
    ])
    return { exp, s, d, v }
  }, [backend, id])

  useEffect(() => {
    let alive = true
    setStatus('loading')
    fetchAll()
      .then(({ exp, s, d, v }) => {
        if (!alive) return
        setExperiment(exp)
        setSteps(s)
        setItems(d)
        setDeviations(v)
        setStatus('ready')
      })
      .catch((e) => {
        if (alive) setStatus(e instanceof NotFoundError ? 'notfound' : 'error')
      })
    return () => {
      alive = false
    }
  }, [fetchAll])

  const reload = useCallback(async () => {
    const { exp, s, d, v } = await fetchAll()
    setExperiment(exp)
    setSteps(s)
    setItems(d)
    setDeviations(v)
  }, [fetchAll])

  return { status, experiment, steps, items, deviations, setExperiment, setSteps, setItems, setDeviations, reload }
}
