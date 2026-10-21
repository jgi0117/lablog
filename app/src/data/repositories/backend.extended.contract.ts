import { describe, expect, it } from 'vitest'
import { ConflictError, NotFoundError, type DataBackend } from './index'
import type { Experiment, NewEntity } from '../../domain/types'

export function runExtendedBackendContract(
  backend: () => DataBackend,
  exp: (overrides?: Partial<NewEntity<Experiment>>) => NewEntity<Experiment>,
  create: () => Promise<DataBackend>,
) {
  describe('검색', () => {
    it('단계 메모와 조건 값에서도 찾고, 일치한 위치를 알려 준다', async () => {
      const e = await backend().experiments.create(exp({ title: '코팅 실험' }))
      await backend().steps.create({
        experimentId: e.id,
        order: 5,
        content: '오븐에서 건조한다',
        done: false,
        doneAt: null,
        note: '라인 속도 450 mm/min 유지',
      })
      await backend().dataItems.create({
        experimentId: e.id,
        kind: 'condition',
        order: 1,
        name: '온도',
        value: '80',
        unit: '°C',
      })
      const byNote = await backend().experiments.search('450 mm/min')
      expect(byNote[0].experimentId).toBe(e.id)
      expect(byNote[0].matches.some((m) => m.field === 'note' && m.stepOrder === 5)).toBe(true)
      const byValue = await backend().experiments.search('80')
      expect(byValue[0].matches.some((m) => m.field === 'condition')).toBe(true)
    })

    it('띄어쓰기가 달라도 부분 일치로 찾는다', async () => {
      await backend().experiments.create(exp({ title: 'HC-300 하드코팅 조건 탐색' }))
      expect(await backend().experiments.search('HC-300하드코팅')).toHaveLength(1)
      expect(await backend().experiments.search('하드코팅 조건')).toHaveLength(1)
    })

    it('수정·삭제·되돌린 뒤에도 검색 결과가 최신이다', async () => {
      const e = await backend().experiments.create(exp({ title: '색인 확인' }))
      const step = await backend().steps.create({ experimentId: e.id, order: 1, content: '처음 문장', done: false, doneAt: null, note: '' })
      expect(await backend().experiments.search('처음 문장')).toHaveLength(1) // 색인을 만든다

      await backend().steps.update(step.id, { content: '바뀐 문장' })
      expect(await backend().experiments.search('처음 문장')).toHaveLength(0)
      expect(await backend().experiments.search('바뀐 문장')).toHaveLength(1)

      await backend().steps.update(step.id, { note: '새 메모 650' })
      expect((await backend().experiments.search('650'))[0].matches[0].field).toBe('note')

      await backend().experiments.update(e.id, { title: '제목도 바뀜' })
      expect(await backend().experiments.search('색인 확인')).toHaveLength(0)
      expect(await backend().experiments.search('제목도 바뀜')).toHaveLength(1)

      await backend().steps.remove(step.id)
      expect(await backend().experiments.search('바뀐 문장')).toHaveLength(0)

      const item = await backend().dataItems.create({ experimentId: e.id, kind: 'result', order: 1, name: '수율', value: '91', unit: '%' })
      expect(await backend().experiments.search('수율 91')).toHaveLength(1)
      await backend().dataItems.update(item.id, { value: '55' })
      expect(await backend().experiments.search('수율 91')).toHaveLength(0)
      expect(await backend().experiments.search('수율 55')).toHaveLength(1)
    })

    it('가져오기(replace) 뒤에는 이전 색인이 남지 않는다', async () => {
      const e = await backend().experiments.create(exp({ title: '가져오기 전 실험' }))
      expect(await backend().experiments.search('가져오기 전')).toHaveLength(1)
      const file = await backend().backup.exportAll()
      file.experiments = file.experiments.map((x) => ({ ...x, id: x.id + '-b', title: '가져온 뒤 실험' }))
      await backend().backup.importAll(file, 'replace')
      expect(await backend().experiments.search('가져오기 전')).toHaveLength(0)
      expect(await backend().experiments.search('가져온 뒤')).toHaveLength(1)
      void e
    })

    it('결과가 없으면 빈 배열이다', async () => {
      await backend().experiments.create(exp())
      expect(await backend().experiments.search('존재하지않는단어')).toEqual([])
    })
  })

  describe('복제 (s3, E8)', () => {
    it('절차·조건은 복사하고 체크·메모는 비우며 결과는 항목만 남긴다', async () => {
      const e = await backend().experiments.create(exp({ status: 'done' }))
      await backend().steps.create({
        experimentId: e.id,
        order: 1,
        content: '건조',
        done: true,
        doneAt: new Date().toISOString(),
        note: '메모',
      })
      await backend().dataItems.create({
        experimentId: e.id,
        kind: 'condition',
        order: 1,
        name: '온도',
        value: '80',
        unit: '°C',
      })
      await backend().dataItems.create({
        experimentId: e.id,
        kind: 'result',
        order: 1,
        name: '수율',
        value: '92',
        unit: '%',
      })
      const copy = await backend().experiments.duplicate(e.id)
      expect(copy.id).not.toBe(e.id)
      expect(copy.status).toBe('ready')
      expect(copy.sourceExperimentId).toBe(e.id)
      const steps = await backend().steps.listByExperiment(copy.id)
      expect(steps).toHaveLength(1)
      expect(steps[0]).toMatchObject({ content: '건조', done: false, doneAt: null, note: '' })
      const items = await backend().dataItems.listByExperiment(copy.id)
      // 조건은 값까지, 결과는 항목 이름·단위만 가져오고 값은 비운다.
      expect(items.map((i) => [i.kind, i.name, i.value, i.unit])).toEqual([
        ['condition', '온도', '80', '°C'],
        ['result', '수율', '', '%'],
      ])
    })
  })

  describe('템플릿 (s3)', () => {
    const tpl = { name: '하드코팅 표준', steps: [{ content: '도포' }, { content: '경화' }], defaultConditions: [{ name: '온도', value: '80', unit: '°C' }], resultItems: [{ name: '연필경도', unit: 'H' }] }

    it('만들고 이름순으로 읽는다', async () => {
      await backend().templates.create({ ...tpl, name: '나 템플릿' })
      await backend().templates.create({ ...tpl, name: '가 템플릿' })
      expect((await backend().templates.list()).map((t) => t.name)).toEqual(['가 템플릿', '나 템플릿'])
    })

    it('수정하면 version이 늘고, expectedVersion이 다르면 ConflictError', async () => {
      const t = await backend().templates.create(tpl)
      const next = await backend().templates.update(t.id, { name: '바뀐 이름' }, t.version)
      expect(next.version).toBe(2)
      await expect(backend().templates.update(t.id, { name: '충돌' }, 1)).rejects.toBeInstanceOf(ConflictError)
    })

    it('삭제하면 목록과 get에서 사라진다', async () => {
      const t = await backend().templates.create(tpl)
      await backend().templates.softDelete(t.id)
      expect(await backend().templates.list()).toEqual([])
      await expect(backend().templates.get(t.id)).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('달라진 점 (s3)', () => {
    it('실험에 기록하고 만든 순서대로 읽는다', async () => {
      const e = await backend().experiments.create(exp())
      await backend().deviations.create({ experimentId: e.id, stepId: null, change: '첫째', reason: '' })
      await backend().deviations.create({ experimentId: e.id, stepId: null, change: '둘째', reason: '사유' })
      expect((await backend().deviations.listByExperiment(e.id)).map((d) => d.change)).toEqual(['첫째', '둘째'])
    })

    it('없는 실험에는 기록할 수 없다', async () => {
      await expect(backend().deviations.create({ experimentId: 'none', stepId: null, change: 'x', reason: '' })).rejects.toBeInstanceOf(NotFoundError)
    })

    it('수정과 삭제', async () => {
      const e = await backend().experiments.create(exp())
      const d = await backend().deviations.create({ experimentId: e.id, stepId: null, change: '원래', reason: '' })
      const next = await backend().deviations.update(d.id, { change: '고침' })
      expect(next.version).toBe(2)
      await backend().deviations.remove(d.id)
      expect(await backend().deviations.listByExperiment(e.id)).toEqual([])
    })

    it('휴지통의 실험은 빈 목록이고, 복원하면 다시 보인다', async () => {
      const e = await backend().experiments.create(exp())
      await backend().deviations.create({ experimentId: e.id, stepId: null, change: '기록', reason: '' })
      await backend().experiments.softDelete(e.id)
      expect(await backend().deviations.listByExperiment(e.id)).toEqual([])
      await backend().experiments.restore(e.id)
      expect(await backend().deviations.listByExperiment(e.id)).toHaveLength(1)
    })

    it('복제는 달라진 점을 가져가지 않고, 원본은 그대로다', async () => {
      const e = await backend().experiments.create(exp())
      await backend().deviations.create({ experimentId: e.id, stepId: null, change: '원본의 기록', reason: '' })
      const copy = await backend().experiments.duplicate(e.id)
      expect(await backend().deviations.listByExperiment(copy.id)).toEqual([])
      expect(await backend().deviations.listByExperiment(e.id)).toHaveLength(1)
    })

    it('영구 삭제하면 딸린 기록도 사라진다', async () => {
      const e = await backend().experiments.create(exp())
      await backend().deviations.create({ experimentId: e.id, stepId: null, change: '기록', reason: '' })
      await backend().experiments.softDelete(e.id)
      await backend().experiments.purge(e.id)
      const file = await backend().backup.exportAll()
      expect(file.deviations).toEqual([])
    })
  })

  describe('백업: 템플릿과 달라진 점', () => {
    it('내보냈다가 replace로 가져오면 템플릿과 달라진 점도 복원된다', async () => {
      const e = await backend().experiments.create(exp())
      const d = await backend().deviations.create({ experimentId: e.id, stepId: null, change: '기록', reason: '이유' })
      const t = await backend().templates.create({ name: 'T', steps: [{ content: 'a' }], defaultConditions: [], resultItems: [{ name: 'r', unit: '%' }] })
      const file = await backend().backup.exportAll()
      const fresh = await create()
      await fresh.backup.importAll(file, 'replace')
      expect(await fresh.deviations.listByExperiment(e.id)).toEqual([d])
      expect(await fresh.templates.get(t.id)).toEqual(t)
    })

    it('버전 1 파일(템플릿 목록 없음)로 바꾸기를 해도 템플릿은 남는다', async () => {
      const t = await backend().templates.create({ name: '남아야 함', steps: [], defaultConditions: [], resultItems: [] })
      const file = await backend().backup.exportAll()
      const v1 = { ...file, schemaVersion: 1, templates: undefined, deviations: undefined }
      await backend().backup.importAll(v1, 'replace')
      expect(await backend().templates.get(t.id)).toMatchObject({ name: '남아야 함' })
    })
  })

  describe('백업', () => {
    it('내보냈다가 replace로 가져오면 데이터가 그대로 복원된다', async () => {
      const e = await backend().experiments.create(exp({ title: '백업 대상', tags: ['a', 'b'] }))
      await backend().steps.create({
        experimentId: e.id,
        order: 1,
        content: '단계',
        done: false,
        doneAt: null,
        note: '',
      })
      const file = await backend().backup.exportAll()
      expect(file.schemaVersion).toBeGreaterThan(0)
      const fresh = await create()
      await fresh.backup.importAll(file, 'replace')
      expect(await fresh.experiments.get(e.id)).toEqual(e)
      expect(await fresh.steps.listByExperiment(e.id)).toHaveLength(1)
    })

    it('merge는 같은 id에서 updatedAt이 더 최신인 쪽을 쓴다', async () => {
      const e = await backend().experiments.create(exp({ title: '원본' }))
      const file = await backend().backup.exportAll()
      await backend().experiments.update(e.id, { title: '로컬에서 수정' })
      await backend().backup.importAll(file, 'merge')
      expect((await backend().experiments.get(e.id)).title).toBe('로컬에서 수정')
    })
  })

}
