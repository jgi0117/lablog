import { useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ExperimentFilter, ExperimentSort } from '../../../data/repositories'
import type { ExperimentStatus } from '../../../domain/types'

export interface ListFilters {
  q: string
  project: string
  tag: string
  status: '' | ExperimentStatus
  period: '' | '7' | '30' | '90'
  sort: ExperimentSort
  page: number
}

export const DEFAULT_FILTERS: ListFilters = { q: '', project: '', tag: '', status: '', period: '', sort: 'updated_desc', page: 1 }
export const PAGE_SIZE = 12
const STORAGE_KEY = 'lablog:list-filters'

const STATUSES = ['ready', 'running', 'done']
const PERIODS = ['7', '30', '90']
const SORTS = ['updated_desc', 'title_asc', 'started_desc']

/** 주소의 쿼리를 필터 값으로 읽는다. 알 수 없는 값은 기본값으로 돌린다. */
export function parseFilters(params: URLSearchParams): ListFilters {
  const status = params.get('status') ?? ''
  const period = params.get('period') ?? ''
  const sort = params.get('sort') ?? ''
  const page = Number(params.get('page') ?? '1')
  return {
    q: params.get('q') ?? '',
    project: params.get('project') ?? '',
    tag: params.get('tag') ?? '',
    status: STATUSES.includes(status) ? (status as ListFilters['status']) : '',
    period: PERIODS.includes(period) ? (period as ListFilters['period']) : '',
    sort: SORTS.includes(sort) ? (sort as ExperimentSort) : 'updated_desc',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  }
}

/** 기본값과 다른 것만 주소에 담는다. */
export function toParams(f: ListFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.project) p.set('project', f.project)
  if (f.tag) p.set('tag', f.tag)
  if (f.status) p.set('status', f.status)
  if (f.period) p.set('period', f.period)
  if (f.sort !== 'updated_desc') p.set('sort', f.sort)
  if (f.page > 1) p.set('page', String(f.page))
  return p
}

export function isFiltered(f: ListFilters): boolean {
  return !!(f.q || f.project || f.tag || f.status || f.period)
}

/** 화면 필터를 저장소 조회 조건으로 바꾼다. 기간은 마지막 수정 시각 기준. */
export function toExperimentFilter(f: Pick<ListFilters, 'project' | 'tag' | 'status' | 'period'>, now = new Date()): ExperimentFilter {
  const out: ExperimentFilter = {}
  if (f.project) out.projectId = f.project
  if (f.tag) out.tag = f.tag
  if (f.status) out.status = f.status
  if (f.period) out.from = new Date(now.getTime() - Number(f.period) * 86400000).toISOString()
  return out
}

/**
 * 실험 목록의 필터·정렬·페이지를 주소(?project=&tag=&status=&period=&sort=&page=)와 동기화한다.
 * 주소에 아무것도 없으면 마지막으로 쓴 필터를 복원한다(기기 안에만 저장).
 */
export function useListFilters() {
  const [params, setParams] = useSearchParams()
  const filters = parseFilters(params)

  useEffect(() => {
    if ([...params.keys()].length > 0) return
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setParams(new URLSearchParams(saved), { replace: true })
    } catch {
      // 저장소를 쓸 수 없어도 목록은 정상 동작한다.
    }
    // 처음 한 번만 복원한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = useCallback(
    (patch: Partial<ListFilters>) => {
      const next = { ...parseFilters(params), ...patch, page: patch.page ?? 1 }
      setParams(toParams(next))
      try {
        localStorage.setItem(STORAGE_KEY, toParams({ ...next, page: 1 }).toString())
      } catch {
        // 무시
      }
    },
    [params, setParams],
  )

  const reset = useCallback(() => {
    setParams(new URLSearchParams())
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // 무시
    }
  }, [setParams])

  return { filters, update, reset, filtered: isFiltered(filters) }
}
