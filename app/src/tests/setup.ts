import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// vitest의 globals를 쓰지 않으므로 Testing Library 자동 정리가 등록되지 않는다. 직접 등록한다.
afterEach(() => {
  cleanup()
})

// 파일이 많이 동시에 돌 때 화면이 늦게 그려져도 시험이 흔들리지 않도록 비동기 대기 시간을 늘린다(기본 1초).
configure({ asyncUtilTimeout: 8000 })
