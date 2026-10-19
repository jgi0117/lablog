import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import { defaultExampleSet, seedDemo } from '../data/seed'
import { countExampleData, removeExampleData, seedFirstRun } from './firstRun'

const opened: LocalBackend[] = []
function make(): LocalBackend {
  const b = createLocalBackend(`lablog-first-${Date.now()}-${Math.random()}`)
  opened.push(b)
  return b
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  while (opened.length) opened.pop()?.close()
})

const exp = { projectId: null, purpose: '', owner: '', tags: [], status: 'ready' as const, startedAt: null, completedAt: null, sourceExperimentId: null }

describe('처음 여는 브라우저의 예시 데이터', () => {
  it('데이터가 하나도 없으면 예시를 한 번 넣고, 다시 불러도 늘지 않는다', async () => {
    const b = make()
    expect(await seedFirstRun(b, seedDemo)).toBe(true)
    expect((await b.experiments.list()).total).toBe(200)
    expect(await b.projects.list()).toHaveLength(4)
    expect(await seedFirstRun(b, seedDemo)).toBe(false)
    expect((await b.experiments.list()).total).toBe(200)
  })

  it('이미 기록이 있으면 예시를 섞지 않는다', async () => {
    const b = make()
    await b.experiments.create({ ...exp, title: '내 실험' })
    expect(await seedFirstRun(b, seedDemo)).toBe(false)
    expect((await b.experiments.list()).total).toBe(1)
  })

  it('휴지통에만 기록이 있어도 섞지 않는다', async () => {
    const b = make()
    const e = await b.experiments.create({ ...exp, title: '지운 실험' })
    await b.experiments.softDelete(e.id)
    expect(await seedFirstRun(b, seedDemo)).toBe(false)
    expect((await b.experiments.list()).total).toBe(0)
  })

  it('예시를 지운 뒤에는 다시 넣지 않는다', async () => {
    const b = make()
    await seedFirstRun(b, seedDemo)
    expect(await removeExampleData(b)).toBe(200)
    expect(await seedFirstRun(b, seedDemo)).toBe(false)
    expect((await b.experiments.list()).total).toBe(0)
  })

  it('넣는 데 실패하면 표시를 남기지 않아 다음에 다시 시도한다', async () => {
    const b = make()
    await expect(seedFirstRun(b, async () => Promise.reject(new Error('실패')))).rejects.toThrow()
    expect(await seedFirstRun(b, seedDemo)).toBe(true)
  })
})

describe('예시 구성이 바뀐 뒤의 첫 실행', () => {
  it('시험에서는 고른 200건 구성, 기본(앱)은 전체 1,030건 구성이다', () => {
    expect(defaultExampleSet()).toBe('demo') // vitest는 VITE_EXAMPLE_SET=curated
  })

  it('예전 구성의 예시만 있으면 새 구성(전체 1,030건)으로 바꾼다', async () => {
    const b = make()
    await seedDemo(b, 'demo') // 예전 구성이 들어 있다고 본다
    localStorage.setItem('lablog:example-seeded', 'seeded')
    expect(await seedFirstRun(b, (x) => seedDemo(x, 'full'))).toBe(true)
    expect((await b.experiments.list()).total).toBe(1030)
    expect((await b.projects.list()).filter((p) => p.id.startsWith('demo-project-'))).toHaveLength(4)
    expect(localStorage.getItem('lablog:example-seeded')).toBe('seeded:2')
    expect(await seedFirstRun(b, (x) => seedDemo(x, 'full'))).toBe(false) // 두 번 바꾸지 않는다
  }, 60000)

  it('직접 만든 기록이 섞여 있으면 예전 예시도 건드리지 않는다', async () => {
    const b = make()
    await seedDemo(b, 'demo')
    await b.experiments.create({ ...exp, title: '내 실험' })
    localStorage.setItem('lablog:example-seeded', 'seeded')
    expect(await seedFirstRun(b, (x) => seedDemo(x, 'full'))).toBe(false)
    expect((await b.experiments.list()).total).toBe(201)
    expect(localStorage.getItem('lablog:example-seeded')).toBe('existing')
  })

  it('예전에 예시를 지운 브라우저에는 다시 넣지 않는다', async () => {
    const b = make()
    localStorage.setItem('lablog:example-seeded', 'seeded')
    expect(await seedFirstRun(b, seedDemo)).toBe(false)
    expect((await b.experiments.list()).total).toBe(0)
    expect(localStorage.getItem('lablog:example-seeded')).toBe('seeded:2')
  })
})

describe('예시를 지운 뒤 다시 넣기', () => {
  it('프로젝트까지 되살아나서 실험이 프로젝트 없이 떠 있지 않는다', async () => {
    const b = make()
    await seedDemo(b)
    await removeExampleData(b)
    expect(await b.projects.list()).toHaveLength(0)
    await seedDemo(b)
    expect((await b.projects.list()).map((p) => p.name).sort()).toEqual(['로히트 플라이 LF-20', '스탠다드믹스 SM-00', '에코슬래그 ES-30', '하이브리드본드 HB-50'].sort())
    expect((await b.experiments.list({ projectId: 'demo-project-1' })).total).toBe(50)
  })
})

describe('예시 데이터 지우기', () => {
  it('예시만 지우고 직접 만든 실험과 프로젝트는 남긴다', async () => {
    const b = make()
    await seedDemo(b)
    const mine = await b.experiments.create({ ...exp, title: '내 실험' })
    const myProject = await b.projects.create({ name: '내 프로젝트', description: '' })
    expect(await countExampleData(b)).toEqual({ projects: 4, experiments: 200 })

    expect(await removeExampleData(b)).toBe(200)
    expect(await countExampleData(b)).toEqual({ projects: 0, experiments: 0 })
    expect((await b.experiments.list()).items.map((e) => e.id)).toEqual([mine.id])
    expect((await b.projects.list()).map((p) => p.id)).toEqual([myProject.id])
    // 휴지통에도 남지 않는다
    expect((await b.experiments.list({ deleted: 'only' })).total).toBe(0)
    // 딸린 데이터도 사라졌다
    const file = await b.backup.exportAll()
    expect(file.steps).toEqual([])
    expect(file.dataItems).toEqual([])
  })
})
