import { safeGetJson, safeSetJson } from '../../../shared/lib/safeStorage'

export interface AppSettings {
  /** 이 기기 안에 사용 기록(검색 후 열기까지 걸린 시간 등)을 남긴다. 밖으로 보내지 않는다. */
  usageLog: boolean
  /** 수행 모드에서 화면이 꺼지지 않게 한다. */
  wakeLock: boolean
}

const KEY = 'lablog:settings'
const DEFAULTS: AppSettings = { usageLog: true, wakeLock: true }

export function getSettings(): AppSettings {
  return { ...DEFAULTS, ...safeGetJson<Partial<AppSettings>>(KEY, {}) }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch }
  safeSetJson(KEY, next)
  return next
}
