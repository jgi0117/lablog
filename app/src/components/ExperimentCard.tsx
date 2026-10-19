import { Link } from 'react-router-dom'
import type { Experiment } from '../domain/types'
import { formatRelative } from '../services/format'
import { ProgressBar } from './ProgressBar'
import { StatusBadge } from './StatusBadge'

interface Props {
  experiment: Experiment
  projectName?: string
  percent: number
  /** 남은 단계 수. 있으면 "남은 단계 N개"를 보여 준다. */
  openSteps?: number
}

/** 홈과 실험 목록(Phase 4)에서 같이 쓴다. 카드 전체가 링크다. */
export function ExperimentCard({ experiment, projectName, percent, openSteps }: Props) {
  const href = experiment.status === 'ready' ? `/experiments/${experiment.id}/steps` : `/experiments/${experiment.id}`
  return (
    <Link to={href} className="card">
      <div className="card__top">
        <span className="card__project">{projectName ?? '프로젝트 없음'}</span>
        <StatusBadge status={experiment.status} />
      </div>
      <h3 className="card__title">{experiment.title}</h3>
      <ProgressBar percent={percent} label={`${experiment.title} 진행률`} />
      <span className="card__meta">
        {openSteps !== undefined && openSteps > 0 ? `남은 단계 ${openSteps}개 · ` : ''}
        {experiment.owner ? `${experiment.owner} · ` : ''}
        {formatRelative(experiment.updatedAt)} 수정
      </span>
    </Link>
  )
}
