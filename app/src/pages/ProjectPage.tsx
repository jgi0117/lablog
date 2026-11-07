import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { GoalMark, ProjectHeader, StatusChip, useModel, useProject, useStatus, valueText } from '../components'
import { checkGoal, describeGoal, fmt, inputsOf, label, levelsOf, outputsOf, type Goal, type ID, type Project, type Run } from '../domain/types'
import { KIND_LABEL, checkGoals, describeFit, predictAll, suggest, vectorOf, type Model } from '../services/model'
import { designPoints, expandRuns, modelPlan, nextRun } from '../services/plan'
import { addRuns, insertPlanned, newId, nextOrder, now, updateRun } from '../services/store'

const pct = (p: number) => `${Math.round(p * 100)}%`
const SOURCE: Record<Run['source'], string> = { plan: '탐색 계획', model: '모델 제안', manual: '직접 정함', import: '가져옴' }

/** 계획이 바닥나면 다음 계획을 짠다: 모델이 믿을 만하면 모델 제안, 아니면 탐색 조건을 더 */
function extendPlan(p: Project, runs: Run[], model: Model): Run[] {
  const start = runs.reduce((m, r) => Math.max(m, r.order), 0) + 1
  const id = () => newId('r')
  if (model.models.some((m) => m.reliable) && p.goals.some((g) => g.must)) {
    const planned = modelPlan(p, runs, model, start, id, 3)
    if (planned.length > 0) return planned
  }
  const free = inputsOf(p).filter((v) => v.min !== undefined && v.max !== undefined && v.min < v.max)
  if (free.length === 0) return []
  return expandRuns(p, designPoints(p, Math.max(2, Math.min(4, p.initialRuns)), runs.length + 1).slice(1), start, 'plan', id)
}

function runGoal(p: Project, r: Run, g: Goal): boolean | null {
  if (g.at && r.x[g.at.variable] !== g.at.value) return null
  const v = p.variables.find((x) => x.id === g.variable)
  if (!v) return null
  const val = v.role === 'output' ? r.y[v.id] : r.x[v.id]
  return Number.isFinite(val) ? checkGoal(g, val).ok : null
}

