import { Link } from 'react-router-dom'
import { GAP_LABEL, type Gap } from '../services/analysis'

const SEVERITY_LABEL = { high: '먼저 확인', mid: '확인 필요', low: '참고' } as const

interface Props {
  gaps: Gap[]
  /** 처음에 보여 줄 최대 개수. 넘으면 나머지는 접어 둔다. */
  limit?: number
  /** 각 항목 앞에 프로젝트 이름 등을 붙일 때 */
  prefix?: (g: Gap) => string | undefined
}

/** 빠진 것 한눈에: 심각한 것부터, 종류와 이유와 해당 실험으로 가는 링크를 보여 준다. */
export function GapList({ gaps, limit = 6, prefix }: Props) {
  if (gaps.length === 0) {
    return (
      <p className="gaps__ok" role="status">
        빠진 것이나 의심스러운 값이 없습니다.
      </p>
    )
  }
  const shown = gaps.slice(0, limit)
  const rest = gaps.slice(limit)
  const item = (g: Gap) => (
    <li key={g.id} className={`gap gap--${g.severity}`}>
      <span className="gap__tag">
        {GAP_LABEL[g.type]}
        <span className="visually-hidden"> ({SEVERITY_LABEL[g.severity]})</span>
      </span>
      <div className="gap__body">
        <Link to={`/experiments/${g.experimentId}`}>{prefix?.(g) ? `${prefix(g)} · ` : ''}{g.experimentTitle}</Link>
        <span className="gap__msg">{g.message}</span>
      </div>
    </li>
  )
  return (
    <div>
      <ul className="gaps">{shown.map(item)}</ul>
      {rest.length > 0 && (
        <details className="gaps__more">
          <summary>나머지 {rest.length}건 보기</summary>
          <ul className="gaps">{rest.map(item)}</ul>
        </details>
      )}
    </div>
  )
}
