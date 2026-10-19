import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import { seedDemo } from '../data/seed'
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
    expect((await b.experiments.list()).total).toBe(48)
    expect(await b.projects.list()).toHaveLength(4)
    expect(await seedFirstRun(b, seedDemo)).toBe(false)
    expect((await b.experiments.list()).total).toBe(48)
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
    expect(await removeExampleData(b)).toBe(48)
    expect(await seedFirstRun(b, seedDemo)).toBe(false)
    expect((await b.experiments.list()).total).toBe(0)
  })

  it('넣는 데 실패하면 표시를 남기지 않아 다음에 다시 시도한다', async () => {
    const b = make()
    await expect(seedFirstRun(b, async () => Promise.reject(new Error('실패')))).rejects.toThrow()
    expect(await seedFirstRun(b, seedDemo)).toBe(true)
  })
})

describe('예시 데이터 지우기', () => {
  it('예시만 지우고 직접 만든 실험과 프로젝트는 남긴다', async () => {
    const b = make()
    await seedDemo(b)
    const mine = await b.experiments.create({ ...exp, title: '내 실험' })
    const myProject = await b.projects.create({ name: '내 프로젝트', description: '' })
    expect(await countExampleData(b)).toEqual({ projects: 4, experiments: 48 })

    expect(await removeExampleData(b)).toBe(48)
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
