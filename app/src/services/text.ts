/**
 * 붙여넣은 텍스트를 단계 목록으로 바꾼다.
 * 줄마다 한 단계. 앞의 번호("1.", "2)", "①", "-", "•", "3단계:")는 지운다. 빈 줄은 건너뛴다.
 */
export function parseSteps(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^(?:[-*•·▪]|\d{1,3}\s*[.)\]:]|\d{1,3}\s*단계\s*[.):]?|[①-⑳]|\(\d{1,3}\))\s*/u, '')
        .trim(),
    )
    .filter((line) => line.length > 0)
}

/** 쉼표나 줄바꿈으로 구분된 태그 입력을 정리한다. 중복과 빈 값은 뺀다. */
export function parseTags(input: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input.split(/[,\n]/)) {
    const t = raw.trim()
    if (t && !seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out
}

const ROMAN: [number, string][] = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
]

/** 단계 번호를 로마 숫자로 (엔틱 디자인). 1~39까지 지원하고 넘으면 아라비아 숫자를 쓴다. */
export function roman(n: number): string {
  if (n < 1 || n > 39) return String(n)
  let rest = n
  let out = ''
  for (const [v, s] of ROMAN) {
    while (rest >= v) {
      out += s
      rest -= v
    }
  }
  return out
}
