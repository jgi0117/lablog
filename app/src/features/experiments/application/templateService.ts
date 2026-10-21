import type { DataBackend } from '../../../data/repositories'
import type { DataItem, Experiment, ID, Step, Template } from '../../../domain/types'
import { ValidationError } from './experimentService'

/**
 * 실험의 절차와 조건·결과 항목으로 템플릿을 만든다.
 * 체크·메모·결과 값은 담지 않는다. 조건은 값까지 담고, 결과는 항목 이름과 단위만 담는다.
 */
export async function saveAsTemplate(db: DataBackend, name: string, steps: Step[], items: DataItem[]): Promise<Template> {
  const trimmed = name.trim()
  if (!trimmed) throw new ValidationError('템플릿 이름을 입력하세요')
  if (steps.length === 0) throw new ValidationError('절차가 없는 실험은 템플릿으로 저장할 수 없습니다')
  const ordered = [...steps].sort((a, b) => a.order - b.order)
  const named = (kind: DataItem['kind']) => items.filter((i) => i.kind === kind && i.name.trim()).sort((a, b) => a.order - b.order)
  return db.templates.create({
    name: trimmed,
    steps: ordered.map((s) => ({ content: s.content })),
    defaultConditions: named('condition').map((c) => ({ name: c.name, value: c.value, unit: c.unit })),
    resultItems: named('result').map((r) => ({ name: r.name, unit: r.unit })),
  })
}

export interface FromTemplateInput {
  title: string
  purpose?: string
  owner?: string
  tags?: string[]
  projectId?: ID | null
}

/** 템플릿으로 새 실험을 만든다. 상태는 준비, 결과 값은 빈 칸. */
export async function startFromTemplate(db: DataBackend, template: Template, input: FromTemplateInput): Promise<Experiment> {
  const title = input.title.trim()
  if (!title) throw new ValidationError('제목을 입력하세요')
  const exp = await db.experiments.create({
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
  let order = 0
  for (const s of template.steps) {
    await db.steps.create({ experimentId: exp.id, order: ++order, content: s.content, done: false, doneAt: null, note: '' })
  }
  order = 0
  for (const c of template.defaultConditions) {
    await db.dataItems.create({ experimentId: exp.id, kind: 'condition', order: ++order, name: c.name, value: c.value, unit: c.unit })
  }
  order = 0
  for (const r of template.resultItems) {
    await db.dataItems.create({ experimentId: exp.id, kind: 'result', order: ++order, name: r.name, value: '', unit: r.unit })
  }
  return exp
}

/** 템플릿 편집 화면의 글자 입력(한 줄에 하나)을 목록으로 바꾼다. 빈 줄은 버린다. */
export function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/** "이름 | 값 | 단위" 한 줄을 조건으로. 값과 단위는 비워도 된다. */
export function parseConditionLines(text: string): Template['defaultConditions'] {
  return parseLines(text).map((l) => {
    const [name = '', value = '', unit = ''] = l.split('|').map((p) => p.trim())
    return { name, value, unit }
  })
}

/** "이름 | 단위" 한 줄을 결과 항목으로. */
export function parseResultLines(text: string): Template['resultItems'] {
  return parseLines(text).map((l) => {
    const [name = '', unit = ''] = l.split('|').map((p) => p.trim())
    return { name, unit }
  })
}

export const conditionsToText = (c: Template['defaultConditions']) => c.map((x) => [x.name, x.value, x.unit].join(' | ').replace(/( \| )+$/, '')).join('\n')
export const resultsToText = (r: Template['resultItems']) => r.map((x) => (x.unit ? `${x.name} | ${x.unit}` : x.name)).join('\n')
