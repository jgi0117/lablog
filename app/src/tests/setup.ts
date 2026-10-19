import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// vitest의 globals를 쓰지 않으므로 Testing Library 자동 정리가 등록되지 않는다. 직접 등록한다.
afterEach(() => {
  cleanup()
})
