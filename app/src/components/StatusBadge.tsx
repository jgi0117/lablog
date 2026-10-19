import type { ExperimentStatus } from '../domain/types'

export const STATUS_LABEL: Record<ExperimentStatus, string> = {
  ready: '준비',
  running: '진행',
  done: '완료',
}

/** 상태는 색만으로 구분하지 않고 글자를 함께 쓴다. */
export function StatusBadge({ status }: { status: ExperimentStatus }) {
  return <span className={`badge badge--${status}`}>{STATUS_LABEL[status]}</span>
}
