import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useBackend } from '../app/BackendContext'
import { EmptyState } from '../components/EmptyState'
import { Highlight } from '../components/Highlight'
import { StatusBadge } from '../components/StatusBadge'
import type { SearchField, SearchHit } from '../data/repositories'
import { toExperimentFilter, type ListFilters } from '../hooks/useListFilters'
import type { Experiment, Project } from '../domain/types'
import { formatRelative } from '../services/format'
import { snippet } from '../services/highlight'
import { roman } from '../services/text'
import { suggestQueries, vocabularyFrom } from '../services/suggest'

type Group = 'all' | 'title' | 'step' | 'condition' | 'result'

const GROUPS: { key: Group; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'title', label: '제목·태그' },
  { key: 'step', label: '단계' },
  { key: 'condition', label: '조건' },
  { key: 'result', label: '결과' },
]

function groupOf(field: SearchField): Exclude<Group, 'all'> {
  if (field === 'step' || field === 'note') return 'step'
  if (field === 'condition') return 'condition'
  if (field === 'result') return 'result'
  return 'title'
}

function whereLabel(m: SearchHit['matches'][number]): string {
  switch (m.field) {
    case 'title':
      return '제목'
    case 'purpose':
      return '목적'
    case 'tag':
      return '태그'
    case 'step':
      return `단계 ${roman(m.stepOrder ?? 0)}`
    case 'note':
      return `메모 ${roman(m.stepOrder ?? 0)}`
    case 'condition':
      return '조건'
    default:
      return '결과'
  }
}

interface Result {
  hits: SearchHit[]
  experiments: Map<string, Experiment>
  suggestions: string[]
  ms: number
}

/** 통합 검색: 제목·단계·메모·조건·결과를 한 번에 찾고, 일치한 위치와 문구를 강조해 보여 준다. */
export function SearchPage() {
  const backend = useBackend()
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') ?? '').trim()
  const group = (GROUPS.find((g) => g.key === params.get('in'))?.key ?? 'all') as Group
  const project = params.get('project') ?? ''
  const period = (['7', '30', '90'].includes(params.get('period') ?? '') ? params.get('period') : '') as ListFilters['period']
  const [projects, setProjects] = useState<Project[]>([])
  const [result, setResult] = useState<Result | null>(null)
  const [pendingQuery, setPendingQuery] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    backend.projects
      .list()
      .then((p) => alive && setProjects(p))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [backend])

  useEffect(() => {
    if (!q) return
    let alive = true
    const started = performance.now()
    const filter = toExperimentFilter({ project, tag: '', status: '', period })
    setPendingQuery(q)
    Promise.all([backend.experiments.search(q, filter), backend.experiments.list(filter, 'updated_desc')])
      .then(([hits, list]) => {
        if (!alive) return
        setResult({
          hits,
          experiments: new Map(list.items.map((e) => [e.id, e])),
          suggestions: hits.length === 0 ? suggestQueries(q, vocabularyFrom(list.items)) : [],
          ms: performance.now() - started,
        })
        setPendingQuery(null)
      })
      .catch(() => {
        if (!alive) return
        setResult({ hits: [], experiments: new Map(), suggestions: [], ms: performance.now() - started })
        setPendingQuery(null)
      })
    return () => {
      alive = false
    }
  }, [backend, q, project, period])

  const counts = useMemo(() => {
    const c: Record<Group, number> = { all: 0, title: 0, step: 0, condition: 0, result: 0 }
    for (const h of result?.hits ?? []) {
      c.all++
      for (const g of new Set(h.matches.map((m) => groupOf(m.field)))) c[g]++
    }
    return c
  }, [result])

  const shown = useMemo(
    () => (result?.hits ?? []).filter((h) => group === 'all' || h.matches.some((m) => groupOf(m.field) === group)),
    [result, group],
  )

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value && !(key === 'in' && value === 'all')) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }

  const filtered = !!(project || period)
  const clearFilters = () => {
    const next = new URLSearchParams()
    next.set('q', q)
    setParams(next)
  }

  if (!q) {
    return (
      <section>
        <h1 className="page-title">검색</h1>
        <EmptyState title="찾을 내용을 입력하세요" description="위 검색창에 제목, 단계, 조건, 결과의 단어를 넣으면 한 번에 찾습니다. (Ctrl K)" />
      </section>
    )
  }

  return (
    <section>
      <div className="list-head">
        <h1 className="page-title">검색 결과</h1>
        {result && pendingQuery === null && (
          <span className="list-head__count">
            {shown.length}건 · {(result.ms / 1000).toFixed(2)}초
          </span>
        )}
      </div>
      <p className="muted search-q">
        검색어: <strong>{q}</strong>
      </p>

      <div className="filters" role="group" aria-label="검색 필터">
        <div className="filters__chips" role="group" aria-label="일치 위치">
          {GROUPS.map((g) => (
            <button key={g.key} type="button" className={`chip${group === g.key ? ' is-on' : ''}`} aria-pressed={group === g.key} onClick={() => setParam('in', g.key)}>
              {g.label} {counts[g.key]}
            </button>
          ))}
        </div>
        <select className="input input--compact" aria-label="프로젝트" value={project} onChange={(e) => setParam('project', e.target.value)}>
          <option value="">프로젝트 전체</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className="input input--compact" aria-label="기간" value={period} onChange={(e) => setParam('period', e.target.value)}>
          <option value="">기간 전체</option>
          <option value="7">최근 7일</option>
          <option value="30">최근 30일</option>
          <option value="90">최근 90일</option>
        </select>
      </div>

      {result === null || pendingQuery !== null ? (
        <p className="muted">찾는 중…</p>
      ) : shown.length === 0 ? (
        <EmptyState title="일치하는 실험이 없습니다" description="철자를 확인하거나 필터를 풀어 보세요.">
          {result.suggestions.length > 0 && (
            <p className="suggest">
              혹시 이 단어인가요?{' '}
              {result.suggestions.map((s) => (
                <Link key={s} to={`/search?q=${encodeURIComponent(s)}`} className="suggest__word">
                  {s}
                </Link>
              ))}
            </p>
          )}
          {(filtered || group !== 'all') && (
            <button type="button" className="btn" onClick={clearFilters}>
              필터 해제
            </button>
          )}
          <Link to="/experiments/new" className="btn btn--primary">
            새 실험 만들기
          </Link>
        </EmptyState>
      ) : (
        <ul className="results">
          {shown.map((h) => {
            const e = result.experiments.get(h.experimentId)
            if (!e) return null
            const matches = h.matches.filter((m) => group === 'all' || groupOf(m.field) === group)
            return (
              <li key={h.experimentId} className="result">
                <div className="result__top">
                  <Link to={`/experiments/${e.id}`} className="result__title">
                    <Highlight text={e.title} query={q} />
                  </Link>
                  <StatusBadge status={e.status} />
                  <span className="result__where">{[...new Set(h.matches.map(whereLabel))].slice(0, 3).join(' · ')}</span>
                </div>
                {matches.slice(0, 3).map((m, i) => (
                  <p key={i} className="result__snip">
                    <span className="result__label">{whereLabel(m)}</span> <Highlight text={snippet(m.text, q)} query={q} />
                  </p>
                ))}
                {matches.length > 3 && <p className="muted result__more">외 {matches.length - 3}곳에서 일치</p>}
                <span className="card__meta">
                  {e.owner ? `${e.owner} · ` : ''}
                  {formatRelative(e.updatedAt)} 수정
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
