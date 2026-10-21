import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from '../../auth/AccountContext'
import { bannerDismissed, dismissBanner, localCounts, migratedAt } from '../application/localData'
import { totalOf } from '../application/migrate'

/**
 * 서버 저장소로 로그인했는데 이 브라우저에 아직 옮기지 않은 로컬 기록이 있으면 알린다.
 * 기록이 서버에 없다고 놀라지 않게, 처음 로그인한 화면에서 이전을 권한다. 로컬 저장소만 쓸 때는 나오지 않는다.
 */
export function MigrationBanner() {
  const account = useAccount()
  const [count, setCount] = useState(0)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let alive = true
    if (!account || migratedAt(account.userId) || bannerDismissed(account.userId)) return
    localCounts().then((c) => alive && setCount(c ? totalOf(c) : 0))
    return () => {
      alive = false
    }
  }, [account])

  if (!account || hidden || count === 0) return null
  return (
    <div className="banner banner--warn" role="status">
      <span>
        <strong>이 브라우저에 아직 서버로 옮기지 않은 기록이 {count.toLocaleString('ko-KR')}개 있습니다.</strong> 옮기면 어느 기기에서든 같은 계정으로 볼 수 있습니다.
      </span>
      <span className="banner__actions">
        <Link to="/migrate" className="btn btn--primary">
          클라우드로 이전
        </Link>
        <button
          type="button"
          className="btn"
          onClick={() => {
            dismissBanner(account.userId)
            setHidden(true)
          }}
        >
          나중에
        </button>
      </span>
    </div>
  )
}
