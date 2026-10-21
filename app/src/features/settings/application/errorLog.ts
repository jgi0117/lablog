import { safeGetJson, safeRemove, safeSetJson } from '../../../shared/lib/safeStorage'

export interface ErrorEntry {
  t: string
  source: string
  message: string
  /** 앞부분만. 실험 내용은 들어가지 않는다. */
  stack?: string
}

const KEY = 'lablog:errors'
export const MAX_ERRORS = 30

export function readErrors(): ErrorEntry[] {
  const list = safeGetJson<ErrorEntry[]>(KEY, [])
  return Array.isArray(list) ? list : []
}

export function logError(source: string, error: unknown, now: Date = new Date()): void {
  const e = error instanceof Error ? error : new Error(String(error))
  const list = readErrors()
  list.push({ t: now.toISOString(), source, message: e.message.slice(0, 300), stack: e.stack?.split('\n').slice(0, 4).join('\n').slice(0, 500) })
  safeSetJson(KEY, list.slice(-MAX_ERRORS))
}

export function clearErrors(): void {
  safeRemove(KEY)
}

/** 처리하지 못한 오류와 거절된 약속을 오류 기록에 남긴다. 해제 함수를 돌려준다. */
export function installGlobalErrorLogging(): () => void {
  const onError = (e: ErrorEvent) => logError('window', e.error ?? e.message)
  const onRejection = (e: PromiseRejectionEvent) => logError('promise', e.reason)
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
