import { afterEach, describe, expect, it } from 'vitest'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import type { Requirement } from '../domain/types'
import { applyRequirementItems, planRequirementItems } from './requirementItems'

const req = (o: Partial<Requirement> & Pick<Requirement, 'name'>): Requirement => ({ id: `r-${o.name}`, unit: '', kind: 'min', min: 1, priority: 'must', ...o })

describe('요구에 맞춰 만들 항목', () => {
  it('요구가 가리키는 항목은 결과로, 적용 조건은 조건으로 계획한다(단위는 요구에서)', () => {
    const plan = planRequirementItems(
      [req({ name: '압축강도', unit: 'MPa', at: { name: '재령', value: 28 } }), req({ name: '슬럼프', unit: 'mm' })],
      [],
    )
    expect(plan).toEqual([
      { kind: 'condition', name: '재령', unit: '' },
      { kind: 'result', name: '압축강도', unit: 'MPa' },
      { kind: 'result', name: '슬럼프', unit: 'mm' },
    ])
  })

  it('이미 있는 항목(조건이든 결과든, 띄어쓰기와 대소문자는 무시)은 만들지 않는다', () => {
    const plan = planRequirementItems(
      [req({ name: '시멘트', kind: 'max', max: 400 }), req({ name: '압축 강도', unit: 'MPa', at: { name: '재령', value: 7 } }), req({ name: '압축강도', unit: 'MPa', at: { name: '재령', value: 28 } })],
      [
        { kind: 'condition', name: '시멘트' },
        { kind: 'condition', name: '재령' },
      ],
    )
    expect(plan).toEqual([{ kind: 'result', name: '압축 강도', unit: 'MPa' }]) // 두 요구가 같은 항목이면 한 번만
  })

  it('요구가 없으면 아무것도 만들지 않는다', () => {
    expect(planRequirementItems([], [])).toEqual([])
  })
})

describe('항목 만들기', () => {
  const opened: LocalBackend[] = []
  afterEach(() => {
    while (opened.length) opened.pop()?.close()
  })

  it('실험 뒤에 이어서 빈 값으로 만들고, 같은 요구로 다시 해도 늘지 않는다', async () => {
    const b = createLocalBackend(`lablog-ri-${Date.now()}`)
    opened.push(b)
    const e = await b.experiments.create({ projectId: null, title: 'x', purpose: '', owner: '', tags: [], status: 'ready', startedAt: null, completedAt: null, sourceExperimentId: null })
    await b.dataItems.create({ experimentId: e.id, kind: 'condition', order: 1, name: '시멘트', value: '300', unit: 'kg/m³' })
    const reqs = [req({ name: '압축강도', unit: 'MPa', at: { name: '재령', value: 28 } })]
    expect(await applyRequirementItems(b, e.id, reqs)).toBe(2)
    const items = await b.dataItems.listByExperiment(e.id)
    expect(items.map((i) => [i.kind, i.name, i.value, i.unit, i.order])).toEqual([
      ['condition', '시멘트', '300', 'kg/m³', 1],
      ['condition', '재령', '', '', 2],
      ['result', '압축강도', '', 'MPa', 1],
    ])
    expect(await applyRequirementItems(b, e.id, reqs)).toBe(0)
    expect(await applyRequirementItems(b, e.id, [])).toBe(0)
  })
})
