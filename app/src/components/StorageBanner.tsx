import { useStorageStatus } from '../app/StorageStatus'
import { useBackupExport } from '../hooks/useBackupExport'
import { formatBytes } from '../services/storage'

/** 저장소를 못 쓰거나 가득 찼을 때 모든 화면 위에 띄우는 경고. 데이터를 잃기 전에 알리는 것이 목적이다. */
export function StorageBanner() {
  const { blocked, nearFull, estimate } = useStorageStatus()
  const exportNow = useBackupExport()
  if (blocked) {
    return (
      <div className="banner banner--danger" role="alert">
        <strong>이 브라우저가 저장을 막고 있습니다.</strong> 지금 입력하는 내용은 남지 않습니다. 사생활 보호(시크릿) 창이라면 일반 창에서 열고, 아니라면 브라우저의 사이트 데이터 설정에서 이 사이트의 저장을 허용하세요.
      </div>
    )
  }
  if (nearFull && estimate) {
    return (
      <div className="banner banner--warn" role="status">
        <span>
          <strong>저장 공간이 거의 찼습니다.</strong> ({formatBytes(estimate.usage)} / {formatBytes(estimate.quota)}) 가득 차면 새 기록을 저장하지 못합니다.
        </span>
        <button type="button" className="btn" onClick={() => void exportNow()}>
          지금 백업
        </button>
      </div>
    )
  }
  return null
}
