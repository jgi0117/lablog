import { useMemo } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { useAllBundles } from '../hooks/useBundles'
import type { DataHubContext } from '../hooks/useDataHub'
import { buildMatrix } from '../services/analysis'
import { columnSummaries } from '../services/insights'

const TABS = [
  { to: '/data', label: '표', end: true },
  { to: '/data/analysis', label: '분석', end: false },
  { to: '/data/export', label: '내보내기', end: false },
]

/**
 * 모든 프로젝트의 실험 데이터를 한곳에 모아 보는 화면의 틀. 한 번 읽어 표·분석·내보내기 탭이 같이 쓴다.
 * 나중에 통계 분석이나 머신러닝에 쓸 수 있도록, 조건과 결과를 실험 한 줄씩의 표로 만들어 둔다.
 */
export function DataLayout() {
  const { state } = useAllBundles()
  const ctx = useMemo<DataHubContext | null>(() => {
    if (!state) return null
    return {
      projects: state.projects,
      projectNames: new Map(state.projects.map((p) => [p.id, p.name])),
      bundles: state.bundles,
      matrix: buildMatrix(state.bundles),
    }
  }, [state])
  const stats = useMemo(() => {
    if (!ctx) return null
    const sums = columnSummaries(ctx.matrix)
    return {
      values: sums.reduce((n, s) => n + (s.summary?.n ?? 0), 0),
      columns: ctx.matrix.columns.length,
      mixed: ctx.matrix.columns.filter((c) => c.units.length > 1).length,
    }
  }, [ctx])

  if (!ctx || !stats) return <p className="muted">불러오는 중…</p>

  return (
    <section>
      <h1 className="page-title">데이터</h1>
      <p className="muted data-hub__intro">모든 프로젝트의 실험 기록을 한곳에 모았습니다. 보고, 통계로 분석하고, 파일로 내보내 다른 도구에서 쓸 수 있습니다.</p>
      {ctx.matrix.rows.length === 0 ? (
        <EmptyState title="모을 데이터가 없습니다" description="실험에 조건과 결과를 입력하면 여기에 모입니다.">
          <Link to="/experiments/new" className="btn btn--primary">
            + 새 실험
          </Link>
        </EmptyState>
      ) : (
        <>
          <dl className="data-hub__stats" aria-label="데이터 규모">
            <div>
              <dt>프로젝트</dt>
              <dd>{ctx.projects.length}개</dd>
            </div>
            <div>
              <dt>실험</dt>
              <dd>{ctx.matrix.rows.length}건</dd>
            </div>
            <div>
              <dt>항목(조건·결과)</dt>
              <dd>{stats.columns}개</dd>
            </div>
            <div>
              <dt>숫자 값</dt>
              <dd>{stats.values.toLocaleString('ko-KR')}개</dd>
            </div>
            {stats.mixed > 0 && (
              <div>
                <dt>단위가 섞인 항목</dt>
                <dd>{stats.mixed}개</dd>
              </div>
            )}
          </dl>
          <nav className="tabs" aria-label="데이터 탭">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tabs__item${isActive ? ' is-active' : ''}`}>
                {t.label}
              </NavLink>
            ))}
          </nav>
          <Outlet context={ctx} />
        </>
      )}
    </section>
  )
}
