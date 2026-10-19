import { Link } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { GapList } from '../components/GapList'
import { StatusBadge } from '../components/StatusBadge'
import { StatusBar, TimelineChart } from '../components/charts'
import { useProject } from '../hooks/useProjectContext'
import { statusCounts, timelineBars } from '../services/analysis'
import { stepStats } from '../services/experimentService'
import { formatRelative } from '../services/format'

/** 프로젝트 현황: 진행 상태, 빠진 것 한눈에, 타임라인, 최근 실험. */
export function ProjectOverviewPage() {
  const { project, bundles, gaps } = useProject()
  if (bundles.length === 0) {
    return (
      <EmptyState title="이 프로젝트에는 아직 실험이 없습니다" description="실험을 만들면 진행 현황, 빠진 것, 데이터 비교가 여기에 나타납니다.">
        <Link to={`/experiments/new?project=${project.id}`} className="btn btn--primary">
          + 이 프로젝트에 새 실험
        </Link>
      </EmptyState>
    )
  }
  const counts = statusCounts(bundles)
  const stats = stepStats(bundles.flatMap((b) => b.steps))
  const bars = timelineBars(bundles)
  const recent = [...bundles].sort((a, b) => b.experiment.updatedAt.localeCompare(a.experiment.updatedAt)).slice(0, 5)

  return (
    <div className="proj-grid">
      <section className="panel" aria-labelledby="h-progress">
        <h2 id="h-progress" className="panel__title">
          진행 현황
        </h2>
        <StatusBar counts={counts} />
        <p className="muted">
          실험 {bundles.length}건 · 전체 단계 {stats.done}/{stats.total} 완료 ({stats.percent}%)
        </p>
      </section>

      <section className="panel proj-grid__gaps" aria-labelledby="h-gaps">
        <h2 id="h-gaps" className="panel__title">
          빠진 것 한눈에 <span className="muted">({gaps.length}건)</span>
        </h2>
        <GapList gaps={gaps} limit={6} />
      </section>

      <section className="panel proj-grid__wide" aria-labelledby="h-timeline">
        <h2 id="h-timeline" className="panel__title">
          타임라인
        </h2>
        {bars.length === 0 ? <p className="muted">아직 시작한 실험이 없습니다.</p> : <TimelineChart bars={bars} />}
      </section>

      <section className="panel proj-grid__wide" aria-labelledby="h-recent">
        <h2 id="h-recent" className="panel__title">
          최근 실험
        </h2>
        <ul className="plain-list">
          {recent.map((b) => (
            <li key={b.experiment.id} className="recent-row">
              <Link to={`/experiments/${b.experiment.id}`}>{b.experiment.title}</Link>
              <StatusBadge status={b.experiment.status} />
              <span className="muted">{formatRelative(b.experiment.updatedAt)} 수정</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
