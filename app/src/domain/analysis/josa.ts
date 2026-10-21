/** 한글 낱말 끝에 받침이 있는지. 한글이 아니면(영문, 숫자, 기호) 판단하지 않고 null. */
function hasBatchim(word: string): boolean | null {
  const last = word.trim().slice(-1)
  if (!last) return null
  const code = last.charCodeAt(0)
  if (code < 0xac00 || code > 0xd7a3) return null
  return (code - 0xac00) % 28 !== 0
}

/** 받침에 맞는 조사를 붙인다. 받침을 알 수 없으면 "이(가)"처럼 둘 다 적는다. */
export function josa(word: string, withBatchim: string, without: string): string {
  const b = hasBatchim(word)
  return `${word}${b === null ? `${withBatchim}(${without})` : b ? withBatchim : without}`
}

export const iga = (w: string) => josa(w, '이', '가')
export const eunneun = (w: string) => josa(w, '은', '는')
export const eulreul = (w: string) => josa(w, '을', '를')
export const wagwa = (w: string) => josa(w, '과', '와')
