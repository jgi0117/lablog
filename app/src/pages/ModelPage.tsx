import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GoalMark, useModel, useProjectParam, valueText } from '../components'
import { describeGoal, fmt, inputsOf, label, type ID, type Project, type Run } from '../domain/types'
import { KIND_LABEL, MIN_R2, MIN_TRAIN, checkGoals, describeFit, predictAll, suggest, vectorOf, type Model, type TargetModel } from '../services/model'
import { expandRuns, nextRun } from '../services/plan'
import { PROJECT_PREFIX, pool } from '../services/pool'
import { addRuns, insertPlanned, newId, nextOrder, updateProject, useDb } from '../services/store'

const pct = (p: number) => `${Math.round(p * 100)}%`
const C = { point: '#2a78d6', line: '#4b5563', grid: '#e5e8ec' }

/** 교차검증 예측 vs 실제 산점도. 대각선에 가까울수록 잘 맞힌다 */
function CvChart({ m }: { m: TargetModel }) {
  const W = 360
  const H = 300
  const P = { l: 54, r: 14, t: 14, b: 40 }
  const all = [...m.cv_actual, ...m.cv_pred]
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const pad = (hi - lo || 1) * 0.06
  const s = (v: number, axis: 'x' | 'y') => (axis === 'x' ? P.l + ((v - lo + pad) / (hi - lo + 2 * pad)) * (W - P.l - P.r) : H - P.b - ((v - lo + pad) / (hi - lo + 2 * pad)) * (H - P.t - P.b))
  const tk = (() => {
    const n = 4
    const raw = (hi - lo) / n
    const mag = 10 ** Math.floor(Math.log10(raw || 1))
    const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((x) => x >= raw) ?? raw
    const out: number[] = []
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(8)))
    return out
  })()
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${m.target.name} 교차검증: 예측 대 실제`} style={{ maxWidth: 420 }}>
      <g fontSize="12" fill={C.line}>
        {tk.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={s(t, 'y')} y2={s(t, 'y')} stroke={C.grid} />
            <text x={P.l - 6} y={s(t, 'y') + 4} textAnchor="end">
              {fmt(t)}
            </text>
            <text x={s(t, 'x')} y={H - P.b + 16} textAnchor="middle">
              {fmt(t)}
            </text>
          </g>
        ))}
        <text x={(P.l + W - P.r) / 2} y={H - 6} textAnchor="middle" fontWeight="600">
          실제 {m.target.name}
        </text>
        <text x={14} y={(P.t + H - P.b) / 2} textAnchor="middle" fontWeight="600" transform={`rotate(-90 14 ${(P.t + H - P.b) / 2})`}>
          모델 예측
        </text>
      </g>
      <line x1={s(lo, 'x')} y1={s(lo, 'y')} x2={s(hi, 'x')} y2={s(hi, 'y')} stroke={C.line} strokeDasharray="6 4" />
      {m.cv_actual.map((a, i) => (
        <circle key={i} cx={s(a, 'x')} cy={s(m.cv_pred[i], 'y')} r="4.5" fill={C.point} stroke="#fff" strokeWidth="1.2" opacity="0.9">
          <title>
            실제 {fmt(a)} / 예측 {fmt(m.cv_pred[i])}
          </title>
        </circle>
      ))}
    </svg>
  )
}

function ImportanceBars({ m }: { m: TargetModel }) {
  const rows = m.importance.filter((i) => i.share > 0.005).slice(0, 8)
  const rowH = 26
  const W = 360
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${rows.length * rowH + 6}`} role="img" aria-label={`${m.target.name} 모델의 조건 중요도`} style={{ maxWidth: 420 }}>
      {rows.map((d, i) => (
        <g key={d.variable.id} transform={`translate(0 ${i * rowH})`}>
          <text x={120} y={17} textAnchor="end" fontSize="13" fill={C.line}>
            {d.variable.name}
          </text>
          <rect x={128} y={5} width={Math.max(2, d.share * 200)} height={16} rx="4" fill={C.point} />
          <text x={132 + Math.max(2, d.share * 200)} y={17} fontSize="12" fill={C.line}>
            {pct(d.share)}
          </text>
        </g>
      ))}
    </svg>
  )
}

