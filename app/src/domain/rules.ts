import type { ExperimentStatus, ISODate } from './types'

export { progressPercent } from './progress'

/** 휴지통 보관 기간(일). 지나면 영구 삭제한다. */
export const TRASH_RETENTION_DAYS = 30

const ALLOWED: Record<ExperimentStatus, ExperimentStatus[]> = {
  ready: ['running'],
  running: ['done'],
  done: ['running'],
}

/** 상태 전이 규칙: 준비 → 진행 → 완료, 완료에서 재개(진행) 허용. */
export function canTransition(from: ExperimentStatus, to: ExperimentStatus): boolean {
  return ALLOWED[from].includes(to)
}

/** 휴지통에 보낸 지 보관 기간이 지났으면 영구 삭제 대상이다. */
export function isPurgeable(deletedAt: ISODate | null, now: Date): boolean {
  if (!deletedAt) return false
  const ms = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
  return now.getTime() - new Date(deletedAt).getTime() >= ms
}

/** 완료할 때 알려 줄 미완료 단계 수와 빈 결과 수 (E3, E8 대응). */
export function completionWarnings(
  steps: { done: boolean }[],
  results: { value: string }[],
): { openSteps: number; emptyResults: number } {
  return {
    openSteps: steps.filter((s) => !s.done).length,
    emptyResults: results.filter((r) => r.value.trim() === '' || r.value.trim() === '—').length,
  }
}
