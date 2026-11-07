import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { TrackChart } from '../charts'
import { GoalMark, ProjectHeader, useModel, useProject, useStatus, valueText } from '../components'
import { checkGoal, describeGoal, fmt, inputsOf, label, levelsOf, outputsOf, type Goal, type ID, type Project, type Run } from '../domain/types'
import { describeFit, type Model } from '../services/model'
import { designPoints, expandRuns, modelPlan, nextRun } from '../services/plan'
import { addRuns, newId, now, updateRun } from '../services/store'

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

/** 프로젝트 화면: 다음 실험 카드(결과만 넣는다) + 목표 현황 + 최근 결과. 목표를 달성하면 실험이 끝난다 */
export function ProjectPage() {
  const { id } = useParams()
  const { project, runs } = useProject(id)
  const { model, busy } = useModel(project)
  const s = useStatus(project, runs)
  const next = useMemo(() => nextRun(runs), [runs])
  const [more, setMore] = useState(false)
  const finished = !!s?.finished && !more

  // 계획이 비면 자동으로 다음 계획을 짠다(목표를 달성해 끝났으면 짜지 않는다)
  useEffect(() => {
    if (!project || next || busy || !model || finished) return
    const extra = extendPlan(project, runs, model)
    if (extra.length > 0) addRuns(extra)
  }, [project, runs, next, busy, model, finished])

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
  const recent = runs.filter((r) => r.status === 'done').slice(-6).reverse()
  const musts = project.goals.filter((g) => g.must)
  const best = s.achieved[0] ?? s.closest

  return (
    <div className="stack">
      <ProjectHeader project={project} runs={runs} />

      {s.overall === 'achieved' && (
        <div className="banner banner--ok stack" style={{ gap: 6 }}>
          <b>목표 달성. 실험 {s.done}건으로 끝났습니다.</b>
          {s.achieved[0] && (
            <span>
              달성한 조건: {inputs.map((v) => `${v.name} ${valueText(v, s.achieved[0].x[v.id])}`).join(' · ')}
              {s.achieved[0].verdicts
                .filter((v) => v.value !== null && project.variables.find((x) => x.id === v.goal.variable)?.role === 'output')
                .map((v) => ` → ${describeGoal(project, v.goal)}: ${fmt(v.value)}`)
                .join('')}
            </span>
          )}
          {!more && (
            <span>
              <button type="button" className="btn btn--ghost" onClick={() => setMore(true)}>
                그래도 실험을 더 하려면 →
              </button>
            </span>
          )}
        </div>
      )}
      {s.overall === 'in-progress' && s.closest && (
        <div className="banner banner--warn">
          <b>
            아직 목표를 만족한 조건이 없습니다 (필수 {s.closest.mustTotal}개 중 {s.closest.mustMet}개까지 만족).
          </b>{' '}
          가장 가까운 조건에서 부족한 것:{' '}
          {s.closest.verdicts
            .filter((v) => v.goal.must && v.ok !== true)
            .map((v) => `${describeGoal(project, v.goal)}${v.value !== null ? ` (지금 ${fmt(v.value)})` : ' (값 없음)'}`)
            .join(', ')}
        </div>
      )}
      {project.goals.length === 0 && (
        <div className="banner">
          목표가 없습니다. <Link to={`/p/${project.id}/setup`}>설정</Link>에서 목표(예: 압축강도 35 ± 3 MPa)를 적으면 달성 여부를 판정하고, 모델이 그 목표를 향해 조건을 제안합니다.
        </div>
      )}

      <div className="split">
        <div className="stack">
          {finished ? null : next ? (
            <NextRunCard key={next.id} project={project} run={next} total={s.done + s.planned} done={s.done} />
          ) : (
            <div className="card stack">
              <h2>다음 실험</h2>
              {busy ? <p className="muted">다음 조건을 정하는 중…</p> : <p className="muted">{inputs.some((v) => v.min !== undefined && v.max !== undefined && v.min < v.max) ? '계획을 짜는 중입니다.' : '입력 조건에 범위(최소·최대)가 없어 계획을 짤 수 없습니다. 설정에서 범위를 적어 주세요.'}</p>}
            </div>
          )}

          <div className="card stack">
            <h2>
              최근 결과{' '}
              <Link to={`/data?p=${project.id}`} className="small">
                전체 데이터 →
              </Link>
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
                        <th key={v.id}>{v.name}</th>
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
            <h2>목표</h2>
            {project.goals.length === 0 ? (
              <p className="muted">없음</p>
            ) : (
              <ul className="goal-list goal-list--big">
                {s.goals.map((g) => (
                  <li key={g.goal.id}>
                    <div className="row between" style={{ width: '100%' }}>
                      <span>
                        <b>{describeGoal(project, g.goal)}</b> <span className="chip">{g.goal.must ? '필수' : '참고'}</span>
                      </span>
                      <GoalMark ok={g.judged === 0 ? null : g.passing > 0} />
                    </div>
                    <span className="muted small">
                      만족 {g.passing} / 판정 {g.judged}건{g.best && ` · 가장 가까운 값 ${fmt(g.best.value)} (#${g.best.run.order})`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {best && (
              <p className="small">
                {s.achieved.length > 0 ? '달성한 조건' : '가장 가까운 조건'}: {inputs.map((v) => `${v.name} ${valueText(v, best.x[v.id])}`).join(' · ')}
              </p>
            )}
            <div>
              <div className="row between small muted">
                <span>
                  완료 {s.done}건{s.planned > 0 && ` · 계획 ${s.planned}건`}
                </span>
                <span>{s.finished ? '종료' : '진행 중'}</span>
              </div>
              <div className="progress">
                <div style={{ width: `${s.done + s.planned > 0 ? (s.done / (s.done + s.planned)) * 100 : 0}%` }} />
              </div>
            </div>
          </div>

          {outputs[0] && (
            <div className="card stack">
              <h2>목표에 가까워지고 있는가</h2>
              <TrackChart runs={runs} y={outputs[0]} goal={project.goals.find((g) => g.variable === outputs[0].id && g.must) ?? project.goals.find((g) => g.variable === outputs[0].id)} levelVar={levels[0]} />
              <p className="hint">초록 띠가 목표 범위, 초록 점은 목표 안에 든 실험입니다.</p>
            </div>
          )}

          <div className="card stack">
            <h2>
              모델{' '}
              <Link to={`/model?p=${project.id}`} className="small">
                자세히 →
              </Link>
            </h2>
            {!model ? (
              <p className="muted">{busy ? '만드는 중…' : ''}</p>
            ) : model.models.length === 0 ? (
              <p className="muted small">{model.skipped[0]?.reason}</p>
            ) : (
              <ul className="goal-list">
                {model.models.map((m) => (
                  <li key={m.target.id}>
                    <span>{m.target.name}</span>
                    <span className={`chip ${m.r2 >= 0.6 ? 'chip--ok' : m.reliable ? 'chip--warn' : 'chip--bad'}`}>
                      R² {m.r2.toFixed(2)} · {describeFit(m.r2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="hint">{model && model.pooledProjects > 1 ? `같은 변수를 가진 프로젝트 ${model.pooledProjects}개의 실험을 모아 학습했습니다. ` : ''}모델 탭에서 목표를 만족할 조건 제안과 조건 바꿔 보기를 할 수 있습니다.</p>
          </div>
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
        <h2 id="h-next" className="h-big">
          다음 실험 #{run.order} <span className="chip chip--accent">{SOURCE[run.source]}</span>
        </h2>
        <span className="muted">
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
        <button type="button" className="btn btn--ghost" onClick={() => setEditing((x) => !x)}>
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
