import type { BackupReminder as Kind } from '../services/backup'

interface Props {
  kind: Exclude<Kind, null>
  /** 마지막 백업 시각 표기(예: "9일 전") */
  lastBackupLabel?: string
  onBackup: () => void
  onSnooze: () => void
}

/** 홈 위쪽의 백업 권유. 이 앱의 데이터는 이 브라우저에만 있어서 파일 백업이 유일한 안전망이다. */
export function BackupReminder({ kind, lastBackupLabel, onBackup, onSnooze }: Props) {
  return (
    <div className="banner banner--warn" role="status">
      <span>
        {kind === 'never' ? (
          <>
            <strong>아직 백업한 적이 없습니다.</strong> 이 앱의 데이터는 이 브라우저에만 저장됩니다. 파일로 한 번 저장해 두세요.
          </>
        ) : (
          <>
            <strong>마지막 백업({lastBackupLabel ?? '일주일 전'}) 뒤에 바뀐 내용이 있습니다.</strong> 파일로 다시 저장해 두세요.
          </>
        )}
      </span>
      <span className="banner__actions">
        <button type="button" className="btn btn--primary" onClick={onBackup}>
          지금 백업
        </button>
        <button type="button" className="btn" onClick={onSnooze}>
          3일 뒤에 다시
        </button>
      </span>
    </div>
  )
}
