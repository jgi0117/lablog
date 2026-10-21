export type SaveStatus = 'saved' | 'saving' | 'error' | 'conflict'

interface Props {
  status: SaveStatus
  savedAt?: Date
  onRetry?: () => void
  /** 저장이 계속 실패할 때를 대비해 지금 데이터를 파일로 받게 한다. */
  onExport?: () => void
  /** 다른 탭에서 먼저 수정했을 때: 내 내용으로 덮어쓰기 */
  onOverwrite?: () => void
  /** 다른 탭에서 먼저 수정했을 때: 최신 내용 불러오기 */
  onReload?: () => void
}

function clock(d: Date): string {
  return d.toTimeString().slice(0, 8)
}

/**
 * 저장 상태 표시.
 * 실패하면 이유를 알리고 다시 시도와 데이터 내보내기를 안내한다(E1).
 * 다른 탭에서 먼저 수정한 경우에는 최신 내용을 불러올지, 내 내용으로 덮어쓸지 고르게 한다(E6, E9).
 */
export function SaveIndicator({ status, savedAt, onRetry, onExport, onOverwrite, onReload }: Props) {
  if (status === 'conflict') {
    return (
      <div className="save save--error" role="alert">
        <span>다른 탭에서 이 항목을 먼저 수정했습니다.</span>
        {onReload && (
          <button type="button" className="link" onClick={onReload}>
            최신 내용 불러오기
          </button>
        )}
        {onOverwrite && (
          <button type="button" className="link" onClick={onOverwrite}>
            내 내용으로 덮어쓰기
          </button>
        )}
      </div>
    )
  }
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
