import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GoalMark, useModel, useProjectParam, valueText } from '../components'
import { describeGoal, fmt, groupKeyOf, inputsOf, label, type ID, type ModelVersion, type Project, type Run } from '../domain/types'
import {
  ALGOS,
  KIND_LABEL,
  MIN_R2,
  MIN_TRAIN,
  checkGoals,
  defaultParams,
  describeFit,
  predictAll,
  suggest,
  toVersion,
  trainTarget,
  vectorOf,
  type Algo,
  type Model,
  type Params,
  type TargetModel,
} from '../services/model'
import { expandRuns, nextRun } from '../services/plan'
import { PROJECT_PREFIX, pool } from '../services/pool'
import { addModelVersion, addRuns, applyModelVersion, deleteModelVersion, insertPlanned, modelsOf, newId, nextOrder, updateProject, useDb } from '../services/store'

const pct = (p: number) => `${Math.round(p * 100)}%`
const C = { point: '#2a78d6', line: '#4b5563', grid: '#e5e8ec' }
const fitChip = (r2: number) => `chip ${r2 >= 0.6 ? 'chip--ok' : r2 >= MIN_R2 ? 'chip--warn' : 'chip--bad'}`
const paramText = (algo: Algo, p: Params) => ALGOS[algo].params.map((s) => `${s.label.split(' ')[0]} ${p[s.key] ?? s.def}`).join(' · ')

