import type { Entity } from '../../domain/types'
import type { Query, RemoteStore, TableName } from './store'

const TABLES: TableName[] = ['projects', 'experiments', 'steps', 'dataItems', 'templates', 'deviations']

export class RemoteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteError'
  }
}

function matches(row: Record<string, unknown>, q: Query = {}): boolean {
  for (const [k, v] of Object.entries(q.eq ?? {})) if ((row[k] ?? null) !== v) return false
  if (q.in && !q.in.values.includes(row[q.in.field] as string)) return false
  if (q.notNull && (row[q.notNull] ?? null) === null) return false
  return true
}

/**
 * 메모리에만 있는 서버 흉내. 서버 저장소의 규칙을 네트워크 없이 시험하고(계약 테스트),
 * 서버가 하는 일(같은 id 거절, 부모가 없으면 자식 거절, 부모를 지우면 자식도 삭제, 사용자별 분리)을 같은 방식으로 한다.
 * 한 인스턴스가 한 사용자다. 같은 서버에 사용자 둘을 시험하려면 shared를 넘겨 같은 데이터 상자를 쓰되 owner를 다르게 준다.
 */
export function createMemoryStore(shared: Map<string, { owner: string; row: Entity }> = new Map(), owner = 'user-1'): RemoteStore & { latency: { ms: number } } {
  const latency = { ms: 0 }
  const key = (table: TableName, id: string) => `${table}:${id}`
  const wait = () => (latency.ms > 0 ? new Promise<void>((r) => setTimeout(r, latency.ms)) : Promise.resolve())
  const mine = (table: TableName) => [...shared.entries()].filter(([k, v]) => k.startsWith(`${table}:`) && v.owner === owner).map(([, v]) => v.row)

  const parentTable = (table: TableName): TableName | null => (table === 'steps' || table === 'dataItems' || table === 'deviations' ? 'experiments' : null)

  function assertParent(table: TableName, row: Record<string, unknown>) {
    const parent = parentTable(table)
    if (parent) {
      const p = shared.get(key(parent, row.experimentId as string))
      if (!p || p.owner !== owner) throw new RemoteError(`${table}: 부모 실험이 없어 넣을 수 없습니다`)
    }
    if (table === 'experiments') {
      for (const [field, target] of [['projectId', 'projects'] as const, ['sourceExperimentId', 'experiments'] as const]) {
        const ref = row[field]
        if (ref) {
          const p = shared.get(key(target, ref as string))
          if (!p || p.owner !== owner) throw new RemoteError(`experiments.${field}: 가리키는 행이 없습니다`)
        }
      }
    }
  }

  /** 한 문장(한 번의 요청)처럼 쓴다: 모두 넣은 다음에 외래 키를 확인하고, 하나라도 어긋나면 전부 되돌린다. */
  function writeBatch(table: TableName, rows: Entity[]) {
    const before = new Map(rows.map((r) => [key(table, r.id), shared.get(key(table, r.id))]))
    for (const row of rows) shared.set(key(table, row.id), { owner, row: structuredClone(row) })
    try {
      for (const row of rows) assertParent(table, row as unknown as Record<string, unknown>)
    } catch (e) {
      for (const [k, v] of before) {
        if (v) shared.set(k, v)
        else shared.delete(k)
      }
      throw e
    }
  }

  function cascade(table: TableName, id: string) {
    if (table !== 'experiments') return
    for (const [k, v] of [...shared.entries()]) {
      const t = k.split(':')[0] as TableName
      if ((t === 'steps' || t === 'dataItems' || t === 'deviations') && (v.row as unknown as Record<string, unknown>).experimentId === id) shared.delete(k)
    }
    // 복제 원본이 지워지면 원본 표시만 비운다
    for (const [, v] of shared.entries()) {
      const r = v.row as unknown as Record<string, unknown>
      if (r.sourceExperimentId === id) r.sourceExperimentId = null
    }
  }

  return {
    latency,
    async select<T extends Entity>(table: TableName, query?: Query) {
      await wait()
      return mine(table)
        .filter((r) => matches(r as unknown as Record<string, unknown>, query))
        .map((r) => structuredClone(r) as T)
    },
    async get<T extends Entity>(table: TableName, id: string) {
      await wait()
      const v = shared.get(key(table, id))
      return v && v.owner === owner ? (structuredClone(v.row) as T) : null
    },
    async insert<T extends Entity>(table: TableName, rows: T[]) {
      await wait()
      for (const row of rows) if (shared.has(key(table, row.id))) throw new RemoteError(`${table}: 같은 id가 이미 있습니다`)
      writeBatch(table, rows)
    },
    async upsert<T extends Entity>(table: TableName, rows: T[]) {
      await wait()
      for (const row of rows) {
        const cur = shared.get(key(table, row.id))
        if (cur && cur.owner !== owner) throw new RemoteError(`${table}: 다른 사용자의 행입니다`)
      }
      writeBatch(table, rows)
    },
    async update<T extends Entity>(table: TableName, next: T, expectedVersion: number) {
      await wait()
      const cur = shared.get(key(table, next.id))
      if (!cur || cur.owner !== owner || cur.row.version !== expectedVersion) return false
      assertParent(table, next as unknown as Record<string, unknown>)
      shared.set(key(table, next.id), { owner, row: structuredClone(next) })
      return true
    },
    async remove(table: TableName, query: Query) {
      await wait()
      for (const [k, v] of [...shared.entries()]) {
        if (!k.startsWith(`${table}:`) || v.owner !== owner) continue
        if (!matches(v.row as unknown as Record<string, unknown>, query)) continue
        shared.delete(k)
        cascade(table, v.row.id)
      }
    },
  }
}

export { TABLES }
