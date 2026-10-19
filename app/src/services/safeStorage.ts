/**
 * localStorage를 안전하게 쓴다. 사생활 보호 모드나 저장소 차단으로 접근이 막혀도 앱은 계속 동작해야 하므로
 * 모든 읽기·쓰기를 try/catch로 감싼다. 실패하면 읽기는 null, 쓰기는 false를 돌려준다.
 * 여기에는 설정, 마지막 백업 시각, 사용 기록 같은 "없어져도 데이터는 안전한" 값만 둔다. 실험 데이터는 IndexedDB에 있다.
 */
export function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // 무시
  }
}

export function safeGetJson<T>(key: string, fallback: T): T {
  const raw = safeGet(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function safeSetJson(key: string, value: unknown): boolean {
  return safeSet(key, JSON.stringify(value))
}
