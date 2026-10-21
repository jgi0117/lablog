export interface Range {
  start: number
  end: number
}

/**
 * text 안에서 query와 일치하는 구간을 찾는다.
 * 대소문자와 띄어쓰기를 무시한다. ("하드코팅조건"으로 "하드코팅 조건"을 찾는다.)
 * 저장소의 검색(normalize)과 같은 규칙이라 검색에 걸린 결과는 항상 강조할 구간이 있다.
 */
export function findRanges(text: string, query: string): Range[] {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return []
  // 공백을 뺀 문자열과, 그 각 글자가 원문 어디에 있었는지의 위치표
  const chars: string[] = []
  const pos: number[] = []
  const lower = text.toLowerCase()
  for (let i = 0; i < lower.length; i++) {
    if (!/\s/.test(lower[i])) {
      chars.push(lower[i])
      pos.push(i)
    }
  }
  const flat = chars.join('')
  const out: Range[] = []
  let from = 0
  for (;;) {
    const at = flat.indexOf(q, from)
    if (at === -1) break
    out.push({ start: pos[at], end: pos[at + q.length - 1] + 1 })
    from = at + q.length
  }
  return out
}

export interface Piece {
  text: string
  match: boolean
}

/** 일치 구간을 기준으로 글자를 조각낸다. 화면에서는 match인 조각만 강조한다. */
export function splitByRanges(text: string, ranges: Range[]): Piece[] {
  const out: Piece[] = []
  let at = 0
  for (const r of ranges) {
    if (r.start > at) out.push({ text: text.slice(at, r.start), match: false })
    out.push({ text: text.slice(r.start, r.end), match: true })
    at = r.end
  }
  if (at < text.length) out.push({ text: text.slice(at), match: false })
  return out
}

/** 긴 글은 첫 일치 위치 주변만 잘라 보여 준다. 앞뒤가 잘리면 …을 붙인다. */
export function snippet(text: string, query: string, max = 120): string {
  if (text.length <= max) return text
  const first = findRanges(text, query)[0]
  if (!first) return text.slice(0, max) + '…'
  const start = Math.max(0, Math.min(first.start - Math.floor(max / 3), text.length - max))
  const end = Math.min(text.length, start + max)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}
