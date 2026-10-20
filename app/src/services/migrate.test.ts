import { afterEach, describe, expect, it } from 'vitest'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import { createMemoryStore } from '../data/remote/memoryStore'
import { createRemoteBackend } from '../data/remote/remoteBackend'
import { seedDemo } from '../data/seed'
import type { Experiment, NewEntity } from '../domain/types'
import { countsOf, migrateLocalToRemote, previewMigration, totalOf, type MigrationReport } from './migrate'

const opened: LocalBackend[] = []
afterEach(() => {
  while (opened.length) opened.pop()?.close()
})

const local = () => {
  const b = createLocalBackend(`lablog-mig-${Date.now()}-${Math.random()}`)
  opened.push(b)
  return b
}
const exp = (o: Partial<NewEntity<Experiment>> = {}): NewEntity<Experiment> => ({ projectId: null, title: '실험', purpose: '', owner: '', tags: [], status: 'ready', startedAt: null, completedAt: null, sourceExperimentId: null, ...o })

/** 모든 종류의 데이터가 들어 있는 작은 로컬 저장소 */
async function populated() {
  const b = local()
  const p = await b.projects.create({ name: '프로젝트', description: '설명', customer: '고객', requirements: [{ id: 'q', name: '강도', unit: 'MPa', kind: 'min', min: 40, priority: 'must' }] })
  const e1 = await b.experiments.create(exp({ projectId: p.id, title: '첫 실험', tags: ['a'] }))
  const e2 = await b.experiments.duplicate(e1.id, { title: '복제본' })
  await b.steps.create({ experimentId: e1.id, order: 1, content: '단계', done: true, doneAt: new Date().toISOString(), note: '메모' })
  await b.dataItems.create({ experimentId: e1.id, kind: 'condition', order: 1, name: '온도', value: '80', unit: '°C' })
  await b.dataItems.create({ experimentId: e1.id, kind: 'result', order: 1, name: '강도', value: '41.5', unit: 'MPa' })
  await b.deviations.create({ experimentId: e1.id, stepId: null, change: '70도로 낮춤', reason: '변형' })
  await b.templates.create({ name: '표준', steps: [{ content: 'a' }], defaultConditions: [], resultItems: [{ name: '강도', unit: 'MPa' }] })
  await b.experiments.softDelete(e2.id) // 휴지통에 있는 것도 옮긴다
  return b
}

