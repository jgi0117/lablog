import { useId } from 'react'
import type { Requirement, RequirementKind } from '../../../domain/types'
import { validateRequirement } from '../../../domain/analysis/requirements'

interface Props {
  value: Requirement[]
  onChange: (next: Requirement[]) => void
  /** 이 프로젝트 실험에 이미 있는 항목 이름들(입력 자동 완성에 쓴다) */
  knownNames?: string[]
  /** 적용 조건(예: 재령)으로 자주 쓰는 조건 이름들 */
  knownConditions?: string[]
}

const KIND_LABEL: Record<RequirementKind, string> = {
  min: '이상 (≥)',
  max: '이하 (≤)',
  range: '범위 (최소~최대)',
  target: '목표값 ± 허용',
}

const num = (s: string): number | undefined => {
  const t = s.trim().replace(/,/g, '')
  if (t === '') return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

const show = (n: number | undefined) => (n === undefined ? '' : String(n))
const newId = () => globalThis.crypto.randomUUID()

/**
 * 고객 요구 특성 입력. 한 줄이 요구 하나다: 항목 이름, 조건(이상/이하/범위/목표값), 값, 필수 여부, 필요하면 "이 조건일 때만"(예: 재령 28일).
 * 아직 덜 쓴 줄은 줄 아래에 이유를 보여 준다(저장은 완성된 줄만 된다).
 */
export function RequirementsEditor({ value, onChange, knownNames = [], knownConditions = [] }: Props) {
  const uid = useId()
  const update = (id: string, patch: Partial<Requirement>) => onChange(value.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const add = () => onChange([...value, { id: newId(), name: '', unit: '', kind: 'min', priority: 'must' }])

  return (
    <div className="req-editor">
      <datalist id={`${uid}-names`}>
        {knownNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <datalist id={`${uid}-conds`}>
        {knownConditions.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {value.length === 0 && <p className="muted">고객이 요청한 특성을 적어 두면 실험마다 달성 여부를 자동으로 판정합니다. 예) 28일 압축강도 40 MPa 이상</p>}
      <ul className="req-list">
        {value.map((r, i) => {
          const problem = validateRequirement(r)
          return (
            <li key={r.id} className="req-row">
              <div className="req-row__main">
                <div className="field req-row__name">
                  <label htmlFor={`${uid}-n${i}`}>요구 {i + 1} · 항목 이름</label>
                  <input id={`${uid}-n${i}`} className="input input--compact" list={`${uid}-names`} value={r.name} placeholder="예) 압축강도" onChange={(e) => update(r.id, { name: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor={`${uid}-k${i}`}>조건</label>
                  <select id={`${uid}-k${i}`} className="input input--compact" value={r.kind} onChange={(e) => update(r.id, { kind: e.target.value as RequirementKind })}>
                    {(Object.keys(KIND_LABEL) as RequirementKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </div>
                {(r.kind === 'min' || r.kind === 'range') && (
                  <div className="field req-row__num">
                    <label htmlFor={`${uid}-a${i}`}>{r.kind === 'min' ? '이상' : '최소'}</label>
                    <input id={`${uid}-a${i}`} className="input input--compact" inputMode="decimal" value={show(r.min)} onChange={(e) => update(r.id, { min: num(e.target.value) })} />
                  </div>
                )}
                {(r.kind === 'max' || r.kind === 'range') && (
                  <div className="field req-row__num">
                    <label htmlFor={`${uid}-b${i}`}>{r.kind === 'max' ? '이하' : '최대'}</label>
                    <input id={`${uid}-b${i}`} className="input input--compact" inputMode="decimal" value={show(r.max)} onChange={(e) => update(r.id, { max: num(e.target.value) })} />
                  </div>
                )}
                {r.kind === 'target' && (
                  <>
                    <div className="field req-row__num">
                      <label htmlFor={`${uid}-t${i}`}>목표값</label>
                      <input id={`${uid}-t${i}`} className="input input--compact" inputMode="decimal" value={show(r.target)} onChange={(e) => update(r.id, { target: num(e.target.value) })} />
                    </div>
                    <div className="field req-row__num">
                      <label htmlFor={`${uid}-o${i}`}>허용 오차 ±</label>
                      <input id={`${uid}-o${i}`} className="input input--compact" inputMode="decimal" value={show(r.tolerance)} onChange={(e) => update(r.id, { tolerance: num(e.target.value) ?? 0 })} />
                    </div>
                  </>
                )}
                <div className="field req-row__num">
                  <label htmlFor={`${uid}-u${i}`}>단위</label>
                  <input id={`${uid}-u${i}`} className="input input--compact" value={r.unit} placeholder="MPa" onChange={(e) => update(r.id, { unit: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor={`${uid}-p${i}`}>중요도</label>
                  <select id={`${uid}-p${i}`} className="input input--compact" value={r.priority} onChange={(e) => update(r.id, { priority: e.target.value as Requirement['priority'] })}>
                    <option value="must">필수</option>
                    <option value="nice">있으면 좋음</option>
                  </select>
                </div>
                <button type="button" className="btn btn--quiet req-row__remove" aria-label={`요구 ${i + 1} 지우기`} onClick={() => onChange(value.filter((x) => x.id !== r.id))}>
                  지우기
                </button>
              </div>
              <div className="req-row__at">
                <label className="req-row__at-toggle">
                  <input
                    type="checkbox"
                    checked={!!r.at}
                    onChange={(e) => update(r.id, { at: e.target.checked ? { name: knownConditions[0] ?? '', value: 0 } : undefined })}
                  />
                  <span>특정 조건일 때만 적용 (예: 재령 28일일 때의 강도)</span>
                </label>
                {r.at && (
                  <span className="req-row__at-fields">
                    <label className="visually-hidden" htmlFor={`${uid}-an${i}`}>
                      요구 {i + 1} 적용 조건 이름
                    </label>
                    <input id={`${uid}-an${i}`} className="input input--compact" list={`${uid}-conds`} value={r.at.name} placeholder="조건 이름" onChange={(e) => update(r.id, { at: { name: e.target.value, value: r.at?.value ?? 0 } })} />
                    <span aria-hidden="true">=</span>
                    <label className="visually-hidden" htmlFor={`${uid}-av${i}`}>
                      요구 {i + 1} 적용 조건 값
                    </label>
                    <input id={`${uid}-av${i}`} className="input input--compact req-row__at-value" inputMode="decimal" value={show(r.at.value)} onChange={(e) => update(r.id, { at: { name: r.at?.name ?? '', value: num(e.target.value) ?? 0 } })} />
                  </span>
                )}
              </div>
              {problem && (
                <p className="field__warn" role="status">
                  {problem} — 이 줄은 채워질 때까지 저장되지 않습니다.
                </p>
              )}
            </li>
          )
        })}
      </ul>
      <button type="button" className="btn" onClick={add}>
        + 요구 특성 추가
      </button>
    </div>
  )
}
