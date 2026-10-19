/** 두 문자열의 편집 거리(글자 추가·삭제·바꾸기 횟수). 한글은 글자(음절) 단위로 센다. */
export function editDistance(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i)
  for (let i = 1; i <= x.length; i++) {
    const cur = [i]
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[y.length]
}

/** 제목과 태그에서 검색어 후보가 될 낱말을 뽑는다. */
export function vocabularyFrom(experiments: { title: string; tags: string[] }[]): string[] {
  const set = new Set<string>()
  for (const e of experiments) {
    for (const w of e.title.split(/[\s·,()/#:-]+/)) if (w.length >= 2) set.add(w)
    for (const t of e.tags) if (t.length >= 2) set.add(t)
  }
  return [...set]
}

/**
 * 결과가 없을 때 보여 줄 비슷한 낱말(E4). 검색어의 각 낱말마다 가장 가까운 후보를 찾고,
 * 철자가 한두 글자 다른 경우만 제안한다. 이미 정확히 있는 낱말은 제안하지 않는다.
 */
export function suggestQueries(query: string, vocabulary: string[], limit = 3): string[] {
  const out: string[] = []
  const words = query.split(/\s+/).filter((w) => w.length >= 2)
  for (const word of words) {
    const w = word.toLowerCase()
    if (vocabulary.some((v) => v.toLowerCase() === w)) continue
    const allowed = w.length >= 6 ? 2 : 1
    const ranked = vocabulary
      .map((v) => ({ v, d: editDistance(w, v.toLowerCase()) }))
      .filter((x) => x.d > 0 && x.d <= allowed)
      .sort((a, b) => a.d - b.d || a.v.localeCompare(b.v, 'ko'))
    for (const { v } of ranked) {
      if (!out.includes(v)) out.push(v)
      if (out.length >= limit) return out
    }
  }
  return out
}
