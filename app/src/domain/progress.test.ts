import { describe, expect, it } from 'vitest'
import { progressPercent } from './progress'

describe('progressPercent', () => {
  it('완료 단계 / 전체 단계를 정수 퍼센트로 반환한다', () => {
    expect(progressPercent(4, 9)).toBe(44)
    expect(progressPercent(9, 9)).toBe(100)
  })
  it('단계가 없으면 0이다', () => {
    expect(progressPercent(0, 0)).toBe(0)
  })
  it('범위를 벗어난 값은 0~100으로 맞춘다', () => {
    expect(progressPercent(12, 9)).toBe(100)
    expect(progressPercent(-1, 9)).toBe(0)
  })
})
