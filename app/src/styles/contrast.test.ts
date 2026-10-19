/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** tokens.css의 색 변수(#rrggbb)를 읽는다. vitest가 CSS를 비워서 불러오므로 파일을 직접 읽는다. 테스트는 app 폴더에서 실행된다. */
function readTokens(): Record<string, string> {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf-8')
  const out: Record<string, string> = {}
  for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2].toLowerCase()
  return out
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/** WCAG 대비율 */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const T = readTokens()

/**
 * 실제로 글자나 의미 있는 표시가 놓이는 조합만 검사한다.
 * 일반 글자는 4.5:1 이상, 큰 글자·아이콘·테두리처럼 정보를 전하는 도형은 3:1 이상(WCAG AA).
 */
const TEXT_PAIRS: [fg: string, bg: string, where: string][] = [
  ['ink', 'paper', '바탕 위 본문'],
  ['ink', 'paper-raised', '카드 위 본문'],
  ['ink', 'paper-field', '입력칸 글자'],
  ['ink-2', 'paper', '보조 글자'],
  ['ink-2', 'paper-raised', '카드 위 보조 글자, 차트 눈금'],
  ['ink-3', 'paper', '힌트, 메타 정보'],
  ['ink-3', 'paper-raised', '카드 위 힌트, 메타 정보'],
  ['ink-3', 'paper-field', '입력칸 안내 글자'],
  ['verdigris-strong', 'paper', '링크'],
  ['verdigris-strong', 'paper-raised', '카드 위 링크'],
  ['verdigris-strong', 'verdigris-soft', '선택된 칩'],
  ['wax', 'paper', '붉은 강조 글자'],
  ['wax', 'paper-raised', '카드 위 붉은 글자'],
  ['ink-2', 'paper-sunken', '표 머리글의 단위(ink-3는 이 배경에서 기준 미달이라 쓰지 않는다)'],
  ['wax', 'paper-sunken', '표 머리글의 단위 확인'],
  ['ink', 'paper-sunken', '표 머리글'],
  ['wax', 'wax-soft', '이상치·현재 단계 위 붉은 글자'],
  ['color-warn', 'paper-raised', '경고 글자'],
  ['color-warn', 'paper-field', '입력칸 아래 경고'],
  ['paper-raised', 'wax', '주요 버튼 글자'],
  ['paper-raised', 'leather', '토스트·건너뛰기 링크 글자'],
  ['brass', 'leather', '왼쪽 메뉴 글자'],
]

const GRAPHIC_PAIRS: [fg: string, bg: string, where: string][] = [
  ['rule', 'paper', '테두리'],
  ['rule', 'paper-raised', '카드 테두리'],
  ['rule', 'paper-field', '입력칸 테두리'],
  ['ink-3', 'paper-raised', '체크 전 동그라미'],
  ['verdigris', 'paper-raised', '진행 막대, 완료 표시'],
  ['wax', 'paper-raised', '현재 단계 체크'],
]

describe('색 대비 (WCAG AA)', () => {
  for (const [fg, bg, where] of TEXT_PAIRS) {
    it(`글자 4.5:1 이상 — ${where} (${fg} on ${bg})`, () => {
      expect(T[fg], `${fg} 토큰이 없습니다`).toBeDefined()
      expect(T[bg], `${bg} 토큰이 없습니다`).toBeDefined()
      expect(contrast(T[fg], T[bg])).toBeGreaterThanOrEqual(4.5)
    })
  }
  for (const [fg, bg, where] of GRAPHIC_PAIRS) {
    it(`도형 3:1 이상 — ${where} (${fg} on ${bg})`, () => {
      expect(contrast(T[fg], T[bg])).toBeGreaterThanOrEqual(3)
    })
  }

  it('대비 계산이 맞다 (검정 대 흰색은 21:1)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1)
  })
})
