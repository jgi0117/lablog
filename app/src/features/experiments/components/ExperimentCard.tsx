import { Link } from 'react-router-dom'
import type { DataItem, Experiment } from '../../../domain/types'
import { formatRelative } from '../../../shared/lib/format'
import { ProgressBar } from '../../../shared/ui/ProgressBar'
import { StatusBadge } from '../../../shared/ui/StatusBadge'

interface Props {
  experiment: Experiment
  projectName?: string
  percent: number
  /** 남은 단계 수. 있으면 "남은 단계 N개"를 보여 준다. */
  openSteps?: number
  items?: DataItem[]
  deviationCount?: number
}

/** 홈과 실험 목록(Phase 4)에서 같이 쓴다. 카드 전체가 링크다. */
export function ExperimentCard({ experiment, projectName, percent, openSteps, items = [], deviationCount = 0 }: Props) {
  const href = experiment.status === 'ready' ? `/experiments/${experiment.id}/steps` : `/experiments/${experiment.id}`
  const summary = (kind: DataItem['kind']) => items.filter((item) => item.kind === kind)
  const conditions = summary('condition')
  const results = summary('result')
  const values = (rows: DataItem[]) => rows.slice(0, 3).map((item) => `${item.name} ${item.value || '—'}${item.unit ? ` ${item.unit}` : ''}`).join(' · ')
  return (
    <Link to={href} className="card">
      <div className="card__top">
        <span className="card__project">{projectName ?? '프로젝트 없음'}</span>
        <StatusBadge status={experiment.status} />
      </div>
      <h3 className="card__title">{experiment.title}</h3>
      {experiment.purpose && <p className="card__purpose">{experiment.purpose}</p>}
      <ProgressBar percent={percent} label={`${experiment.title} 진행률`} />
      <dl className="card__summary">
        <dt>조건</dt><dd>{conditions.length ? values(conditions) : '기록 없음'}{conditions.length > 3 ? ` · 외 ${conditions.length - 3}개` : ''}</dd>
        <dt>결과</dt><dd>{results.length ? values(results) : '기록 없음'}{results.length > 3 ? ` · 외 ${results.length - 3}개` : ''}</dd>
      </dl>
      <span className="card__meta">
        {openSteps !== undefined && openSteps > 0 ? `남은 단계 ${openSteps}개 · ` : ''}
        {deviationCount > 0 ? `달라진 점 ${deviationCount}건 · ` : ''}
        {experiment.owner ? `${experiment.owner} · ` : ''}
        {formatRelative(experiment.updatedAt)} 수정
      </span>
    </Link>
  )
}
