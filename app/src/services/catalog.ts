import type { DataKind } from '../domain/types'
import { buildMatrix, normalizeName, type ExperimentBundle } from './analysis'

/** 같은 프로젝트에서 이미 쓴 조건·결과 항목. 입력할 때 같은 이름·단위로 쓰도록 돕는다. */
export interface CatalogItem {
  kind: DataKind
  name: string
  unit: string
  /** 이 항목을 쓴 실험 수 */
  count: number
}

export function buildCatalog(bundles: ExperimentBundle[]): CatalogItem[] {
  return buildMatrix(bundles).columns.map((c) => ({ kind: c.kind, name: c.name, unit: c.unit, count: c.count }))
}

/** 이름이 (띄어쓰기·대소문자 무시하고) 정확히 같은 항목의 단위. 없으면 null. */
export function findCatalogUnit(catalog: CatalogItem[], kind: DataKind, name: string): string | null {
  const key = normalizeName(name)
  if (!key) return null
  return catalog.find((c) => c.kind === kind && normalizeName(c.name) === key)?.unit || null
}

/** 입력창 제안 목록: 해당 종류의 항목 이름을 많이 쓴 순서로. */
export function catalogNames(catalog: CatalogItem[], kind: DataKind): string[] {
  return catalog.filter((c) => c.kind === kind).map((c) => c.name)
}