/** 프로젝트 화면: 다음 실험 카드(결과만 넣는다) + 현황 + 모델 제안 + 조건 바꿔 예측 */
export function ProjectPage() {
  const { id } = useParams()
  const { project, runs } = useProject(id)
  const { model, busy } = useModel(project, runs)
  const s = useStatus(project, runs)
  const next = useMemo(() => nextRun(runs), [runs])

  // 계획이 비면 자동으로 다음 계획을 짠다
  useEffect(() => {
    if (!project || next || busy || !model) return
    const extra = extendPlan(project, runs, model)
    if (extra.length > 0) addRuns(extra)
  }, [project, runs, next, busy, model])

  if (!project || !s) {
    return (
      <p className="muted">
        프로젝트가 없습니다. <Link to="/">홈으로</Link>
      </p>
    )
  }
  const outputs = outputsOf(project)
  const inputs = inputsOf(project)
  const levels = levelsOf(project)
  const total = s.done + s.planned
  const recent = runs.filter((r) => r.status === 'done').slice(-6).reverse()
  const musts = project.goals.filter((g) => g.must)

  return (
    <div className="stack">
      <ProjectHeader project={project} runs={runs} />

      {s.overall === 'achieved' && (
        <div className="banner banner--ok">
          <b>필수 목표를 모두 만족한 조건이 {s.achieved.length}개 있습니다.</b>{' '}
          {s.achieved.slice(0, 2).map((r, i) => (
            <span key={r.key}>
              {i > 0 && ' / '}
              {inputs.map((v) => `${v.name} ${valueText(v, r.x[v.id])}`).join(', ')}
            </span>
          ))}
        </div>
      )}
      {s.overall === 'in-progress' && s.closest && (
        <div className="banner banner--warn">
          <b>
            필수 목표 {s.closest.mustTotal}개 중 {s.closest.mustMet}개까지 만족한 조건이 있습니다.
          </b>{' '}
          부족한 것:{' '}
          {s.closest.verdicts
            .filter((v) => v.goal.must && v.ok !== true)
            .map((v) => `${describeGoal(project, v.goal)}${v.value !== null ? ` (지금 ${fmt(v.value)})` : ' (값 없음)'}`)
            .join(', ')}
        </div>
      )}
      {project.goals.length === 0 && (
        <div className="banner">
          목표가 없습니다. <Link to={`/p/${project.id}/setup`}>설정</Link>에서 목표(예: 압축강도 ≥ 30 MPa)를 적으면 달성 여부를 판정하고 모델이 그 목표를 향해 조건을 제안합니다.
        </div>
      )}

      <div className="split">
        <div className="stack">
          {next ? (
            <NextRunCard key={next.id} project={project} run={next} total={total} done={s.done} />
          ) : (
            <div className="card stack">
              <h2>다음 실험</h2>
              {busy ? <p className="muted">다음 조건을 정하는 중…</p> : <p className="muted">{inputs.some((v) => v.min !== undefined && v.max !== undefined && v.min < v.max) ? '계획을 짜는 중입니다.' : '입력 조건에 범위(최소·최대)가 없어 계획을 짤 수 없습니다. 설정에서 범위를 적어 주세요.'}</p>}
            </div>
          )}

          <div className="card stack">
            <h2>
              최근 결과 <Link to={`/p/${project.id}/data`} className="small">전체 데이터 →</Link>
            </h2>
            {recent.length === 0 ? (
              <p className="muted">아직 완료한 실험이 없습니다.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      {[...inputs, ...levels].map((v) => (
                        <th key={v.id}>{label(v)}</th>
                      ))}
                      {outputs.map((v) => (
                        <th key={v.id}>{label(v)}</th>
                      ))}
                      {musts.map((g) => (
                        <th key={g.id} title={describeGoal(project, g)}>
                          목표
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((r) => (
                      <tr key={r.id}>
                        <td>{r.order}</td>
                        {[...inputs, ...levels].map((v) => (
                          <td key={v.id}>{valueText(v, r.x[v.id])}</td>
                        ))}
                        {outputs.map((v) => (
                          <td key={v.id}>
                            <b>{valueText(v, r.y[v.id])}</b>
                          </td>
                        ))}
                        {musts.map((g) => {
                          const ok = runGoal(project, r, g)
                          return (
                            <td key={g.id} className={ok === null ? '' : ok ? 'pass' : 'fail'}>
                              {ok === null ? '' : ok ? '✓' : '✗'}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="card stack">
            <h2>
              목표 <StatusChip s={s} />
            </h2>
            {project.goals.length === 0 ? (
              <p className="muted">없음</p>
            ) : (
              <ul className="goal-list">
                {s.goals.map((g) => (
                  <li key={g.goal.id}>
                    <span>{describeGoal(project, g.goal)}</span>
                    <span className="chip">{g.goal.must ? '필수' : '참고'}</span>
                    <GoalMark ok={g.judged === 0 ? null : g.passing > 0} />
                    <span className="muted small">
                      {g.passing}/{g.judged}건
                      {g.best && ` · 가장 좋은 값 ${fmt(g.best.value)} (#${g.best.run.order})`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <div className="row between small muted">
                <span>
                  완료 {s.done} / 계획 {s.planned}
                </span>
                <span>{total > 0 ? Math.round((s.done / total) * 100) : 0}%</span>
              </div>
              <div className="progress">
                <div style={{ width: `${total > 0 ? (s.done / total) * 100 : 0}%` }} />
              </div>
            </div>
          </div>

          <ModelCard project={project} runs={runs} model={model} busy={busy} next={next} />
        </div>
      </div>
    </div>
  )
}

function NextRunCard({ project, run, total, done }: { project: Project; run: Run; total: number; done: number }) {
  const outputs = outputsOf(project)
  const inputs = inputsOf(project)
  const levels = levelsOf(project)
  const [vals, setVals] = useState<Record<ID, string>>({})
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')

  const save = (e: FormEvent) => {
    e.preventDefault()
    const y: Record<ID, number> = {}
    for (const v of outputs) {
      const t = (vals[v.id] ?? '').trim()
      if (t === '') continue
      const n = Number(t.replace(/,/g, ''))
      if (!Number.isFinite(n)) return setError(`"${v.name}" 값이 숫자가 아닙니다`)
      y[v.id] = n
    }
    if (Object.keys(y).length === 0) return setError('결과를 하나는 넣어 주세요')
    updateRun(run.id, { y, status: 'done', date: now(), note: note.trim() })
  }

  return (
    <form className="card card--focus stack" onSubmit={save} noValidate aria-labelledby="h-next">
      <div className="row between">
        <h2 id="h-next">
          다음 실험 #{run.order} <span className="chip chip--accent">{SOURCE[run.source]}</span>
        </h2>
        <span className="muted small">
          {done + 1} / {total}
        </span>
      </div>
      <div>
        <h3>이 조건으로 하세요</h3>
        <div className="cond-grid" role="list" aria-label="실험 조건">
          {[...inputs, ...levels].map((v) => (
            <div key={v.id} className="cond" role="listitem">
              <span className="name">{v.name}</span>
              {editing ? (
                <input
                  className="input input--sm input--num"
                  aria-label={`${v.name} 조건`}
                  inputMode="decimal"
                  defaultValue={valueText(v, run.x[v.id])}
                  onBlur={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n) && n !== run.x[v.id]) updateRun(run.id, { x: { ...run.x, [v.id]: n }, source: 'manual' })
                  }}
                />
              ) : (
                <span className="val">
                  {valueText(v, run.x[v.id])}
                  {v.unit && <small>{v.unit}</small>}
                </span>
              )}
            </div>
          ))}
        </div>
        <button type="button" className="btn btn--ghost small" onClick={() => setEditing((x) => !x)}>
          {editing ? '조건 수정 끝' : '조건을 고쳐야 한다면'}
        </button>
      </div>
      <div>
        <h3>결과를 넣으세요</h3>
        <div className="result-grid">
          {outputs.map((v, i) => (
            <div key={v.id} className="field">
              <label htmlFor={`y-${v.id}`}>{label(v)}</label>
              <input
                id={`y-${v.id}`}
                className="input input--num"
                inputMode="decimal"
                autoFocus={i === 0}
                value={vals[v.id] ?? ''}
                onChange={(e) => {
                  setVals((x) => ({ ...x, [v.id]: e.target.value }))
                  if (error) setError('')
                }}
              />
            </div>
          ))}
        </div>
      </div>
      <input className="input input--sm" aria-label="메모" placeholder="메모 (선택)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="btn btn--primary btn--big">
          저장하고 다음 실험 →
        </button>
        <button type="button" className="btn" onClick={() => updateRun(run.id, { status: 'skipped' })}>
          건너뛰기
        </button>
      </div>
    </form>
  )
}

function ModelCard({ project, runs, model, busy, next }: { project: Project; runs: Run[]; model: Model | null; busy: boolean; next: Run | null }) {
  const sug = useMemo(() => (model && model.models.some((m) => m.reliable) && project.goals.some((g) => g.must) ? suggest(model, project, { n: 3, explore: 0 }) : null), [model, project])
  const features = useMemo(() => model?.dataset.features ?? [], [model])
  const [draft, setDraft] = useState<Record<ID, string>>({})
  const what = useMemo(() => {
    if (!model || !model.models.some((m) => m.reliable)) return null
    const values: Record<ID, number | null> = {}
    for (const f of features) {
      const t = draft[f.id] ?? (next && Number.isFinite(next.x[f.id]) ? String(next.x[f.id]) : '')
      values[f.id] = t.trim() === '' ? null : Number(t)
    }
    const v = vectorOf(model, values)
    return { ...v, values, predictions: predictAll(model, v.x), goals: checkGoals(model, project, v.x) }
  }, [model, features, draft, next, project])

  const takeCandidate = (x: Record<ID, number>) => {
    const full: Record<ID, number> = {}
    for (const v of inputsOf(project)) full[v.id] = Number.isFinite(x[v.id]) ? x[v.id] : (next?.x[v.id] ?? v.min ?? 0)
    const planned = expandRuns(project, [full], 0, 'model', () => newId('r'))
    if (next) insertPlanned(project.id, planned, next.order)
    else addRuns(planned.map((r, i) => ({ ...r, order: nextOrder({ version: 3, projects: [project], runs }, project.id) + i })))
  }

  return (
    <div className="card stack">
      <h2>모델</h2>
      {!model ? (
        <p className="muted">{busy ? '모델을 만드는 중…' : ''}</p>
      ) : (
        <>
          <ul className="goal-list">
            {model.models.map((m) => (
              <li key={m.target.id}>
                <span>{m.target.name}</span>
                <span className={`chip ${m.r2 >= 0.6 ? 'chip--ok' : m.reliable ? 'chip--warn' : 'chip--bad'}`}>
                  R² {m.r2.toFixed(2)} · {describeFit(m.r2)}
                </span>
                <span className="muted small">
                  {KIND_LABEL[m.kind]} · 실험 {m.n}건 · 평균 오차 ±{Number(m.mae.toPrecision(2))}
                </span>
              </li>
            ))}
            {model.skipped.map((sk) => (
              <li key={sk.target.id}>
                <span>{sk.target.name}</span>
                <span className="muted small">{sk.reason}</span>
              </li>
            ))}
          </ul>
          {model.models.length > 0 && (
            <p className="hint">R²는 학습에 쓰지 않은 실험을 얼마나 맞히는지(5겹 교차검증)입니다. 0.3 미만이면 예측·제안에 쓰지 않습니다. 모델은 실험한 범위 안에서만 믿을 수 있습니다.</p>
          )}
          {sug && !sug.problem && sug.candidates.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <h3>목표를 만족할 가능성이 큰 조건</h3>
              <div className="cands">
                {sug.candidates.map((c, i) => (
                  <div key={i} className="cand">
                    <div className="row between">
                      <b>후보 {i + 1}</b>
                      <span className={`chip ${c.allOk ? 'chip--ok' : 'chip--warn'}`}>{pct(c.prob)}</span>
                    </div>
                    {c.values.map((v) => (
                      <div key={v.variable.id} className="kv">
                        <span className="muted">{v.variable.name}</span>
                        <b>{valueText(v.variable, v.value)}</b>
                      </div>
                    ))}
                    {c.checks
                      .filter((k) => !k.onCondition)
                      .map((k) => (
                        <div key={k.goal.id} className="kv small">
                          <span className="muted">{describeGoal(project, k.goal)}</span>
                          <span>
                            {fmt(k.mean)} ± {fmt(1.96 * k.sd, 1)}
                          </span>
                        </div>
                      ))}
                    {c.known && <span className="muted small">이미 해 본 조건과 거의 같음</span>}
                    <button type="button" className="btn" onClick={() => takeCandidate(Object.fromEntries(c.values.map((v) => [v.variable.id, v.value])))}>
                      다음 실험으로 →
                    </button>
                  </div>
                ))}
              </div>
              {sug.unmodeled.length > 0 && <p className="hint">{sug.unmodeled.map((u) => `${describeGoal(project, u.goal)}: ${u.reason}`).join(' / ')}</p>}
            </div>
          )}
          {sug?.problem && <p className="hint">{sug.problem}</p>}
          {what && (
            <details>
              <summary>조건을 바꿔 보며 예측하기</summary>
              <div className="stack" style={{ gap: 10, marginTop: 10 }}>
                <div className="cond-grid">
                  {features.map((f) => (
                    <div key={f.id} className="field">
                      <label htmlFor={`w-${f.id}`}>{label(f)}</label>
                      <input id={`w-${f.id}`} className="input input--sm input--num" inputMode="decimal" value={draft[f.id] ?? (what.values[f.id] === null ? '' : String(what.values[f.id]))} onChange={(e) => setDraft((d) => ({ ...d, [f.id]: e.target.value }))} />
                    </div>
                  ))}
                </div>
                {what.outOfRange.length > 0 && <p className="error">{what.outOfRange.map((v) => v.name).join(', ')}이(가) 실험한 범위를 벗어났습니다. 범위 밖은 거의 맞히지 못합니다.</p>}
                <ul className="goal-list">
                  {what.predictions.map((p) => (
                    <li key={p.model.target.id}>
                      <span>{label(p.model.target)}</span>
                      <b>{fmt(p.mean)}</b>
                      <span className="muted small">
                        95% 구간 {fmt(p.lo)} ~ {fmt(p.hi)}
                      </span>
                    </li>
                  ))}
                  {what.goals.checks.map((k) => (
                    <li key={k.goal.id}>
                      <span className="small">{describeGoal(project, k.goal)}</span>
                      <GoalMark ok={k.ok} />
                      {!k.onCondition && <span className="muted small">만족 가능성 {pct(k.prob)}</span>}
                    </li>
                  ))}
                </ul>
                <div className="row">
                  <button type="button" className="btn" onClick={() => takeCandidate(Object.fromEntries(features.filter((f) => f.role === 'input').map((f) => [f.id, what.values[f.id] ?? 0])))}>
                    이 조건을 다음 실험으로 →
                  </button>
                  {Object.keys(draft).length > 0 && (
                    <button type="button" className="btn btn--ghost" onClick={() => setDraft({})}>
                      되돌리기
                    </button>
                  )}
                </div>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  )
}

