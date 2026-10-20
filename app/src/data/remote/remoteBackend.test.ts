import { describe, expect, it } from 'vitest'
import type { Experiment, NewEntity } from '../../domain/types'
import { ConflictError, NotFoundError } from '../repositories'
import { createMemoryStore } from './memoryStore'
import { createRemoteBackend } from './remoteBackend'

const exp = (o: Partial<NewEntity<Experiment>> = {}): NewEntity<Experiment> => ({
  projectId: null,
  title: '실험',
  purpose: '',
  owner: '',
  tags: [],
  status: 'ready',
  startedAt: null,
  completedAt: null,
  sourceExperimentId: null,
  ...o,
})

/** 같은 서버를 쓰는 두 기기(같은 사용자) 또는 두 사용자 */
function server() {
  const box = new Map()
  return {
    device: (owner = 'user-1') => createRemoteBackend(createMemoryStore(box, owner)),
  }
}

describe('서버 저장소: 여러 기기', () => {
  it('한 기기에서 만든 실험이 다른 기기에서 보인다', async () => {
    const s = server()
    const a = s.device()
    const b = s.device()
    const e = await a.experiments.create(exp({ title: '노트북에서 만듦' }))
    expect((await b.experiments.get(e.id)).title).toBe('노트북에서 만듦')
    expect((await b.experiments.list()).total).toBe(1)
  })

  it('두 기기에서 같은 항목을 고치면 늦게 저장하는 쪽이 충돌을 받는다', async () => {
    const s = server()
    const a = s.device()
    const b = s.device()
    const e = await a.experiments.create(exp({ title: '원래' }))
    await a.experiments.update(e.id, { title: 'A가 고침' }, e.version)
    await expect(b.experiments.update(e.id, { title: 'B가 고침' }, e.version)).rejects.toBeInstanceOf(ConflictError)
    // 덮어쓰기(expectedVersion 없음)는 최신을 읽어 이어서 쓴다
    const forced = await b.experiments.update(e.id, { title: 'B가 덮어씀' })
    expect(forced.version).toBe(3)
    expect((await a.experiments.get(e.id)).title).toBe('B가 덮어씀')
  })

  it('단계 체크는 다른 기기의 변경과 섞여도 둘 다 남는다(서로 다른 단계)', async () => {
    const s = server()
    const a = s.device()
    const b = s.device()
    const e = await a.experiments.create(exp())
    const s1 = await a.steps.create({ experimentId: e.id, order: 1, content: '하나', done: false, doneAt: null, note: '' })
    const s2 = await a.steps.create({ experimentId: e.id, order: 2, content: '둘', done: false, doneAt: null, note: '' })
    await Promise.all([a.steps.setDone(s1.id, true), b.steps.setDone(s2.id, true)])
    expect((await a.steps.listByExperiment(e.id)).map((x) => x.done)).toEqual([true, true])
  })
})

describe('서버 저장소: 사용자 분리와 무결성', () => {
  it('다른 사용자의 데이터는 목록·조회·수정 어디에도 나오지 않는다', async () => {
    const s = server()
    const alice = s.device('alice')
    const bob = s.device('bob')
    const e = await alice.experiments.create(exp({ title: '앨리스의 실험' }))
    await alice.projects.create({ name: '앨리스 프로젝트', description: '' })
    expect((await bob.experiments.list()).total).toBe(0)
    expect(await bob.projects.list()).toEqual([])
    await expect(bob.experiments.get(e.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(bob.experiments.update(e.id, { title: '가로챔' })).rejects.toBeInstanceOf(NotFoundError)
    expect((await alice.experiments.get(e.id)).title).toBe('앨리스의 실험')
    expect((await bob.backup.exportAll()).experiments).toEqual([])
  })

  it('남의 실험에 자식을 붙일 수 없다', async () => {
    const s = server()
    const alice = s.device('alice')
    const bob = s.device('bob')
    const e = await alice.experiments.create(exp())
    await expect(bob.steps.create({ experimentId: e.id, order: 1, content: 'x', done: false, doneAt: null, note: '' })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('가져올 때 복제 원본이 뒤에 있어도 순서를 맞춰 넣고, 파일에 없는 원본은 비운다', async () => {
    const s = server()
    const a = s.device()
    const src = await a.experiments.create(exp({ title: '원본' }))
    const copy = await a.experiments.duplicate(src.id, { title: '복제' })
    const file = await a.backup.exportAll()
    // 복제가 원본보다 앞에 오도록 뒤집는다
    file.experiments = [...file.experiments].sort((x) => (x.id === copy.id ? -1 : 1))
    file.experiments.push({ ...copy, id: 'orphan-copy-id-1', sourceExperimentId: 'missing-source-id' })
    // 다른 서버(빈 데이터)로 옮긴다. id는 서버 전체에서 유일해서, 같은 서버의 다른 사용자에게 같은 id로 넣을 수는 없다.
    const fresh = createRemoteBackend(createMemoryStore(new Map(), 'carol'))
    await fresh.backup.importAll(file, 'replace')
    const list = (await fresh.experiments.list()).items
    expect(list.find((e) => e.id === copy.id)?.sourceExperimentId).toBe(src.id)
    expect(list.find((e) => e.id === 'orphan-copy-id-1')?.sourceExperimentId).toBeNull()
  })

  it('가져오기를 두 번 해도 늘지 않는다(멱등)', async () => {
    const s = server()
    const a = s.device()
    const e = await a.experiments.create(exp())
    await a.steps.create({ experimentId: e.id, order: 1, content: '단계', done: false, doneAt: null, note: '' })
    const file = await a.backup.exportAll()
    const fresh = createRemoteBackend(createMemoryStore(new Map(), 'dave'))
    await fresh.backup.importAll(file, 'merge')
    await fresh.backup.importAll(file, 'merge')
    const again = await fresh.backup.exportAll()
    expect(again.experiments).toHaveLength(1)
    expect(again.steps).toHaveLength(1)
  })

  it('많은 데이터도 여러 번에 나눠 넣는다', async () => {
    const s = server()
    const a = createRemoteBackend(createMemoryStore(new Map(), 'big'), { batchSize: 10 })
    void s
    const src = createRemoteBackend(createMemoryStore())
    for (let i = 0; i < 35; i++) await src.experiments.create(exp({ title: `실험 ${i}` }))
    const file = await src.backup.exportAll()
    const { imported } = await a.backup.importAll(file, 'merge')
    expect(imported).toBe(35)
    expect((await a.experiments.list()).total).toBe(35)
  })
})

describe('서버 저장소: 검색', () => {
  it('다른 기기에서 고친 내용도 읽어 둔 시간이 지나면 검색에 보인다', async () => {
    const s = server()
    const a = createRemoteBackend(createMemoryStore(new Map(), 'u'), { searchCacheMs: 0 })
    const e = await a.experiments.create(exp({ title: '검색 대상' }))
    await a.steps.create({ experimentId: e.id, order: 1, content: '건조 오븐', done: false, doneAt: null, note: '' })
    void s
    expect(await a.experiments.search('건조')).toHaveLength(1)
    await a.steps.create({ experimentId: e.id, order: 2, content: '경화 램프', done: false, doneAt: null, note: '' })
    expect(await a.experiments.search('경화')).toHaveLength(1)
  })
})
