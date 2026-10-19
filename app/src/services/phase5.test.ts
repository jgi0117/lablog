import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import { seedDemo } from '../data/seed'
import { backupFileName, backupReminder, lastBackupAt, parseBackup, recordBackup, serializeBackup, snoozeBackupReminder, backupSnoozedUntil } from './backup'
import { createChangeBus } from './changeBus'
import { MAX_ERRORS, clearErrors, installGlobalErrorLogging, logError, readErrors } from './errorLog'
import { getSettings, saveSettings } from './settings'
import { estimateStorage, formatBytes, requestPersistence } from './storage'
import { MAX_USAGE_EVENTS, clearUsage, logUsage, noteOpenFromSearch, noteSearchShown, readUsage, summarizeUsage } from './usage'

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
    expect(res.summary).toMatchObject({ projects: 3, experiments: 17 })
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

describe('백업 알림', () => {
  const now = new Date('2026-10-20T12:00:00.000Z')
  const day = (n: number) => new Date(now.getTime() - n * 86400000).toISOString()
  const base = { now, hasData: true, lastBackup: null as string | null, newestChange: day(0), oldestCreated: day(10), snoozedUntil: null as string | null }

  it('데이터가 없으면 권하지 않는다', () => {
    expect(backupReminder({ ...base, hasData: false })).toBeNull()
  })
  it('한 번도 백업하지 않았고 첫 기록이 하루 넘었으면 권한다', () => {
    expect(backupReminder(base)).toBe('never')
    expect(backupReminder({ ...base, oldestCreated: day(0.2) })).toBeNull()
  })
  it('마지막 백업 뒤 바뀐 게 있고 7일이 지났을 때만 다시 권한다', () => {
    expect(backupReminder({ ...base, lastBackup: day(8), newestChange: day(1) })).toBe('stale')
    expect(backupReminder({ ...base, lastBackup: day(3), newestChange: day(1) })).toBeNull()
    expect(backupReminder({ ...base, lastBackup: day(8), newestChange: day(9) })).toBeNull() // 바뀐 게 없음
  })
  it('나중에를 누르면 정해진 기간 동안 조용하다', () => {
    expect(backupReminder({ ...base, snoozedUntil: new Date(now.getTime() + 86400000).toISOString() })).toBeNull()
    expect(backupReminder({ ...base, snoozedUntil: day(1) })).toBe('never')
  })
  it('마지막 백업 시각과 미루기를 저장한다', () => {
    expect(lastBackupAt()).toBeNull()
    recordBackup(now)
    expect(lastBackupAt()).toBe(now.toISOString())
    snoozeBackupReminder(3, now)
    expect(backupSnoozedUntil()).toBe(new Date(now.getTime() + 3 * 86400000).toISOString())
  })
})

describe('저장 공간', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  it('영구 저장 요청: 이미 허용됨, 새로 허용, 거절, 미지원', async () => {
    vi.stubGlobal('navigator', { storage: { persisted: async () => true, persist: vi.fn() } })
    expect(await requestPersistence()).toBe('granted')
    const persist = vi.fn(async () => false)
    vi.stubGlobal('navigator', { storage: { persisted: async () => false, persist } })
    expect(await requestPersistence()).toBe('denied')
    expect(persist).toHaveBeenCalled()
    vi.stubGlobal('navigator', {})
    expect(await requestPersistence()).toBe('unsupported')
  })
  it('사용량과 비율, 단위 표기', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 80, quota: 100 }) } })
    expect(await estimateStorage()).toEqual({ usage: 80, quota: 100, ratio: 0.8 })
    vi.stubGlobal('navigator', {})
    expect(await estimateStorage()).toBeNull()
    expect([512, 2048, 5 * 1024 * 1024].map(formatBytes)).toEqual(['512 B', '2.0 KB', '5.0 MB'])
  })
})

