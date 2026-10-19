import { describe, expect, it } from 'vitest'
import {
  compareGroups,
  correlationMatrix,
  fSurvivalP,
  formatP,
  histogram,
  pearson,
  quantile,
  ranks,
  regressStandardized,
  spearman,
  summarize,
  tTwoSidedP,
} from './stats'

describe('기술통계', () => {
  it('평균, 표준편차, 사분위수를 구한다 (엑셀 QUARTILE.INC와 같은 방식)', () => {
    const s = summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])!
    expect(s.n).toBe(10)
    expect(s.mean).toBeCloseTo(5.5, 10)
    expect(s.sd).toBeCloseTo(3.0276503541, 8)
    expect(s.median).toBe(5.5)
    expect(s.q1).toBeCloseTo(3.25, 10)
    expect(s.q3).toBeCloseTo(7.75, 10)
    expect(s.cv).toBeCloseTo(3.0276503541 / 5.5, 8)
  })

  it('값이 하나이거나 없거나 평균이 0인 경우를 다룬다', () => {
    expect(summarize([])).toBeNull()
    expect(summarize([NaN])).toBeNull()
    const one = summarize([4])!
    expect([one.sd, one.min, one.max, one.median]).toEqual([0, 4, 4, 4])
    expect(summarize([-1, 1])!.cv).toBeNull()
    expect(quantile([1, 3], 0.5)).toBe(2)
  })
})

describe('p-값 계산', () => {
  it('t 분포: 알려진 값과 맞는다', () => {
    expect(tTwoSidedP(2.1213203, 3)).toBeCloseTo(0.124, 3)
    expect(tTwoSidedP(0, 10)).toBeCloseTo(1, 10)
    expect(tTwoSidedP(12.706, 1)).toBeCloseTo(0.05, 3) // 자유도 1의 95% 임계값
    expect(tTwoSidedP(2.228, 10)).toBeCloseTo(0.05, 3)
  })

  it('F 분포: F=13, 자유도(2, 6)', () => {
    expect(fSurvivalP(13, 2, 6)).toBeCloseTo(0.00659, 4)
  })
})

describe('상관과 회귀', () => {
  it('피어슨 상관: 교과서 예제 (r=0.7746, p=0.124)', () => {
    const c = pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5])!
    expect(c.r).toBeCloseTo(0.774597, 5)
    expect(c.p).toBeCloseTo(0.124, 3)
    expect(c.slope).toBeCloseTo(0.6, 10)
    expect(c.intercept).toBeCloseTo(2.2, 10)
    expect(c.r2).toBeCloseTo(0.6, 10)
  })

  it('완전한 직선은 r=±1, p=0이다', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toMatchObject({ r: 1, p: 0 })
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])?.r).toBe(-1)
  })

  it('계산할 수 없으면 null이다 (3쌍 미만, 한 쪽이 모두 같은 값)', () => {
    expect(pearson([1, 2], [1, 2])).toBeNull()
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull()
  })

  it('순위는 같은 값에 평균 순위를 준다', () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4])
  })

  it('스피어먼은 곡선이어도 한 방향이면 1이다', () => {
    const xs = [1, 2, 3, 4, 5, 6]
    expect(spearman(xs, xs.map((x) => x ** 3))?.rho).toBeCloseTo(1, 10)
    expect(pearson(xs, xs.map((x) => x ** 3))!.r).toBeLessThan(1)
  })

  it('상관 행렬: 대각선은 1, 값이 모자란 칸은 null, 결측은 쌍 단위로 뺀다', () => {
    const m = correlationMatrix(
      [
        { key: 'a', values: [1, 2, 3, 4, 5, 6] },
        { key: 'b', values: [2, 4, 6, 8, 10, null] },
        { key: 'c', values: [null, null, null, 1, 2, 3] },
      ],
      5,
    )
    expect(m[0][0]?.r).toBe(1)
    expect(m[0][1]).toMatchObject({ r: 1, n: 5 })
    expect(m[0][2]).toBeNull() // 겹치는 실험이 3건뿐
    expect(m[1][0]?.r).toBe(m[0][1]?.r)
  })

  it('다중회귀: 두 조건이 결과를 정확히 만들면 R²=1, 실험이 모자라면 null', () => {
    const X: number[][] = []
    const y: number[] = []
    for (let i = 0; i < 12; i++) {
      const a = i
      const b = (i * 7) % 5
      X.push([a, b])
      y.push(3 * a + 2 * b + 1)
    }
    const r = regressStandardized(X, y)!
    expect(r.r2).toBeCloseTo(1, 8)
    expect(r.coefs[0].beta).toBeGreaterThan(r.coefs[1].beta)
    expect(regressStandardized(X.slice(0, 5), y.slice(0, 5))).toBeNull()
  })

  it('다중회귀: 조건 하나만 영향을 주면 그 조건의 계수만 크고 p가 작다', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 2
    const X: number[][] = []
    const y: number[] = []
    for (let i = 0; i < 60; i++) {
      const a = rnd()
      const b = rnd()
      X.push([a, b])
      y.push(2 * a + 0.1 * rnd())
    }
    const r = regressStandardized(X, y)!
    expect(r.r2).toBeGreaterThan(0.95)
    expect(Math.abs(r.coefs[0].beta)).toBeGreaterThan(0.9)
    expect(Math.abs(r.coefs[1].beta)).toBeLessThan(0.1)
    expect(r.coefs[0].p).toBeLessThan(0.001)
    expect(r.coefs[1].p).toBeGreaterThan(0.05)
  })

  it('조건끼리 똑같은 정보이면 풀지 않는다', () => {
    const X = Array.from({ length: 12 }, (_, i) => [i, i * 2])
    expect(regressStandardized(X, X.map((_, i) => i + (i % 3)))).toBeNull()
  })
})

