/** 글자를 파일로 내려받는다. 브라우저가 파일 저장을 막으면 false. */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch {
    return false
  }
}
