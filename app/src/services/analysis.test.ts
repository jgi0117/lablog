import { afterEach, describe, expect, it } from 'vitest'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import { seedDemo } from '../data/seed'
import {
  buildMatrix,
  detectOutliers,
  findGaps,
  linearFit,
  matrixToCsv,
  median,
  niceTicks,
  scatterPoints,
  statusCounts,
  timelineBars,
  trendPoints,
  type Gap,
} from './analysis'
import { loadAllBundles, loadProjectBundles } from './projectData'

describe('이상치', () => {
  it('중앙값과 MAD로 한참 벗어난 값만 후보로 본다', () => {
    const haze = [0.6, 0.6, 0.7, 0.7, 0.8, 0.9, 1.0, 3.9]
    expect(detectOutliers(haze)).toEqual([false, false, false, false, false, false, false, true])
  })
  it('값이 5개 미만이면 판단하지 않는다', () => {
    expect(detectOutliers([1, 2, 3, 100])).toEqual([false, false, false, false])
  })
  it('대부분 같은 값이어도 조금 다른 정도는 이상치로 보지 않는다', () => {
    expect(detectOutliers([100, 100, 100, 100, 95, 100, 90]).some(Boolean)).toBe(false)
    expect(detectOutliers([80, 80, 80, 80, 80, 80, 8000]).at(-1)).toBe(true)
  })
  it('중앙값', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
})

describe('눈금·직선·CSV', () => {
  it('보기 좋은 눈금을 만든다', () => {
    expect(niceTicks(0.6, 3.9)).toEqual([0, 1, 2, 3, 4])
    expect(niceTicks(80, 100)).toEqual([80, 85, 90, 95, 100])
    expect(niceTicks(5, 5)).toContain(5)
  })
  it('상관계수와 직선', () => {
    const fit = linearFit([
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 6 },
    ])
    expect(fit?.r).toBeCloseTo(1)
    expect(fit?.slope).toBeCloseTo(2)
    expect(
      linearFit([
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toBeNull()
    expect(
      linearFit([
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 1, y: 3 },
      ]),
    ).toBeNull()
  })
})

describe('시연 데이터로 보는 프로젝트 분석', () => {
  const opened: LocalBackend[] = []
  afterEach(() => {
    while (opened.length) opened.pop()?.close()
  })
  async function demo() {
    const db = createLocalBackend(`lablog-analysis-${Date.now()}-${Math.random()}`)
    opened.push(db)
    await seedDemo(db)
    const projects = await db.projects.list()
    return {
      db,
      hc: projects.find((p) => p.name.includes('HC-300'))!,
      ag: projects.find((p) => p.name.includes('AG'))!,
    }
  }

  it('같은 항목은 한 열로 묶고, 조건이 결과보다 앞에 오며, 실험은 시작 순서다', async () => {
    const { db, hc } = await demo()
    const m = buildMatrix(await loadProjectBundles(db, hc.id))
    expect(m.rows).toHaveLength(10)
    const kinds = m.columns.map((c) => c.kind)
    expect(kinds.indexOf('result')).toBe(kinds.lastIndexOf('condition') + 1)
    expect(m.columns.map((c) => c.name)).toEqual(expect.arrayContaining(['건조 온도', '코팅 두께', 'UV 조사량', '건조 시간', '헤이즈', '연필경도']))
    // 시작한 날짜순이라 #9(12일 전 시작)가 #7(9일 전)보다 앞선다.
    expect(m.rows.map((r) => r.experiment.title.match(/#(\d+)/)?.[1])).toEqual(['1', '2', '3', '4', '5', '6', '9', '7', '8', '10'])
  })

  it('이상치는 헤이즈 3.9 한 건뿐이다', async () => {
    const { db, hc } = await demo()
    const m = buildMatrix(await loadProjectBundles(db, hc.id))
    const flagged = m.rows.flatMap((r) =>
      m.columns.filter((c) => r.cells[c.key]?.outlier).map((c) => `${r.experiment.title}|${c.name}|${r.cells[c.key]?.value}`),
    )
    expect(flagged).toEqual(['HC-300 하드코팅 조건 탐색 #8|헤이즈|3.9'])
  })

  it('빠짐 점검이 심어 둔 문제를 찾고 정상 실험은 건드리지 않는다', async () => {
    const { db, hc } = await demo()
    const gaps = findGaps(await loadProjectBundles(db, hc.id))
    const of = (n: number): Gap[] => gaps.filter((g) => g.experimentTitle.endsWith(`#${n}`))
    expect(of(8).map((g) => g.type).sort()).toEqual(['empty-result', 'missing-item', 'outlier'])
    expect(of(8).find((g) => g.type === 'empty-result')?.message).toContain('밀착성')
    expect(of(8).find((g) => g.type === 'missing-item')?.message).toContain('건조 시간')
    expect(of(9).map((g) => g.type).sort()).toEqual(['missing-item', 'stale'])
    expect(of(9).find((g) => g.type === 'stale')?.message).toMatch(/1[0-9]일/)
    for (const n of [1, 2, 3, 4, 5, 6, 7, 10]) expect(of(n)).toEqual([])
    expect(gaps[0].severity).toBe('high') // 심각한 것부터
  })

  it('결과 없이 완료했거나 미완료 단계가 남은 완료 실험을 알린다', () => {
    const base = { createdAt: '', updatedAt: new Date().toISOString(), deletedAt: null, version: 1 }
    const experiment = {
      ...base,
      id: 'e1',
      projectId: null,
      title: '기록 누락',
      purpose: '',
      owner: '',
      tags: [],
      status: 'done' as const,
      startedAt: new Date().toISOString(),
      completedAt: null,
      sourceExperimentId: null,
    }
    const steps = [{ ...base, id: 's1', experimentId: 'e1', order: 1, content: 'a', done: false, doneAt: null, note: '' }]
    const gaps = findGaps([{ experiment, steps, items: [] }])
    expect(gaps.map((g) => g.type).sort()).toEqual(['no-result', 'open-steps'])
  })

  it('두 항목의 점과 순서별 추세를 만든다', async () => {
    const { db, ag, hc } = await demo()
    const agm = buildMatrix(await loadProjectBundles(db, ag.id))
    const filler = agm.columns.find((c) => c.name === '필러 함량')!
    const haze = agm.columns.find((c) => c.name === '헤이즈')!
    const pts = scatterPoints(agm, filler.key, haze.key)
    expect(pts.map((p) => [p.x, p.y])).toEqual([
      [2, 6.1],
      [4, 12.4],
      [6, 19.8],
    ])
    expect(linearFit(pts)?.r).toBeGreaterThan(0.99)

    const hcm = buildMatrix(await loadProjectBundles(db, hc.id))
    const tr = trendPoints(hcm, hcm.columns.find((c) => c.name === '투과율')!.key)
    expect(tr).toHaveLength(8)
    expect(tr.map((p) => p.x)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('타임라인과 상태별 개수', async () => {
    const { db } = await demo()
    const all = await loadAllBundles(db)
    expect(all).toHaveLength(17)
    expect(statusCounts(all)).toEqual({ ready: 1, running: 2, done: 14 })
    const bars = timelineBars(all)
    expect(bars).toHaveLength(16) // 아직 시작하지 않은 실험은 막대가 없다
    expect(bars.every((b) => b.end > b.start)).toBe(true)
    expect(bars.filter((b) => b.open)).toHaveLength(2)
  })

  it('CSV는 BOM으로 시작하고 값을 열에 맞춰 담는다', async () => {
    const { db, ag } = await demo()
    const csv = matrixToCsv(buildMatrix(await loadProjectBundles(db, ag.id)))
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const [header, first] = csv.slice(1).split('\r\n')
    expect(header).toContain('필러 함량 (wt%)')
    expect(first).toContain('AG 방현 필름 필러 함량 비교 #1')
    expect(first).toContain('완료')
  })
})
