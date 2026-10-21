import { afterEach } from 'vitest'
import { createLocalBackend, type LocalBackend } from './localBackend'
import { runBackendContract } from '../repositories/backend.contract'

const opened: LocalBackend[] = []
let seq = 0
let currentName = ''

afterEach(() => {
  while (opened.length) opened.pop()?.close()
})

runBackendContract('local (IndexedDB)', async () => {
  // 테스트마다 새 DB 이름을 써서 서로 영향을 주지 않게 한다.
  currentName = `lablog-test-${Date.now()}-${seq++}`
  const backend = createLocalBackend(currentName)
  opened.push(backend)
  return backend
}, async () => {
  const backend = createLocalBackend(currentName)
  opened.push(backend)
  return backend
})
