import type { ExperimentRequirementState } from '../hooks/useRequirementCheck'

const f = (n: number) => String(Number(n.toPrecision(4)))
const MARK = { pass: '✓ 만족', fail: '✗ 미달', unknown: '· 값 없음', na: '' } as const

/**
 * 이 실험이 고객 요구를 만족하는지 한눈에. 적용 조건(예: 재령 28일)이 다른 요구는 "해당 없음"이라 숨기고,
 * 값이 아직 없는 요구는 "값 없음"으로 알려 무엇을 더 재야 하는지 보이게 한다.
 */
export function ExperimentRequirementBar({ state }: { state: ExperimentRequirementState }) {
  const shown = state.checks.filter((c) => c.verdict !== 'na')
  if (shown.length === 0) {
    return (
      <p className="req-summary" role="status">
        이 실험에는 적용되는 고객 요구가 없습니다(요구가 특정 조건에서만 적용됩니다).
      </p>
    )
  }
  const tone = state.allMust === true ? 'ok' : state.allMust === false ? 'todo' : ''
  return (
    <section className={`req-summary${tone ? ` req-summary--${tone}` : ''}`} aria-label="고객 요구 판정">
      <b>
        고객 요구{state.customer ? ` (${state.customer})` : ''}: 필수 {state.mustTotal}개 중 {state.mustPass}개 만족
        {state.allMust === true && ' — 모두 만족'}
      </b>
      <ul className="req-banner__list">
        {shown.map((c) => (
          <li key={c.requirement.id}>
            <span className={`req-flag req-flag--${c.verdict === 'pass' ? 'pass' : c.verdict === 'fail' ? 'fail' : ''}`}>{MARK[c.verdict]}</span> {c.text}
            {c.value !== null && (
              <span className="muted">
                {' '}
                (현재 {f(c.value)}
                {c.requirement.unit ? ` ${c.requirement.unit}` : ''})
              </span>
            )}
            {c.requirement.priority === 'nice' && <span className="muted"> · 희망</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}
