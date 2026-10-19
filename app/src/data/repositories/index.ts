import type {
  DataItem,
  Deviation,
  Experiment,
  ExperimentStatus,
  ID,
  ISODate,
  NewEntity,
  Patch,
  Project,
  Step,
  Template,
} from '../../domain/types'

/**
 * 화면과 서비스는 이 인터페이스만 부른다. 구현은 data/local(IndexedDB)과
 * data/supabase(Phase 9)가 따로 갖고, 같은 계약 테스트를 통과해야 한다.
 * 모든 메서드는 Promise를 돌려준다. 로컬 구현도 동기로 만들지 않는다.
 */

// ---------- 오류 ----------
export class NotFoundError extends Error {
  readonly entity: string
  readonly id: ID
  constructor(entity: string, id: ID) {
    super(`${entity} ${id} 을(를) 찾을 수 없습니다`)
    this.name = 'NotFoundError'
    this.entity = entity
    this.id = id
  }
}

/** expectedVersion이 저장된 version과 다를 때 (동시 수정 감지) */
export class ConflictError extends Error {
  readonly entity: string
  readonly id: ID
  readonly currentVersion: number
  constructor(entity: string, id: ID, currentVersion: number) {
    super(`${entity} ${id} 이(가) 다른 곳에서 먼저 수정되었습니다`)
    this.name = 'ConflictError'
    this.entity = entity
    this.id = id
    this.currentVersion = currentVersion
  }
}

/** 저장 공간 부족, 저장소 접근 차단 등 (E1: 저장 실패 안내) */
export class StorageError extends Error {
  readonly reason: 'quota' | 'blocked' | 'unknown'
  constructor(message: string, reason: 'quota' | 'blocked' | 'unknown') {
    super(message)
    this.name = 'StorageError'
    this.reason = reason
  }
}

// ---------- 조회 조건 ----------
export interface ExperimentFilter {
  projectId?: ID
  tag?: string
  status?: ExperimentStatus
  /** updatedAt 기준 기간 */
  from?: ISODate
  to?: ISODate
  /** 기본 'exclude'. 'only'는 휴지통 화면용. */
  deleted?: 'exclude' | 'only'
}

export type ExperimentSort = 'updated_desc' | 'title_asc' | 'started_desc'

export interface PageRequest {
  limit: number
  offset: number
}

export interface PageResult<T> {
  items: T[]
  total: number
}

// ---------- 검색 ----------
export type SearchField = 'title' | 'purpose' | 'tag' | 'step' | 'note' | 'condition' | 'result'

export interface SearchHit {
  experimentId: ID
  /** 일치한 위치. 한 실험이 여러 곳에서 일치하면 모두 담는다. */
  matches: { field: SearchField; text: string; stepOrder?: number }[]
  score: number
}

// ---------- 저장소 ----------
export interface ExperimentRepository {
  list(
    filter?: ExperimentFilter,
    sort?: ExperimentSort,
    page?: PageRequest,
  ): Promise<PageResult<Experiment>>
  get(id: ID): Promise<Experiment>
  create(input: NewEntity<Experiment>): Promise<Experiment>
  /** expectedVersion을 주면 다를 때 ConflictError. 저장 후 version이 1 늘어난다. */
  update(id: ID, patch: Patch<Experiment>, expectedVersion?: number): Promise<Experiment>
  /** 휴지통으로 보낸다. 실험에 딸린 단계·조건·결과도 함께 숨긴다. */
  softDelete(id: ID): Promise<void>
  restore(id: ID): Promise<void>
  /** 휴지통에 있는 실험 하나를 보관 기간과 상관없이 영구 삭제한다(딸린 데이터 포함). 휴지통에 없으면 오류. */
  purge(id: ID): Promise<void>
  /** 삭제 후 보관 기간이 지난 실험과 딸린 데이터를 영구 삭제한다. 지운 실험 수를 돌려준다. */
  purgeExpired(now: Date): Promise<number>
  /** 제목·목적·태그·단계·메모·조건·결과 전체 검색. 휴지통은 제외. */
  search(query: string, filter?: ExperimentFilter): Promise<SearchHit[]>
  /** 실험과 딸린 단계·조건을 복사하고 결과·체크·메모는 비운다 (s3). */
  duplicate(id: ID, overrides?: { title?: string }): Promise<Experiment>
}

