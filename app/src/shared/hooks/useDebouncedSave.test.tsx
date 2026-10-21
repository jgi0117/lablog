import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError } from '../../data/repositories'
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
    expect(save).toHaveBeenCalledWith('80°C', { force: false })
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
    expect(save).toHaveBeenCalledWith('메모', { force: false })
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
    expect(save).toHaveBeenCalledWith('남은 값', { force: false })
  })

  it('다른 탭이 먼저 수정했으면 conflict 상태가 되고, 덮어쓰기는 force로 다시 저장한다 (E6)', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new ConflictError('Experiment', 'e1', 5))
      .mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave<string>(save))
    act(() => result.current.schedule('내 제목'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    expect(result.current.status).toBe('conflict')
    await act(async () => {
      await result.current.overwrite()
    })
    expect(save).toHaveBeenLastCalledWith('내 제목', { force: true })
    expect(result.current.status).toBe('saved')
  })

  it('저장에 성공하면 이전 실패 기록을 지워 retry가 옛 값을 다시 저장하지 않는다', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave<string>(save))
    act(() => result.current.schedule('첫 값'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    expect(result.current.status).toBe('error')
    act(() => result.current.schedule('새 값'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    expect(result.current.status).toBe('saved')
    await act(async () => {
      await result.current.retry()
    })
    expect(save).toHaveBeenCalledTimes(2)
  })
})
