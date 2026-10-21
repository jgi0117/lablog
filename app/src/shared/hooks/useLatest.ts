import { useEffect, useRef, type MutableRefObject } from 'react'

/** 렌더마다 최신 값을 담아 두는 ref. 자동 저장처럼 시간이 지난 뒤 실행되는 함수가 옛 값을 쓰지 않게 한다. */
export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}