/** 모델 탭: 무엇으로 학습했고 얼마나 믿을 만한지, 목표를 만족할 조건 제안, 조건 바꿔 보며 예측 */
export function ModelPage() {
  const db = useDb()
  const { project, setProject, projects } = useProjectParam()
  const { model, busy } = useModel(project)
  const pooled = useMemo(() => (project ? pool(db, project) : null), [db, project])
  if (!project || !pooled) {
    return (
      <div className="stack">
        <h1>모델</h1>
        <p className="muted">
          프로젝트가 없습니다. <Link to="/new">새 프로젝트</Link>를 만들면 완료 실험 {MIN_TRAIN}건부터 모델이 만들어집니다.
        </p>
      </div>
    )
  }
  const runs = db.runs.filter((r) => r.project === project.id)
  const done = runs.filter((r) => r.status === 'done').length
  const pooledDone = pooled.runs.filter((r) => r.status === 'done').length
  const others = db.projects.filter((q) => q.id !== project.id)
  return (
    <div className="stack">
      <div className="row between">
        <h1>모델</h1>
        <div className="field">
          <label htmlFor="mp">제안·예측할 프로젝트</label>
          <select id="mp" className="input input--sm" value={project.id} onChange={(e) => setProject(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="muted small">
        모델은 같은 변수를 가진 프로젝트의 실험을 모아 하나로 학습합니다. 목표 만족 조건 제안과 예측은 위에서 고른 프로젝트의 목표 기준입니다. <Link to={`/p/${project.id}`}>{project.name} 실험 화면 →</Link>
      </p>
      <section className="card stack" aria-labelledby="h-fit">
        <h2 id="h-fit">무엇으로 학습했고, 얼마나 믿을 만한가</h2>
        <div className="banner">
          <b>학습 데이터: {pooled.projects.length > 1 ? `이 프로젝트 ${done}건 + 같은 변수를 가진 프로젝트 ${pooled.projects.length - 1}개 = 완료 ${pooledDone}건` : `이 프로젝트 완료 ${done}건`}</b>
          {pooled.projects.length > 1 && <span className="muted small"> ({pooled.projects.filter((q) => q.id !== project.id).map((q) => q.name).join(', ')})</span>}
          {others.length > 0 && (
            <label className="row small" style={{ marginTop: 6 }}>
              <input type="checkbox" checked={project.pool !== false} onChange={(e) => updateProject(project.id, { pool: e.target.checked })} />
              같은 변수(입력·측정 시점·출력 이름이 모두 같은)를 가진 다른 프로젝트의 실험도 모아서 학습 — 프로젝트 하나에 20여 건이면 모델이 약하지만 모으면 수백 건이 됩니다. 프로젝트 차이는 "프로젝트" 표시 변수로 모델이 배웁니다.
            </label>
          )}
        </div>
        <p className="hint">
          결과가 바뀔 때마다 자동으로 다시 만듭니다. 랜덤 포레스트와 선형 회귀를 5겹 교차검증(학습에 쓰지 않은 실험 맞히기)으로 시험해 더 잘 맞히는 쪽을 씁니다. 교차검증 R²가 {MIN_R2} 미만이면 예측·제안에 쓰지 않습니다. 계산은 이 브라우저 안에서만.
        </p>
        {!model ? (
          <p className="muted">{busy ? '모델을 만드는 중…' : ''}</p>
        ) : model.models.length === 0 ? (
          <p className="muted">{model.skipped.map((s) => `${s.target.name}: ${s.reason}`).join(' / ') || `완료 실험이 ${MIN_TRAIN}건 이상 쌓이면 모델을 만듭니다.`}</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>결과</th>
                    <th>실험 수</th>
                    <th>방법</th>
                    <th title="학습에 쓰지 않은 실험을 얼마나 맞히는지. 1에 가까울수록 좋다">교차검증 R²</th>
                    <th>평균 오차</th>
                    <th>판단</th>
                  </tr>
                </thead>
                <tbody>
                  {model.models.map((m) => (
                    <tr key={m.target.id}>
                      <td>{label(m.target)}</td>
                      <td>{m.n}</td>
                      <td>{KIND_LABEL[m.kind]}</td>
                      <td>
                        <b>{m.r2.toFixed(2)}</b>
                      </td>
                      <td>
                        ±{Number(m.mae.toPrecision(2))}
                        {m.target.unit ? ` ${m.target.unit}` : ''}
                      </td>
                      <td>
                        <span className={`chip ${m.r2 >= 0.6 ? 'chip--ok' : m.reliable ? 'chip--warn' : 'chip--bad'}`}>{describeFit(m.r2)}</span>
                      </td>
                    </tr>
                  ))}
                  {model.skipped.map((s) => (
                    <tr key={s.target.id}>
                      <td>{label(s.target)}</td>
                      <td colSpan={5} style={{ textAlign: 'left' }} className="muted">
                        {s.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {model.models.map((m) => (
              <div key={m.target.id} className="split">
                <div>
                  <h3>{m.target.name}: 교차검증 예측 vs 실제</h3>
                  <p className="hint">점이 점선(예측 = 실제)에 붙을수록 새 조건에서도 맞힙니다. 실험이 적으면(30건 미만) 흔들립니다.</p>
                  <CvChart m={m} />
                </div>
                <div>
                  <h3>{m.target.name} 모델이 많이 보는 조건</h3>
                  <p className="hint">모델이 결과를 가를 때 의지한 정도(합 100%). 상관과 달리 다른 조건을 함께 고려한 값입니다.</p>
                  <ImportanceBars m={m} />
                </div>
              </div>
            ))}
          </>
        )}
      </section>
      {model && model.models.some((m) => m.reliable) ? (
        <SuggestCard project={project} runs={runs} model={model} />
      ) : (
        model &&
        model.models.length > 0 && (
          <section className="card">
            <h2>목표를 만족할 조건 제안</h2>
            <p className="muted">믿을 만한 모델이 아직 없어 제안하지 않습니다. 실험이 더 쌓이면(보통 20~30건부터, 조건 수가 많을수록 더) 나아집니다. 그동안은 실험 탭의 탐색 계획이 범위를 고르게 덮습니다.</p>
          </section>
        )
      )}
    </div>
  )
}

function SuggestCard({ project, runs, model }: { project: Project; runs: Run[]; model: Model }) {
  const next = useMemo(() => nextRun(runs), [runs])
  const sug = useMemo(() => (project.goals.some((g) => g.must) ? suggest(model, project, { n: 3, explore: 0 }) : null), [model, project])
  const features = useMemo(() => model.dataset.features.filter((f) => !f.id.startsWith(PROJECT_PREFIX)), [model])
  const [draft, setDraft] = useState<Record<ID, string>>({})
  const what = useMemo(() => {
    const values: Record<ID, number | null> = {}
    for (const f of features) {
      const t = draft[f.id] ?? (next && Number.isFinite(next.x[f.id]) ? String(next.x[f.id]) : String(model.dataset.medians[features.indexOf(f)]))
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
    <section className="card stack" aria-labelledby="h-sug">
      <h2 id="h-sug">목표를 만족할 가능성이 큰 조건</h2>
      {!sug ? (
        <p className="muted">
          필수 목표가 없어 제안하지 않습니다. <Link to={`/p/${project.id}/setup`}>설정</Link>에서 목표를 적어 주세요.
        </p>
      ) : sug.problem ? (
        <p className="muted">{sug.problem}</p>
      ) : (
        <>
          <p className="hint">실험한 범위 안에서 필수 목표를 모두 만족할 확률이 큰 조건입니다. "목표값 ±"는 목표값에 가까울수록 확률이 높습니다. 확률은 예측 오차를 감안한 값이며 보장이 아닙니다.</p>
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
        </>
      )}

      <h3 style={{ marginTop: 16 }}>조건을 바꿔 보며 예측하기</h3>
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
            <b className="num-big">{fmt(p.mean)}</b>
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
    </section>
  )
}
