import { useEffect, useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Column, Matrix, MatrixRow } from '../services/analysis'
import { STATUS_LABEL } from './StatusBadge'

interface Props {
  matrix: Matrix
  /** 프로젝트 id → 이름. 주면 프로젝트 열과 프로젝트 필터를 보여 준다(여러 프로젝트를 한꺼번에 볼 때) */
  projectNames?: Map<string, string>
  /** 현재 필터·정렬·열 선택이 바뀔 때마다 알려 준다(내보내기에서 "지금 보는 대로"를 쓰기 위함) */
  onViewChange?: (view: { rows: MatrixRow[]; columns: Column[] }) => void
}

type SortKey = 'title' | 'project' | 'status' | 'started' | string
interface Sort {
  key: SortKey
  dir: 'asc' | 'desc'
}

const PAGE_SIZES = [25, 50, 100, 0] as const
const STATUS_ORDER = { ready: 0, running: 1, done: 2 } as const

/** 실험이 많아도 끝까지 볼 수 있는 데이터 표: 검색·필터·정렬·열 고르기·페이지 나눔, 머리글과 실험 열 고정. */
export function DataGrid({ matrix, projectNames, onViewChange }: Props) {
  const uid = useId()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [project, setProject] = useState('')
  const [sort, setSort] = useState<Sort | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [pageSize, setPageSize] = useState<number>(50)
  const [page, setPage] = useState(0)

  const visibleColumns = useMemo(() => matrix.columns.filter((c) => !hidden.has(c.key)), [matrix.columns, hidden])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = matrix.rows.filter(
      (r) =>
        (!q || r.experiment.title.toLowerCase().includes(q)) &&
        (!status || r.experiment.status === status) &&
        (!project || r.experiment.projectId === project),
    )
    if (sort) {
      const dir = sort.dir === 'asc' ? 1 : -1
      const val = (r: MatrixRow): string | number | null => {
        if (sort.key === 'title') return r.experiment.title
        if (sort.key === 'project') return (r.experiment.projectId && projectNames?.get(r.experiment.projectId)) || ''
        if (sort.key === 'status') return STATUS_ORDER[r.experiment.status]
        if (sort.key === 'started') return r.experiment.startedAt ?? ''
        const c = r.cells[sort.key]
        return c?.num ?? null
      }
      list = [...list].sort((a, b) => {
        const x = val(a)
        const y = val(b)
        // 값이 없는 칸은 정렬 방향과 상관없이 맨 아래
        if (x === null && y === null) return 0
        if (x === null) return 1
        if (y === null) return -1
        return typeof x === 'number' && typeof y === 'number' ? (x - y) * dir : String(x).localeCompare(String(y), 'ko') * dir
      })
    }
    return list
  }, [matrix.rows, query, status, project, sort, projectNames])

  // 부모에게 지금 보는 범위를 알린다.
  useEffect(() => {
    onViewChange?.({ rows, columns: visibleColumns })
  }, [rows, visibleColumns, onViewChange])

  const size = pageSize === 0 ? Math.max(1, rows.length) : pageSize
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const current = Math.min(page, pages - 1)
  const shown = rows.slice(current * size, current * size + size)

  const toggleSort = (key: SortKey) => {
    setPage(0)
    setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null))
  }
  const ariaSort = (key: SortKey) => (sort?.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none')
  const arrow = (key: SortKey) => (sort?.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '')

  const header = (key: SortKey, content: React.ReactNode, className?: string) => (
    <th key={key} scope="col" aria-sort={ariaSort(key)} className={className}>
      <button type="button" className="matrix__sort" onClick={() => toggleSort(key)}>
        {content}
        <span aria-hidden="true">{arrow(key)}</span>
      </button>
    </th>
  )

  const setGroup = (kind: 'all' | 'condition' | 'result') =>
    setHidden(new Set(kind === 'all' ? [] : matrix.columns.filter((c) => c.kind !== kind).map((c) => c.key)))

  return (
    <div className="grid">
      <div className="grid__toolbar" role="group" aria-label="표 보기 설정">
        <div className="field">
          <label htmlFor={`${uid}-q`}>실험 이름 찾기</label>
          <input
            id={`${uid}-q`}
            className="input input--compact"
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(0)
            }}
            placeholder="예) 재령 28일"
          />
        </div>
        <div className="field">
          <label htmlFor={`${uid}-s`}>상태</label>
          <select
            id={`${uid}-s`}
            className="input input--compact"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(0)
            }}
          >
            <option value="">모두</option>
            {(['ready', 'running', 'done'] as const).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        {projectNames && (
          <div className="field">
            <label htmlFor={`${uid}-p`}>프로젝트</label>
            <select
              id={`${uid}-p`}
              className="input input--compact"
              value={project}
              onChange={(e) => {
                setProject(e.target.value)
                setPage(0)
              }}
            >
              <option value="">모든 프로젝트</option>
              {[...projectNames.entries()].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor={`${uid}-n`}>한 번에 보기</label>
          <select
            id={`${uid}-n`}
            className="input input--compact"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setPage(0)
            }}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? '전체' : `${n}건`}
              </option>
            ))}
          </select>
        </div>
        <details className="grid__columns">
          <summary>
            열 고르기 ({visibleColumns.length}/{matrix.columns.length})
          </summary>
          <div className="grid__columns-body">
            <div className="grid__columns-actions">
              <button type="button" className="btn btn--quiet" onClick={() => setGroup('all')}>
                모두 보기
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => setGroup('condition')}>
                조건만
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => setGroup('result')}>
                결과만
              </button>
            </div>
            <ul className="grid__column-list">
              {matrix.columns.map((c) => (
                <li key={c.key}>
                  <label className="grid__check">
                    <input
                      type="checkbox"
                      checked={!hidden.has(c.key)}
                      onChange={() =>
                        setHidden((h) => {
                          const next = new Set(h)
                          if (next.has(c.key)) next.delete(c.key)
                          else next.add(c.key)
                          return next
                        })
                      }
                    />
                    <span>
                      {c.name}
                      {c.unit && <span className="muted"> ({c.unit})</span>} <span className="muted">· {c.kind === 'condition' ? '조건' : '결과'}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </details>
      </div>

      <p className="grid__count" role="status">
        {rows.length === 0 ? '조건에 맞는 실험이 없습니다.' : `${current * size + 1}–${Math.min(rows.length, current * size + size)} / ${rows.length}건`}
        {rows.length !== matrix.rows.length && <span className="muted"> (전체 {matrix.rows.length}건 중)</span>}
      </p>

      <div className="matrix-wrap matrix-wrap--tall" tabIndex={0} role="region" aria-label="실험 × 항목 데이터 표">
        <table className="matrix matrix--sticky">
          <thead>
            <tr>
              {header('title', '실험', 'matrix__exp')}
              {projectNames && header('project', '프로젝트')}
              {header('status', '상태')}
              {header('started', '시작')}
              {visibleColumns.map((c) =>
                header(
                  c.key,
                  <>
                    <span className={`matrix__kind matrix__kind--${c.kind}`}>{c.kind === 'condition' ? '조건' : '결과'}</span> {c.name}
                    {c.unit && <span className="matrix__unit"> ({c.unit})</span>}
                    {c.units.length > 1 && <span className="matrix__warn"> 단위 확인</span>}
                  </>,
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.experiment.id}>
                <th scope="row" className="matrix__exp">
                  <Link to={`/experiments/${r.experiment.id}`}>{r.experiment.title}</Link>
                </th>
                {projectNames && <td className="matrix__text">{(r.experiment.projectId && projectNames.get(r.experiment.projectId)) || '—'}</td>}
                <td className="matrix__text">{STATUS_LABEL[r.experiment.status]}</td>
                <td className="matrix__text">{(r.experiment.startedAt ?? '').slice(0, 10) || '—'}</td>
                {visibleColumns.map((c) => {
                  const cell = r.cells[c.key]
                  if (!cell)
                    return (
                      <td key={c.key} className="cell cell--none" aria-label="항목 없음">
                        ·
                      </td>
                    )
                  return (
                    <td key={c.key} className={`cell${cell.outlier ? ' cell--out' : ''}${cell.empty ? ' cell--empty' : ''}`}>
                      {cell.empty ? '—' : cell.value}
                      {cell.outlier && (
                        <>
                          <span className="cell__flag" aria-hidden="true">
                            {' '}
                            ▲
                          </span>
                          <span className="visually-hidden"> (이상치 후보)</span>
                        </>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav className="grid__pager" aria-label="표 페이지">
          <button type="button" className="btn" disabled={current === 0} onClick={() => setPage(current - 1)}>
            이전
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button type="button" className="btn" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            다음
          </button>
        </nav>
      )}
    </div>
  )
}
