/** 브라우저의 저장 공간 상태. 실험 데이터는 이 브라우저 안에만 있으므로 지워지거나 가득 차는 것이 가장 큰 위험이다. */

export type PersistResult = 'granted' | 'denied' | 'unsupported'

/** 브라우저에 "이 사이트 데이터는 자동으로 지우지 말아 달라"고 요청한다. 이미 허용됐으면 그대로 granted. */
export async function requestPersistence(): Promise<PersistResult> {
  try {
    const s = navigator.storage
    if (!s || typeof s.persist !== 'function') return 'unsupported'
    if (typeof s.persisted === 'function' && (await s.persisted())) return 'granted'
    return (await s.persist()) ? 'granted' : 'denied'
  } catch {
    return 'unsupported'
  }
}

export interface UsageEstimate {
  usage: number
  quota: number
  ratio: number
}

export async function estimateStorage(): Promise<UsageEstimate | null> {
  try {
    const s = navigator.storage
    if (!s || typeof s.estimate !== 'function') return null
    const { usage = 0, quota = 0 } = await s.estimate()
    return { usage, quota, ratio: quota > 0 ? usage / quota : 0 }
  } catch {
    return null
  }
}

/** 사용량이 한도의 이 비율을 넘으면 경고한다. */
export const NEAR_FULL_RATIO = 0.8

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}
