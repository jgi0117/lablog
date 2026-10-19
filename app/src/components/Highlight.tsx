import { findRanges, splitByRanges } from '../services/highlight'

interface Props {
  text: string
  query: string
}

/** 검색어와 일치한 부분을 <mark>로 강조한다. 띄어쓰기·대소문자는 무시한다. */
export function Highlight({ text, query }: Props) {
  const pieces = splitByRanges(text, findRanges(text, query))
  return (
    <>
      {pieces.map((p, i) => (p.match ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  )
}
