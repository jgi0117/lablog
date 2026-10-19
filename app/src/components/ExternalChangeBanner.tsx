import { useEffect, useRef, useState } from 'react'
import { useBackend } from '../app/BackendContext'

/**
 * 같은 브라우저의 다른 탭(또는 다른 기기)에서 데이터가 바뀌면 알린다.
 * 이 탭의 화면은 옛 내용일 수 있어서, 이대로 고치면 충돌 안내가 뜰 수 있다는 것을 먼저 알려 주는 장치다.
 * 변경이 몰아서 올 수 있어(가져오기 등) 잠깐 모았다가 한 번만 표시한다.
 */
export function ExternalChangeBanner() {
  const backend = useBackend()
  const [changed, setChanged] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const off = backend.onExternalChange?.(() => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setChanged(true), 400)
    })
    return () => {
      off?.()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [backend])

  if (!changed) return null
  return (
    <div className="banner banner--warn" role="status">
      <span>
        <strong>다른 탭에서 데이터가 바뀌었습니다.</strong> 이 화면은 이전 내용일 수 있습니다.
      </span>
      <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
        새로 고침
      </button>
    </div>
  )
}
