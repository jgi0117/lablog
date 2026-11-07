import type { DataBackend } from '../data/repositories'
import type { ID } from '../domain/types'
import { normalizeName } from './analysis'

/**
 * 제안받은(또는 직접 정한) 조건 값을 들고 "새 실험" 화면으로 가서, 실험을 만들자마자 조건 항목에 채워 넣는다.
 * 주소의 cond 매개변수에 JSON으로 싣는다. 이름이 같은 조건 항목이 이미 있으면(이어받기·템플릿) 값만 바꾼다.
 */

export interface PrefillCondition {
  name: string
  value: string
  unit: string
}

export function conditionsHref(projectId: ID, conds: PrefillCondition[]): string {
  return `/experiments/new?project=${encodeURIComponent(projectId)}&cond=${encodeURIComponent(JSON.stringify(conds))}`
}

/** 주소에서 조건 목록을 읽는다. 모양이 이상하면 빈 목록. */
export function parseConditions(raw: string | null): PrefillCondition[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
      .map((c) => ({ name: String(c.name ?? '').trim(), value: String(c.value ?? '').trim(), unit: String(c.unit ?? '').trim() }))
      .filter((c) => c.name)
  } catch {
    return []
  }
}

/** 실험의 조건 항목에 값을 채운다. 같은 이름이 있으면 값(과 빈 단위)을 바꾸고, 없으면 조건 항목을 새로 만든다. 만들거나 바꾼 개수를 돌려준다. */
export async function applyConditions(db: DataBackend, experimentId: ID, conds: PrefillCondition[]): Promise<number> {
  if (conds.length === 0) return 0
  const existing = await db.dataItems.listByExperiment(experimentId)
  let order = existing.filter((i) => i.kind === 'condition').reduce((m, i) => Math.max(m, i.order), 0)
  let n = 0
  for (const c of conds) {
    const key = normalizeName(c.name)
    const hit = existing.find((i) => i.kind === 'condition' && normalizeName(i.name) === key)
    if (hit) {
      if (hit.value !== c.value || (!hit.unit && c.unit)) await db.dataItems.update(hit.id, { value: c.value, ...(!hit.unit && c.unit ? { unit: c.unit } : {}) })
    } else {
      await db.dataItems.create({ experimentId, kind: 'condition', order: ++order, name: c.name, value: c.value, unit: c.unit })
    }
    n++
  }
  return n
}
