/** "2026-10-19 14:32" 형식 (기기 시간대 기준) */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** "방금", "5분 전", "2시간 전", "어제", "3일 전", 그 이상은 날짜 */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}시간 전`
  const days = Math.floor(h / 24)
  if (days === 1) return '어제'
  if (days < 7) return `${days}일 전`
  return formatDateTime(iso).slice(0, 10)
}
