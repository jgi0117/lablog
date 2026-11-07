import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import type { Requirement } from '../domain/types'
import { useProject } from '../hooks/useProjectContext'
import type { Column, Matrix } from '../services/analysis'
import {
  KIND_LABEL,
  MIN_R2,
  MIN_TRAIN,
  checkRequirements,
  describeFit,
  predictAll,
  suggest,
  trainModel,
  vectorOf,
  type Model,
  type RequirementCheck,
  type Suggestion,
} from '../services/model'
import { conditionsHref, type PrefillCondition } from '../services/prefill'
import { describeRequirement } from '../services/requirements'
import { logUsage } from '../services/usage'

const f = (n: number) => String(Number(n.toPrecision(4)))
/** 오차·거리처럼 대략만 보면 되는 숫자 */
const f2 = (n: number) => String(Number(n.toPrecision(2)))
const pct = (p: number) => `${Math.round(p * 100)}%`
const label = (c: Column) => (c.unit ? `${c.name} (${c.unit})` : c.name)

/** 실험 표가 바뀔 때마다 모델을 다시 만든다. 화면이 먼저 그려지도록 한 박자 뒤에 계산한다. */
function useModel(matrix: Matrix): { model: Model | null; busy: boolean } {
  const [state, setState] = useState<{ matrix: Matrix; model: Model } | null>(null)
  useEffect(() => {
    const h = setTimeout(() => setState({ matrix, model: trainModel(matrix) }), 30)
    return () => clearTimeout(h)
  }, [matrix])
  return { model: state?.model ?? null, busy: state?.matrix !== matrix }
}

function ReqLine({ c }: { c: RequirementCheck }) {
  const r = c.requirement
  const unit = r.unit ? ` ${r.unit}` : ''
  return (
    <span className="pred-check">
      <span className={`req-flag ${c.ok ? 'req-flag--pass' : 'req-flag--fail'}`}>{c.ok ? '✓' : '✗'}</span>{' '}
      {c.onCondition ? (
        <>
          {f(c.mean)}
          {unit} <span className="muted">(조건 그대로)</span>
        </>
      ) : (
        <>
          <b>{f(c.mean)}</b> ± {f2(1.96 * c.sd)}
          {unit}
          <br />
          <span className="muted">만족 가능성 {pct(c.prob)}</span>
        </>
      )}
    </span>
  )
}

