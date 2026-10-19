import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedSave } from './useDebouncedSave'

describe('useDebouncedSave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('입력이 멈추면 마지막 값 하나만 저장한다', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave<string>(save, { delayMs: 400 }))
    act(() => {
      result.current.schedule('8')
      result.current.schedule('80')
      result.current.schedule('80°C')
    })
    expect(result.current.status).toBe('saving')
    expect(save).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('80°C')
    expect(result.current.status).toBe('saved')
    expect(result.current.savedAt).toBeInstanceOf(Date)
  })

  it('flush는 기다리지 않고 바로 저장한다', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave<string>(save))
    act(() => result.current.schedule('메모'))
    await act(async () => {
      await result.current.flush()
    })
    expect(save).toHaveBeenCalledWith('메모')
  })

  it('실패하면 error 상태가 되고 retry로 다시 저장한다 (E1)', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave<string>(save))
    act(() => result.current.schedule('값'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    expect(result.current.status).toBe('error')
    await act(async () => {
      await result.current.retry()
    })
    expect(save).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('saved')
  })

  it('화면을 떠날 때 저장하지 못한 값이 있으면 마저 저장한다', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result, unmount } = renderHook(() => useDebouncedSave<string>(save))
    act(() => result.current.schedule('남은 값'))
    unmount()
    expect(save).toHaveBeenCalledWith('남은 값')
  })
})
