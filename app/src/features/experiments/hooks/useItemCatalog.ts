import { useEffect, useState } from 'react'
import { useBackend } from '../../../app/BackendContext'
import { buildCatalog, type CatalogItem } from '../application/catalog'
import { loadProjectBundles } from '../../../shared/application/projectData'

/** 프로젝트에서 이미 쓴 조건·결과 항목. 프로젝트가 없으면 빈 목록. */
export function useItemCatalog(projectId: string | null | undefined): CatalogItem[] {
  const backend = useBackend()
  const [catalog, setCatalog] = useState<{ projectId: string; items: CatalogItem[] } | null>(null)

  useEffect(() => {
    if (!projectId) return
    let alive = true
    loadProjectBundles(backend, projectId)
      .then((b) => alive && setCatalog({ projectId, items: buildCatalog(b) }))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [backend, projectId])

  return projectId && catalog?.projectId === projectId ? catalog.items : []
}
