import { afterEach, describe, expect, it } from 'vitest'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import csv from '../data/concrete/concrete.csv?raw'
import { ALTERED, DEMO_ROWS, binderOf, parseConcreteCsv } from '../data/concreteDemo'
import { seedConcreteFull, seedDemo } from '../data/seed'
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
  it('정해 둔 수준(재령 3·7·28·90·365일 등)은 실험이 많아도 이상치로 보지 않고, 연속 값은 그대로 판단한다', async () => {
    const { buildConcreteBackup, parseConcreteCsv } = await import('../data/concreteDemo')
    const csv = (await import('../data/concrete/concrete.csv?raw')).default
    const file = buildConcreteBackup(parseConcreteCsv(csv), 'full')
    const { bundlesFromBackup } = await import('./projectData')
    const m = buildMatrix(bundlesFromBackup(file, (e) => e.projectId === 'demo-project-1')) // 시멘트 단독 232건
    const age = m.columns.find((c) => c.name === '재령')!
    expect(m.rows.filter((r) => r.cells[age.key]?.outlier)).toHaveLength(0)
    const water = m.columns.find((c) => c.name === '물')!
    expect(m.rows.filter((r) => r.cells[water.key]?.outlier).length).toBeGreaterThan(0)
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

describe('시연 데이터(UCI 콘크리트)로 보는 프로젝트 분석', () => {
  const opened: LocalBackend[] = []
  const rows = parseConcreteCsv(csv)
  afterEach(() => {
    while (opened.length) opened.pop()?.close()
  })
  async function demo() {
    const db = createLocalBackend(`lablog-analysis-${Date.now()}-${Math.random()}`)
    opened.push(db)
    await seedDemo(db)
    const projects = await db.projects.list()
    const by = (code: string) => projects.find((p) => p.name.includes(code))!
    return { db, sm: by('SM-00'), es: by('ES-30'), lf: by('LF-20'), hb: by('HB-50') }
  }
  const titleOf = (row: number) => `배합 #${row}, 재령 ${rows[row - 1].age}일`

  it('공개 데이터는 1,030행이고 결합재로 나누면 232·334·239·225건이다', () => {
    expect(rows).toHaveLength(1030)
    const n = { SM: 0, ES: 0, LF: 0, HB: 0 }
    for (const r of rows) n[binderOf(r)]++
    expect(n).toEqual({ SM: 232, ES: 334, LF: 239, HB: 225 })
  })

  it('시연에 고른 200건은 각자 맞는 프로젝트의 행이고, 값을 바꾼 곳의 원래 값은 원본과 같다', () => {
    for (const key of Object.keys(DEMO_ROWS) as (keyof typeof DEMO_ROWS)[]) {
      expect(DEMO_ROWS[key].length).toBeGreaterThanOrEqual(49)
      for (const row of DEMO_ROWS[key]) expect(binderOf(rows[row - 1])).toBe(key)
    }
    const all = Object.values(DEMO_ROWS).flat()
    expect(new Set(all).size).toBe(200)
    const original = (row: number) => rows[row - 1]
    expect(ALTERED.map((a) => a.kind)).toEqual(['blank-strength', 'decimal-slip', 'drop-superplasticizer'])
    expect(`${original(400).strength} MPa`).toBe(ALTERED[0].original)
    expect(`${original(205).strength} MPa`).toBe(ALTERED[1].original)
    expect(original(439).superplasticizer).toBeGreaterThan(0)
    for (const a of ALTERED) expect(all).toContain(a.row)
  })

  it('프로젝트 4개에 실험 200건이 들어가고, 설명 첫 줄은 부제목, 끝은 출처 표시다', async () => {
    const { db, sm, hb } = await demo()
    expect((await db.projects.list()).map((p) => p.name).sort()).toEqual(['스탠다드믹스 SM-00', '에코슬래그 ES-30', '로히트 플라이 LF-20', '하이브리드본드 HB-50'].sort())
    const lines = sm.description.split('\n')
    expect(lines[0]).toBe('표준 배합 강도 기준 확립')
    expect(lines[lines.length - 1]).toBe('공개 데이터(UCI 콘크리트) 기반 예시')
    expect(hb.description.split('\n')[0]).toBe('고성능 복합 결합재 콘크리트 개발')
    expect((await db.experiments.list()).total).toBe(200)
  })

  it('전체 1,030건 경로는 프로젝트별로 232·334·239·225건을 넣고, 시연 200건과 겹쳐도 늘지 않는다', async () => {
    const { db } = await demo() // 시연 200건이 먼저 들어 있다
    expect(await seedConcreteFull(db)).toBe(1030)
    expect((await db.experiments.list()).total).toBe(1030)
    const counts: number[] = []
    for (const p of await db.projects.list()) counts.push((await db.experiments.list({ projectId: p.id })).total)
    expect(counts.sort((a, b) => a - b)).toEqual([225, 232, 239, 334])
    // 바꿔 둔 값은 전체 경로에서도 같다
    expect((await db.dataItems.listByExperiment('concrete-205')).find((i) => i.kind === 'result')?.value).toBe('124.7')
  }, 60000)

  it('같은 항목은 한 열로 묶고, 조건이 결과보다 앞에 오며, 실험은 시작 순서다', async () => {
    const { db, es, sm } = await demo()
    const m = buildMatrix(await loadProjectBundles(db, es.id))
    expect(m.rows).toHaveLength(DEMO_ROWS.ES.length)
    const kinds = m.columns.map((c) => c.kind)
    expect(kinds.indexOf('result')).toBe(kinds.lastIndexOf('condition') + 1)
    expect(m.columns.map((c) => c.name).sort()).toEqual(['고로슬래그', '고성능 감수제', '굵은 골재', '물', '시멘트', '압축강도', '잔골재', '재령'].sort())
    expect(m.rows.map((r) => r.experiment.title)).toEqual(DEMO_ROWS.ES.map(titleOf))
    // 슬래그·플라이애시를 쓰지 않는 시멘트 단독 프로젝트에는 그 열이 없다
    const smm = buildMatrix(await loadProjectBundles(db, sm.id))
    expect(smm.columns.map((c) => c.name)).not.toContain('고로슬래그')
    expect(smm.columns.map((c) => c.name)).not.toContain('플라이애시')
  })

  it('이상치는 바꿔 둔 압축강도 124.7 한 건뿐이다', async () => {
    const { db, sm, es, lf, hb } = await demo()
    const flagged: string[] = []
    for (const p of [sm, es, lf, hb]) {
      const m = buildMatrix(await loadProjectBundles(db, p.id))
      for (const r of m.rows) for (const c of m.columns) if (r.cells[c.key]?.outlier) flagged.push(`${r.experiment.title}|${c.name}|${r.cells[c.key]?.value}`)
    }
    expect(flagged).toEqual([`${titleOf(205)}|압축강도|124.7`])
  })

  it('빠짐 점검이 심어 둔 네 가지를 프로젝트마다 찾고, 시멘트 단독 프로젝트는 건드리지 않는다', async () => {
    const { db, sm, es, lf, hb } = await demo()
    const gapsOf = async (p: { id: string }) => findGaps(await loadProjectBundles(db, p.id))
    expect(await gapsOf(sm)).toEqual([])

    const esGaps = await gapsOf(es)
    expect(esGaps.map((g) => [g.type, g.experimentTitle])).toEqual([['empty-result', titleOf(400)]])
    expect(esGaps[0].message).toContain('압축강도')

    const lfGaps = await gapsOf(lf)
    expect(lfGaps.map((g) => [g.type, g.experimentTitle])).toEqual([['outlier', titleOf(205)]])

    const hbGaps: Gap[] = await gapsOf(hb)
    expect(hbGaps.map((g) => [g.type, g.experimentTitle]).sort()).toEqual(
      [
        ['missing-item', titleOf(439)],
        ['stale', titleOf(895)],
      ].sort(),
    )
    expect(hbGaps.find((g) => g.type === 'missing-item')?.message).toContain('고성능 감수제')
    expect(hbGaps.find((g) => g.type === 'stale')?.message).toMatch(/1[0-9]일/)
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
    const { db, sm } = await demo()
    const m = buildMatrix(await loadProjectBundles(db, sm.id))
    const cement = m.columns.find((c) => c.name === '시멘트')!
    const strength = m.columns.find((c) => c.name === '압축강도')!
    const pts = scatterPoints(m, cement.key, strength.key)
    // 시험을 마친 실험만 점이 된다(마지막 두 건은 진행 중이라 결과가 없다)
    const finished = DEMO_ROWS.SM.slice(0, -2)
    expect(pts).toHaveLength(finished.length)
    expect(pts.map((p) => [p.x, p.y])).toEqual(finished.map((row) => [rows[row - 1].cement, rows[row - 1].strength]))
    expect(linearFit(pts)).not.toBeNull()

    const tr = trendPoints(m, strength.key)
    expect(tr).toHaveLength(finished.length)
    expect(tr.map((p) => p.x)).toEqual(finished.map((_, i) => i + 1))
  })

  it('타임라인과 상태별 개수', async () => {
    const { db } = await demo()
    const all = await loadAllBundles(db)
    expect(all).toHaveLength(200)
    expect(statusCounts(all)).toEqual({ ready: 1, running: 8, done: 191 })
    const bars = timelineBars(all)
    expect(bars).toHaveLength(199) // 아직 시작하지 않은 실험은 막대가 없다
    expect(bars.every((b) => b.end > b.start)).toBe(true)
    expect(bars.filter((b) => b.open)).toHaveLength(8)
  })

  it('CSV는 BOM으로 시작하고 값을 열에 맞춰 담는다', async () => {
    const { db, sm } = await demo()
    const csvText = matrixToCsv(buildMatrix(await loadProjectBundles(db, sm.id)))
    expect(csvText.charCodeAt(0)).toBe(0xfeff)
    const [header, first] = csvText.slice(1).split('\r\n')
    expect(header).toContain('시멘트 (kg/m³)')
    expect(header).toContain('압축강도 (MPa)')
    expect(first).toContain(titleOf(DEMO_ROWS.SM[0]))
    expect(first).toContain('완료')
  })
})
