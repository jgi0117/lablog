import type { DataBackend } from '../data/repositories'
import { canTransition, progressPercent } from '../domain/rules'
import type { DataItem, Experiment, ID, Step } from '../domain/types'

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`${from} 상태에서 ${to} 상태로 바꿀 수 없습니다`)
    this.name = 'InvalidTransitionError'
  }
}

export interface NewExperimentInput {
  title: string
  purpose?: string
  owner?: string
  tags?: string[]
  projectId?: ID | null
}

/** 제목만 필수. 만들면 상태는 준비. */
export async function createExperiment(db: DataBackend, input: NewExperimentInput): Promise<Experiment> {
  const title = input.title.trim()
  if (!title) throw new ValidationError('제목을 입력하세요')
  return db.experiments.create({
    projectId: input.projectId ?? null,
    title,
    purpose: input.purpose?.trim() ?? '',
    owner: input.owner?.trim() ?? '',
    tags: input.tags ?? [],
    status: 'ready',
    startedAt: null,
    completedAt: null,
    sourceExperimentId: null,
  })
}

/** 수행 모드 시작. 준비 → 진행으로 바꾸고 시작 시각을 남긴다. 이미 진행 중이면 그대로 둔다. */
export async function startRun(db: DataBackend, exp: Experiment): Promise<Experiment> {
  if (exp.status === 'running') return exp
  if (!canTransition(exp.status, 'running')) throw new InvalidTransitionError(exp.status, 'running')
  return db.experiments.update(exp.id, { status: 'running', startedAt: exp.startedAt ?? new Date().toISOString() })
}

/** 완료 처리. 진행 중인 실험만 완료할 수 있다. 미완료 단계와 빈 결과는 막지 않는다(E3, E8). */
export async function completeExperiment(db: DataBackend, exp: Experiment): Promise<Experiment> {
  if (!canTransition(exp.status, 'done')) throw new InvalidTransitionError(exp.status, 'done')
  return db.experiments.update(exp.id, { status: 'done', completedAt: new Date().toISOString() })
}

/** 완료한 실험을 다시 연다(재개). */
export async function reopenExperiment(db: DataBackend, exp: Experiment): Promise<Experiment> {
  if (!canTransition(exp.status, 'running')) throw new InvalidTransitionError(exp.status, 'running')
  return db.experiments.update(exp.id, { status: 'running', completedAt: null })
}

/** 단계를 뒤에 이어서 추가한다. */
export async function appendSteps(db: DataBackend, experimentId: ID, contents: string[], existing: Step[]): Promise<Step[]> {
  let order = existing.reduce((m, s) => Math.max(m, s.order), 0)
  const out: Step[] = []
  for (const content of contents) {
    out.push(
      await db.steps.create({ experimentId, order: ++order, content, done: false, doneAt: null, note: '' }),
    )
  }
  return out
}

export function stepStats(steps: Step[]): { done: number; total: number; percent: number } {
  const done = steps.filter((s) => s.done).length
  return { done, total: steps.length, percent: progressPercent(done, steps.length) }
}

/** 수행 모드가 처음 보여 줄 단계: 아직 체크하지 않은 첫 단계. 모두 끝났으면 -1. */
export function firstOpenIndex(steps: Step[]): number {
  return steps.findIndex((s) => !s.done)
}

export function nextOpenIndex(steps: Step[], after: number): number {
  for (let i = after + 1; i < steps.length; i++) if (!steps[i].done) return i
  for (let i = 0; i <= after && i < steps.length; i++) if (!steps[i].done) return i
  return -1
}

/** 같은 이름의 숫자 값들. 이상 값 경고(E7)의 기준이 된다. */
export function numericHistory(items: DataItem[], name: string, excludeId?: ID): number[] {
  return items
    .filter((i) => i.name.trim() === name.trim() && i.id !== excludeId)
    .map((i) => Number(i.value.replace(/,/g, '')))
    .filter((n) => Number.isFinite(n))
}
