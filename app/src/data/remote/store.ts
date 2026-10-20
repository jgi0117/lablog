import type { Entity } from '../../domain/types'

export type TableName = 'projects' | 'experiments' | 'steps' | 'dataItems' | 'templates' | 'deviations'

/** 조회 조건. 모든 항목은 AND로 묶인다. 필드 이름은 앱의 camelCase를 쓴다. */
export interface Query {
  eq?: Record<string, string | number | boolean | null>
  /** 필드 값이 목록 안에 있는 행 */
  in?: { field: string; values: string[] }
  /** 값이 비어 있지 않은 행(예: 휴지통에 있는 실험은 deletedAt이 있다) */
  notNull?: string
}

/**
 * 서버 저장소가 해야 하는 일을 작게 줄인 것. 행은 앱의 도메인 모양(camelCase)이고,
 * DB 열 이름(snake_case)으로 바꾸는 일은 이 인터페이스의 구현이 맡는다(data/supabase/mapping.ts).
 * 이렇게 나눠 두면 저장소 규칙(버전 충돌, 휴지통, 복제, 검색, 백업)은 한 번만 만들고 같은 계약 테스트로 확인할 수 있다.
 * 소유자(owner_id)는 서버가 로그인 사용자로 채우고 RLS가 지키므로 여기에는 나오지 않는다.
 */
export interface RemoteStore {
  /** 조건에 맞는 모든 행. 서버가 한 번에 주는 개수를 넘으면 나눠서 모두 읽어 온다. */
  select<T extends Entity>(table: TableName, query?: Query): Promise<T[]>
  get<T extends Entity>(table: TableName, id: string): Promise<T | null>
  /** 새 행을 넣는다. 같은 id가 있으면 오류. */
  insert<T extends Entity>(table: TableName, rows: T[]): Promise<void>
  /** 있으면 덮어쓰고 없으면 넣는다(데이터 이전과 가져오기용). */
  upsert<T extends Entity>(table: TableName, rows: T[]): Promise<void>
  /**
   * id가 같고 version이 expectedVersion인 행을 next로 바꾼다. 바뀌었으면 true,
   * 맞는 행이 없으면(없거나 다른 곳에서 먼저 고쳤으면) false.
   */
  update<T extends Entity>(table: TableName, next: T, expectedVersion: number): Promise<boolean>
  /** 조건에 맞는 행을 지운다(영구 삭제). */
  remove(table: TableName, query: Query): Promise<void>
}
