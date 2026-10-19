import { describe, expect, it } from 'vitest'
import csv from '../data/concrete/concrete.csv?raw'
import { buildConcreteBackup, parseConcreteCsv } from '../data/concreteDemo'
import { buildMatrix, type ExperimentBundle } from './analysis'
import {
  buildInsights,
  columnSummaries,
  compareBy,
  correlationView,
  groupCandidates,
  numericColumns,
  rankDrivers,
  rankedExperiments,
} from './insights'
import { bundlesFromBackup } from './projectData'

const rows = parseConcreteCsv(csv)
const full = buildConcreteBackup(rows, 'full')
const demo = buildConcreteBackup(rows, 'demo')
const matrixOf = (file: typeof full, projectId: string | null) => buildMatrix(bundlesFromBackup(file, (e) => (projectId ? e.projectId === projectId : true)))
const colKey = (m: ReturnType<typeof buildMatrix>, name: string) => m.columns.find((c) => c.name === name)!.key

describe('영향 주는 조건 (공개 콘크리트 데이터 전체)', () => {
  const m = matrixOf(full, null)
  const res = rankDrivers(m, colKey(m, '압축강도'))!

  it('압축강도와 가장 상관이 큰 조건은 시멘트(+), 물(−)은 음의 상관이다', () => {
    expect(res.drivers[0].column.name).toBe('시멘트')
    expect(res.drivers[0].r).toBeGreaterThan(0.45)
    expect(res.drivers[0].p).toBeLessThan(0.001)
    const water = res.drivers.find((d) => d.column.name === '물')!
    expect(water.r).toBeLessThan(-0.25)
    // |r| 큰 순
    const abs = res.drivers.map((d) => Math.abs(d.r))
    expect(abs).toEqual([...abs].sort((a, b) => b - a))
  })

  it('재령은 직선보다 곡선에 가까워서 순위상관이 상관보다 크다', () => {
    const age = res.drivers.find((d) => d.column.name === '재령')!
    expect(age.rho).toBeGreaterThan(age.r + 0.2)
  })

  it('다중회귀는 조건 여러 개로 변동의 절반 이상을 설명하고, 계수가 붙는다', () => {
    expect(res.regression!.r2).toBeGreaterThan(0.5)
    expect(res.regression!.used.length).toBeGreaterThanOrEqual(4)
    const used = res.drivers.filter((d) => d.beta !== null)
    expect(used).toHaveLength(res.regression!.used.length)
  })

  it('결과 항목이나 없는 항목에는 null을 돌려준다', () => {
    expect(rankDrivers(m, 'result:없음')).toBeNull()
    expect(res.drivers.every((d) => d.column.kind === 'condition')).toBe(true)
  })

  it('값이 모자란 조건은 건너뛴다', () => {
    const few = buildMatrix(bundlesFromBackup(demo, (e) => e.projectId === 'demo-project-1').slice(0, 4))
    expect(rankDrivers(few, colKey(few, '압축강도'))!.drivers).toEqual([])
  })
})

describe('그룹 비교', () => {
  const m = matrixOf(full, 'demo-project-2') // 에코슬래그
  it('재령별 강도는 집단 차이가 크다(η² > 0.4)', () => {
    const g = compareBy(m, colKey(m, '재령'), colKey(m, '압축강도'))!
    expect(g.groups.map((x) => x.label)).toEqual(['3 일', '7 일', '28 일', '56 일', '90 일', '91 일', '180 일', '270 일', '360 일', '365 일'])
    expect(g.p).toBeLessThan(0.001)
    expect(g.eta2).toBeGreaterThan(0.4)
    const mean = (label: string) => g.groups.find((x) => x.label === label)!.mean
    expect(mean('28 일')).toBeGreaterThan(mean('3 일'))
  })

  it('값 종류가 너무 많은 조건(연속 값)은 비교하지 않는다', () => {
    expect(compareBy(m, colKey(m, '시멘트'), colKey(m, '압축강도'))).toBeNull()
  })

  it('후보는 η²가 큰 순이고 재령이 들어 있다', () => {
    const list = groupCandidates(m, colKey(m, '압축강도'))
    expect(list.map((g) => g.by.name)).toContain('재령')
    const eta = list.map((g) => g.eta2)
    expect(eta).toEqual([...eta].sort((a, b) => b - a))
  })
})

