import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { StatusBadge } from '../components/StatusBadge'
import { useExperimentData } from '../hooks/useExperimentData'

const RUN_LABEL = { ready: '수행 모드 시작', running: '이어서 하기', done: '' } as const

/** 실험 상세의 공통 틀: 제목, 상태, 탭, 수행 모드 진입. 데이터는 한 번 읽어 탭들이 같이 쓴다. */
export function ExperimentLayout() {
  const { id = '' } = useParams()
  const data = useExperimentData(id)

  if (data.status === 'loading') return <p className="muted">불러오는 중…</p>
  if (data.status === 'notfound' || !data.experiment) {
    return (
      <EmptyState title="실험을 찾을 수 없습니다" description="삭제되었거나 주소가 잘못되었습니다.">
        <Link to="/" className="btn btn--primary">
          홈으로
        </Link>
      </EmptyState>
    )
  }
  if (data.status === 'error') {
    return <EmptyState title="실험을 불러오지 못했습니다" description="저장소를 읽는 중 문제가 생겼습니다. 새로고침해 보세요." />
  }

  const exp = data.experiment
  const tabs = [
    { to: `/experiments/${id}`, label: '개요', end: true },
    { to: `/experiments/${id}/steps`, label: `절차 (${data.steps.length})`, end: false },
    { to: `/experiments/${id}/data`, label: '조건·결과', end: false },
    { to: `/experiments/${id}/deviations`, label: `달라진 점 (${data.deviations.length})`, end: false },
  ]

  return (
    <section>
      <header className="exp-head">
        <h1 className="page-title page-title--tight">{exp.title}</h1>
        <StatusBadge status={exp.status} />
      </header>
      <nav className="tabs" aria-label="실험 상세 탭">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tabs__item${isActive ? ' is-active' : ''}`}>
            {t.label}
          </NavLink>
        ))}
        {exp.status !== 'done' && (
          <Link to={`/experiments/${id}/run`} className="btn btn--primary tabs__run">
            {RUN_LABEL[exp.status]}
          </Link>
        )}
      </nav>
      <Outlet context={data} />
    </section>
  )
}
