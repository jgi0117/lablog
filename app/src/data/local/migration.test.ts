import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { LablogDB } from './db'
import { createLocalBackend, type LocalBackend } from './localBackend'

/** 배포된 v1 스키마를 그대로 재현한다. 이 블록은 고치지 않는다. */
class V1 extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(1).stores({
      projects: 'id, deletedAt',
      experiments: 'id, status, projectId, updatedAt, deletedAt',
      steps: 'id, experimentId, [experimentId+order], deletedAt',
      dataItems: 'id, experimentId, [experimentId+kind], deletedAt',
    })
  }
}

/** 배포된 v2 스키마를 그대로 재현한다. 이 블록도 고치지 않는다. */
class V2 extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(1).stores({
      projects: 'id, deletedAt',
      experiments: 'id, status, projectId, updatedAt, deletedAt',
      steps: 'id, experimentId, [experimentId+order], deletedAt',
      dataItems: 'id, experimentId, [experimentId+kind], deletedAt',
    })
    this.version(2).stores({
      experiments: 'id, status, projectId, updatedAt, deletedAt, [projectId+updatedAt]',
    })
  }
}

describe('로컬 DB 마이그레이션 (v2 → v3: 템플릿·편차)', () => {
  it('v2 데이터가 그대로 남고 새 표를 바로 쓸 수 있다', async () => {
    const name = `lablog-mig-v3-${Date.now()}`
    const v2 = new V2(name)
    const at = '2026-10-01T00:00:00.000Z'
    await v2.table('experiments').add({ id: 'e1', projectId: null, title: 'v2 실험', purpose: '', owner: '', tags: [], sourceExperimentId: null, status: 'ready', startedAt: null, completedAt: null, createdAt: at, updatedAt: at, deletedAt: null, version: 1 })
    v2.close()

    const backend = createLocalBackend(name)
    try {
      expect((await backend.experiments.get('e1')).title).toBe('v2 실험')
      expect(await backend.templates.list()).toEqual([])
      expect(await backend.deviations.listByExperiment('e1')).toEqual([])
      await backend.deviations.create({ experimentId: 'e1', stepId: null, change: '새 표에 기록', reason: '' })
      expect(await backend.deviations.listByExperiment('e1')).toHaveLength(1)
    } finally {
      backend.close()
    }
  })
})

describe('로컬 DB 마이그레이션 (v1 → v2)', () => {
  const opened: LocalBackend[] = []
  afterEach(() => {
    while (opened.length) opened.pop()?.close()
  })

  async function oldDatabase(name: string) {
    const v1 = new V1(name)
    const at = '2026-09-01T00:00:00.000Z'
    await v1.table('experiments').bulkAdd([
      // tags와 sourceExperimentId가 없던 시절의 기록
      { id: 'old-1', projectId: 'p1', title: '예전 실험', purpose: '', owner: '', status: 'done', startedAt: at, completedAt: at, createdAt: at, updatedAt: at, deletedAt: null, version: 1 },
      { id: 'old-2', projectId: 'p1', title: '태그가 있던 실험', purpose: '', owner: '', tags: ['하드코팅'], sourceExperimentId: null, status: 'ready', startedAt: null, completedAt: null, createdAt: at, updatedAt: '2026-09-05T00:00:00.000Z', deletedAt: null, version: 1 },
    ])
    await v1.table('steps').add({ id: 's1', experimentId: 'old-1', order: 1, content: '도포', done: true, doneAt: at, note: '', createdAt: at, updatedAt: at, deletedAt: null, version: 1 })
    v1.close()
  }

  it('예전 데이터가 그대로 남고 빠져 있던 필드가 채워진다', async () => {
    const name = `lablog-mig-${Date.now()}`
    await oldDatabase(name)
    const db = new LablogDB(name)
    const e = await db.experiments.get('old-1')
    expect(e?.title).toBe('예전 실험')
    expect(e?.tags).toEqual([])
    expect(e?.sourceExperimentId).toBeNull()
    expect((await db.experiments.get('old-2'))?.tags).toEqual(['하드코팅'])
    expect(await db.steps.count()).toBe(1)
    db.close()
  })

  it('새 복합 인덱스로 프로젝트별 최근순 조회가 된다', async () => {
    const name = `lablog-mig-idx-${Date.now()}`
    await oldDatabase(name)
    const db = new LablogDB(name)
    const rows = await db.experiments.where('[projectId+updatedAt]').between(['p1', Dexie.minKey], ['p1', Dexie.maxKey]).reverse().toArray()
    expect(rows.map((r) => r.id)).toEqual(['old-2', 'old-1'])
    db.close()
  })

  it('업그레이드한 DB를 앱의 저장소가 그대로 쓴다', async () => {
    const name = `lablog-mig-app-${Date.now()}`
    await oldDatabase(name)
    const backend = createLocalBackend(name)
    opened.push(backend)
    const list = await backend.experiments.list()
    expect(list.total).toBe(2)
    expect(await backend.steps.listByExperiment('old-1')).toHaveLength(1)
    const made = await backend.experiments.create({ projectId: 'p1', title: '새 실험', purpose: '', owner: '', tags: [], status: 'ready', startedAt: null, completedAt: null, sourceExperimentId: null })
    expect((await backend.experiments.list({ projectId: 'p1' })).total).toBe(3)
    expect(made.version).toBe(1)
  })

  it('새로 만든 DB는 곧바로 최신 버전(v3)이다', async () => {
    const db = new LablogDB(`lablog-mig-fresh-${Date.now()}`)
    await db.open()
    expect(db.verno).toBe(3)
    db.close()
  })
})
