import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { newId } from '../local/util'

/**
 * RLS(행 수준 보안) 침투 시험. 진짜 Supabase에서 "다른 사용자의 데이터가 안 보이고 건드릴 수 없는가"를 확인한다.
 * 접속 정보와 시험 계정 둘이 있을 때만 실행한다(없으면 건너뜀). 시험 전용 프로젝트에서만 돌리고, 시험이 두 계정의 데이터를 만들고 지운다.
 *
 *   SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY
 *   SUPABASE_TEST_EMAIL, SUPABASE_TEST_PASSWORD      (계정 A)
 *   SUPABASE_TEST_EMAIL2, SUPABASE_TEST_PASSWORD2    (계정 B)
 *
 * 실행: npm run test:supabase
 */
const env = process.env
const ready = !!(env.SUPABASE_TEST_URL && env.SUPABASE_TEST_ANON_KEY && env.SUPABASE_TEST_EMAIL && env.SUPABASE_TEST_PASSWORD && env.SUPABASE_TEST_EMAIL2 && env.SUPABASE_TEST_PASSWORD2)

async function login(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(env.SUPABASE_TEST_URL as string, env.SUPABASE_TEST_ANON_KEY as string, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`시험 계정 로그인 실패(${email}): ${error.message}`)
  return c
}

const now = () => new Date().toISOString()

describe.skipIf(!ready)('RLS: 다른 사용자의 데이터', () => {
  it('B는 A의 행을 읽을 수도, 고칠 수도, 지울 수도 없고, 로그인하지 않은 사용자는 아무것도 못 본다', async () => {
    const a = await login(env.SUPABASE_TEST_EMAIL as string, env.SUPABASE_TEST_PASSWORD as string)
    const b = await login(env.SUPABASE_TEST_EMAIL2 as string, env.SUPABASE_TEST_PASSWORD2 as string)
    const anon = createClient(env.SUPABASE_TEST_URL as string, env.SUPABASE_TEST_ANON_KEY as string, { auth: { persistSession: false } })

    const projectId = newId()
    const expId = newId()
    const ins = await a.from('projects').insert({ id: projectId, name: 'RLS 시험(A)', created_at: now(), updated_at: now(), version: 1 })
    expect(ins.error).toBeNull()
    const insExp = await a.from('experiments').insert({ id: expId, project_id: projectId, title: 'A의 실험', created_at: now(), updated_at: now(), version: 1 })
    expect(insExp.error).toBeNull()

    try {
      // 읽기: B에게 안 보인다
      expect((await b.from('projects').select('id').eq('id', projectId)).data).toEqual([])
      expect((await b.from('experiments').select('id').eq('id', expId)).data).toEqual([])
      // 로그인하지 않은 사용자(anon)는 표 접근 자체가 막힌다
      const anonRead = await anon.from('experiments').select('id').eq('id', expId)
      expect(anonRead.data ?? []).toEqual([])
      // 수정·삭제: 0행이 바뀐다(오류 없이 조용히 걸러진다)
      const upd = await b.from('projects').update({ name: '가로챔' }).eq('id', projectId).select('id')
      expect(upd.data ?? []).toEqual([])
      const del = await b.from('experiments').delete().eq('id', expId).select('id')
      expect(del.data ?? []).toEqual([])
      // 쓰기: 남의 소유자 id를 직접 넣어 만들 수 없다
      const { data: userA } = await a.auth.getUser()
      const forge = await b.from('projects').insert({ id: newId(), owner_id: userA.user?.id, name: '위조', created_at: now(), updated_at: now(), version: 1 })
      expect(forge.error).not.toBeNull()
      // 자식 행: B가 A의 실험에 단계를 붙일 수 없다(복합 외래 키가 막는다)
      const child = await b.from('steps').insert({ id: newId(), experiment_id: expId, step_order: 1, content: '끼워 넣기', created_at: now(), updated_at: now(), version: 1 })
      expect(child.error).not.toBeNull()
      // A의 데이터는 멀쩡하다
      const mine = await a.from('projects').select('name').eq('id', projectId).single()
      expect(mine.data?.name).toBe('RLS 시험(A)')
    } finally {
      await a.from('experiments').delete().eq('id', expId)
      await a.from('projects').delete().eq('id', projectId)
    }
  }, 60000)
})
