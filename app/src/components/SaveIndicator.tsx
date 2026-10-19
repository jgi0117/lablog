export type SaveStatus = 'saved' | 'saving' | 'error'

interface Props {
  status: SaveStatus
  savedAt?: Date
  onRetry?: () => void
  onExport?: () => void
}

function clock(d: Date): string {
  return d.toTimeString().slice(0, 8)
}

/** 저장 상태 표시. 실패하면 이유를 알리고 다시 시도와 데이터 내보내기를 안내한다(E1). */
export function SaveIndicator({ status, savedAt, onRetry, onExport }: Props) {
  if (status === 'error') {
    return (
      <div className="save save--error" role="alert">
        <span>저장하지 못했습니다.</span>
        {onRetry && (
          <button type="button" className="link" onClick={onRetry}>
            다시 시도
          </button>
        )}
        {onExport && (
          <button type="button" className="link" onClick={onExport}>
            데이터 내보내기
          </button>
        )}
      </div>
    )
  }
  return (
    <div className={`save save--${status}`} role="status" aria-live="polite">
      {status === 'saving' ? '저장 중…' : `저장됨${savedAt ? ` · ${clock(savedAt)}` : ''}`}
    </div>
  )
}
