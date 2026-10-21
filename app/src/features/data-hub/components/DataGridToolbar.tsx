import type { Dispatch, SetStateAction } from 'react'
import type { Column } from '../../../domain/analysis/analysis'
import { STATUS_LABEL } from '../../../shared/ui/StatusBadge'

const PAGE_SIZES = [25, 50, 100, 0] as const

interface Props {
  uid: string
  query: string
  onQuery: Dispatch<SetStateAction<string>>
  status: string
  onStatus: Dispatch<SetStateAction<string>>
  project: string
  onProject: Dispatch<SetStateAction<string>>
  requirement: string
  onRequirement: Dispatch<SetStateAction<string>>
  pageSize: number
  onPageSize: Dispatch<SetStateAction<number>>
  onResetPage: () => void
  projectNames?: Map<string, string>
  hasRequirements: boolean
  columns: Column[]
  visibleColumns: Column[]
  hidden: Set<string>
  onHidden: Dispatch<SetStateAction<Set<string>>>
}

export function DataGridToolbar(props: Props) {
  const { uid, query, onQuery, status, onStatus, project, onProject, requirement: reqFilter, onRequirement, pageSize, onPageSize, onResetPage, projectNames, hasRequirements, columns, visibleColumns, hidden, onHidden } = props
  const setGroup = (kind: 'all' | 'condition' | 'result') =>
    onHidden(new Set(kind === 'all' ? [] : columns.filter((column) => column.kind !== kind).map((column) => column.key)))
  const setQuery = (value: string) => { onQuery(value); onResetPage() }
  const setStatus = (value: string) => { onStatus(value); onResetPage() }
  const setProject = (value: string) => { onProject(value); onResetPage() }
  const setReqFilter = (value: string) => { onRequirement(value); onResetPage() }
  const setPageSize = (value: number) => { onPageSize(value); onResetPage() }
  const matrix = { columns }
  const setHidden = onHidden
  return (
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
            onResetPage()
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
            onResetPage()
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
              onResetPage()
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
      {hasRequirements && (
        <div className="field">
          <label htmlFor={`${uid}-r`}>고객 요구</label>
          <select
            id={`${uid}-r`}
            className="input input--compact"
            value={reqFilter}
            onChange={(e) => {
              setReqFilter(e.target.value)
              onResetPage()
            }}
          >
            <option value="">모두</option>
            <option value="met">필수 요구를 모두 만족한 것</option>
            <option value="unmet">미달이 있는 것</option>
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
            onResetPage()
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
  )
}
