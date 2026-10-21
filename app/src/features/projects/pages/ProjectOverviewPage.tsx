import { Link } from 'react-router-dom'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { GapList } from '../components/GapList'
import { StatusBadge } from '../../../shared/ui/StatusBadge'
import { StatusBar, TimelineChart } from '../../data-hub/components/charts'
import { RequirementStatus } from '../components/RequirementStatus'
import { useProject } from '../hooks/useProjectContext'
import { statusCounts, timelineBars } from '../../../domain/analysis/analysis'
import { stepStats } from '../../experiments/application/experimentService'
import { formatRelative } from '../../../shared/lib/format'

const TIMELINE_MAX = 30

/** 프로젝트 현황: 진행 상태, 빠진 것 한눈에, 타임라인, 최근 실험. */
export function ProjectOverviewPage() {
  const { project, bundles, gaps, matrix } = useProject()
  if (bundles.length === 0) {
    return (
      <div className="proj-empty">
        {/* 실험을 만들기 전에 고객 요구부터 정해 두는 것이 자연스러운 순서라서 요구 입력 안내를 먼저 보여 준다 */}
        <RequirementStatus matrix={matrix} requirements={project.requirements ?? []} customer={project.customer} editHref={`/projects/${project.id}/requirements`} />
        <EmptyState title="이 프로젝트에는 아직 실험이 없습니다" description="실험을 만들면 진행 현황, 빠진 것, 데이터 비교가 여기에 나타납니다.">
          <Link to={`/experiments/new?project=${project.id}`} className="btn btn--primary">
            마지막 실험 이어받아 등록
          </Link>
        </EmptyState>
      </div>
    )
  }
  const counts = statusCounts(bundles)
  const stats = stepStats(bundles.flatMap((b) => b.steps))
  const allBars = timelineBars(bundles)
  // 실험이 수백 건이면 막대가 화면을 가득 채우므로 가장 최근에 시작한 것만 그린다.
  const bars = allBars.slice(-TIMELINE_MAX)
  const recent = [...bundles].sort((a, b) => b.experiment.updatedAt.localeCompare(a.experiment.updatedAt)).slice(0, 5)
  const active = recent.filter((bundle) => bundle.experiment.status !== 'done')
  const completed = recent.filter((bundle) => bundle.experiment.status === 'done')
  const keyValues = (bundle: (typeof bundles)[number]) => bundle.items
    .filter((item) => item.kind === 'condition' || (item.kind === 'result' && item.value.trim()))
    .slice(0, 3)
    .map((item) => `${item.name} ${item.value || '—'}${item.unit ? ` ${item.unit}` : ''}`)
    .join(' · ')

  return (
    <div className="proj-grid">
      <section className="panel proj-grid__wide project-next" aria-label="프로젝트 다음 작업">
        <div><strong>다음 실험을 준비하세요</strong><p className="muted">마지막 실험을 이어받으면 달라진 부분만 고치면 됩니다.</p></div>
        <Link to={`/experiments/new?project=${project.id}`} className="btn btn--primary">마지막 실험 이어받아 등록</Link>
      </section>
      <div className="proj-grid__wide">
        <RequirementStatus matrix={matrix} requirements={project.requirements ?? []} customer={project.customer} editHref={`/projects/${project.id}/requirements`} />
      </div>
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
        {bars.length === 0 ? (
          <p className="muted">아직 시작한 실험이 없습니다.</p>
        ) : (
          <>
            <TimelineChart bars={bars} />
            {allBars.length > bars.length && (
              <p className="analysis__note">
                가장 최근에 시작한 {bars.length}건만 그렸습니다(전체 {allBars.length}건). 전체는 <Link to={`/projects/${project.id}/data`}>데이터 탭</Link>의 표에서 볼 수 있습니다.
              </p>
            )}
          </>
        )}
      </section>

      <section className="panel proj-grid__wide" aria-labelledby="h-recent">
        <h2 id="h-recent" className="panel__title">진행 중·최근 완료</h2>
        <ul className="plain-list">
          {[...active, ...completed].map((b) => (
            <li key={b.experiment.id} className="recent-row">
              <div><Link to={`/experiments/${b.experiment.id}`}>{b.experiment.title}</Link><p className="muted recent-row__values">{keyValues(b) || '주요 조건·결과 기록 없음'}</p></div>
              <div className="recent-row__meta"><StatusBadge status={b.experiment.status} /><span className="muted">{formatRelative(b.experiment.updatedAt)} 수정</span></div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
