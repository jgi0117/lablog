import { useCallback, useEffect, useState } from 'react'
import { useBackend } from '../../../app/BackendContext'
import type { Project } from '../../../domain/types'
import type { ExperimentBundle } from '../../../domain/analysis/analysis'
import { loadAllBundles, loadProjectBundles } from '../../../shared/application/projectData'

export type BundleStatus = 'loading' | 'ready' | 'notfound' | 'error'

/** 프로젝트 한 개와 그 실험들(단계·조건·결과 포함)을 읽는다. */
export function useProjectBundles(projectId: string) {
  const backend = useBackend()
  const [status, setStatus] = useState<BundleStatus>('loading')
  const [project, setProject] = useState<Project | null>(null)
  const [bundles, setBundles] = useState<ExperimentBundle[]>([])

  const fetchAll = useCallback(async () => {
    const projects = await backend.projects.list()
    const p = projects.find((x) => x.id === projectId) ?? null
    if (!p) return { p: null, b: [] as ExperimentBundle[] }
    return { p, b: await loadProjectBundles(backend, projectId) }
  }, [backend, projectId])

  useEffect(() => {
    let alive = true
    fetchAll()
      .then(({ p, b }) => {
        if (!alive) return
        setProject(p)
        setBundles(b)
        setStatus(p ? 'ready' : 'notfound')
      })
      .catch(() => alive && setStatus('error'))
    return () => {
      alive = false
    }
  }, [fetchAll])

  const reload = useCallback(async () => {
    const { p, b } = await fetchAll()
    setProject(p)
    setBundles(b)
  }, [fetchAll])

  return { status, project, setProject, bundles, reload }
}

/** 모든 프로젝트와 모든 실험. 프로젝트 목록과 홈의 "놓친 것"에 쓴다. */
export function useAllBundles() {
  const backend = useBackend()
  const [state, setState] = useState<{ projects: Project[]; bundles: ExperimentBundle[] } | null>(null)

  const load = useCallback(async () => {
    const [projects, bundles] = await Promise.all([backend.projects.list(), loadAllBundles(backend)])
    return { projects, bundles }
  }, [backend])

  useEffect(() => {
    let alive = true
    load()
      .then((s) => alive && setState(s))
      .catch(() => alive && setState({ projects: [], bundles: [] }))
    return () => {
      alive = false
    }
  }, [load])

  return { state, reload: async () => setState(await load()) }
}
