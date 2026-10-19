import { safeGetJson, safeRemove, safeSetJson } from './safeStorage'
import { getSettings } from './settings'

/**
 * 파일럿에서 KR을 재기 위한 사용 기록. 이 기기의 localStorage에만 남고 어디로도 전송하지 않는다.
 * 실험 제목, 값, 메모 같은 내용은 기록하지 않고 시간과 개수만 남긴다. 설정에서 끄거나 지우거나 내보낼 수 있다.
 */
export type UsageName =
  | 'search' // 검색 실행: ms, hits
  | 'open_from_search' // 검색 결과에서 실험 열기: ms(검색 결과가 뜬 뒤 걸린 시간)
  | 'step_toggle' // 수행 모드 단계 체크·해제: done
  | 'complete' // 실험 완료: openSteps, emptyResults
  | 'gaps_snapshot' // 빠진 것 개수: total, 종류별 개수
  | 'csv_export'
  | 'backup_export'
  | 'backup_import'
  | 'analysis_view'
  | 'duplicate' // 복제로 새 실험 시작 (복제 사용률)
  | 'template_save' // 템플릿으로 저장
  | 'template_start' // 템플릿으로 새 실험 시작
  | 'deviation_add' // 달라진 점 기록: fromRun

export interface UsageEvent {
  /** ISO 시각 */
  t: string
  name: UsageName
  data?: Record<string, number | string | boolean>
}

const KEY = 'lablog:usage'
export const MAX_USAGE_EVENTS = 2000

export function readUsage(): UsageEvent[] {
  const list = safeGetJson<UsageEvent[]>(KEY, [])
  return Array.isArray(list) ? list : []
}

export function logUsage(name: UsageName, data?: UsageEvent['data'], now: Date = new Date()): void {
  if (!getSettings().usageLog) return
  const list = readUsage()
  list.push({ t: now.toISOString(), name, ...(data ? { data } : {}) })
  safeSetJson(KEY, list.slice(-MAX_USAGE_EVENTS))
}

export function clearUsage(): void {
  safeRemove(KEY)
}

// ---------- 검색 → 열기 시간 (KR1) ----------
let lastSearchShownAt: number | null = null

/** 검색 결과가 화면에 뜬 시각을 기억한다. */
export function noteSearchShown(): void {
  lastSearchShownAt = performance.now()
}

/** 결과에서 실험을 열면 검색 결과가 뜬 뒤 걸린 시간을 기록한다. 검색 없이 연 경우는 기록하지 않는다. */
export function noteOpenFromSearch(): void {
  if (lastSearchShownAt === null) return
  logUsage('open_from_search', { ms: Math.round(performance.now() - lastSearchShownAt) })
  lastSearchShownAt = null
}

// ---------- 요약 ----------
export interface UsageSummary {
  events: number
  searches: number
  /** 검색 결과가 뜬 뒤 실험을 열기까지 걸린 시간의 중앙값(초). 기록이 없으면 null */
  medianOpenSec: number | null
  /** 목표(10초) 안에 연 비율 0~1. 기록이 없으면 null */
  within10s: number | null
  stepToggles: number
  completes: number
  /** 미완료 단계나 빈 결과가 있는 채로 완료한 횟수 */
  completesWithGaps: number
  csvExports: number
  backups: number
  /** 빠진 것 개수: 이번 주 마지막 기록과 지난주 마지막 기록. 없으면 null */
  gapsThisWeek: number | null
  gapsLastWeek: number | null
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function summarizeUsage(events: UsageEvent[], now: Date = new Date()): UsageSummary {
  const by = (name: UsageName) => events.filter((e) => e.name === name)
  const opens = by('open_from_search')
    .map((e) => Number(e.data?.ms))
    .filter((n) => Number.isFinite(n))
  const completes = by('complete')
  const weekMs = 7 * 86400000
  const lastGap = (from: number, to: number) => {
    const inRange = by('gaps_snapshot')
      .filter((e) => {
        const t = Date.parse(e.t)
        return t >= from && t < to
      })
      .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
    const last = inRange.at(-1)
    return last ? Number(last.data?.total) : null
  }
  const med = median(opens)
  return {
    events: events.length,
    searches: by('search').length,
    medianOpenSec: med === null ? null : Math.round(med / 100) / 10,
    within10s: opens.length ? opens.filter((ms) => ms <= 10000).length / opens.length : null,
    stepToggles: by('step_toggle').length,
    completes: completes.length,
    completesWithGaps: completes.filter((e) => Number(e.data?.openSteps) > 0 || Number(e.data?.emptyResults) > 0).length,
    csvExports: by('csv_export').length,
    backups: by('backup_export').length,
    gapsThisWeek: lastGap(now.getTime() - weekMs, now.getTime() + 1),
    gapsLastWeek: lastGap(now.getTime() - 2 * weekMs, now.getTime() - weekMs),
  }
}

/** 같은 값을 계속 쌓지 않도록, 마지막 기록 뒤 이 시간(시간 단위)이 지났을 때만 남긴다. */
export const GAPS_SNAPSHOT_EVERY_HOURS = 6

/** 빠진 것 개수를 한 번 기록한다(KR3: 주마다 줄어드는지 보기 위해). 기록했으면 true. */
export function logGapsSnapshot(counts: Record<string, number>, now: Date = new Date()): boolean {
  const last = readUsage()
    .filter((e) => e.name === 'gaps_snapshot')
    .at(-1)
  if (last && now.getTime() - Date.parse(last.t) < GAPS_SNAPSHOT_EVERY_HOURS * 3600000) return false
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  logUsage('gaps_snapshot', { total, ...counts }, now)
  return true
}