describe('요약, 상관 행렬, 상·하위', () => {
  const m = matrixOf(demo, 'demo-project-2')
  it('항목마다 요약 통계와 결측, 이상치 개수를 센다', () => {
    const s = columnSummaries(m).find((x) => x.column.name === '압축강도')!
    expect(s.summary!.n).toBe(49 - 1) // 시연 ES 51건 중 진행 2건과 일부러 비운 1건은 값이 없다
    expect(s.missing).toBe(m.rows.length - s.summary!.n)
    expect(s.summary!.min).toBeLessThan(s.summary!.max)
  })

  it('숫자 항목이 5건 이상인 것만 분석 대상이다', () => {
    const names = numericColumns(m).map((c) => c.name)
    expect(names).toEqual(expect.arrayContaining(['시멘트', '물', '재령', '압축강도']))
  })

  it('상관 행렬은 정사각이고 대각선이 1이며 대칭이다', () => {
    const v = correlationView(m)!
    expect(v.cells).toHaveLength(v.columns.length)
    v.cells.forEach((row, i) => {
      expect(row).toHaveLength(v.columns.length)
      expect(row[i]?.r).toBe(1)
      row.forEach((c, j) => expect(c?.r).toBe(v.cells[j][i]?.r))
    })
    // 결과가 맨 뒤
    expect(v.columns[v.columns.length - 1].kind).toBe('result')
  })

  it('높은 순과 낮은 순 실험을 고른다', () => {
    const key = colKey(m, '압축강도')
    const high = rankedExperiments(m, key, 'high', 3)
    const low = rankedExperiments(m, key, 'low', 3)
    expect(high.map((r) => r.value)).toEqual([...high.map((r) => r.value)].sort((a, b) => b - a))
    expect(high[0].value).toBeGreaterThan(low[0].value)
    expect(low).toHaveLength(3)
  })
})

describe('한눈에 읽는 인사이트', () => {
  it('근거(r, p, 실험 수)와 함께 문장을 만들고, 마지막에 상관≠원인 주의를 붙인다', () => {
    const m = matrixOf(full, 'demo-project-2')
    const list = buildInsights(m, colKey(m, '압축강도'))
    const text = list.map((i) => i.text).join('\n')
    expect(text).toMatch(/시멘트/)
    expect(text).toMatch(/r = 0\.\d\d, p < 0\.001, 실험 \d+건/)
    expect(text).toMatch(/재령별로 나누면/)
    expect(text).toMatch(/가장 높은 실험은/)
    expect(list[list.length - 1]).toMatchObject({ kind: 'caution' })
    expect(list[list.length - 1].text).toContain('상관이 곧 원인은 아닙니다')
  })

  it('받침에 맞는 조사를 쓴다', () => {
    const m = matrixOf(full, 'demo-project-2')
    const text = buildInsights(m, colKey(m, '압축강도')).map((i) => i.text).join('\n')
    expect(text).toContain('압축강도와 가장 뚜렷하게') // 받침 없음? "도" 받침 없음 → 와
    expect(text).toContain('시멘트입니다')
    expect(text).not.toMatch(/\(이\)|\(가\)|\(와\)|\(과\)|\(을\)|\(를\)/)
  })

  it('실험이 20건 미만이면 흔들릴 수 있다고 알린다', () => {
    const m = matrixOf(demo, 'demo-project-1')
    const few: ExperimentBundle[] = bundlesFromBackup(demo, (e) => e.projectId === 'demo-project-1').slice(0, 12)
    const fm = buildMatrix(few)
    const list = buildInsights(fm, colKey(fm, '압축강도'))
    expect(list.some((i) => i.kind === 'caution' && i.text.includes('흔들릴 수 있습니다'))).toBe(true)
    void m
  })

  it('없는 항목이면 빈 목록이다', () => {
    expect(buildInsights(matrixOf(demo, null), 'result:없음')).toEqual([])
  })
})
