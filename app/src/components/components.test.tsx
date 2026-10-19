import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState } from './EmptyState'
import { SaveIndicator } from './SaveIndicator'
import { ToastProvider, useToast } from './Toast'

describe('EmptyState', () => {
  it('제목, 설명, 첫 행동 버튼을 보여 준다', () => {
    render(
      <EmptyState title="첫 실험을 만들어 보세요" description="실험 기록을 한 곳에 모읍니다.">
        <button>+ 새 실험</button>
      </EmptyState>,
    )
    expect(screen.getByText('첫 실험을 만들어 보세요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ 새 실험' })).toBeInTheDocument()
  })
})

describe('SaveIndicator', () => {
  it('저장됨에는 시각이 붙는다', () => {
    render(<SaveIndicator status="saved" savedAt={new Date(2026, 9, 19, 14, 32, 8)} />)
    expect(screen.getByRole('status')).toHaveTextContent('저장됨 · 14:32:08')
  })

  it('저장 중 표시', () => {
    render(<SaveIndicator status="saving" />)
    expect(screen.getByRole('status')).toHaveTextContent('저장 중')
  })

  it('실패하면 다시 시도와 데이터 내보내기를 안내한다 (E1)', async () => {
    const onRetry = vi.fn()
    const onExport = vi.fn()
    render(<SaveIndicator status="error" onRetry={onRetry} onExport={onExport} />)
    expect(screen.getByRole('alert')).toHaveTextContent('저장하지 못했습니다')
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await userEvent.click(screen.getByRole('button', { name: '데이터 내보내기' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onExport).toHaveBeenCalledOnce()
  })
})

describe('ConfirmDialog', () => {
  it('닫혀 있으면 아무것도 그리지 않는다', () => {
    render(<ConfirmDialog open={false} title="삭제할까요?" onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('확인과 취소 버튼, Esc로 닫는다', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmDialog open title="삭제할까요?" message="30일 동안 휴지통에 보관됩니다." confirmLabel="삭제" onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByRole('dialog', { name: '삭제할까요?' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('위험한 동작은 기본 포커스가 취소에 있다', () => {
    render(<ConfirmDialog open danger title="삭제할까요?" onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: '취소' })).toHaveFocus()
  })
})

describe('Toast', () => {
  function Trigger({ onUndo }: { onUndo: () => void }) {
    const toast = useToast()
    return (
      <button onClick={() => toast.show({ message: '단계 5를 체크했습니다', actionLabel: '되돌리기', onAction: onUndo })}>
        알림
      </button>
    )
  }

  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  it('되돌리기 버튼이 동작하고 토스트가 닫힌다', async () => {
    const onUndo = vi.fn()
    render(
      <ToastProvider>
        <Trigger onUndo={onUndo} />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '알림' }))
    expect(screen.getByText('단계 5를 체크했습니다')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    expect(onUndo).toHaveBeenCalledOnce()
    expect(screen.queryByText('단계 5를 체크했습니다')).toBeNull()
  })

  it('5초 뒤에 저절로 사라진다', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })
    render(
      <ToastProvider>
        <Trigger onUndo={() => {}} />
      </ToastProvider>,
    )
    await user.click(screen.getByRole('button', { name: '알림' }))
    expect(screen.getByText('단계 5를 체크했습니다')).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(5100)
    })
    expect(screen.queryByText('단계 5를 체크했습니다')).toBeNull()
  })
})
