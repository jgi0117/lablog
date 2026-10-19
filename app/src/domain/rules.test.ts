import { describe, expect, it } from 'vitest'
import { canTransition, completionWarnings, isPurgeable } from './rules'

describe('canTransition', () => {
  it('준비 → 진행 → 완료로 간다', () => {
    expect(canTransition('ready', 'running')).toBe(true)
    expect(canTransition('running', 'done')).toBe(true)
  })
  it('완료에서 다시 진행으로 재개할 수 있다', () => {
    expect(canTransition('done', 'running')).toBe(true)
  })
  it('준비에서 바로 완료로 갈 수 없다', () => {
    expect(canTransition('ready', 'done')).toBe(false)
    expect(canTransition('done', 'ready')).toBe(false)
  })
})

describe('isPurgeable', () => {
  const now = new Date('2026-11-20T00:00:00.000Z')
  it('삭제하지 않은 레코드는 대상이 아니다', () => {
    expect(isPurgeable(null, now)).toBe(false)
  })
  it('30일이 지나야 영구 삭제 대상이 된다', () => {
    expect(isPurgeable('2026-10-22T00:00:00.000Z', now)).toBe(false) // 29일
    expect(isPurgeable('2026-10-21T00:00:00.000Z', now)).toBe(true) // 30일
  })
})

describe('completionWarnings', () => {
  it('미완료 단계와 빈 결과를 센다', () => {
    const out = completionWarnings(
      [{ done: true }, { done: false }, { done: false }],
      [{ value: '42.3' }, { value: '' }, { value: '—' }],
    )
    expect(out).toEqual({ openSteps: 2, emptyResults: 2 })
  })
})
