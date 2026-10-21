import { runBackendContract } from '../repositories/backend.contract'
import { createRemoteBackend } from './remoteBackend'
import { createMemoryStore } from './memoryStore'

// 서버 저장소(Phase 9)가 로컬 저장소와 같은 계약을 지키는지, 네트워크 없이 서버 흉내(메모리)로 확인한다.
// 진짜 Supabase에 대해서는 supabase.integration.test.ts가 같은 계약을 돌린다(접속 정보가 있을 때만).
let store = createMemoryStore()

runBackendContract('서버 저장소(메모리 서버)', async () => {
  store = createMemoryStore()
  return createRemoteBackend(store)
}, async () => createRemoteBackend(store))
