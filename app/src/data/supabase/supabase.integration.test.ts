import { createClient } from '@supabase/supabase-js'
import { describe, it } from 'vitest'
import { runBackendContract } from '../repositories/backend.contract'
import { createRemoteBackend } from '../remote/remoteBackend'
import { createSupabaseStore } from './supabaseStore'

/**
 * 진짜 Supabase에 같은 계약 테스트를 돌린다. 접속 정보가 있을 때만 실행한다(없으면 건너뜀).
 * 시험용 프로젝트와 시험용 계정을 쓰고, 운영 데이터가 있는 프로젝트에는 절대 돌리지 않는다. 시험이 이 계정의 데이터를 지운다.
 *
 *   SUPABASE_TEST_URL=https://xxxx.supabase.co
 *   SUPABASE_TEST_ANON_KEY=공개용 anon 키
 *   SUPABASE_TEST_EMAIL=시험 계정 이메일
 *   SUPABASE_TEST_PASSWORD=시험 계정 비밀번호
 *
 * 실행: npm run test:supabase
 */
const url = process.env.SUPABASE_TEST_URL
const key = process.env.SUPABASE_TEST_ANON_KEY
const email = process.env.SUPABASE_TEST_EMAIL
const password = process.env.SUPABASE_TEST_PASSWORD

if (url && key && email && password) {
  runBackendContract('서버 저장소(진짜 Supabase)', async () => {
    const client = createClient(url, key, { auth: { persistSession: false } })
    const { error } = await client.auth.signInWithPassword({ email, password })
    if (error) throw new Error(`시험 계정으로 로그인하지 못했습니다: ${error.message}`)
    const backend = createRemoteBackend(createSupabaseStore(client))
    // 계약 테스트는 빈 상태에서 시작한다고 가정하므로, 시험 계정의 데이터를 모두 비운다.
    await backend.backup.importAll({ schemaVersion: 2, exportedAt: new Date().toISOString(), projects: [], experiments: [], steps: [], dataItems: [], templates: [], deviations: [] }, 'replace')
    return backend
  })
}
else {
  describe.skip('서버 저장소(진짜 Supabase)', () => {
    it('접속 정보(SUPABASE_TEST_*)가 없어 건너뜁니다', () => {})
  })
}