/** 교차검증 예측 vs 실제 */
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
    const raw = (hi - lo) / 4
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
          실제
        </text>
        <text x={14} y={(P.t + H - P.b) / 2} textAnchor="middle" fontWeight="600" transform={`rotate(-90 14 ${(P.t + H - P.b) / 2})`}>
          예측
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
  if (rows.length === 0) return <p className="muted small">이 알고리즘은 중요도를 내지 않음 (k-최근접)</p>
  const rowH = 26
  const W = 360
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${rows.length * rowH + 6}`} role="img" aria-label={`${m.target.name} 모델의 조건 중요도`} style={{ maxWidth: 420 }}>
      {rows.map((d, i) => (
        <g key={d.variable.id} transform={`translate(0 ${i * rowH})`}>
          <text x={140} y={17} textAnchor="end" fontSize="13" fill={C.line}>
            {d.variable.name.replace(/^프로젝트 /, 'P: ')}
          </text>
          <rect x={148} y={5} width={Math.max(2, d.share * 180)} height={16} rx="4" fill={C.point} />
          <text x={152 + Math.max(2, d.share * 180)} y={17} fontSize="12" fill={C.line}>
            {pct(d.share)}
          </text>
        </g>
      ))}
    </svg>
  )
}

/** 모델 탭: 직접 학습(알고리즘·파라미터·조건·결과 선택) → 버전 저장 → 적용. 적용한 모델이 제안·예측·다음 실험에 쓰인다 */
export function ModelPage() {
  const db = useDb()
  const { project, setProject, projects } = useProjectParam()
  const { model, busy } = useModel(project)
  const pooled = useMemo(() => (project ? pool(db, project) : null), [db, project])
  const group = project ? groupKeyOf(project) : ''
  const versions = useMemo(() => modelsOf(db, group).sort((a, b) => b.version - a.version), [db, group])
  if (!project || !pooled) {
    return (
      <div className="stack">
        <h1>모델</h1>
        <p className="muted">
          프로젝트 없음. <Link to="/new">새 프로젝트</Link> → 완료 {MIN_TRAIN}건부터 학습.
        </p>
      </div>
    )
  }
  const runs = db.runs.filter((r) => r.project === project.id)
  const done = runs.filter((r) => r.status === 'done').length
  const pooledDone = pooled.runs.filter((r) => r.status === 'done').length

  return (
    <div className="stack">
      <div className="row between">
        <h1>모델</h1>
        <div className="field">
          <label htmlFor="mp">프로젝트</label>
          <select id="mp" className="input input--sm" value={project.id} onChange={(e) => setProject(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <section className="card stack" aria-labelledby="h-applied">
        <h2 id="h-applied">적용 중인 모델</h2>
        <ul className="goal-list">
          <li>
            <span className="muted small">학습 데이터</span>
            <b>완료 {pooledDone}건</b>
            <span className="muted small">{pooled.projects.length > 1 ? `= 이 프로젝트 ${done}건 + 같은 변수 프로젝트 ${pooled.projects.length - 1}개` : `(이 프로젝트만)`}</span>
            {db.projects.length > 1 && (
              <label className="row small">
                <input type="checkbox" checked={project.pool !== false} onChange={(e) => updateProject(project.id, { pool: e.target.checked })} />
                같은 변수 프로젝트 모아서
              </label>
            )}
          </li>
          {!model ? (
            <li className="muted">{busy ? '만드는 중…' : ''}</li>
          ) : (
            <>
              {model.models.map((m) => (
                <li key={m.target.id}>
                  <b>{m.target.name}</b>
                  <span className="chip chip--accent">{m.versionId ? `v${versions.find((v) => v.id === m.versionId)?.version ?? '?'} ${ALGOS[m.algo].short}` : `자동 ${ALGOS[m.algo].short}`}</span>
                  <span className={fitChip(m.r2)}>
                    R² {m.r2.toFixed(2)} · {describeFit(m.r2)}
                  </span>
                  <span className="muted small">
                    MAE {Number(m.mae.toPrecision(3))} · RMSE {Number(m.rmse.toPrecision(3))} · MSE {Number(m.mse.toPrecision(3))}
                    {m.target.unit ? ` (${m.target.unit})` : ''} · 실험 {m.n}건 · 조건 {m.featureIdx.length}개 · {m.folds}겹 교차검증
                    {!m.versionId && m.cv.ridge !== undefined && m.cv.forest !== undefined && ` · 자동 비교 R²: RF ${m.cv.forest.toFixed(2)} / 선형 ${m.cv.ridge.toFixed(2)}`}
                  </span>
                </li>
              ))}
              {model.skipped.map((s) => (
                <li key={s.target.id}>
                  <b>{s.target.name}</b>
                  <span className="muted small">{s.reason}</span>
                </li>
              ))}
            </>
          )}
        </ul>
        <p className="hint">모두 교차검증 값(학습에 쓰지 않은 실험으로) · R² 1에 가까울수록, MAE·RMSE·MSE 작을수록 좋음 · R² 0.3 미만이면 제안·예측에 쓰지 않음 · 실험 범위 안에서만 유효</p>
        {model && model.models.length > 0 && (
          <div className="stack">
            {model.models.map((m) => (
              <div key={m.target.id} className="split">
                <div>
                  <h3>{m.target.name} · 예측 vs 실제 (점선에 붙을수록 정확)</h3>
                  <CvChart m={m} />
                </div>
                <div>
                  <h3>{m.target.name} · 모델이 보는 조건 중요도</h3>
                  <ImportanceBars m={m} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {model && model.dataset.targets.length > 0 && <TrainCard key={model.dataset.features.map((f) => f.id).join('|')} project={project} model={model} versions={versions} group={group} pooledProjects={pooled.projects.map((q) => q.id)} />}

      <section className="card stack" aria-labelledby="h-ver">
        <h2 id="h-ver">버전</h2>
        {versions.length === 0 ? (
          <p className="muted small">저장한 버전 없음 → 자동 모델 사용 중. 위에서 학습해 저장하면 여기 쌓임.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>버전</th>
                  <th>결과</th>
                  <th>알고리즘</th>
                  <th>파라미터</th>
                  <th>조건</th>
                  <th>실험</th>
                  <th>R²</th>
                  <th>MAE</th>
                  <th>RMSE</th>
                  <th>학습일</th>
                  <th>상태</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td>v{v.version}</td>
                    <td style={{ textAlign: 'left' }}>{v.target}</td>
                    <td style={{ textAlign: 'left' }}>{KIND_LABEL[v.algo]}</td>
                    <td style={{ textAlign: 'left' }} className="small">
                      {paramText(v.algo, v.params as Params)}
                    </td>
                    <td title={v.features.join(', ')}>{v.features.length}개</td>
                    <td>{v.n}</td>
                    <td>
                      <b>{v.r2.toFixed(2)}</b>
                    </td>
                    <td>{Number(v.mae.toPrecision(3))}</td>
                    <td>{Number((v.rmse ?? v.residSd).toPrecision(3))}</td>
                    <td className="small">{v.trainedAt.slice(0, 16).replace('T', ' ')}</td>
                    <td>{v.applied ? <span className="chip chip--ok">적용 중</span> : <span className="muted small">—</span>}</td>
                    <td>
                      <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        {v.applied ? (
                          <button type="button" className="btn btn--ghost small" onClick={() => applyModelVersion(group, v.target, null)}>
                            자동으로
                          </button>
                        ) : (
                          <button type="button" className="btn btn--ghost small" onClick={() => applyModelVersion(group, v.target, v.id)}>
                            적용
                          </button>
                        )}
                        <button type="button" className="btn btn--ghost small" aria-label={`v${v.version} 삭제`} onClick={() => confirm(`v${v.version}을 지울까요?`) && deleteModelVersion(v.id)}>
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">적용 = 이 결과의 제안·예측·다음 실험 계획에 쓰는 모델. 같은 변수를 가진 프로젝트가 함께 씀. 자동 = 포레스트 vs 선형 중 교차검증이 좋은 쪽.</p>
      </section>

      {model && model.models.some((m) => m.reliable) ? (
        <SuggestCard project={project} runs={runs} model={model} />
      ) : (
        model &&
        model.models.length > 0 && (
          <section className="card">
            <h2>목표를 만족할 조건</h2>
            <p className="muted small">R² 0.3 이상인 모델 없음 → 제안 안 함. 실험이 더 쌓이거나 다른 알고리즘·조건으로 학습해 보세요.</p>
          </section>
        )
      )}
    </div>
  )
}

function TrainCard({ project, model, versions, group, pooledProjects }: { project: Project; model: Model; versions: ModelVersion[]; group: string; pooledProjects: ID[] }) {
  const targets = model.dataset.targets
  const features = model.dataset.features
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '')
  const [algo, setAlgo] = useState<Algo>('forest')
  const [params, setParams] = useState<Params>(defaultParams('forest'))
  const [folds, setFolds] = useState(5)
  const [sel, setSel] = useState<Set<number>>(() => new Set(features.map((_, j) => j)))
  const [result, setResult] = useState<{ tm: TargetModel; ms: number } | { reason: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const target = targets.find((t) => t.id === targetId) ?? targets[0]
  const projIdx = features.map((f, j) => (f.id.startsWith(PROJECT_PREFIX) ? j : -1)).filter((j) => j >= 0)
  const plainIdx = features.map((_, j) => j).filter((j) => !projIdx.includes(j))
  const toggle = (j: number) =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(j)) n.delete(j)
      else n.add(j)
      return n
    })
  const toggleProj = (on: boolean) =>
    setSel((s) => {
      const n = new Set(s)
      for (const j of projIdx) if (on) n.add(j)
      else n.delete(j)
      return n
    })
  const train = () => {
    if (!target) return
    setBusy(true)
    setResult(null)
    setTimeout(() => {
      const t0 = Date.now()
      const tm = trainTarget(model.dataset, target, { algo, params, featureIdx: [...sel].sort((a, b) => a - b), folds, seed: 7 })
      setResult('reason' in tm ? tm : { tm, ms: Date.now() - t0 })
      setBusy(false)
    }, 20)
  }
  const save = (apply: boolean) => {
    if (!result || 'reason' in result) return
    const version = versions.reduce((m, v) => Math.max(m, v.version), 0) + 1
    addModelVersion(toVersion(result.tm, model.dataset, { id: newId('m'), group, version, projects: pooledProjects, pooled: project.pool !== false, note }), apply)
    setResult(null)
    setNote('')
  }
  return (
    <section className="card stack" aria-labelledby="h-train">
      <h2 id="h-train">새 모델 학습</h2>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field">
          <label htmlFor="t-y">결과 (label)</label>
          <select id="t-y" className="input input--sm" value={target?.id ?? ''} onChange={(e) => setTargetId(e.target.value)}>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {label(t)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="t-a">알고리즘</label>
          <select
            id="t-a"
            className="input input--sm"
            value={algo}
            onChange={(e) => {
              const a = e.target.value as Algo
              setAlgo(a)
              setParams(defaultParams(a))
            }}
          >
            {(Object.keys(ALGOS) as Algo[]).map((a) => (
              <option key={a} value={a}>
                {ALGOS[a].label}
              </option>
            ))}
          </select>
        </div>
        {ALGOS[algo].params.map((s) => (
          <div key={s.key} className="field" style={{ width: 150 }}>
            <label htmlFor={`t-${s.key}`}>{s.label}</label>
            <input id={`t-${s.key}`} className="input input--sm input--num" type="number" min={s.min} max={s.max} step={s.step} value={params[s.key] ?? s.def} onChange={(e) => setParams((p) => ({ ...p, [s.key]: Number(e.target.value) }))} />
          </div>
        ))}
        <div className="field" style={{ width: 120 }}>
          <label htmlFor="t-f">교차검증 겹</label>
          <select id="t-f" className="input input--sm" value={folds} onChange={(e) => setFolds(Number(e.target.value))}>
            {[3, 5, 10].map((k) => (
              <option key={k} value={k}>
                {k}겹
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="hint">{ALGOS[algo].note}</p>
      <div>
        <h3>조건 (feature) · {sel.size}개 선택</h3>
        <div className="row" role="group" aria-label="조건 선택">
          {plainIdx.map((j) => (
            <label key={j} className={`chip ${sel.has(j) ? 'chip--accent' : ''}`} style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={sel.has(j)} onChange={() => toggle(j)} style={{ marginRight: 4 }} />
              {features[j].name}
            </label>
          ))}
          {projIdx.length > 0 && (
            <label className={`chip ${projIdx.every((j) => sel.has(j)) ? 'chip--accent' : ''}`} style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={projIdx.every((j) => sel.has(j))} onChange={(e) => toggleProj(e.target.checked)} style={{ marginRight: 4 }} />
              프로젝트 표시 변수 ({projIdx.length})
            </label>
          )}
        </div>
      </div>
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={train} disabled={busy || !target || sel.size === 0}>
          {busy ? '학습 중…' : '학습하기'}
        </button>
        <span className="muted small">완료 {model.dataset.runs.length}건 · 저장한 버전은 데이터가 바뀌어도 그대로(다시 학습해야 반영)</span>
      </div>
      {result && 'reason' in result && (
        <p className="error" role="alert">
          {result.reason}
        </p>
      )}
      {result && !('reason' in result) && (
        <div className="banner stack" style={{ gap: 8 }}>
          <div className="row">
            <b>{result.tm.target.name}</b>
            <span className="chip chip--accent">{ALGOS[algo].short}</span>
            <span className={fitChip(result.tm.r2)}>
              R² {result.tm.r2.toFixed(2)} · {describeFit(result.tm.r2)}
            </span>
            <span className="muted small">
              MAE {Number(result.tm.mae.toPrecision(3))} · RMSE {Number(result.tm.rmse.toPrecision(3))} · MSE {Number(result.tm.mse.toPrecision(3))} · 실험 {result.tm.n}건 · 조건 {result.tm.featureIdx.length}개 · {result.ms}ms
            </span>
          </div>
          <div className="split">
            <CvChart m={result.tm} />
            <ImportanceBars m={result.tm} />
          </div>
          <div className="row">
            <input className="input input--sm" style={{ maxWidth: 320 }} placeholder="메모 (선택)" aria-label="버전 메모" value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="button" className="btn btn--primary" onClick={() => save(true)}>
              저장하고 적용
            </button>
            <button type="button" className="btn" onClick={() => save(false)}>
              저장만
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setResult(null)}>
              버리기
            </button>
          </div>
        </div>
      )}
    </section>
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
      const t = draft[f.id] ?? (next && Number.isFinite(next.x[f.id]) ? String(next.x[f.id]) : String(model.dataset.medians[model.dataset.features.indexOf(f)]))
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
        <p className="muted small">
          필수 목표 없음 → <Link to={`/p/${project.id}/setup`}>설정</Link>에서 목표 추가
        </p>
      ) : sug.problem ? (
        <p className="muted small">{sug.problem}</p>
      ) : (
        <>
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
          <p className="hint">
            실험 범위 안 · 확률 = 예측 오차 감안한 만족 가능성(보장 아님) · 이미 계획한 조건은 피함
            {sug.unmodeled.length > 0 && ` · 제외: ${sug.unmodeled.map((u) => `${describeGoal(project, u.goal)} (${u.reason})`).join(', ')}`}
          </p>
        </>
      )}

      <h3 style={{ marginTop: 16 }}>조건을 바꿔 보며 예측</h3>
      <div className="cond-grid">
        {features.map((f) => (
          <div key={f.id} className="field">
            <label htmlFor={`w-${f.id}`}>{label(f)}</label>
            <input id={`w-${f.id}`} className="input input--sm input--num" inputMode="decimal" value={draft[f.id] ?? (what.values[f.id] === null ? '' : String(what.values[f.id]))} onChange={(e) => setDraft((d) => ({ ...d, [f.id]: e.target.value }))} />
          </div>
        ))}
      </div>
      {what.outOfRange.length > 0 && <p className="error">{what.outOfRange.map((v) => v.name).join(', ')}: 실험 범위 밖 → 예측 불확실</p>}
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
