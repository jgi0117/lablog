const EMPTY_VALUES = new Set(['', '—', '-'])

export function isEmptyValue(value: string): boolean {
  return EMPTY_VALUES.has(value.trim())
}

/** "80", "42.3", "1,200", "78~82", "-5"를 숫자 값으로 본다. */
export function parseNumber(value: string): number | null {
  const v = value.trim().replace(/,/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null
  return Number(v)
}

/**
 * 조건·결과 값 검증(E7). 막지 않고 경고 문구만 돌려준다. 문제 없으면 null.
 * - 숫자가 아니면 안내 (범위 "78~82"와 비워 둔 값은 허용)
 * - 같은 이름의 이전 값들(history)과 자릿수가 크게 다르면 확인 요청
 */
export function valueWarning(value: string, history: number[] = []): string | null {
  const v = value.trim()
  if (isEmptyValue(v)) return null
  if (/^-?\d+(\.\d+)?\s*[~∼-]\s*-?\d+(\.\d+)?$/.test(v)) return null
  const n = parseNumber(v)
  if (n === null) return '숫자가 아닌 값입니다. 맞게 적었는지 확인하세요.'
  const past = history.filter((h) => h !== 0)
  if (past.length >= 2 && n !== 0) {
    const min = Math.min(...past.map(Math.abs))
    const max = Math.max(...past.map(Math.abs))
    const a = Math.abs(n)
    if (a > max * 5 || a < min / 5) return `평소 값(${min}~${max})과 많이 다릅니다. 단위나 자릿수를 확인하세요.`
  }
  return null
}

/** 자주 쓰는 단위. 입력칸에서 고르거나 직접 입력할 수 있다. */
export const COMMON_UNITS = ['µm', 'nm', 'mm', '°C', 'min', 's', 'm/min', 'mJ/cm²', 'wt%', '%', 'H', 'YI', 'GU', 'cP', 'g', 'mL', 'MPa', '만회']
