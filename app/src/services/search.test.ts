import { describe, expect, it } from 'vitest'
import { findRanges, snippet, splitByRanges } from './highlight'
import { editDistance, suggestQueries, vocabularyFrom } from './suggest'

describe('findRanges / splitByRanges', () => {
  it('대소문자와 띄어쓰기를 무시하고 원문 위치를 돌려준다', () => {
    const text = '나노입자 합성 조건 최적화'
    const ranges = findRanges(text, '나노입자합성')
    expect(ranges).toEqual([{ start: 0, end: 7 }])
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('나노입자 합성')
  })

  it('여러 곳에서 일치하면 모두 찾는다', () => {
    const ranges = findRanges('80°C로 가열하고 80°C를 유지한다', '80°c')
    expect(ranges).toHaveLength(2)
  })

  it('일치하지 않거나 검색어가 비면 빈 배열', () => {
    expect(findRanges('가열한다', '냉각')).toEqual([])
    expect(findRanges('가열한다', '  ')).toEqual([])
  })

  it('조각으로 나누면 일치한 조각만 match=true', () => {
    const text = '용액을 80°C로 가열한다'
    const pieces = splitByRanges(text, findRanges(text, '80°C'))
    expect(pieces.map((p) => [p.text, p.match])).toEqual([
      ['용액을 ', false],
      ['80°C', true],
      ['로 가열한다', false],
    ])
    expect(pieces.map((p) => p.text).join('')).toBe(text)
  })
})

describe('snippet', () => {
  it('짧은 글은 그대로 둔다', () => {
    expect(snippet('짧은 글', '짧은')).toBe('짧은 글')
  })
  it('긴 글은 일치 위치 주변만 자르고 …을 붙인다', () => {
    const long = '가'.repeat(100) + ' 핵심단어 ' + '나'.repeat(100)
    const out = snippet(long, '핵심단어', 60)
    expect(out).toContain('핵심단어')
    expect(out.startsWith('…')).toBe(true)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(62)
  })
})

describe('검색어 제안 (E4)', () => {
  it('편집 거리는 글자 단위다', () => {
    expect(editDistance('합성', '합성')).toBe(0)
    expect(editDistance('합성', '함성')).toBe(1)
    expect(editDistance('kitten', 'sitting')).toBe(3)
  })

  const vocab = vocabularyFrom([
    { title: '나노입자 합성 조건 최적화 #12', tags: ['합성', '나노입자'] },
    { title: '고분자 필름 인장 강도 측정', tags: ['고분자', '측정'] },
  ])

  it('제목과 태그에서 낱말을 뽑는다', () => {
    expect(vocab).toEqual(expect.arrayContaining(['나노입자', '합성', '고분자', '인장', '측정']))
  })

  it('철자가 한 글자 다른 낱말을 제안한다', () => {
    expect(suggestQueries('나노입잔', vocab)).toEqual(['나노입자'])
    expect(suggestQueries('고분잔 필름', vocab)).toContain('고분자')
  })

  it('이미 있는 낱말이나 전혀 다른 낱말은 제안하지 않는다', () => {
    expect(suggestQueries('합성', vocab)).toEqual([])
    expect(suggestQueries('전혀다른말', vocab)).toEqual([])
  })
})
