import { useCallback, useEffect, useRef, useState } from 'react'
import type { SaveStatus } from '../components/SaveIndicator'

interface Options {
  /** 마지막 입력 후 이 시간(ms) 동안 가만히 있으면 저장한다. 기본 400 */
  delayMs?: number
}

/**
 * 입력 중인 값을 잠깐 모았다가 자동 저장한다. 저장 상태(saved/saving/error)를 함께 돌려준다.
 * 화면을 떠나거나 flush()를 부르면 기다리지 않고 바로 저장한다. 실패하면 retry()로 다시 시도한다.
 */
export function useDebouncedSave<T>(save: (value: T) => Promise<unknown>, { delayMs = 400 }: Options = {}) {
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

  const run = useCallback(async (job: { value: T }) => {
    if (mounted.current) setStatus('saving')
    try {
      await saveRef.current(job.value)
      if (mounted.current) {
        setStatus('saved')
        setSavedAt(new Date())
      }
    } catch {
      last.current = job
      if (mounted.current) setStatus('error')
    }
  }, [])

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const job = pending.current
    pending.current = null
    if (job) await run(job)
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
    if (last.current) await run(last.current)
  }, [run])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // 화면을 떠날 때 아직 저장하지 못한 값이 있으면 마저 저장한다.
      if (timer.current) clearTimeout(timer.current)
      const job = pending.current
      pending.current = null
      if (job) void saveRef.current(job.value).catch(() => {})
    }
  }, [])

  return { schedule, flush, retry, status, savedAt }
}