describe('설정과 사용 기록', () => {
  it('설정은 기본값에서 시작하고 바꾼 값을 기억한다', () => {
    expect(getSettings()).toEqual({ usageLog: true, wakeLock: true })
    saveSettings({ usageLog: false })
    expect(getSettings()).toEqual({ usageLog: false, wakeLock: true })
  })

  it('사용 기록을 끄면 아무것도 남기지 않는다', () => {
    logUsage('search', { ms: 30, hits: 4 })
    expect(readUsage()).toHaveLength(1)
    saveSettings({ usageLog: false })
    logUsage('search', { ms: 30, hits: 4 })
    expect(readUsage()).toHaveLength(1)
    clearUsage()
    expect(readUsage()).toEqual([])
  })

  it('기록은 최대 개수를 넘으면 오래된 것부터 버린다', () => {
    for (let i = 0; i < MAX_USAGE_EVENTS + 5; i++) logUsage('step_toggle', { i })
    const list = readUsage()
    expect(list).toHaveLength(MAX_USAGE_EVENTS)
    expect(list[0].data?.i).toBe(5)
  })

  it('검색 결과가 뜬 뒤 실험을 열기까지의 시간을 잰다 (KR1)', () => {
    noteOpenFromSearch() // 검색 없이 연 경우는 기록하지 않는다
    expect(readUsage()).toEqual([])
    noteSearchShown()
    noteOpenFromSearch()
    const [e] = readUsage()
    expect(e.name).toBe('open_from_search')
    expect(Number(e.data?.ms)).toBeGreaterThanOrEqual(0)
    noteOpenFromSearch() // 한 번 열면 다시 재지 않는다
    expect(readUsage()).toHaveLength(1)
  })

  it('요약: 열기까지 중앙값, 10초 안 비율, 완료 시 빠진 것, 주별 빠진 것 개수', () => {
    const now = new Date('2026-10-20T12:00:00.000Z')
    const at = (d: number) => new Date(now.getTime() - d * 86400000).toISOString()
    const ev = (t: string, name: Parameters<typeof logUsage>[0], data?: Record<string, number>) => ({ t, name, ...(data ? { data } : {}) })
    const s = summarizeUsage(
      [
        ev(at(1), 'open_from_search', { ms: 3000 }),
        ev(at(1), 'open_from_search', { ms: 7000 }),
        ev(at(1), 'open_from_search', { ms: 20000 }),
        ev(at(1), 'search', { ms: 30 }),
        ev(at(1), 'complete', { openSteps: 0, emptyResults: 0 }),
        ev(at(1), 'complete', { openSteps: 2, emptyResults: 0 }),
        ev(at(1), 'complete', { openSteps: 0, emptyResults: 1 }),
        ev(at(2), 'gaps_snapshot', { total: 9 }),
        ev(at(1), 'gaps_snapshot', { total: 5 }),
        ev(at(9), 'gaps_snapshot', { total: 12 }),
        ev(at(10), 'gaps_snapshot', { total: 14 }),
      ],
      now,
    )
    expect(s.medianOpenSec).toBe(7)
    expect(s.within10s).toBeCloseTo(2 / 3)
    expect(s.completes).toBe(3)
    expect(s.completesWithGaps).toBe(2)
    expect(s.gapsThisWeek).toBe(5) // 이번 주의 마지막 기록
    expect(s.gapsLastWeek).toBe(12) // 지난주의 마지막 기록
    expect(summarizeUsage([], now)).toMatchObject({ medianOpenSec: null, within10s: null, gapsThisWeek: null })
  })
})

describe('오류 기록', () => {
  it('오류를 남기고 최대 개수를 넘으면 오래된 것을 버린다', () => {
    logError('test', new Error('첫 오류'))
    expect(readErrors()[0]).toMatchObject({ source: 'test', message: '첫 오류' })
    for (let i = 0; i < MAX_ERRORS + 3; i++) logError('t', `오류 ${i}`)
    expect(readErrors()).toHaveLength(MAX_ERRORS)
    clearErrors()
    expect(readErrors()).toEqual([])
  })

  it('처리하지 못한 오류와 거절된 약속을 기록한다', () => {
    const off = installGlobalErrorLogging()
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('전역 오류'), message: '전역 오류' }))
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown }
    rejection.reason = new Error('약속 거절')
    window.dispatchEvent(rejection)
    off()
    expect(readErrors().map((e) => e.message)).toEqual(['전역 오류', '약속 거절'])
  })
})

describe('다른 탭 변경 알림', () => {
  class FakeChannel extends EventTarget {
    static all: FakeChannel[] = []
    readonly name: string
    constructor(name: string) {
      super()
      this.name = name
      FakeChannel.all.push(this)
    }
    postMessage(data: unknown) {
      for (const c of FakeChannel.all) if (c !== this && c.name === this.name) c.dispatchEvent(new MessageEvent('message', { data }))
    }
    close() {
      FakeChannel.all = FakeChannel.all.filter((c) => c !== this)
    }
  }
  const factory = (name: string) => new FakeChannel(name) as unknown as BroadcastChannel
  beforeEach(() => {
    FakeChannel.all = []
  })

  it('다른 탭의 변경만 전달하고 내 변경은 무시한다', () => {
    const a = createChangeBus('t', factory)
    const b = createChangeBus('t', factory)
    const onA = vi.fn()
    const onB = vi.fn()
    a.subscribe(onA)
    const off = b.subscribe(onB)
    a.post({ table: 'experiments', id: 'e1' })
    expect(onA).not.toHaveBeenCalled()
    expect(onB).toHaveBeenCalledWith(expect.objectContaining({ table: 'experiments', id: 'e1' }))
    off()
    a.post({ table: 'steps', id: 's1' })
    expect(onB).toHaveBeenCalledTimes(1)
    a.close()
    b.close()
  })

  it('지원하지 않는 환경에서도 오류 없이 동작한다', () => {
    const bus = createChangeBus('x', () => {
      throw new Error('지원 안 함')
    })
    expect(() => bus.post({ table: 'steps', id: '1' })).not.toThrow()
    expect(bus.subscribe(() => {})()).toBeUndefined()
  })

  it('저장소는 같은 DB를 쓰는 다른 인스턴스(다른 탭)의 변경을 알려 준다', async () => {
    const name = `lablog-tabs-${Date.now()}`
    const tabA = createLocalBackend(name, { channel: factory })
    const tabB = createLocalBackend(name, { channel: factory })
    const seenByA = vi.fn()
    const seenByB = vi.fn()
    tabA.onExternalChange?.(seenByA)
    tabB.onExternalChange?.(seenByB)
    await tabA.experiments.create({ projectId: null, title: '탭 A에서 만듦', purpose: '', owner: '', tags: [], status: 'ready', startedAt: null, completedAt: null, sourceExperimentId: null })
    expect(seenByB).toHaveBeenCalled()
    expect(seenByA).not.toHaveBeenCalled()
    tabA.close()
    tabB.close()
  })
})
