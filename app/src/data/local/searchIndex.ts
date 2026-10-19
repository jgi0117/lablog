import type { SearchHit } from '../repositories'
import type { LablogDB } from './db'
import { normalize } from './util'
import type { DataItem, Experiment, ID, Step } from '../../domain/types'

interface Doc {
  exp: Experiment
  titleN: string
  purposeN: string
  tagsN: string[]
  steps: { order: number; content: string; contentN: string; note: string; noteN: string }[]
  items: { kind: 'condition' | 'result'; text: string; textN: string }[]
}

function build(exp: Experiment, steps: Step[], items: DataItem[]): Doc {
  return {
    exp,
    titleN: normalize(exp.title),
    purposeN: normalize(exp.purpose),
    tagsN: exp.tags.map(normalize),
    steps: [...steps]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ order: s.order, content: s.content, contentN: normalize(s.content), note: s.note, noteN: normalize(s.note) })),
    items: items.map((d) => {
      const text = `${d.name} ${d.value} ${d.unit}`.trim()
      return { kind: d.kind, text, textN: normalize(text) }
    }),
  }
}

function groupBy<T extends { experimentId: ID }>(rows: T[]): Map<ID, T[]> {
  const m = new Map<ID, T[]>()
  for (const r of rows) {
    const list = m.get(r.experimentId)
    if (list) list.push(r)
    else m.set(r.experimentId, [r])
  }
  return m
}

/**
 * 검색용 메모리 색인. 실험마다 글자를 한 번만 정규화해 두고, 데이터가 바뀐 실험만 다시 만든다.
 * 변경 감지는 Dexie 훅으로 한다(생성·수정·삭제 모두). clear나 통째 가져오기는 invalidateAll을 부른다.
 */
export function createSearchIndex(db: LablogDB) {
  const docs = new Map<ID, Doc>()
  const stale = new Set<ID>()

  db.experiments.hook('creating', (id) => {
    stale.add(id as ID)
  })
  db.experiments.hook('updating', (_mods, id) => {
    stale.add(id as ID)
  })
  db.experiments.hook('deleting', (id) => {
    stale.add(id as ID)
  })
  for (const table of [db.steps, db.dataItems] as const) {
    table.hook('creating', (_id, obj) => {
      stale.add(obj.experimentId)
    })
    table.hook('updating', (_mods, _id, obj) => {
      stale.add(obj.experimentId)
    })
    table.hook('deleting', (_id, obj) => {
      stale.add(obj.experimentId)
    })
  }

  async function docsFor(exps: Experiment[]): Promise<Doc[]> {
    const need = exps.filter((e) => !docs.has(e.id) || stale.has(e.id))
    if (need.length > 0) {
      const ids = need.map((e) => e.id)
      const many = ids.length > 50
      const [steps, items] = await Promise.all([
        many ? db.steps.toArray() : db.steps.where('experimentId').anyOf(ids).toArray(),
        many ? db.dataItems.toArray() : db.dataItems.where('experimentId').anyOf(ids).toArray(),
      ])
      const stepsBy = groupBy(steps)
      const itemsBy = groupBy(items)
      for (const e of need) {
        docs.set(e.id, build(e, stepsBy.get(e.id) ?? [], itemsBy.get(e.id) ?? []))
        stale.delete(e.id)
      }
    }
    return exps.map((e) => docs.get(e.id) as Doc)
  }

  return {
    invalidateAll() {
      docs.clear()
      stale.clear()
    },

    /** exps는 이미 필터링된(휴지통 제외) 실험 목록. 점수 높은 순, 같으면 최근 수정순. */
    async search(query: string, exps: Experiment[]): Promise<SearchHit[]> {
      const q = normalize(query)
      if (!q || exps.length === 0) return []
      const list = await docsFor(exps)
      const hits: SearchHit[] = []
      for (const d of list) {
        const matches: SearchHit['matches'] = []
        let score = 0
        if (d.titleN.includes(q)) {
          matches.push({ field: 'title', text: d.exp.title })
          score += 5
        }
        if (d.exp.purpose && d.purposeN.includes(q)) {
          matches.push({ field: 'purpose', text: d.exp.purpose })
          score += 2
        }
        d.tagsN.forEach((t, i) => {
          if (t.includes(q)) {
            matches.push({ field: 'tag', text: d.exp.tags[i] })
            score += 3
          }
        })
        for (const s of d.steps) {
          if (s.contentN.includes(q)) {
            matches.push({ field: 'step', text: s.content, stepOrder: s.order })
            score += 2
          }
          if (s.note && s.noteN.includes(q)) {
            matches.push({ field: 'note', text: s.note, stepOrder: s.order })
            score += 2
          }
        }
        for (const it of d.items) {
          if (it.textN.includes(q)) {
            matches.push({ field: it.kind, text: it.text })
            score += 2
          }
        }
        if (matches.length) hits.push({ experimentId: d.exp.id, matches, score })
      }
      const updated = new Map(exps.map((e) => [e.id, e.updatedAt]))
      return hits.sort((a, b) => b.score - a.score || (updated.get(b.experimentId) ?? '').localeCompare(updated.get(a.experimentId) ?? ''))
    },
  }
}
