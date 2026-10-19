/** 진행률(0~100, 정수) = 완료한 단계 수 / 전체 단계 수. 단계가 없으면 0. */
export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0
  const clamped = Math.min(Math.max(done, 0), total)
  return Math.round((clamped / total) * 100)
}
