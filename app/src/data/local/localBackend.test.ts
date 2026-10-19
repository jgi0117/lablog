import { afterEach } from 'vitest'
import { createLocalBackend, type LocalBackend } from './localBackend'
import { runBackendContract } from '../../tests/contracts/backend.contract'

const opened: LocalBackend[] = []
let seq = 0

afterEach(() => {
  while (opened.length) opened.pop()?.close()
})

runBackendContract('local (IndexedDB)', async () => {
  // 테스트마다 새 DB 이름을 써서 서로 영향을 주지 않게 한다.
  const backend = createLocalBackend(`lablog-test-${Date.now()}-${seq++}`)
  opened.push(backend)
  return backend
})