describe('그룹 비교', () => {
  it('일원분산분석: F=13, p≈0.0066, η²=26/32', () => {
    const c = compareGroups([
      { label: 'A', values: [1, 2, 3] },
      { label: 'B', values: [2, 3, 4] },
      { label: 'C', values: [5, 6, 7] },
    ])!
    expect(c.f).toBeCloseTo(13, 10)
    expect(c.p).toBeCloseTo(0.00659, 4)
    expect(c.df1).toBe(2)
    expect(c.df2).toBe(6)
    expect(c.eta2).toBeCloseTo(26 / 32, 10)
    expect(c.groups.map((g) => [g.label, g.mean])).toEqual([['A', 2], ['B', 3], ['C', 6]])
  })

  it('값이 하나뿐인 집단은 빼고, 비교할 집단이 모자라면 null이다', () => {
    expect(compareGroups([{ label: 'A', values: [1, 2, 3] }, { label: 'B', values: [9] }])).toBeNull()
    const c = compareGroups([{ label: 'A', values: [1, 2, 3] }, { label: 'B', values: [4, 5, 6] }, { label: 'C', values: [9] }])!
    expect(c.groups.map((g) => g.label)).toEqual(['A', 'B'])
  })

  it('집단 안이 모두 같은 값이면 무한대 F 대신 p=0으로 다룬다', () => {
    const c = compareGroups([{ label: 'A', values: [1, 1] }, { label: 'B', values: [2, 2] }])!
    expect(c.p).toBe(0)
    expect(c.eta2).toBe(1)
  })
})

describe('히스토그램', () => {
  it('값을 구간에 빠짐없이 센다', () => {
    const h = histogram([1, 2, 2, 3, 3, 3, 4, 4, 4, 4])!
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(10)
    expect(h.edges[0]).toBe(1)
    expect(h.edges[h.edges.length - 1]).toBe(4)
    expect(h.counts.length).toBe(h.edges.length - 1)
  })

  it('값이 모두 같거나 없는 경우', () => {
    expect(histogram([])).toBeNull()
    expect(histogram([5, 5, 5])).toEqual({ edges: [4.5, 5.5], counts: [3] })
  })
})

describe('표시', () => {
  it('p-값을 읽기 쉽게 쓴다', () => {
    expect(formatP(0.0004)).toBe('p < 0.001')
    expect(formatP(0.0456)).toBe('p = 0.046')
    expect(formatP(NaN)).toBe('—')
  })
})
