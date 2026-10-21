import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useBackend } from '../../../app/BackendContext'
import { logError, installGlobalErrorLogging } from '../application/errorLog'
import { NEAR_FULL_RATIO, estimateStorage, requestPersistence, type PersistResult, type UsageEstimate } from '../application/storage'

export interface StorageStatus {
  /** 영구 저장 허용 여부. 아직 확인 전이면 'pending' */
  persist: PersistResult | 'pending'
  estimate: UsageEstimate | null
  /** 저장소를 열 수 없음(사생활 보호 모드, 사이트 데이터 차단 등). 이때는 기록이 남지 않는다. */
  blocked: boolean
  nearFull: boolean
  refresh: () => Promise<void>
}

const Ctx = createContext<StorageStatus | null>(null)

/**
 * 앱을 열 때 한 번: 저장소가 열리는지 확인하고, 브라우저에 영구 저장을 요청하고, 사용량을 읽고,
 * 처리하지 못한 오류 기록을 켜고, 30일 지난 휴지통 항목을 정리한다. 어느 것이 실패해도 앱은 계속 동작한다.
 */
export function StorageStatusProvider({ children }: { children: ReactNode }) {
  const backend = useBackend()
  const [persist, setPersist] = useState<StorageStatus['persist']>('pending')
  const [estimate, setEstimate] = useState<UsageEstimate | null>(null)
  const [blocked, setBlocked] = useState(false)

  const refresh = useCallback(async () => {
    try {
      await backend.projects.list()
      setBlocked(false)
    } catch (e) {
      logError('storage', e)
      setBlocked(true)
    }
    setPersist(await requestPersistence())
    setEstimate(await estimateStorage())
  }, [backend])

  useEffect(() => {
    const off = installGlobalErrorLogging()
    void refresh()
    backend.experiments.purgeExpired(new Date()).catch(() => {})
    return off
  }, [backend, refresh])

  const value = useMemo<StorageStatus>(
    () => ({ persist, estimate, blocked, nearFull: !!estimate && estimate.ratio >= NEAR_FULL_RATIO, refresh }),
    [persist, estimate, blocked, refresh],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStorageStatus(): StorageStatus {
  const v = useContext(Ctx)
  if (!v) throw new Error('StorageStatusProvider 안에서만 useStorageStatus를 쓸 수 있습니다')
  return v
}
