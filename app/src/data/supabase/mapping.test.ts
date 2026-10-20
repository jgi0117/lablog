import { describe, expect, it } from 'vitest'
import type { DataItem, Deviation, Experiment, Project, Step, Template } from '../../domain/types'
import type { TableName } from '../remote/store'
import { columnOf, fromRow, isoOf, TABLE_NAME, toRow } from './mapping'

const base = { createdAt: '2026-10-19T05:32:08.123Z', updatedAt: '2026-10-20T01:02:03.456Z', deletedAt: null, version: 3 }

/** 서버가 시각을 돌려주는 모양(+00:00, 마이크로초 자리 0)으로 바꿔 본다 */
const asServer = (row: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(v) ? v.replace('Z', '000+00:00') : v]))

const samples: [TableName, unknown][] = [
  ['projects', { ...base, id: 'p1', name: '프로젝트', description: '설명', customer: '고객', requirements: [{ id: 'q', name: '강도', unit: 'MPa', kind: 'min', min: 40, at: { name: '재령', value: 28 }, priority: 'must' }] } satisfies Project],
  ['projects', { ...base, id: 'p2', name: '고객·요구 없음', description: '' } satisfies Project],
  ['experiments', { ...base, id: 'e1', projectId: 'p1', title: '실험', purpose: '목적', owner: '지윤', tags: ['a', 'b'], status: 'running', startedAt: '2026-10-01T00:00:00.000Z', completedAt: null, sourceExperimentId: null } satisfies Experiment],
  ['experiments', { ...base, id: 'e2', projectId: null, title: '프로젝트 없음', purpose: '', owner: '', tags: [], status: 'done', startedAt: null, completedAt: '2026-10-02T00:00:00.000Z', sourceExperimentId: 'e1', deletedAt: '2026-10-03T00:00:00.000Z' } satisfies Experiment],
  ['steps', { ...base, id: 's1', experimentId: 'e1', order: 2, content: '단계', done: true, doneAt: '2026-10-04T00:00:00.000Z', note: '메모' } satisfies Step],
  ['dataItems', { ...base, id: 'd1', experimentId: 'e1', kind: 'result', order: 3, name: '강도', value: '41.5', unit: 'MPa' } satisfies DataItem],
  ['templates', { ...base, id: 't1', name: '표준', steps: [{ content: 'a' }], defaultConditions: [{ name: '온도', value: '80', unit: '°C' }], resultItems: [{ name: '강도', unit: 'MPa' }] } satisfies Template],
  ['deviations', { ...base, id: 'v1', experimentId: 'e1', stepId: 's1', change: '70도로', reason: '변형' } satisfies Deviation],
]

describe('앱 모양 ↔ DB 행', () => {
  for (const [table, entity] of samples) {
    it(`${table}: 갔다 오면 같다 (${(entity as { id: string }).id})`, () => {
      const row = toRow(table, entity as never)
      expect(fromRow(table, asServer(row))).toEqual(entity)
    })
  }

  it('열 이름은 snake_case이고 owner_id는 보내지 않는다', () => {
    const row = toRow('experiments', samples[2][1] as never)
    expect(Object.keys(row).sort()).toEqual(
      ['assignee', 'completed_at', 'created_at', 'deleted_at', 'id', 'project_id', 'source_experiment_id', 'started_at', 'status', 'tags', 'title', 'purpose', 'updated_at', 'version'].sort(),
    )
    expect(row.assignee).toBe('지윤') // 앱의 owner(담당자)
    expect(row).not.toHaveProperty('owner_id')
    expect(row).not.toHaveProperty('owner')
    const step = toRow('steps', samples[4][1] as never)
    expect(step.step_order).toBe(2)
    expect(step).not.toHaveProperty('order') // SQL 예약어라 쓰지 않는다
    expect(toRow('dataItems', samples[5][1] as never).item_order).toBe(3)
  })

  it('표 이름과 조회 필드를 DB 이름으로 바꾼다', () => {
    expect(TABLE_NAME.dataItems).toBe('data_items')
    expect(columnOf('experimentId')).toBe('experiment_id')
    expect(columnOf('deletedAt')).toBe('deleted_at')
    expect(() => columnOf('임의의필드')).toThrow('조회 조건')
  })

  it('서버의 시각 표기를 앱의 표기로 맞춘다(글자 비교로 최신을 가리므로 중요하다)', () => {
    expect(isoOf('2026-10-19T05:32:08.123456+00:00')).toBe('2026-10-19T05:32:08.123Z')
    expect(isoOf('2026-10-19T14:32:08.123+09:00')).toBe('2026-10-19T05:32:08.123Z')
    expect(isoOf(null)).toBeNull()
    expect(isoOf('이상한 값')).toBe('이상한 값')
  })

  it('서버에 값이 비어 있어도(null, 빠진 열) 앱 모양을 지킨다', () => {
    const e = fromRow<Experiment>('experiments', { id: 'x', created_at: base.createdAt, updated_at: base.updatedAt, deleted_at: null, version: 1, title: 't', status: 'ready', tags: null })
    expect(e).toMatchObject({ projectId: null, purpose: '', owner: '', tags: [], startedAt: null, completedAt: null, sourceExperimentId: null })
    const p = fromRow<Project>('projects', { id: 'p', created_at: base.createdAt, updated_at: base.updatedAt, deleted_at: null, version: 1, name: 'n', requirements: null })
    expect(p).not.toHaveProperty('requirements')
    expect(p).not.toHaveProperty('customer')
  })
})
