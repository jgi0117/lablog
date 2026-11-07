/**
 * lablog v3 데이터 모델. 세 가지뿐이다: 프로젝트, 변수, 실험(run).
 *
 * - 프로젝트는 "무엇을 바꿔(입력) 무엇을 재고(출력) 어디에 도달할지(목표)"를 적어 둔 것이다.
 * - 실험은 입력 값 묶음 x와 측정한 출력 값 y다. 앱이 입력 값을 정해 "계획" 상태로 만들어 두고,
 *   사람은 결과 숫자만 넣는다. 그러면 "완료"가 된다.
 * - 절차·단계·메모 같은 것은 없다. 조건과 결과만 쌓이고, 그것으로 모델을 만든다.
 */
export type ID = string

/** input: 앱이 값을 정해 주는 조건. level: 재령처럼 정해진 몇 가지 값에서 재는 조건. output: 측정 결과 */
export type Role = 'input' | 'level' | 'output'

export interface Variable {
  id: ID
  name: string
  unit: string
  role: Role
  /** input의 탐색 범위. 같으면 그 값으로 고정한다 */
  min?: number
  max?: number
  /** 값의 소수 자릿수(0이면 정수) */
  decimals: number
  /** level 변수에서 계획할 값들(예: 재령 7, 28). 목표의 적용 조건에서 자동으로 채운다 */
  levels?: number[]
}

/** target: 목표값에 가까울수록 좋고 ±허용 안이면 만족. >=, <=: 한쪽 한계. between: 범위 */
export type GoalOp = 'target' | '>=' | '<=' | 'between'

export interface Goal {
  id: ID
  /** 출력 변수 id(입력 변수에 걸 수도 있다: 시멘트 ≤ 400) */
  variable: ID
  op: GoalOp
  lo?: number
  hi?: number
  /** target일 때 목표값과 허용 오차(±) */
  target?: number
  tol?: number
  /** 이 level 값일 때만 판정한다(예: 재령 28일 때) */
  at?: { variable: ID; value: number }
  /** 필수 목표인가(모두 만족해야 "달성"). 아니면 참고 목표 */
  must: boolean
}

export interface Project {
  id: ID
  name: string
  note: string
  variables: Variable[]
  goals: Goal[]
  /** 처음 탐색 단계에서 앱이 짜는 실험(조건 묶음) 수 */
  initialRuns: number
  /** 같은 변수를 가진 다른 프로젝트의 실험도 모아 학습하는가(기본 true) */
  pool?: boolean
  created: string
  updated: string
}

export type RunStatus = 'planned' | 'done' | 'skipped'
export type RunSource = 'plan' | 'model' | 'manual' | 'import'

export interface Run {
  id: ID
  project: ID
  /** 실험 순서(1부터). 계획 순서이자 표시 순서 */
  order: number
  /** 입력·level 변수 id → 값 */
  x: Record<ID, number>
  /** 출력 변수 id → 값(아직 재지 않았으면 없음) */
  y: Record<ID, number>
  status: RunStatus
  source: RunSource
  note: string
  /** 결과를 넣은 날짜(ISO) */
  date: string | null
}

/** 직접 학습해 저장한 모델 한 버전. 변수 이름이 같은 프로젝트들(group)에서 함께 쓴다 */
export interface ModelVersion {
  id: ID
  /** 변수 묶음 열쇠(입력·측정 시점·출력 이름). 같은 묶음의 프로젝트에서 쓸 수 있다 */
  group: string
  version: number
  /** 출력 변수 이름(label) */
  target: string
  /** 쓴 조건 이름(feature). 프로젝트 표시 변수는 'proj:<id>' */
  features: string[]
  algo: 'forest' | 'ridge' | 'knn' | 'gbm'
  params: Record<string, number | undefined>
  folds: number
  pooled: boolean
  projects: ID[]
  n: number
  r2: number
  mae: number
  residSd: number
  ysd: number
  importance: number[]
  cv_pred: number[]
  cv_actual: number[]
  /** 학습한 모델 본체(숫자·배열만) */
  predictor: unknown
  trainedAt: string
  /** 같은 group·target에서 하나만 적용 */
  applied: boolean
  note: string
}

export interface Db {
  version: 3
  projects: Project[]
  runs: Run[]
  models?: ModelVersion[]
}

export const emptyDb = (): Db => ({ version: 3, projects: [], runs: [], models: [] })

/** 변수 묶음 열쇠: 입력·측정 시점·출력의 이름(공백·대소문자 무시). 같은 열쇠면 데이터와 모델을 함께 쓴다 */
export function groupKeyOf(p: Project): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
  return p.variables
    .filter((v) => v.name.trim())
    .map((v) => `${v.role}:${norm(v.name)}`)
    .sort()
    .join('|')
}

export const inputsOf = (p: Project) => p.variables.filter((v) => v.role === 'input')
export const levelsOf = (p: Project) => p.variables.filter((v) => v.role === 'level')
export const outputsOf = (p: Project) => p.variables.filter((v) => v.role === 'output')
export const variableOf = (p: Project, id: ID) => p.variables.find((v) => v.id === id)
export const label = (v: Variable) => (v.unit ? `${v.name} (${v.unit})` : v.name)

/** 사람이 읽는 목표 한 줄. 예) "재령 28일 때 압축강도 ≥ 30 MPa" */
export function describeGoal(p: Project, g: Goal): string {
  const v = variableOf(p, g.variable)
  const name = v?.name ?? g.variable
  const unit = v?.unit ? ` ${v.unit}` : ''
  const rule =
    g.op === 'target'
      ? `${fmt(g.target)} ± ${fmt(g.tol)}${unit}`
      : g.op === '>='
        ? `≥ ${fmt(g.lo)}${unit}`
        : g.op === '<='
          ? `≤ ${fmt(g.hi)}${unit}`
          : `${fmt(g.lo)} ~ ${fmt(g.hi)}${unit}`
  const atVar = g.at ? variableOf(p, g.at.variable) : undefined
  const when = g.at ? `${atVar?.name ?? ''} ${fmt(g.at.value)}${atVar?.unit ? atVar.unit : ''}일 때 ` : ''
  return `${when}${name} ${rule}`
}

export function fmt(n: number | undefined | null, decimals?: number): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—'
  if (decimals !== undefined) return n.toFixed(decimals)
  return String(Number(n.toPrecision(5)))
}

/** 목표의 중심값(가까움을 잴 기준). target은 목표값, 한계는 그 값, 범위는 가운데 */
export function goalCenter(g: Goal): number {
  if (g.op === 'target') return g.target ?? 0
  if (g.op === '>=') return g.lo ?? 0
  if (g.op === '<=') return g.hi ?? 0
  return ((g.lo ?? 0) + (g.hi ?? 0)) / 2
}

/** 값이 목표를 만족하는가와 여유(음수면 미달, 목표 크기에 대한 비율). target은 허용 오차 안쪽이 여유 */
export function checkGoal(g: Goal, v: number): { ok: boolean; margin: number } {
  let gap = 0
  let base = 1
  if (g.op === 'target') {
    base = g.target ?? 0
    gap = (g.tol ?? 0) - Math.abs(v - base)
  } else if (g.op === '>=') {
    base = g.lo ?? 0
    gap = v - base
  } else if (g.op === '<=') {
    base = g.hi ?? 0
    gap = base - v
  } else {
    const lo = g.lo ?? 0
    const hi = g.hi ?? 0
    base = (lo + hi) / 2
    gap = Math.min(v - lo, hi - v)
  }
  return { ok: gap >= -1e-12, margin: gap / Math.max(Math.abs(base), 1e-9) }
}
