import type { DataBackend } from '../data/repositories'
import type { DataItem, ID, Requirement } from '../domain/types'
import { normalizeName } from './analysis'

export interface PlannedItem {
  kind: DataItem['kind']
  name: string
  unit: string
}

/**
 * 고객 요구에 맞춰 실험에 미리 만들어 둘 항목. 이미 같은 이름의 항목이 있으면 만들지 않는다.
 * - 요구가 가리키는 항목: 이름이 이미 조건으로 있으면 그대로 두고, 없으면 결과 항목으로 만든다(값은 비워 둔다).
 * - 적용 조건(예: 재령)은 조건 항목으로 만든다.
 * 이렇게 해 두면 실험을 만들자마자 "무엇을 재야 하는지"가 빈 칸으로 보여 측정을 빠뜨리지 않는다.
 */
export function planRequirementItems(reqs: Requirement[], existing: { kind: DataItem['kind']; name: string }[]): PlannedItem[] {
  const have = new Set(existing.map((i) => normalizeName(i.name)))
  const out: PlannedItem[] = []
  const add = (kind: DataItem['kind'], name: string, unit: string) => {
    const key = normalizeName(name)
    if (!key || have.has(key)) return
    have.add(key)
    out.push({ kind, name: name.trim(), unit })
  }
  for (const r of reqs) {
    if (r.at) add('condition', r.at.name, '')
  }
  for (const r of reqs) add('result', r.name, r.unit)
  return out
}

/** 계획한 항목을 실험 뒤에 이어서 만든다. 만든 개수를 돌려준다. */
export async function applyRequirementItems(db: DataBackend, experimentId: ID, reqs: Requirement[]): Promise<number> {
  if (reqs.length === 0) return 0
  const existing = await db.dataItems.listByExperiment(experimentId)
  const planned = planRequirementItems(reqs, existing)
  const next = (kind: DataItem['kind']) => existing.filter((i) => i.kind === kind).reduce((m, i) => Math.max(m, i.order), 0)
  const orders = { condition: next('condition'), result: next('result') }
  for (const p of planned) {
    await db.dataItems.create({ experimentId, kind: p.kind, order: ++orders[p.kind], name: p.name, value: '', unit: p.unit })
  }
  return planned.length
}