export interface StepRepository {
  listByExperiment(experimentId: ID): Promise<Step[]>
  create(input: NewEntity<Step>): Promise<Step>
  update(id: ID, patch: Patch<Step>, expectedVersion?: number): Promise<Step>
  remove(id: ID): Promise<void>
  /** orderedIds 순서대로 order를 1..n으로 다시 매긴다. */
  reorder(experimentId: ID, orderedIds: ID[]): Promise<Step[]>
  /** done과 doneAt을 함께 바꾼다. 같은 값이면 아무것도 바꾸지 않는다(멱등). */
  setDone(id: ID, done: boolean): Promise<Step>
}

export interface DataItemRepository {
  listByExperiment(experimentId: ID): Promise<DataItem[]>
  create(input: NewEntity<DataItem>): Promise<DataItem>
  update(id: ID, patch: Patch<DataItem>, expectedVersion?: number): Promise<DataItem>
  remove(id: ID): Promise<void>
}

export interface ProjectRepository {
  list(): Promise<Project[]>
  create(input: NewEntity<Project>): Promise<Project>
  update(id: ID, patch: Patch<Project>, expectedVersion?: number): Promise<Project>
  softDelete(id: ID): Promise<void>
}

export interface TemplateRepository {
  /** 휴지통 제외, 이름순 */
  list(): Promise<Template[]>
  get(id: ID): Promise<Template>
  create(input: NewEntity<Template>): Promise<Template>
  update(id: ID, patch: Patch<Template>, expectedVersion?: number): Promise<Template>
  softDelete(id: ID): Promise<void>
}

export interface DeviationRepository {
  /** 만든 순서(오래된 것부터). 실험이 휴지통에 있으면 빈 목록. */
  listByExperiment(experimentId: ID): Promise<Deviation[]>
  create(input: NewEntity<Deviation>): Promise<Deviation>
  update(id: ID, patch: Patch<Deviation>, expectedVersion?: number): Promise<Deviation>
  remove(id: ID): Promise<void>
}

// ---------- 백업 ----------
/** 2: 템플릿과 편차 추가. 1(없는 목록은 빈 목록으로 본다)도 가져올 수 있다. */
export const BACKUP_SCHEMA_VERSION = 2

export interface BackupFile {
  schemaVersion: number
  exportedAt: ISODate
  projects: Project[]
  experiments: Experiment[]
  steps: Step[]
  dataItems: DataItem[]
  /** 버전 1 파일에는 없다 */
  templates?: Template[]
  deviations?: Deviation[]
}

export interface BackupRepository {
  exportAll(): Promise<BackupFile>
  /** merge: 같은 id는 updatedAt이 더 최신인 쪽을 쓴다. replace: 전부 지우고 가져온다. */
  importAll(file: BackupFile, mode: 'merge' | 'replace'): Promise<{ imported: number }>
}

/** data/index.ts가 하나만 만들어 앱 전체에 준다. */
export interface DataBackend {
  projects: ProjectRepository
  experiments: ExperimentRepository
  steps: StepRepository
  dataItems: DataItemRepository
  templates: TemplateRepository
  deviations: DeviationRepository
  backup: BackupRepository
  /**
   * 다른 탭(또는 다른 기기)에서 데이터가 바뀌면 알려 준다. 해제 함수를 돌려준다.
   * 로컬 구현은 BroadcastChannel, Supabase 구현(Phase 9)은 실시간 구독으로 채운다. 없어도 앱은 동작한다.
   */
  onExternalChange?(listener: () => void): () => void
}
