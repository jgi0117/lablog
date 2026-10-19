import { afterEach, describe, expect, it } from 'vitest'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import {
  InvalidTransitionError,
  ValidationError,
  appendSteps,
  completeExperiment,
  createExperiment,
  firstOpenIndex,
  nextOpenIndex,
  reopenExperiment,
  startRun,
  stepStats,
} from './experimentService'
import { parseSteps, parseTags, roman } from './text'
import { isEmptyValue, parseNumber, valueWarning } from './validation'
import type { Step } from '../domain/types'

describe('parseSteps', () => {
  it('줄마다 한 단계로 나누고 번호 접두어를 지운다', () => {
    const text = `1. 코팅액을 조제한다
2) 기재에 도포한다
3단계: 80°C로 건조한다
- UV로 경화한다
① 연필경도를 측정한다

   `
    expect(parseSteps(text)).toEqual([
      '코팅액을 조제한다',
      '기재에 도포한다',
      '80°C로 건조한다',
      'UV로 경화한다',
      '연필경도를 측정한다',
    ])
  })

  it('번호가 아닌 숫자로 시작하는 문장은 지우지 않는다', () => {
    expect(parseSteps('80°C로 건조한다\n3 µm로 도포한다')).toEqual(['80°C로 건조한다', '3 µm로 도포한다'])
  })

  it('빈 입력은 빈 배열', () => {
    expect(parseSteps('  \n \n')).toEqual([])
  })
})

describe('parseTags / roman', () => {
  it('태그는 쉼표·줄바꿈으로 나누고 중복과 빈 값을 뺀다', () => {
    expect(parseTags('하드코팅, UV경화,, 하드코팅\n측정')).toEqual(['하드코팅', 'UV경화', '측정'])
  })
  it('로마 숫자', () => {
    expect([1, 4, 5, 9, 14, 24, 39].map(roman)).toEqual(['I', 'IV', 'V', 'IX', 'XIV', 'XXIV', 'XXXIX'])
    expect(roman(40)).toBe('40')
  })
})

describe('값 검증 (E7)', () => {
  it('비어 있거나 —는 경고하지 않는다', () => {
    expect(isEmptyValue('')).toBe(true)
    expect(isEmptyValue(' — ')).toBe(true)
    expect(valueWarning('')).toBeNull()
  })
  it('숫자와 범위는 통과, 문자는 안내', () => {
    expect(valueWarning('80')).toBeNull()
    expect(valueWarning('42.3')).toBeNull()
    expect(valueWarning('78~82')).toBeNull()
    expect(valueWarning('약 80도')).toMatch(/숫자가 아닌/)
  })
  it('이전 값과 자릿수가 많이 다르면 확인을 요청한다', () => {
    expect(valueWarning('800', [78, 80, 82])).toMatch(/많이 다릅니다/)
    expect(valueWarning('81', [78, 80, 82])).toBeNull()
  })
  it('parseNumber는 천 단위 쉼표를 받는다', () => {
    expect(parseNumber('1,200')).toBe(1200)
    expect(parseNumber('abc')).toBeNull()
  })
})

describe('단계 도우미', () => {
  const mk = (order: number, done: boolean): Step => ({
    id: String(order),
    experimentId: 'e',
    order,
    content: '',
    done,
    doneAt: null,
    note: '',
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    version: 1,
  })
  it('stepStats는 완료 수와 퍼센트를 낸다', () => {
    expect(stepStats([mk(1, true), mk(2, true), mk(3, false), mk(4, false)])).toEqual({ done: 2, total: 4, percent: 50 })
    expect(stepStats([])).toEqual({ done: 0, total: 0, percent: 0 })
  })
  it('firstOpenIndex / nextOpenIndex', () => {
    const steps = [mk(1, true), mk(2, false), mk(3, true), mk(4, false)]
    expect(firstOpenIndex(steps)).toBe(1)
    expect(nextOpenIndex(steps, 1)).toBe(3)
    expect(nextOpenIndex(steps, 3)).toBe(1)
    expect(nextOpenIndex([mk(1, true)], 0)).toBe(-1)
  })
})

describe('experimentService', () => {
  const opened: LocalBackend[] = []
  let seq = 0
  const make = () => {
    const b = createLocalBackend(`lablog-svc-${Date.now()}-${seq++}`)
    opened.push(b)
    return b
  }
  afterEach(() => {
    while (opened.length) opened.pop()?.close()
  })

  it('제목이 비면 만들 수 없다', async () => {
    await expect(createExperiment(make(), { title: '   ' })).rejects.toBeInstanceOf(ValidationError)
  })

  it('만들면 준비 상태이고 제목 공백은 다듬는다', async () => {
    const e = await createExperiment(make(), { title: '  합성 실험  ', tags: ['a'] })
    expect(e.status).toBe('ready')
    expect(e.title).toBe('합성 실험')
  })

  it('준비 → 진행 → 완료 → 재개 흐름과 시각 기록', async () => {
    const db = make()
    let e = await createExperiment(db, { title: '실험' })
    e = await startRun(db, e)
    expect(e.status).toBe('running')
    expect(e.startedAt).not.toBeNull()
    const started = e.startedAt
    expect(await startRun(db, e)).toEqual(e) // 이미 진행 중이면 그대로
    e = await completeExperiment(db, e)
    expect(e.status).toBe('done')
    expect(e.completedAt).not.toBeNull()
    e = await reopenExperiment(db, e)
    expect(e.status).toBe('running')
    expect(e.completedAt).toBeNull()
    expect(e.startedAt).toBe(started)
  })

  it('준비 상태에서 바로 완료할 수 없다', async () => {
    const db = make()
    const e = await createExperiment(db, { title: '실험' })
    await expect(completeExperiment(db, e)).rejects.toBeInstanceOf(InvalidTransitionError)
  })

  it('appendSteps는 기존 단계 뒤에 번호를 이어 붙인다', async () => {
    const db = make()
    const e = await createExperiment(db, { title: '실험' })
    const first = await appendSteps(db, e.id, ['a', 'b'], [])
    const second = await appendSteps(db, e.id, ['c'], first)
    expect([...first, ...second].map((s) => [s.content, s.order])).toEqual([['a', 1], ['b', 2], ['c', 3]])
  })
})
