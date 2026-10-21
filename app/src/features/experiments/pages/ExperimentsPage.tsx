import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useBackend } from '../../../app/BackendContext'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { ExperimentCard } from '../components/ExperimentCard'
import type { BackupFile } from '../../../data/repositories'
import type { Project } from '../../../domain/types'
import { PAGE_SIZE, useListFilters, type ListFilters } from '../hooks/useListFilters'
import { stepStats } from '../application/experimentService'
import { bundlesFromBackup } from '../../../shared/application/projectData'

const STATUS_CHIPS: { value: ListFilters['status']; label: string }[] = [
  { value: '', label: '전체' }, { value: 'ready', label: '준비' }, { value: 'running', label: '진행' }, { value: 'done', label: '완료' },
]

/** 주요 조건·결과까지 한 행에서 비교하는 실험 목록. 검색과 필터는 주소에 남는다. */
export function ExperimentsPage() {
  const backend = useBackend()
  const [routeParams] = useSearchParams()
  const { filters, update, reset, filtered } = useListFilters()
  const [projects, setProjects] = useState<Project[]>([])
  const [file, setFile] = useState<BackupFile | null>(null)
  const [trashCount, setTrashCount] = useState(0)

  useEffect(() => {
    let alive = true
    Promise.all([backend.projects.list(), backend.backup.exportAll(), backend.experiments.list({ deleted: 'only' })])
      .then(([projectRows, backup, trash]) => {
        if (!alive) return
        setProjects(projectRows)
        setFile(backup)
        setTrashCount(trash.total)
      }).catch(() => alive && setFile({ schemaVersion: 2, exportedAt: new Date().toISOString(), projects: [], experiments: [], steps: [], dataItems: [] }))
    return () => { alive = false }
  }, [backend])

  const projectName = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const allBundles = useMemo(() => file ? bundlesFromBackup(file) : [], [file])
  const allTags = useMemo(() => [...new Set(allBundles.flatMap((bundle) => bundle.experiment.tags))].sort((a, b) => a.localeCompare(b, 'ko')), [allBundles])
  const deviations = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of file?.deviations ?? []) counts.set(row.experimentId, (counts.get(row.experimentId) ?? 0) + 1)
    return counts
  }, [file])

  const matching = useMemo(() => {
    const query = filters.q.trim().toLocaleLowerCase('ko')
    const from = filters.period ? new Date(Date.now() - Number(filters.period) * 86400000).toISOString() : ''
    const rows = allBundles.filter(({ experiment }) => {
      if (query && !`${experiment.title}\n${experiment.purpose}`.toLocaleLowerCase('ko').includes(query)) return false
      if (filters.project && experiment.projectId !== filters.project) return false
      if (filters.tag && !experiment.tags.includes(filters.tag)) return false
      if (filters.status && experiment.status !== filters.status) return false
      return !from || experiment.updatedAt >= from
    })
    rows.sort((a, b) => filters.sort === 'title_asc'
      ? a.experiment.title.localeCompare(b.experiment.title, 'ko')
      : filters.sort === 'started_desc'
        ? (b.experiment.startedAt ?? '').localeCompare(a.experiment.startedAt ?? '')
        : b.experiment.updatedAt.localeCompare(a.experiment.updatedAt))
    return rows
  }, [allBundles, filters])

  const total = matching.length
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rows = matching.slice((filters.page - 1) * PAGE_SIZE, filters.page * PAGE_SIZE)
  const from = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1
  const to = Math.min(total, filters.page * PAGE_SIZE)

  return (
    <section>
      {routeParams.get('moved') && <p className="notice" role="status">{routeParams.get('moved') === 'templates' ? '템플릿 대신 기존 실험 이어받기를 사용하세요.' : '검색은 실험 목록의 제목·목적 검색으로 이동했습니다.'}</p>}
      <div className="list-head">
        <h1 className="page-title">실험</h1>
        <span className="list-head__count">{allBundles.length}건</span>
        <label className="list-head__sort">정렬{' '}
          <select className="input input--compact" value={filters.sort} onChange={(event) => update({ sort: event.target.value as ListFilters['sort'] })}>
            <option value="updated_desc">최근 수정순</option><option value="title_asc">이름순</option><option value="started_desc">시작일순</option>
          </select>
        </label>
      </div>

      <div className="filters" role="group" aria-label="검색과 필터">
        <input className="input filters__search" type="search" aria-label="실험 검색" placeholder="제목 또는 목적 검색" value={filters.q} onChange={(event) => update({ q: event.target.value })} />
        <div className="filters__chips" role="group" aria-label="상태">
          {STATUS_CHIPS.map((chip) => <button key={chip.value || 'all'} type="button" className={`chip${filters.status === chip.value ? ' is-on' : ''}`} aria-pressed={filters.status === chip.value} onClick={() => update({ status: chip.value })}>{chip.label}</button>)}
        </div>
        <select className="input input--compact" aria-label="프로젝트" value={filters.project} onChange={(event) => update({ project: event.target.value })}>
          <option value="">프로젝트 전체</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <select className="input input--compact" aria-label="태그" value={filters.tag} onChange={(event) => update({ tag: event.target.value })}>
          <option value="">태그 전체</option>{allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
        </select>
        <select className="input input--compact" aria-label="기간" value={filters.period} onChange={(event) => update({ period: event.target.value as ListFilters['period'] })}>
          <option value="">기간 전체</option><option value="7">최근 7일</option><option value="30">최근 30일</option><option value="90">최근 90일</option>
        </select>
        {filtered && <button type="button" className="link" onClick={reset}>필터 초기화</button>}
      </div>

      {file === null ? <p className="muted">불러오는 중…</p> : allBundles.length === 0 ? (
        <EmptyState title="첫 실험을 만들어 보세요" description="실험 기록을 한 곳에 모읍니다."><Link to="/experiments/new" className="btn btn--primary">+ 새 실험</Link></EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title="조건에 맞는 실험이 없습니다" description="검색어나 필터를 바꿔 보세요."><button type="button" className="btn" onClick={reset}>필터 초기화</button></EmptyState>
      ) : <>
        <div className="experiment-list">{rows.map((bundle) => {
          const stats = stepStats(bundle.steps)
          return <ExperimentCard key={bundle.experiment.id} experiment={bundle.experiment} projectName={bundle.experiment.projectId ? projectName.get(bundle.experiment.projectId) : undefined} percent={stats.percent} openSteps={bundle.experiment.status === 'running' ? stats.total - stats.done : undefined} items={bundle.items} deviationCount={deviations.get(bundle.experiment.id) ?? 0} />
        })}</div>
        <nav className="pager" aria-label="페이지"><span className="muted">{from}–{to} / {total}</span><button type="button" className="btn" onClick={() => update({ page: filters.page - 1 })} disabled={filters.page <= 1}>이전</button><span className="pager__now">{filters.page} / {pages}</span><button type="button" className="btn" onClick={() => update({ page: filters.page + 1 })} disabled={filters.page >= pages}>다음</button></nav>
      </>}
      <p className="list-foot"><Link to="/trash">휴지통 ({trashCount})</Link></p>
    </section>
  )
}
