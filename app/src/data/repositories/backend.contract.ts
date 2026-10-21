import { beforeEach, describe, expect, it } from 'vitest'
import {
  ConflictError,
  NotFoundError,
  type DataBackend,
} from './index'
import type { Experiment, NewEntity } from '../../domain/types'
import { runExtendedBackendContract } from './backend.extended.contract'

/**
 * 저장소 계약 테스트. 어떤 DataBackend 구현이든 같은 결과를 내야 한다.
 * Phase 2: LocalRepository(IndexedDB)로 실행. Phase 9: SupabaseRepository로 다시 실행.
 * 사용법은 `runBackendContract('local', async () => createLocalBackend())` 한 줄이다.
 */
export function runBackendContract(name: string, create: () => Promise<DataBackend>, createPeer?: () => Promise<DataBackend>) {
  describe(`DataBackend 계약: ${name}`, () => {
    let db: DataBackend

    const exp = (o: Partial<NewEntity<Experiment>> = {}): NewEntity<Experiment> => ({
      projectId: null,
      title: 'HC-300 하드코팅 조건 탐색 #12',
      purpose: '',
      owner: '지윤',
      tags: [],
      status: 'ready',
      startedAt: null,
      completedAt: null,
      sourceExperimentId: null,
      ...o,
    })

    beforeEach(async () => {
      db = await create()
    })

    describe('실험 기본', () => {
      it('만들면 id, 시각, version=1이 채워지고 다시 읽을 수 있다', async () => {
        const made = await db.experiments.create(exp())
        expect(made.id).toBeTruthy()
        expect(made.version).toBe(1)
        expect(made.deletedAt).toBeNull()
        expect(await db.experiments.get(made.id)).toEqual(made)
      })

      it('id를 직접 주면 그 id로 저장한다 (이전 도구의 멱등성)', async () => {
        const id = '6f1c0c3e-8a54-4f6d-9d4e-0a6a1b2c3d4e'
        const made = await db.experiments.create({ ...exp(), id })
        expect(made.id).toBe(id)
      })

      it('수정하면 version이 1 늘고 updatedAt이 갱신된다', async () => {
        const made = await db.experiments.create(exp())
        const next = await db.experiments.update(made.id, { title: '#13' })
        expect(next.version).toBe(2)
        expect(next.title).toBe('#13')
        expect(next.updatedAt >= made.updatedAt).toBe(true)
      })

      it('expectedVersion이 다르면 ConflictError', async () => {
        const made = await db.experiments.create(exp())
        await db.experiments.update(made.id, { title: 'A' })
        await expect(db.experiments.update(made.id, { title: 'B' }, 1)).rejects.toBeInstanceOf(
          ConflictError,
        )
      })

      if (createPeer) {
        it('두 클라이언트가 같은 행을 수정하면 늦은 쓰기에 ConflictError', async () => {
          const peer = await createPeer()
          const made = await db.experiments.create(exp())
          const stale = await peer.experiments.get(made.id)
          await db.experiments.update(made.id, { title: 'A가 먼저 수정' }, made.version)
          await expect(peer.experiments.update(made.id, { title: 'B가 늦게 수정' }, stale.version)).rejects.toBeInstanceOf(ConflictError)
        })
      }

      it('없는 id는 NotFoundError', async () => {
        await expect(db.experiments.get('missing')).rejects.toBeInstanceOf(NotFoundError)
      })
    })

    describe('목록·필터·정렬', () => {
      it('상태와 태그로 거른다', async () => {
        await db.experiments.create(exp({ title: 'A', status: 'running', tags: ['합성'] }))
        await db.experiments.create(exp({ title: 'B', status: 'done', tags: ['측정'] }))
        const running = await db.experiments.list({ status: 'running' })
        expect(running.items.map((e) => e.title)).toEqual(['A'])
        const tagged = await db.experiments.list({ tag: '측정' })
        expect(tagged.items.map((e) => e.title)).toEqual(['B'])
      })

      it('기본 정렬은 최근 수정순이다', async () => {
        const a = await db.experiments.create(exp({ title: 'A' }))
        await db.experiments.create(exp({ title: 'B' }))
        await db.experiments.update(a.id, { purpose: '수정' })
        const out = await db.experiments.list()
        expect(out.items[0].title).toBe('A')
      })

      it('limit/offset으로 나누고 total은 전체 수다', async () => {
        for (let i = 0; i < 5; i++) await db.experiments.create(exp({ title: `E${i}` }))
        const page = await db.experiments.list({}, 'title_asc', { limit: 2, offset: 2 })
        expect(page.total).toBe(5)
        expect(page.items.map((e) => e.title)).toEqual(['E2', 'E3'])
      })
    })

    describe('휴지통 (E5)', () => {
      it('삭제하면 목록에서 빠지고 휴지통에만 보인다', async () => {
        const made = await db.experiments.create(exp())
        await db.experiments.softDelete(made.id)
        expect((await db.experiments.list()).items).toHaveLength(0)
        expect((await db.experiments.list({ deleted: 'only' })).items).toHaveLength(1)
      })

      it('복원하면 다시 목록에 나온다', async () => {
        const made = await db.experiments.create(exp())
        await db.experiments.softDelete(made.id)
        await db.experiments.restore(made.id)
        expect((await db.experiments.list()).items).toHaveLength(1)
      })

      it('삭제한 실험은 검색에서 제외된다', async () => {
        const made = await db.experiments.create(exp({ title: '삭제 예정 실험' }))
        await db.experiments.softDelete(made.id)
        expect(await db.experiments.search('삭제 예정')).toHaveLength(0)
      })

      it('보관 기간(30일)이 지나면 purgeExpired가 영구 삭제한다', async () => {
        const made = await db.experiments.create(exp())
        await db.experiments.softDelete(made.id)
        const future = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)
        expect(await db.experiments.purgeExpired(future)).toBe(1)
        await expect(db.experiments.get(made.id)).rejects.toBeInstanceOf(NotFoundError)
      })

      it('purge는 휴지통의 실험과 딸린 데이터를 바로 영구 삭제한다', async () => {
        const made = await db.experiments.create(exp())
        await db.steps.create({ experimentId: made.id, order: 1, content: 'x', done: false, doneAt: null, note: '' })
        await db.experiments.softDelete(made.id)
        await db.experiments.purge(made.id)
        await expect(db.experiments.get(made.id)).rejects.toBeInstanceOf(NotFoundError)
        expect((await db.backup.exportAll()).steps).toHaveLength(0)
      })

      it('휴지통에 없는 실험은 purge할 수 없다', async () => {
        const made = await db.experiments.create(exp())
        await expect(db.experiments.purge(made.id)).rejects.toThrow()
        expect(await db.experiments.get(made.id)).toBeTruthy()
      })

      it('보관 기간 안이면 purgeExpired가 지우지 않는다', async () => {
        const made = await db.experiments.create(exp())
        await db.experiments.softDelete(made.id)
        expect(await db.experiments.purgeExpired(new Date())).toBe(0)
      })
    })

    describe('단계 (E2, E3)', () => {
      it('setDone은 done과 doneAt을 함께 바꾸고, 해제하면 doneAt이 비워진다', async () => {
        const e = await db.experiments.create(exp())
        const s = await db.steps.create({
          experimentId: e.id,
          order: 1,
          content: '코팅액 조제',
          done: false,
          doneAt: null,
          note: '',
        })
        const checked = await db.steps.setDone(s.id, true)
        expect(checked.done).toBe(true)
        expect(checked.doneAt).not.toBeNull()
        const unchecked = await db.steps.setDone(s.id, false)
        expect(unchecked.done).toBe(false)
        expect(unchecked.doneAt).toBeNull()
      })

      it('setDone은 같은 값이면 version을 올리지 않는다 (멱등)', async () => {
        const e = await db.experiments.create(exp())
        const s = await db.steps.create({
          experimentId: e.id,
          order: 1,
          content: 'x',
          done: true,
          doneAt: new Date().toISOString(),
          note: '',
        })
        const again = await db.steps.setDone(s.id, true)
        expect(again.version).toBe(s.version)
      })

      it('reorder는 order를 1..n으로 다시 매긴다', async () => {
        const e = await db.experiments.create(exp())
        const mk = (order: number, content: string) =>
          db.steps.create({ experimentId: e.id, order, content, done: false, doneAt: null, note: '' })
        const [a, b, c] = [await mk(1, 'a'), await mk(2, 'b'), await mk(3, 'c')]
        const out = await db.steps.reorder(e.id, [c.id, a.id, b.id])
        expect(out.map((s) => [s.content, s.order])).toEqual([
          ['c', 1],
          ['a', 2],
          ['b', 3],
        ])
      })

      it('실험을 삭제하면 딸린 단계도 목록에서 숨는다', async () => {
        const e = await db.experiments.create(exp())
        await db.steps.create({
          experimentId: e.id,
          order: 1,
          content: 'x',
          done: false,
          doneAt: null,
          note: '',
        })
        await db.experiments.softDelete(e.id)
        expect(await db.steps.listByExperiment(e.id)).toHaveLength(0)
        await db.experiments.restore(e.id)
        expect(await db.steps.listByExperiment(e.id)).toHaveLength(1)
      })
    })

    runExtendedBackendContract(() => db, exp, create)
  })
}
