import { beforeEach, describe, expect, it } from 'vitest'
import {
  ConflictError,
  NotFoundError,
  type DataBackend,
} from '../../data/repositories'
import type { Experiment, NewEntity } from '../../domain/types'

/**
 * 저장소 계약 테스트. 어떤 DataBackend 구현이든 같은 결과를 내야 한다.
 * Phase 2: LocalRepository(IndexedDB)로 실행. Phase 9: SupabaseRepository로 다시 실행.
 * 사용법은 `runBackendContract('local', async () => createLocalBackend())` 한 줄이다.
 */
export function runBackendContract(name: string, create: () => Promise<DataBackend>) {
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

    describe('검색', () => {
      it('단계 메모와 조건 값에서도 찾고, 일치한 위치를 알려 준다', async () => {
        const e = await db.experiments.create(exp({ title: '코팅 실험' }))
        await db.steps.create({
          experimentId: e.id,
          order: 5,
          content: '오븐에서 건조한다',
          done: false,
          doneAt: null,
          note: '라인 속도 450 mm/min 유지',
        })
        await db.dataItems.create({
          experimentId: e.id,
          kind: 'condition',
          order: 1,
          name: '온도',
          value: '80',
          unit: '°C',
        })
        const byNote = await db.experiments.search('450 mm/min')
        expect(byNote[0].experimentId).toBe(e.id)
        expect(byNote[0].matches.some((m) => m.field === 'note' && m.stepOrder === 5)).toBe(true)
        const byValue = await db.experiments.search('80')
        expect(byValue[0].matches.some((m) => m.field === 'condition')).toBe(true)
      })

      it('띄어쓰기가 달라도 부분 일치로 찾는다', async () => {
        await db.experiments.create(exp({ title: 'HC-300 하드코팅 조건 탐색' }))
        expect(await db.experiments.search('HC-300하드코팅')).toHaveLength(1)
        expect(await db.experiments.search('하드코팅 조건')).toHaveLength(1)
      })

      it('수정·삭제·되돌린 뒤에도 검색 결과가 최신이다', async () => {
        const e = await db.experiments.create(exp({ title: '색인 확인' }))
        const step = await db.steps.create({ experimentId: e.id, order: 1, content: '처음 문장', done: false, doneAt: null, note: '' })
        expect(await db.experiments.search('처음 문장')).toHaveLength(1) // 색인을 만든다

        await db.steps.update(step.id, { content: '바뀐 문장' })
        expect(await db.experiments.search('처음 문장')).toHaveLength(0)
        expect(await db.experiments.search('바뀐 문장')).toHaveLength(1)

        await db.steps.update(step.id, { note: '새 메모 650' })
        expect((await db.experiments.search('650'))[0].matches[0].field).toBe('note')

        await db.experiments.update(e.id, { title: '제목도 바뀜' })
        expect(await db.experiments.search('색인 확인')).toHaveLength(0)
        expect(await db.experiments.search('제목도 바뀜')).toHaveLength(1)

        await db.steps.remove(step.id)
        expect(await db.experiments.search('바뀐 문장')).toHaveLength(0)

        const item = await db.dataItems.create({ experimentId: e.id, kind: 'result', order: 1, name: '수율', value: '91', unit: '%' })
        expect(await db.experiments.search('수율 91')).toHaveLength(1)
        await db.dataItems.update(item.id, { value: '55' })
        expect(await db.experiments.search('수율 91')).toHaveLength(0)
        expect(await db.experiments.search('수율 55')).toHaveLength(1)
      })

      it('가져오기(replace) 뒤에는 이전 색인이 남지 않는다', async () => {
        const e = await db.experiments.create(exp({ title: '가져오기 전 실험' }))
        expect(await db.experiments.search('가져오기 전')).toHaveLength(1)
        const file = await db.backup.exportAll()
        file.experiments = file.experiments.map((x) => ({ ...x, id: x.id + '-b', title: '가져온 뒤 실험' }))
        await db.backup.importAll(file, 'replace')
        expect(await db.experiments.search('가져오기 전')).toHaveLength(0)
        expect(await db.experiments.search('가져온 뒤')).toHaveLength(1)
        void e
      })

      it('결과가 없으면 빈 배열이다', async () => {
        await db.experiments.create(exp())
        expect(await db.experiments.search('존재하지않는단어')).toEqual([])
      })
    })

    describe('복제 (s3, E8)', () => {
      it('절차·조건은 복사하고 체크·메모는 비우며 결과는 항목만 남긴다', async () => {
        const e = await db.experiments.create(exp({ status: 'done' }))
        await db.steps.create({
          experimentId: e.id,
          order: 1,
          content: '건조',
          done: true,
          doneAt: new Date().toISOString(),
          note: '메모',
        })
        await db.dataItems.create({
          experimentId: e.id,
          kind: 'condition',
          order: 1,
          name: '온도',
          value: '80',
          unit: '°C',
        })
        await db.dataItems.create({
          experimentId: e.id,
          kind: 'result',
          order: 1,
          name: '수율',
          value: '92',
          unit: '%',
        })
        const copy = await db.experiments.duplicate(e.id)
        expect(copy.id).not.toBe(e.id)
        expect(copy.status).toBe('ready')
        expect(copy.sourceExperimentId).toBe(e.id)
        const steps = await db.steps.listByExperiment(copy.id)
        expect(steps).toHaveLength(1)
        expect(steps[0]).toMatchObject({ content: '건조', done: false, doneAt: null, note: '' })
        const items = await db.dataItems.listByExperiment(copy.id)
        // 조건은 값까지, 결과는 항목 이름·단위만 가져오고 값은 비운다.
        expect(items.map((i) => [i.kind, i.name, i.value, i.unit])).toEqual([
          ['condition', '온도', '80', '°C'],
          ['result', '수율', '', '%'],
        ])
      })
    })

    describe('백업', () => {
      it('내보냈다가 replace로 가져오면 데이터가 그대로 복원된다', async () => {
        const e = await db.experiments.create(exp({ title: '백업 대상', tags: ['a', 'b'] }))
        await db.steps.create({
          experimentId: e.id,
          order: 1,
          content: '단계',
          done: false,
          doneAt: null,
          note: '',
        })
        const file = await db.backup.exportAll()
        expect(file.schemaVersion).toBeGreaterThan(0)
        const fresh = await create()
        await fresh.backup.importAll(file, 'replace')
        expect(await fresh.experiments.get(e.id)).toEqual(e)
        expect(await fresh.steps.listByExperiment(e.id)).toHaveLength(1)
      })

      it('merge는 같은 id에서 updatedAt이 더 최신인 쪽을 쓴다', async () => {
        const e = await db.experiments.create(exp({ title: '원본' }))
        const file = await db.backup.exportAll()
        await db.experiments.update(e.id, { title: '로컬에서 수정' })
        await db.backup.importAll(file, 'merge')
        expect((await db.experiments.get(e.id)).title).toBe('로컬에서 수정')
      })
    })
  })
}
