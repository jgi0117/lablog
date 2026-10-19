import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useBackend } from '../app/BackendContext'
import { EmptyState } from '../components/EmptyState'
import { ExperimentCard } from '../components/ExperimentCard'
import { PAGE_SIZE, toExperimentFilter, useListFilters, type ListFilters } from '../hooks/useListFilters'
import type { Experiment, Project } from '../domain/types'
import { stepStats } from '../services/experimentService'

interface Row {
  experiment: Experiment
  percent: number
  open: number
}

const STATUS_CHIPS: { value: ListFilters['status']; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'ready', label: '준비' },
  { value: 'running', label: '진행' },
  { value: 'done', label: '완료' },
]

/** 실험 목록: 프로젝트·태그·상태·기간 필터, 정렬, 페이지 나눔. 필터는 주소에 담긴다. */
export function ExperimentsPage() {
  const backend = useBackend()
  const { filters, update, reset, filtered } = useListFilters()
  const [projects, setProjects] = useState<Project[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [rows, setRows] = useState<Row[] | null>(null)
  const [total, setTotal] = useState(0)
  const [everything, setEverything] = useState(0)
  const [trashCount, setTrashCount] = useState(0)
  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])

  // 필터 선택지(프로젝트, 태그)와 전체·휴지통 개수. 처음 한 번 읽는다.
  useEffect(() => {
    let alive = true
    Promise.all([backend.projects.list(), backend.experiments.list({}, 'updated_desc'), backend.experiments.list({ deleted: 'only' })])
      .then(([p, all, trash]) => {
        if (!alive) return
        setProjects(p)
        setAllTags([...new Set(all.items.flatMap((e) => e.tags))].sort((a, b) => a.localeCompare(b, 'ko')))
        setEverything(all.total)
        setTrashCount(trash.total)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [backend])

  const filterKey = JSON.stringify(filters)
  useEffect(() => {
    let alive = true
    backend.experiments
      .list(toExperimentFilter(filters), filters.sort, { limit: PAGE_SIZE, offset: (filters.page - 1) * PAGE_SIZE })
      .then(async (res) => {
        const list = await Promise.all(
          res.items.map(async (experiment) => {
            const s = stepStats(await backend.steps.listByExperiment(experiment.id))
            return { experiment, percent: s.percent, open: s.total - s.done }
          }),
        )
        if (!alive) return
        setRows(list)
        setTotal(res.total)
      })
      .catch(() => {
        if (alive) {
          setRows([])
          setTotal(0)
        }
      })
    return () => {
      alive = false
    }
    // filters는 filterKey로 비교한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, filterKey])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const from = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1
  const to = Math.min(total, filters.page * PAGE_SIZE)

  return (
    <section>
      <div className="list-head">
        <h1 className="page-title">실험</h1>
        <span className="list-head__count">{everything}건</span>
        <label className="list-head__sort">
          정렬{' '}
          <select className="input input--compact" value={filters.sort} onChange={(e) => update({ sort: e.target.value as ListFilters['sort'] })}>
            <option value="updated_desc">최근 수정순</option>
            <option value="title_asc">이름순</option>
            <option value="started_desc">시작일순</option>
          </select>
        </label>
      </div>

      <div className="filters" role="group" aria-label="필터">
        <div className="filters__chips" role="group" aria-label="상태">
          {STATUS_CHIPS.map((c) => (
            <button
              key={c.value || 'all'}
              type="button"
              className={`chip${filters.status === c.value ? ' is-on' : ''}`}
              aria-pressed={filters.status === c.value}
              onClick={() => update({ status: c.value })}
            >
              {c.label}
            </button>
          ))}
        </div>
        <select className="input input--compact" aria-label="프로젝트" value={filters.project} onChange={(e) => update({ project: e.target.value })}>
          <option value="">프로젝트 전체</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className="input input--compact" aria-label="태그" value={filters.tag} onChange={(e) => update({ tag: e.target.value })}>
          <option value="">태그 전체</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select className="input input--compact" aria-label="기간" value={filters.period} onChange={(e) => update({ period: e.target.value as ListFilters['period'] })}>
          <option value="">기간 전체</option>
          <option value="7">최근 7일</option>
          <option value="30">최근 30일</option>
          <option value="90">최근 90일</option>
        </select>
        {filtered && (
          <button type="button" className="link" onClick={reset}>
            필터 초기화
          </button>
        )}
      </div>

      {rows === null ? (
        <p className="muted">불러오는 중…</p>
      ) : everything === 0 ? (
        <EmptyState title="첫 실험을 만들어 보세요" description="실험 기록을 한 곳에 모읍니다.">
          <Link to="/experiments/new" className="btn btn--primary">
            + 새 실험
          </Link>
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title="조건에 맞는 실험이 없습니다" description="필터를 풀거나 다른 조건으로 찾아 보세요.">
          <button type="button" className="btn" onClick={reset}>
            필터 초기화
          </button>
        </EmptyState>
      ) : (
        <>
          <div className="card-grid">
            {rows.map((r) => (
              <ExperimentCard
                key={r.experiment.id}
                experiment={r.experiment}
                projectName={r.experiment.projectId ? projectName.get(r.experiment.projectId) : undefined}
                percent={r.percent}
                openSteps={r.experiment.status === 'running' ? r.open : undefined}
              />
            ))}
          </div>
          <nav className="pager" aria-label="페이지">
            <span className="muted">
              {from}–{to} / {total}
            </span>
            <button type="button" className="btn" onClick={() => update({ page: filters.page - 1 })} disabled={filters.page <= 1}>
              이전
            </button>
            <span className="pager__now">
              {filters.page} / {pages}
            </span>
            <button type="button" className="btn" onClick={() => update({ page: filters.page + 1 })} disabled={filters.page >= pages}>
              다음
            </button>
          </nav>
        </>
      )}
      <p className="list-foot">
        <Link to="/trash">휴지통 ({trashCount})</Link>
      </p>
    </section>
  )
}