describe('로컬 → 서버 이전', () => {
  it('미리보기: 건수와 이미 서버에 있는 행을 알려 주고 아무것도 바꾸지 않는다', async () => {
    const l = await populated()
    const r = createRemoteBackend(createMemoryStore())
    const pre = await previewMigration(l, r)
    expect(pre.local).toEqual({ projects: 1, experiments: 2, steps: 1, dataItems: 2, deviations: 1, templates: 1 })
    expect(totalOf(pre.remote)).toBe(0)
    expect(pre.alreadyThere).toBe(0)
    expect(totalOf(countsOf(await r.backup.exportAll()))).toBe(0)
  })

  it('모든 종류의 행을 올리고, 내용이 같은지 서버에서 다시 읽어 검증한다', async () => {
    const l = await populated()
    const r = createRemoteBackend(createMemoryStore())
    const steps: string[] = []
    const report = await migrateLocalToRemote(l, r, (s) => steps.push(s.label))
    expect(report.ok).toBe(true)
    expect(report.local).toEqual(report.remoteAfter)
    expect(totalOf(report.missing)).toBe(0)
    expect(report.uploaded).toBe(totalOf(report.local))
    expect(steps[0]).toContain('프로젝트')
    expect(steps[steps.length - 1]).toContain('확인을 마쳤습니다')

    // 내용까지 같다(휴지통, 고객 요구, 복제 원본 연결 포함)
    const lf = await l.backup.exportAll()
    const rf = await r.backup.exportAll()
    const by = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id))
    expect(by(rf.projects)).toEqual(by(lf.projects))
    expect(by(rf.experiments)).toEqual(by(lf.experiments))
    expect(by(rf.steps)).toEqual(by(lf.steps))
    expect(by(rf.dataItems)).toEqual(by(lf.dataItems))
    expect(by(rf.deviations ?? [])).toEqual(by(lf.deviations ?? []))
    expect(by(rf.templates ?? [])).toEqual(by(lf.templates ?? []))
    expect((await r.experiments.list({ deleted: 'only' })).total).toBe(1)
  })

  it('중단했다가 다시 해도 중복되지 않는다(멱등)', async () => {
    const l = await populated()
    const r = createRemoteBackend(createMemoryStore())
    await migrateLocalToRemote(l, r)
    const second = await migrateLocalToRemote(l, r)
    expect(second.ok).toBe(true)
    expect(second.uploaded).toBe(0) // 같은 내용이라 올릴 것이 없다
    expect(second.remoteAfter).toEqual(second.local)
  })

  it('중간에 실패해도 올라간 것은 남고, 다시 하면 이어서 끝난다', async () => {
    const l = await populated()
    const store = createMemoryStore()
    const r = createRemoteBackend(store)
    // 실험 표를 올릴 때 서버가 오류를 내도록 한 번만 망가뜨린다
    const original = store.upsert
    let broke = false
    store.upsert = async (table, rows) => {
      if (table === 'experiments' && !broke) {
        broke = true
        throw new Error('네트워크가 끊겼습니다')
      }
      return original(table, rows)
    }
    await expect(migrateLocalToRemote(l, r)).rejects.toThrow('끊겼습니다')
    expect(countsOf(await r.backup.exportAll()).projects).toBe(1) // 프로젝트는 이미 올라갔다
    const report = await migrateLocalToRemote(l, r)
    expect(report.ok).toBe(true)
    expect(report.remoteAfter).toEqual(report.local)
  })

  it('서버에 더 최신 내용이 있으면 덮어쓰지 않고 알려 준다', async () => {
    const l = await populated()
    const r = createRemoteBackend(createMemoryStore())
    await migrateLocalToRemote(l, r)
    const [proj] = await r.projects.list()
    await r.projects.update(proj.id, { name: '서버에서 고친 이름' })
    const report = await migrateLocalToRemote(l, r)
    expect(report.keptNewerOnServer).toBe(1)
    expect((await r.projects.list())[0].name).toBe('서버에서 고친 이름')
    expect(report.ok).toBe(true)
  })

  it('실제 예시 데이터(실험 200건, 단계·조건·결과 수천 건)도 건수와 내용이 맞는다', async () => {
    const l = local()
    await seedDemo(l) // 시험은 고른 200건 구성
    const r = createRemoteBackend(createMemoryStore())
    const report = await migrateLocalToRemote(l, r)
    expect(report.ok).toBe(true)
    expect(report.local.experiments).toBe(200)
    expect(report.remoteAfter).toEqual(report.local)
    // 고객 요구가 그대로 올라갔다
    const projects = await r.projects.list()
    expect(projects.every((p) => (p.requirements?.length ?? 0) === 3)).toBe(true)
    // 올린 데이터로 같은 화면 계산이 된다: 실험의 조건·결과를 읽어 비교
    const e = (await l.experiments.list({}, 'title_asc', { limit: 1, offset: 0 })).items[0]
    expect(await r.dataItems.listByExperiment(e.id)).toEqual(await l.dataItems.listByExperiment(e.id))
  }, 60000)

  it('빠진 행이 있으면 ok가 아니다(검증이 실제로 걸러 낸다)', async () => {
    const l = await populated()
    const store = createMemoryStore()
    const r = createRemoteBackend(store)
    // 서버가 단계 표를 조용히 버린다고 가정
    const original = store.upsert
    store.upsert = async (table, rows) => (table === 'steps' ? undefined : original(table, rows))
    const report: MigrationReport = await migrateLocalToRemote(l, r)
    expect(report.ok).toBe(false)
    expect(report.missing.steps).toBe(1)
  })
})
