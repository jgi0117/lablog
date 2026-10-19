import type { SaveStatus } from './SaveIndicator'
import { SaveIndicator } from './SaveIndicator'
import { useBackupExport } from '../hooks/useBackupExport'

interface Saver {
  status: SaveStatus
  savedAt?: Date
  retry: () => Promise<void>
  overwrite: () => Promise<void>
}

/**
 * useDebouncedSave의 결과를 저장 표시에 연결한다.
 * 실패하면 다시 시도와 데이터 내보내기를, 다른 탭과 충돌하면 최신 내용 불러오기와 덮어쓰기를 보여 준다.
 */
export function SaverIndicator({ saver }: { saver: Saver }) {
  const exportNow = useBackupExport()
  return (
    <SaveIndicator
      status={saver.status}
      savedAt={saver.savedAt}
      onRetry={() => void saver.retry()}
      onExport={() => void exportNow()}
      onOverwrite={() => void saver.overwrite()}
      onReload={() => window.location.reload()}
    />
  )
}
