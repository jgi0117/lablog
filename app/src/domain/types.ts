/** 모든 ID는 클라이언트가 만드는 UUID. 로컬과 Supabase에서 같은 값을 그대로 쓴다. */
export type ID = string
/** ISO 8601 UTC 문자열 (예: 2026-10-19T05:32:08.000Z) */
export type ISODate = string

/** 모든 레코드의 공통 필드. 소프트 삭제와 충돌 감지(version)에 쓴다. */
export interface Entity {
  id: ID
  createdAt: ISODate
  updatedAt: ISODate
  /** 휴지통으로 보낸 시각. null이면 살아 있음. 30일 뒤 영구 삭제 대상. */
  deletedAt: ISODate | null
  /** 저장할 때마다 1씩 늘어난다. 같은 레코드를 동시에 고쳤는지 판단한다. */
  version: number
}

export interface Project extends Entity {
  name: string
  description: string
}

/** 준비 → 진행 → 완료. 완료에서 다시 진행으로 돌아갈 수 있다. */
export type ExperimentStatus = 'ready' | 'running' | 'done'

export interface Experiment extends Entity {
  projectId: ID | null
  title: string
  purpose: string
  owner: string
  tags: string[]
  status: ExperimentStatus
  startedAt: ISODate | null
  completedAt: ISODate | null
  /** 복제로 만든 실험이면 원본 실험 ID */
  sourceExperimentId: ID | null
}

export interface Step extends Entity {
  experimentId: ID
  /** 1부터 시작하는 표시 순서 */
  order: number
  content: string
  done: boolean
  doneAt: ISODate | null
  note: string
}

export type DataKind = 'condition' | 'result'

/** 조건·결과 한 줄. 값은 문자열로 둔다("—", 범위, 단위 없는 값 허용). */
export interface DataItem extends Entity {
  experimentId: ID
  kind: DataKind
  order: number
  name: string
  value: string
  unit: string
}

/** (P1) 첨부. 파일 본문은 Blob 저장소에 두고 여기에는 참조만 둔다. */
export interface Attachment extends Entity {
  experimentId: ID
  stepId: ID | null
  fileName: string
  mimeType: string
  size: number
  blobRef: string
}

/** (s3) 절차와 달라진 점 */
export interface Deviation extends Entity {
  experimentId: ID
  stepId: ID | null
  change: string
  reason: string
}

/** (s3) 표준 절차 묶음 */
export interface Template extends Entity {
  name: string
  steps: { content: string }[]
  defaultConditions: { name: string; value: string; unit: string }[]
  /** 결과는 항목 이름과 단위만 두고 값은 실험마다 채운다(빠뜨리지 않게 빈 칸으로 만들어 준다) */
  resultItems: { name: string; unit: string }[]
}

/** 생성 입력: 서버/저장소가 채우는 필드를 뺀다. id는 호출자가 줄 수 있다(멱등 이전용). */
export type NewEntity<T extends Entity> = Omit<
  T,
  'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'version'
> & { id?: ID }

/** 수정 입력: 바꿀 필드만. */
export type Patch<T extends Entity> = Partial<
  Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'version'>
>
