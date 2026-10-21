import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import { seedDemo } from '../data/seed'
import { backupFileName, parseBackup, serializeBackup } from './backup'

beforeEach(() => {
  localStorage.clear()
})

describe('백업 파일 검사 (parseBackup)', () => {
  const opened: LocalBackend[] = []
  afterEach(() => {
    while (opened.length) opened.pop()?.close()
  })

  async function goodFile() {
    const db = createLocalBackend(`lablog-bk-${Date.now()}-${Math.random()}`)
    opened.push(db)
    await seedDemo(db)
    return { db, text: serializeBackup(await db.backup.exportAll()) }
  }

  it('내보낸 파일을 다시 읽으면 내용이 같고 요약이 맞다', async () => {
    const { db, text } = await goodFile()
    const res = parseBackup(text)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.summary).toMatchObject({ projects: 4, experiments: 200 })
    expect(res.summary.steps).toBeGreaterThan(100)
    const original = await db.backup.exportAll()
    expect(res.file.experiments).toEqual(original.experiments)
    expect(res.file.steps).toEqual(original.steps)
    expect(res.file.dataItems).toEqual(original.dataItems)
    expect(res.file.projects).toEqual(original.projects)
  })

  it('JSON이 아니거나 비어 있으면 이해할 수 있는 이유를 준다', () => {
    expect(parseBackup('이건 json이 아님')).toMatchObject({ ok: false, error: expect.stringContaining('파일을 읽을 수 없습니다') })
    expect(parseBackup('')).toMatchObject({ ok: false })
    expect(parseBackup('[]')).toMatchObject({ ok: false, error: expect.stringContaining('형식') })
    expect(parseBackup('null')).toMatchObject({ ok: false })
  })

  it('버전 정보가 없거나 더 새로운 파일은 가져오지 않는다', () => {
    expect(parseBackup(JSON.stringify({ projects: [] }))).toMatchObject({ ok: false, error: expect.stringContaining('버전') })
    const newer = parseBackup(JSON.stringify({ schemaVersion: 99, projects: [], experiments: [], steps: [], dataItems: [] }))
    expect(newer).toMatchObject({ ok: false, error: expect.stringContaining('업데이트') })
  })

  it('목록이 빠진 파일은 어느 목록인지 알려 준다', () => {
    const res = parseBackup(JSON.stringify({ schemaVersion: 1, projects: [], experiments: [], steps: [] }))
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('dataItems') })
  })

  it('필수 값이 틀린 항목을 가려낸다', async () => {
    const { text } = await goodFile()
    const base = JSON.parse(text)
    const withBadStatus = structuredClone(base)
    withBadStatus.experiments[0].status = '끝남'
    expect(parseBackup(JSON.stringify(withBadStatus))).toMatchObject({ ok: false, error: expect.stringContaining('상태가 올바르지 않습니다') })
    const noTitle = structuredClone(base)
    delete noTitle.experiments[1].title
    expect(parseBackup(JSON.stringify(noTitle))).toMatchObject({ ok: false, error: expect.stringContaining('제목이 없습니다') })
    const badKind = structuredClone(base)
    badKind.dataItems[0].kind = 'other'
    expect(parseBackup(JSON.stringify(badKind))).toMatchObject({ ok: false, error: expect.stringContaining('구분이 올바르지 않습니다') })
    const badTime = structuredClone(base)
    badTime.steps[0].updatedAt = 'yesterday'
    badTime.steps[0].createdAt = 'x'
    expect(parseBackup(JSON.stringify(badTime))).toMatchObject({ ok: false, error: expect.stringContaining('수정 시각') })
  })

  it('id가 겹치거나 주인 없는 단계가 있으면 거부한다', async () => {
    const { text } = await goodFile()
    const dup = JSON.parse(text)
    dup.experiments[1].id = dup.experiments[0].id
    expect(parseBackup(JSON.stringify(dup))).toMatchObject({ ok: false, error: expect.stringContaining('중복') })
    const orphan = JSON.parse(text)
    orphan.experiments = orphan.experiments.slice(1)
    const res = parseBackup(JSON.stringify(orphan))
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('파일에 없는') })
  })

  it('알 수 없는 필드는 버리고, 빠진 선택 필드는 기본값으로 채운다', () => {
    const at = '2026-10-01T00:00:00.000Z'
    const res = parseBackup(
      JSON.stringify({
        schemaVersion: 1,
        exportedAt: at,
        projects: [],
        experiments: [{ id: 'e1', title: '실험', status: 'done', updatedAt: at, __proto__: { x: 1 }, evil: '<script>', extra: { a: 1 } }],
        steps: [{ id: 's1', experimentId: 'e1', order: 1, content: '도포', updatedAt: at }],
        dataItems: [],
      }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const e = res.file.experiments[0]
    expect(e).toEqual({
      id: 'e1',
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      version: 1,
      projectId: null,
      title: '실험',
      purpose: '',
      owner: '',
      tags: [],
      status: 'done',
      startedAt: null,
      completedAt: null,
      sourceExperimentId: null,
    })
    expect(res.file.steps[0]).toMatchObject({ done: false, note: '', doneAt: null })
  })

  it('너무 큰 파일은 거부한다', () => {
    expect(parseBackup('x'.repeat(100 * 1024 * 1024 + 1))).toMatchObject({ ok: false, error: expect.stringContaining('너무 큽니다') })
  })

  it('파일 이름에 날짜와 시각이 들어간다', () => {
    expect(backupFileName(new Date(2026, 9, 19, 14, 5))).toBe('lablog-backup-2026-10-19-1405.json')
  })
})
