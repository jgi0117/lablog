import { useCallback } from 'react'
import { useBackend } from '../app/BackendContext'
import { useToast } from '../components/Toast'
import { backupFileName, recordBackup, serializeBackup } from '../services/backup'
import { downloadText } from '../services/download'
import { logUsage } from '../services/usage'

/**
 * 지금 데이터를 JSON 파일로 내려받는다. 저장이 실패하는 상황에서도 읽기는 될 수 있어서,
 * 저장 실패 안내의 "데이터 내보내기"와 설정의 백업 버튼이 같은 함수를 쓴다.
 */
export function useBackupExport() {
  const backend = useBackend()
  const toast = useToast()
  return useCallback(async (): Promise<boolean> => {
    try {
      const file = await backend.backup.exportAll()
      const ok = downloadText(backupFileName(), serializeBackup(file), 'application/json;charset=utf-8')
      if (!ok) throw new Error('download blocked')
      recordBackup()
      logUsage('backup_export', { experiments: file.experiments.length })
      toast.show({ message: `백업 파일을 저장했습니다 (실험 ${file.experiments.length}건)` })
      return true
    } catch {
      toast.show({ message: '백업 파일을 만들지 못했습니다. 브라우저의 다운로드 설정과 저장 공간을 확인하세요.', durationMs: 8000 })
      return false
    }
  }, [backend, toast])
}