/** 예측·제안 탭. 1) 모델이 어디까지 믿을 만한지, 2) 요구를 만족할 조건 제안, 3) 조건을 바꿔 보며 결과 예측. */
export function ProjectPredictPage() {
  const { project, matrix } = useProject()
  const reqs: Requirement[] = useMemo(() => project.requirements ?? [], [project.requirements])
  const musts = reqs.filter((r) => r.priority === 'must')
  const { model, busy } = useModel(matrix)
  useEffect(() => {
    logUsage('predict_view')
  }, [])

  const result = useMemo(() => (model && model.models.length > 0 && reqs.length > 0 ? suggest(model, matrix, reqs) : null), [model, matrix, reqs])

  // 조건 바꿔 보기: 첫 후보(없으면 중앙값)로 시작한다
  const [draft, setDraft] = useState<Record<string, string> | null>(null)
  const values = useMemo(() => {
    if (!model) return {}
    const base: Record<string, string> = {}
    model.dataset.features.forEach((c, j) => (base[c.key] = f(model.dataset.medians[j])))
    for (const v of result?.candidates[0]?.values ?? []) base[v.column.key] = f(v.value)
    return { ...base, ...(draft ?? {}) }
  }, [model, result, draft])
  const what = useMemo(() => {
    if (!model || model.models.length === 0) return null
    const named: Record<string, number | null> = {}
    for (const c of model.dataset.features) {
      const t = (values[c.key] ?? '').trim()
      named[c.name] = t === '' ? null : Number(t)
    }
    const v = vectorOf(model, named)
    return { ...v, predictions: predictAll(model, v.x), reqs: checkRequirements(model, matrix, reqs, v.x) }
  }, [model, matrix, reqs, values])

  if (!model) return <p className="muted">모델을 만드는 중…</p>

  const pid = project.id
  const toConds = (vals: { column: Column; value: number }[]): PrefillCondition[] => vals.map((v) => ({ name: v.column.name, value: f(v.value), unit: v.column.unit }))
  const startHref = (vals: { column: Column; value: number }[]) => conditionsHref(pid, toConds(vals))

  if (model.models.length === 0) {
    return (
      <EmptyState
        title="아직 예측할 만큼 데이터가 모이지 않았습니다"
        description={`숫자로 적은 조건과 결과가 함께 있는 실험이 ${MIN_TRAIN}건 이상 쌓이면, 조건에 따른 결과를 예측하고 고객 요구를 만족할 조건을 제안합니다.`}
      >
        {model.skipped.length > 0 && (
          <ul className="insights">
            {model.skipped.map((s) => (
              <li key={s.target.key} className="insights__item insights__item--caution">
                {s.target.name}: {s.reason}
              </li>
            ))}
          </ul>
        )}
      </EmptyState>
    )
  }

  const usable = model.models.filter((m) => m.reliable)

  return (
    <div className="analysis predict">
      {busy && <p className="muted">데이터가 바뀌어 모델을 다시 만드는 중…</p>}

      <section className="panel" aria-labelledby="h-model">
        <h2 id="h-model" className="panel__title">
          모델이 어디까지 믿을 만한가
        </h2>
        <p className="analysis__note">
          이 프로젝트의 실험 {model.dataset.rows.length}건에서 조건 {model.dataset.features.length}개({model.dataset.features.map((c) => c.name).join(', ')})로 결과를 예측합니다. 랜덤 포레스트와 선형 회귀를 모두 5겹 교차검증(학습에 쓰지 않은 실험을 맞히기)으로 시험해 더 잘 맞히는 쪽을 씁니다. 계산은 이 기기 안에서만 합니다.
        </p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="결과별 모델 표">
          <table className="stat-table">
            <thead>
              <tr>
                <th scope="col">결과</th>
                <th scope="col">실험 수</th>
                <th scope="col">방법</th>
                <th scope="col" title="학습에 쓰지 않은 실험을 얼마나 맞히는지. 1에 가까울수록 좋다">
                  교차검증 R²
                </th>
                <th scope="col">평균 오차</th>
                <th scope="col">많이 보는 조건</th>
              </tr>
            </thead>
            <tbody>
              {model.models.map((tm) => (
                <tr key={tm.target.key}>
                  <th scope="row">{label(tm.target)}</th>
                  <td>{tm.n}</td>
                  <td>{KIND_LABEL[tm.kind]}</td>
                  <td>
                    <b>{tm.r2.toFixed(2)}</b> <span className={`req-chip req-chip--${tm.r2 >= 0.6 ? 'achieved' : tm.reliable ? 'no-data' : 'not-yet'}`}>{describeFit(tm.r2)}</span>
                  </td>
                  <td>
                    ±{f2(tm.mae)}
                    {tm.target.unit ? ` ${tm.target.unit}` : ''}
                  </td>
                  <td>
                    {tm.importance
                      .slice(0, 3)
                      .map((i) => `${i.column.name} ${pct(i.share)}`)
                      .join(' · ')}
                  </td>
                </tr>
              ))}
              {model.skipped.map((s) => (
                <tr key={s.target.key}>
                  <th scope="row">{label(s.target)}</th>
                  <td colSpan={5} className="muted">
                    {s.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="analysis__note">
          교차검증 R²가 {MIN_R2} 미만인 결과는 조건만으로 설명되지 않는다고 보고 예측과 제안에 쓰지 않습니다. 평균 오차는 모델이 새 실험을 맞힐 때 보통 이만큼 어긋난다는 뜻이고, 아래 예측값의 ± 범위는 대략 95%가 들어오는 구간입니다. 모델은 지금까지 실험한 범위 안에서만 믿을 수 있습니다.
        </p>
      </section>

      <section className="panel" aria-labelledby="h-suggest">
        <h2 id="h-suggest" className="panel__title">
          고객 요구를 만족할 조건 제안
        </h2>
        {reqs.length === 0 ? (
          <p className="muted">
            고객 요구 특성이 없어 제안할 수 없습니다. <Link to={`/projects/${pid}/requirements`}>고객 요구 특성 입력하기</Link>
          </p>
        ) : musts.length === 0 ? (
          <p className="muted">필수 요구가 없어 제안하지 않습니다. 요구의 중요도를 "필수"로 두면 그 요구를 모두 만족할 조건을 찾습니다.</p>
        ) : !result || result.problem ? (
          <p className="muted">{result?.problem ?? '제안할 수 없습니다.'}</p>
        ) : (
          <>
            <p className="analysis__note">
              지금까지 실험한 범위 안에서 필수 요구 {musts.length}개를 모두 만족할 가능성이 가장 큰 조건입니다. 모델이 본 적 없는 조건은 예측이 흔들리므로, 과거 실험과 가까운 조건을 우선합니다. 확률은 예측 오차를 감안한 값이며 보장이 아닙니다.
            </p>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="제안 조건 표">
              <table className="stat-table cand-table">
                <thead>
                  <tr>
                    <th scope="col">항목</th>
                    {result.candidates.map((c, i) => (
                      <th scope="col" key={i}>
                        후보 {i + 1}
                        <br />
                        <span className={`req-chip req-chip--${c.allOk ? 'achieved' : 'not-yet'}`}>
                          {c.allOk ? '모두 만족 예상' : '일부 미달 예상'} · {pct(c.prob)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.candidates[0].values.map((_, j) => (
                    <tr key={result.candidates[0].values[j].column.key}>
                      <th scope="row">{label(result.candidates[0].values[j].column)}</th>
                      {result.candidates.map((c, i) => (
                        <td key={i}>
                          <b>{f(c.values[j].value)}</b>
                        </td>
                      ))}
                    </tr>
                  ))}
                  {result.candidates[0].checks.map((_, k) => (
                    <tr key={result.candidates[0].checks[k].requirement.id} className="cand-table__req">
                      <th scope="row">{describeRequirement(result.candidates[0].checks[k].requirement)}</th>
                      {result.candidates.map((c, i) => (
                        <td key={i}>
                          <ReqLine c={c.checks[k]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">가장 비슷한 과거 실험</th>
                    {result.candidates.map((c, i) => (
                      <td key={i}>
                        {c.nearest ? (
                          <>
                            <Link to={`/experiments/${c.nearest.row.experiment.id}`}>{c.nearest.row.experiment.title}</Link>
                            <br />
                            <span className="muted">{c.known ? '거의 같은 조건을 이미 해 봤습니다' : `조건 거리 ${f2(c.nearest.distance)}`}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row"></th>
                    {result.candidates.map((c: Suggestion, i) => (
                      <td key={i}>
                        <Link to={startHref(c.values)} className="btn btn--primary" onClick={() => logUsage('suggest_start', { candidate: i + 1 })}>
                          이 조건으로 새 실험
                        </Link>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="analysis__note">
              탐색 범위: {result.ranges.map((r) => `${r.column.name} ${f(r.lo)}~${f(r.hi)}`).join(', ')}.
              {result.fixed.length > 0 && (
                <>
                  {' '}
                  {result.fixed.map((x) => (x.value === null ? `${x.column.name}은(는) 요구의 적용 조건이라 움직이지 않고, 요구마다 그 값으로 넣어 예측합니다` : `${x.column.name}은(는) ${f(x.value)}로 고정`)).join('. ')}.
                </>
              )}
            </p>
            {result.unmodeled.length > 0 && (
              <ul className="insights">
                {result.unmodeled.map((u) => (
                  <li key={u.requirement.id} className="insights__item insights__item--caution">
                    "{describeRequirement(u.requirement)}"은(는) 제안에 넣지 못했습니다: {u.reason}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {what && (
        <section className="panel" aria-labelledby="h-what">
          <h2 id="h-what" className="panel__title">
            조건을 바꿔 보며 결과 예측하기
          </h2>
          <p className="analysis__note">조건 값을 고치면 예측이 바로 바뀝니다. 처음 값은 {result?.candidates[0] ? '후보 1' : '각 조건의 중앙값'}입니다.</p>
          <div className="pred-form" role="group" aria-label="조건 입력">
            {model.dataset.features.map((c, j) => (
              <div className="field" key={c.key}>
                <label htmlFor={`pf-${j}`}>{label(c)}</label>
                <input
                  id={`pf-${j}`}
                  className="input input--compact input--num"
                  type="number"
                  step="any"
                  value={values[c.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...(d ?? {}), [c.key]: e.target.value }))}
                />
                <span className="muted pred-form__range">
                  실험 범위 {f(model.dataset.bounds[j][0])}~{f(model.dataset.bounds[j][1])}
                </span>
              </div>
            ))}
          </div>
          {what.outOfRange.length > 0 && (
            <p className="field__warn" role="status">
              {what.outOfRange.map((c) => c.name).join(', ')}이(가) 지금까지 실험한 범위를 벗어났습니다. 모델은 범위 밖을 거의 맞히지 못합니다.
            </p>
          )}
          {what.missing.length > 0 && <p className="muted">{what.missing.map((c) => c.name).join(', ')}은(는) 비어 있어 중앙값으로 넣었습니다.</p>}
          <div className="table-scroll" tabIndex={0} role="region" aria-label="예측 결과 표">
            <table className="stat-table">
              <thead>
                <tr>
                  <th scope="col">결과</th>
                  <th scope="col">예측</th>
                  <th scope="col">95% 구간</th>
                </tr>
              </thead>
              <tbody>
                {what.predictions.map((p) => (
                  <tr key={p.model.target.key}>
                    <th scope="row">{label(p.model.target)}</th>
                    <td>
                      <b>{f(p.mean)}</b>
                    </td>
                    <td>
                      {f(p.lo)} ~ {f(p.hi)}
                    </td>
                  </tr>
                ))}
                {usable.length === 0 && (
                  <tr>
                    <td colSpan={3} className="muted">
                      믿을 만한 모델이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {what.reqs.checks.length > 0 && (
            <ul className="plain-list pred-reqs" aria-label="고객 요구 판정(예측)">
              {what.reqs.checks.map((c) => (
                <li key={c.requirement.id}>
                  {describeRequirement(c.requirement)}: <ReqLine c={c} />
                </li>
              ))}
            </ul>
          )}
          <div className="panel__actions">
            <Link
              to={startHref(model.dataset.features.map((c, j) => ({ column: c, value: what.x[j] })))}
              className="btn btn--primary"
              onClick={() => logUsage('suggest_start', { candidate: 0 })}
            >
              이 조건으로 새 실험
            </Link>
            {draft && (
              <button type="button" className="btn btn--quiet" onClick={() => setDraft(null)}>
                처음 값으로
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
