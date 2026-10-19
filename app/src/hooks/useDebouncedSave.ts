import { useCallback, useEffect, useRef, useState } from 'react'
import type { SaveStatus } from '../components/SaveIndicator'
import { ConflictError } from '../data/repositories'

interface Options {
  /** 마지막 입력 후 이 시간(ms) 동안 가만히 있으면 저장한다. 기본 400 */
  delayMs?: number
}

export interface SaveOptions {
  /** true면 다른 탭이 먼저 수정했더라도 내 내용으로 덮어쓴다. 사용자가 "덮어쓰기"를 고른 경우에만 true. */
  force: boolean
}

/**
 * 입력 중인 값을 잠깐 모았다가 자동 저장한다. 저장 상태(saved/saving/error/conflict)를 함께 돌려준다.
 * - 화면을 떠나거나 flush()를 부르면 기다리지 않고 바로 저장한다.
 * - 실패하면 error 상태가 되고 retry()로 다시 시도한다.
 * - save가 ConflictError를 던지면(다른 탭이 먼저 수정) conflict 상태가 되고, overwrite()로 force 저장한다.
 */
export function useDebouncedSave<T>(save: (value: T, opts: SaveOptions) => Promise<unknown>, { delayMs = 400 }: Options = {}) {
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [savedAt, setSavedAt] = useState<Date | undefined>()
  const saveRef = useRef(save)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<{ value: T } | null>(null)
  const last = useRef<{ value: T } | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    saveRef.current = save
  })

  const run = useCallback(async (job: { value: T }, force: boolean) => {
    if (mounted.current) setStatus('saving')
    try {
      await saveRef.current(job.value, { force })
      last.current = null
      if (mounted.current) {
        setStatus('saved')
        setSavedAt(new Date())
      }
    } catch (e) {
      last.current = job
      if (mounted.current) setStatus(e instanceof ConflictError ? 'conflict' : 'error')
    }
  }, [])

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const job = pending.current
    pending.current = null
    if (job) await run(job, false)
  }, [run])

  const schedule = useCallback(
    (value: T) => {
      pending.current = { value }
      if (mounted.current) setStatus('saving')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), delayMs)
    },
    [delayMs, flush],
  )

  const retry = useCallback(async () => {
    if (last.current) await run(last.current, false)
  }, [run])

  const overwrite = useCallback(async () => {
    if (last.current) await run(last.current, true)
  }, [run])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // 화면을 떠날 때 아직 저장하지 못한 값이 있으면 마저 저장한다.
      if (timer.current) clearTimeout(timer.current)
      const job = pending.current
      pending.current = null
      if (job) void saveRef.current(job.value, { force: false }).catch(() => {})
    }
  }, [])

  return { schedule, flush, retry, overwrite, status, savedAt }
}
