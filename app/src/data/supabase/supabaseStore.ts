import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import type { Entity } from '../../domain/types'
import { RemoteError } from '../remote/memoryStore'
import type { Query, RemoteStore, TableName } from '../remote/store'
import { columnOf, fromRow, TABLE_NAME, toRow } from './mapping'

/** 서버가 한 번에 주는 행 수의 상한(PostgREST 기본값). 이 단위로 나눠 모두 읽는다. */
const PAGE = 1000

/** 서버 오류를 사람이 읽을 수 있는 한국어로. 원문은 괄호 안에 남겨 문제를 찾을 수 있게 한다. */
export function describeError(error: PostgrestError | { message: string; code?: string }): string {
  const code = 'code' in error ? error.code : undefined
  const tail = ` (${code ? code + ': ' : ''}${error.message})`
  if (code === '42501' || /row-level security|permission denied/i.test(error.message)) {
    return '권한이 없습니다. 로그인이 풀렸거나 다른 사용자의 데이터입니다.' + tail
  }
  if (code === '23505') return '같은 id가 이미 있습니다.' + tail
  if (code === '23503') return '연결된 데이터가 없어 저장하지 못했습니다(예: 지워진 실험에 붙이려 함).' + tail
  if (code === '42P01' || /relation .* does not exist|schema cache/i.test(error.message)) {
    return '서버에 표가 없습니다. supabase/migrations의 SQL을 먼저 적용하세요.' + tail
  }
  if (/failed to fetch|networkerror|load failed/i.test(error.message)) return '서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.' + tail
  return '서버 저장소 오류가 났습니다.' + tail
}

/** supabase-js 위의 RemoteStore. 앱의 캐멀 케이스와 DB의 스네이크 케이스를 바꾸는 일은 mapping.ts가 한다. */
export function createSupabaseStore(client: SupabaseClient): RemoteStore {
  const fail = (e: PostgrestError): never => {
    throw new RemoteError(describeError(e))
  }

  /** fetch 자체가 실패하면(오프라인 등) supabase-js는 오류 객체를 주거나 던진다. 둘 다 같은 오류로 바꾼다. */
  async function run<T>(op: () => PromiseLike<{ data: T | null; error: PostgrestError | null }>): Promise<T> {
    let res: { data: T | null; error: PostgrestError | null }
    try {
      res = await op()
    } catch (e) {
      throw new RemoteError(describeError({ message: e instanceof Error ? e.message : String(e) }))
    }
    if (res.error) fail(res.error)
    return res.data as T
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const filtered = (b: any, q: Query = {}) => {
    for (const [field, v] of Object.entries(q.eq ?? {})) b = v === null ? b.is(columnOf(field), null) : b.eq(columnOf(field), v)
    if (q.in) b = b.in(columnOf(q.in.field), q.in.values)
    if (q.notNull) b = b.not(columnOf(q.notNull), 'is', null)
    return b
  }

  return {
    async select<T extends Entity>(table: TableName, query?: Query) {
      if (query?.in && query.in.values.length === 0) return []
      const out: T[] = []
      for (let from = 0; ; from += PAGE) {
        const rows = await run<Record<string, unknown>[]>(() =>
          filtered(client.from(TABLE_NAME[table]).select('*'), query)
            .order('id')
            .range(from, from + PAGE - 1),
        )
        for (const r of rows) out.push(fromRow<T>(table, r))
        if (rows.length < PAGE) return out
      }
    },
    async get<T extends Entity>(table: TableName, id: string) {
      const row = await run<Record<string, unknown> | null>(() => client.from(TABLE_NAME[table]).select('*').eq('id', id).maybeSingle())
      return row ? fromRow<T>(table, row) : null
    },
    async insert<T extends Entity>(table: TableName, rows: T[]) {
      if (rows.length === 0) return
      await run(() => client.from(TABLE_NAME[table]).insert(rows.map((r) => toRow(table, r))))
    },
    async upsert<T extends Entity>(table: TableName, rows: T[]) {
      if (rows.length === 0) return
      await run(() => client.from(TABLE_NAME[table]).upsert(rows.map((r) => toRow(table, r)), { onConflict: 'id' }))
    },
    async update<T extends Entity>(table: TableName, next: T, expectedVersion: number) {
      const { id, ...rest } = toRow(table, next)
      const data = await run<{ id: string }[]>(() => client.from(TABLE_NAME[table]).update(rest).eq('id', id as string).eq('version', expectedVersion).select('id'))
      return data.length > 0
    },
    async remove(table: TableName, query: Query) {
      if (query.in && query.in.values.length === 0) return
      await run(() => filtered(client.from(TABLE_NAME[table]).delete(), query))
    },
  }
}
