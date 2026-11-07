import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { valueText } from '../components'
import { BoxPlots, InfluenceBars, ScatterChart, boxStats, decimalSuspect, type BoxRow } from '../charts'
import { checkGoal, describeGoal, fmt, inputsOf, label, levelsOf, outputsOf, type Goal, type ID, type Project, type Run, type Variable } from '../domain/types'
import { download, exportDb, parseBackup, parseCsv, runsToCsv, tableToRuns } from '../services/csv'
import { nextRun, status } from '../services/plan'
import { scopeRuns, unionScope } from '../services/pool'
import { addRuns, deleteRuns, insertPlanned, newId, nextOrder, now, replaceDb, runsOf, updateRun, useDb } from '../services/store'

const ALL = 'all'

function runGoal(p: Project, r: Run, g: Goal): boolean | null {
  if (g.at && r.x[g.at.variable] !== g.at.value) return null
  const v = p.variables.find((x) => x.id === g.variable)
  if (!v) return null
  const val = v.role === 'output' ? r.y[v.id] : r.x[v.id]
  return Number.isFinite(val) ? checkGoal(g, val).ok : null
}

/**
 * 데이터: 모든 실험을 한 표로.
 * - 프로젝트 하나(+ 같은 변수 프로젝트): 모델이 학습하는 표. 고른 프로젝트 칸은 바로 고친다
 * - 전체: 변수 이름 기준으로 모든 프로젝트를 합쳐 읽기만 한다
 * 한 쪽에 10건, 입력 점검(박스플롯·이상치·소수점 의심), 산점도, 조건별 상관.
 */
export function DataPage() {
  const db = useDb()
  const [params, setParams] = useSearchParams()
  const [together, setTogether] = useState(false)
  const [filter, setFilter] = useState<'all' | 'done' | 'planned'>('all')
  const [adding, setAdding] = useState(false)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [hl, setHl] = useState<string | null>(null)
  const [scaled, setScaled] = useState(true)
  const [msg, setMsg] = useState('')
  const [yId, setYId] = useState('')
  const [xId, setXId] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const backupRef = useRef<HTMLInputElement>(null)

  const sel = params.get('p')
  const isAll = sel === ALL
  const project = useMemo(() => {
    if (isAll) return null
    const fallback = db.projects.find((p) => !p.reference && !status(p, runsOf(db, p.id)).finished) ?? db.projects.find((p) => !p.reference) ?? db.projects[0] ?? null
    return db.projects.find((p) => p.id === sel) ?? fallback
  }, [db, sel, isAll])
  const names = useMemo(() => new Map(db.projects.map((p) => [p.id, p.name])), [db])

  // 보는 범위: 변수 목록과 실험들
  const view = useMemo(() => {
    if (isAll || !project) {
      const u = unionScope(db)
      return { inputs: u.variables.filter((v) => v.role === 'input'), levels: u.variables.filter((v) => v.role === 'level'), outputs: u.variables.filter((v) => v.role === 'output'), runs: u.runs, projects: u.projects, goals: [] as Goal[] }
    }
    const sc = scopeRuns(db, project, together)
    return { inputs: inputsOf(project), levels: levelsOf(project), outputs: outputsOf(project), runs: sc.runs, projects: sc.projects, goals: project.goals.filter((g) => g.must) }
  }, [db, project, together, isAll])
  const vars = [...view.inputs, ...view.levels, ...view.outputs]
  const multi = isAll || view.projects.length > 1
  // 함께 볼 수 있는 같은 변수 프로젝트 수(체크 여부와 무관)
  const mates = useMemo(() => (project ? scopeRuns(db, project, true).projects.length - 1 : 0), [db, project])

  const importBackup = async (f: File) => {
    const parsed = parseBackup(await f.text())
    if (!parsed) return alert('읽을 수 없는 백업 파일입니다. lablog에서 내보낸 JSON이어야 합니다.')
    const add = db.projects.length === 0 || confirm(`프로젝트 ${parsed.projects.length}개, 실험 ${parsed.runs.length}건을 읽었습니다.\n확인: 지금 데이터에 더합니다 / 취소: 지금 데이터를 모두 지우고 바꿉니다`)
    if (add) replaceDb({ version: 3, projects: [...db.projects, ...parsed.projects], runs: [...db.runs, ...parsed.runs], models: [...(db.models ?? []), ...(parsed.models ?? [])] })
    else replaceDb(parsed)
  }

  if (db.projects.length === 0) {
    return (
      <div className="stack">
        <h1>데이터</h1>
        <p className="muted">
          프로젝트 없음 → <Link to="/new">새 프로젝트</Link> 또는 백업 가져오기
        </p>
        <div className="row">
          <button type="button" className="btn" onClick={() => backupRef.current?.click()}>
            백업 가져오기
          </button>
          <input ref={backupRef} type="file" accept=".json,application/json" hidden aria-label="백업 파일" onChange={(e) => e.target.files?.[0] && importBackup(e.target.files[0])} />
        </div>
      </div>
    )
  }

  const next = project ? nextRun(db.runs.filter((r) => r.project === project.id)) : null
  const sortRuns = (a: Run, b: Run) => (a.project === b.project ? b.order - a.order : project && a.project === project.id ? -1 : project && b.project === project.id ? 1 : (names.get(a.project) ?? '').localeCompare(names.get(b.project) ?? ''))
  const filtered = [...view.runs].filter((r) => filter === 'all' || r.status === filter).sort(sortRuns)
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const cur = Math.min(page, pageCount - 1)
  const shown = filtered.slice(cur * pageSize, (cur + 1) * pageSize)
  const doneScope = view.runs.filter((r) => r.status === 'done')
  const jumpTo = (runId: string) => {
    const i = [...view.runs].sort(sortRuns).findIndex((r) => r.id === runId)
    if (i < 0) return
    setFilter('all')
    setPage(Math.floor(i / pageSize))
    setHl(runId)
  }

  const importCsv = async (f: File) => {
    if (!project) return
    const t = parseCsv(await f.text())
    const { runs: rs, matched, unmatched } = tableToRuns(project, t, nextOrder(db, project.id))
    if (rs.length === 0) return setMsg(`맞는 열 없음. 머리글 = 변수 이름(${project.variables.map((v) => v.name).join(', ')})`)
    addRuns(rs)
    setMsg(`${project.name}에 ${rs.length}건 추가 (맞은 열: ${matched.map((v) => v.name).join(', ')}${unmatched.length ? ` · 안 쓴 열: ${unmatched.join(', ')}` : ''})`)
  }

  const editCell = (r: Run, v: Variable, raw: string) => {
    const t = raw.trim()
    if (v.role === 'output') {
      const y = { ...r.y }
      if (t === '') delete y[v.id]
      else if (Number.isFinite(Number(t))) y[v.id] = Number(t)
      else return
      updateRun(r.id, { y, status: Object.keys(y).length > 0 ? 'done' : r.status === 'done' ? 'planned' : r.status, date: r.date ?? now() })
    } else if (Number.isFinite(Number(t)) && t !== '') updateRun(r.id, { x: { ...r.x, [v.id]: Number(t) } })
  }

  // 입력 점검
  const withValues = view.runs.filter((r) => Object.keys(r.x).length > 0 || Object.keys(r.y).length > 0)
  const checkRows: BoxRow[] = []
  const suspects: { row: BoxRow; idx: number; run: Run; k: number | null }[] = []
  for (const v of vars) {
    const vals = withValues.map((r) => (v.role === 'output' ? r.y[v.id] : r.x[v.id]))
    const st = boxStats(vals.map((x) => (Number.isFinite(x) ? x : NaN)))
    if (!st || new Set(vals.filter((x) => Number.isFinite(x))).size < 2) continue
    const row: BoxRow = { key: v.id, name: v.name, unit: v.unit, values: vals, labels: withValues.map((r) => `#${r.order}${multi ? ` ${names.get(r.project) ?? ''}` : ''}`), stats: st }
    checkRows.push(row)
    for (const idx of st.outliers) suspects.push({ row, idx, run: withValues[idx], k: decimalSuspect(vals[idx], st.med) })
  }
  suspects.sort((a, b) => Number(b.k !== null) - Number(a.k !== null))

  // 차트
  const y = view.outputs.find((v) => v.id === yId) ?? view.outputs[0]
  const goal = y && project ? (project.goals.find((g) => g.variable === y.id && g.must) ?? project.goals.find((g) => g.variable === y.id)) : undefined
  const levelVar = view.levels[0]
  const xCands = [...view.inputs, ...view.levels].filter((v) => new Set(doneScope.map((r) => r.x[v.id])).size > 1)
  const x = xCands.find((v) => v.id === xId) ?? xCands[0]
  const pts = x && y ? doneScope.filter((r) => Number.isFinite(r.x[x.id]) && Number.isFinite(r.y[y.id]) && (!goal?.at || !levelVar || r.x[levelVar.id] === goal.at.value)).map((r) => ({ r, xv: r.x[x.id], yv: r.y[y.id] })) : []

  return (
    <div className="stack">
      <div className="row between">
        <h1>데이터</h1>
        <div className="row">
          <button type="button" className="btn" onClick={() => download(`lablog-${new Date().toISOString().slice(0, 10)}.json`, exportDb(db), 'application/json')}>
            전체 백업
          </button>
          <button type="button" className="btn" onClick={() => backupRef.current?.click()}>
            백업 가져오기
          </button>
          <input ref={backupRef} type="file" accept=".json,application/json" hidden aria-label="백업 파일" onChange={(e) => e.target.files?.[0] && importBackup(e.target.files[0])} />
        </div>
      </div>

      <div className="card row between">
        <div className="row">
          <div className="field">
            <label htmlFor="dp">프로젝트</label>
            <select
              id="dp"
              className="input input--sm"
              value={isAll ? ALL : (project?.id ?? '')}
              onChange={(e) => {
                setParams({ p: e.target.value })
                setPage(0)
              }}
            >
              <option value={ALL}>전체 데이터 (프로젝트 {db.projects.filter((p) => !p.reference).length}개 + 과거 기록)</option>
              {db.projects.filter((p) => !p.reference).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {!isAll && mates > 0 && (
            <label className="row small" style={{ marginTop: 18 }}>
              <input
                type="checkbox"
                checked={together}
                onChange={(e) => {
                  setTogether(e.target.checked)
                  setPage(0)
                }}
              />
              같은 변수 프로젝트 {mates}개 함께 (모델이 학습하는 표)
            </label>
          )}
        </div>
        <div className="row" role="group" aria-label="보기">
          {(['all', 'done', 'planned'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`btn ${filter === f ? 'btn--primary' : ''}`}
              onClick={() => {
                setFilter(f)
                setPage(0)
              }}
            >
              {f === 'all' ? `전체 ${view.runs.length}` : f === 'done' ? `완료 ${doneScope.length}` : `계획 ${view.runs.filter((r) => r.status === 'planned').length}`}
            </button>
          ))}
        </div>
      </div>

      <div className="row between">
        <p className="muted small">
          {project ? (
            <>
              <Link to={`/p/${project.id}`}>{project.name} 실험 화면 →</Link> · 고른 프로젝트 칸만 수정 가능
            </>
          ) : (
            <>전체 보기 · 변수 이름이 같으면 한 열 · 읽기만</>
          )}
        </p>
        {project && (
          <div className="row">
            <button type="button" className="btn" onClick={() => setAdding((a) => !a)}>
              + 직접 추가
            </button>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              CSV 더하기
            </button>
            <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,text/csv" hidden aria-label="CSV 파일" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
            <button type="button" className="btn" onClick={() => download(`${project.name}.csv`, runsToCsv(project, db.runs.filter((r) => r.project === project.id)), 'text/csv')}>
              CSV 내려받기
            </button>
          </div>
        )}
      </div>
      {msg && <p className="small">{msg}</p>}
      {adding && project && <ManualRun project={project} onDone={() => setAdding(false)} />}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {multi && <th>프로젝트</th>}
              <th>#</th>
              <th>상태</th>
              {vars.map((v) => (
                <th key={v.id}>{label(v)}</th>
              ))}
              {project &&
                view.goals.map((g) => (
                  <th key={g.id} title={describeGoal(project, g)}>
                    {describeGoal(project, g)}
                  </th>
                ))}
              <th>메모</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const own = !!project && r.project === project.id
              return (
                <tr key={r.id} className={`${r.status === 'planned' ? (next?.id === r.id ? 'is-next' : 'is-planned') : ''}${hl === r.id ? ' is-hl' : ''}`}>
                  {multi && <td>{own ? <b>{names.get(r.project)}</b> : <span className="muted">{names.get(r.project)}</span>}</td>}
                  <td>{r.order}</td>
                  <td>{r.status === 'done' ? '완료' : r.status === 'planned' ? (next?.id === r.id ? '다음' : '계획') : '건너뜀'}</td>
                  {vars.map((v) => {
                    const val = v.role === 'output' ? r.y[v.id] : r.x[v.id]
                    return (
                      <td key={v.id}>
                        {own ? (
                          <input className="input input--sm input--num" style={{ width: 90, fontSize: 14, minHeight: 30 }} aria-label={`#${r.order} ${v.name}`} defaultValue={Number.isFinite(val) ? (v.role === 'output' ? String(val) : valueText(v, val)) : ''} onBlur={(e) => editCell(r, v, e.target.value)} />
                        ) : v.role === 'output' ? (
                          <b>{valueText(v, val)}</b>
                        ) : (
                          valueText(v, val)
                        )}
                      </td>
                    )
                  })}
                  {project &&
                    view.goals.map((g) => {
                      const ok = own ? runGoal(project, r, g) : null
                      return (
                        <td key={g.id} className={ok === null ? '' : ok ? 'pass' : 'fail'}>
                          {ok === null ? '' : ok ? '✓' : '✗'}
                        </td>
                      )
                    })}
                  <td style={{ textAlign: 'left' }}>{own ? <input className="input input--sm" style={{ width: 140, fontSize: 13, minHeight: 30 }} aria-label={`#${r.order} 메모`} defaultValue={r.note} onBlur={(e) => e.target.value !== r.note && updateRun(r.id, { note: e.target.value })} /> : <span className="muted small">{r.note}</span>}</td>
                  <td>
                    {own && project && (
                      <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        {r.status === 'planned' && next && next.id !== r.id && (
                          <button
                            type="button"
                            className="btn btn--ghost small"
                            onClick={() => {
                              deleteRuns([r.id])
                              insertPlanned(project.id, [{ ...r, id: newId('r') }], next.order)
                            }}
                          >
                            지금 하기
                          </button>
                        )}
                        {r.status === 'skipped' && (
                          <button type="button" className="btn btn--ghost small" onClick={() => updateRun(r.id, { status: 'planned' })}>
                            되살리기
                          </button>
                        )}
                        <button type="button" className="btn btn--ghost small" aria-label={`#${r.order} 지우기`} onClick={() => (r.status === 'done' ? confirm(`#${r.order} 결과를 지울까요?`) && deleteRuns([r.id]) : deleteRuns([r.id]))}>
                          ✕
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="row between">
        <div className="row" role="group" aria-label="페이지">
          <button type="button" className="btn" disabled={cur === 0} onClick={() => setPage(cur - 1)}>
            ‹ 이전
          </button>
          <span className="small">
            {cur + 1} / {pageCount} 쪽 · {filtered.length}건
          </span>
          <button type="button" className="btn" disabled={cur >= pageCount - 1} onClick={() => setPage(cur + 1)}>
            다음 ›
          </button>
        </div>
        <div className="field">
          <label htmlFor="ps">한 쪽에</label>
          <select
            id="ps"
            className="input input--sm"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setPage(0)
            }}
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}건
              </option>
            ))}
          </select>
        </div>
      </div>

      {checkRows.length > 0 && (
        <section className="card stack" aria-labelledby="h-check">
          <div className="row between">
            <h2 id="h-check">입력 점검 · 분포와 이상치 후보</h2>
            <div className="row" role="group" aria-label="눈금">
              <button type="button" className={`btn ${scaled ? 'btn--primary' : ''}`} onClick={() => setScaled(true)}>
                표준화 (중앙값·IQR)
              </button>
              <button type="button" className={`btn ${!scaled ? 'btn--primary' : ''}`} onClick={() => setScaled(false)}>
                원래 값
              </button>
            </div>
          </div>
          <p className="hint">
            {scaled ? '모든 변수를 (값 − 중앙값) ÷ IQR 로 맞춰 한 축에 · 상자 = 가운데 50% · 점선 ±2 = 수염 한계(1.5 IQR) · 주황 점 = 밖(이상치 후보, 누르면 표에서 찾기) · ±6 넘으면 끝에 붙여 그림' : '변수마다 자기 범위 · 상자 = 가운데 50% · 수염 = 1.5 IQR 안 · 주황 점 = 밖(이상치 후보, 누르면 표에서 찾기)'} · 소수점 실수(×10, ×0.1)는 표에서 따로 표시
          </p>
          <BoxPlots rows={checkRows} scaled={scaled} onPick={(_, idx) => jumpTo(withValues[idx].id)} />
          {suspects.length === 0 ? (
            <p className="muted small">이상치 후보 없음</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>변수</th>
                    <th>실험</th>
                    <th>값</th>
                    <th>중앙값</th>
                    <th>판단</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {suspects.slice(0, 30).map((q) => (
                    <tr key={`${q.row.key}-${q.run.id}`}>
                      <td>{q.row.name}</td>
                      <td>
                        #{q.run.order}
                        {multi && (!project || q.run.project !== project.id) ? ` · ${names.get(q.run.project)}` : ''}
                      </td>
                      <td>
                        <b>{fmt(q.row.values[q.idx])}</b>
                      </td>
                      <td>{fmt(q.row.stats.med)}</td>
                      <td style={{ textAlign: 'left' }}>{q.k !== null ? <span className="chip chip--bad">소수점 의심 (×{q.k > 0 ? 10 ** q.k : `0.${'0'.repeat(-q.k - 1)}1`})</span> : <span className="chip chip--warn">범위 밖</span>}</td>
                      <td>
                        <button type="button" className="btn btn--ghost small" onClick={() => jumpTo(q.run.id)}>
                          표에서 보기
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {suspects.length > 30 && <p className="muted small">후보 {suspects.length}건 중 30건 표시</p>}
        </section>
      )}

      {y && (
        <div className="split">
          <section className="card stack" aria-labelledby="h-scatter">
            <div className="row between">
              <h2 id="h-scatter">조건과 결과의 관계</h2>
              <div className="row chart-ctl">
                {view.outputs.length > 1 && (
                  <label className="row small">
                    결과
                    <select aria-label="결과" className="input input--sm" value={y.id} onChange={(e) => setYId(e.target.value)}>
                      {view.outputs.map((v) => (
                        <option key={v.id} value={v.id}>
                          {label(v)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {x && (
                  <label className="row small">
                    조건
                    <select aria-label="조건" className="input input--sm" value={x.id} onChange={(e) => setXId(e.target.value)}>
                      {xCands.map((v) => (
                        <option key={v.id} value={v.id}>
                          {label(v)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
            <p className="hint">
              {multi ? `프로젝트 ${view.projects.filter((q) => !q.reference).length}개${view.projects.some((q) => q.reference) ? ' + 과거 기록' : ''}의 완료 실험` : `${project?.name ?? ''}의 완료 실험`}
              {goal?.at && levelVar ? ` 중 ${levelVar.name} ${goal.at.value}${levelVar.unit}` : ''}
              {goal && project ? ` · 초록 띠 = ${project.name} 목표` : ''}
            </p>
            {x ? <ScatterChart pts={pts} x={x} y={y} goal={goal} /> : <p className="muted">값이 달라지는 조건 없음</p>}
          </section>
          <section className="card stack" aria-labelledby="h-infl">
            <h2 id="h-infl">어떤 조건이 {y.name}을(를) 움직이는가</h2>
            <p className="hint">막대 = 상관계수(−1~1) · 길수록 함께 움직임 · 상관 ≠ 원인 · 모델이 본 중요도는 모델 탭</p>
            <div className="chart-fill">
              <InfluenceBars variables={[...view.inputs, ...view.levels]} runs={doneScope} y={y} levelVar={levelVar} goal={goal} />
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function ManualRun({ project, onDone }: { project: Project; onDone: () => void }) {
  const db = useDb()
  const vars = [...inputsOf(project), ...levelsOf(project), ...outputsOf(project)]
  const [vals, setVals] = useState<Record<ID, string>>({})
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const x: Record<ID, number> = {}
    const y: Record<ID, number> = {}
    for (const v of vars) {
      const t = (vals[v.id] ?? '').trim()
      if (t === '' || !Number.isFinite(Number(t))) continue
      if (v.role === 'output') y[v.id] = Number(t)
      else x[v.id] = Number(t)
    }
    if (Object.keys(x).length === 0) return
    addRuns([{ id: newId('r'), project: project.id, order: nextOrder(db, project.id), x, y, status: Object.keys(y).length > 0 ? 'done' : 'planned', source: 'manual', note: '', date: Object.keys(y).length > 0 ? now() : null }])
    setVals({})
    onDone()
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <h2>{project.name}에 실험 직접 추가</h2>
      <p className="hint">결과 비우면 계획 실험, 넣으면 완료 실험</p>
      <div className="cond-grid">
        {vars.map((v) => (
          <div key={v.id} className="field">
            <label htmlFor={`m-${v.id}`}>{label(v)}</label>
            <input id={`m-${v.id}`} className="input input--sm input--num" inputMode="decimal" value={vals[v.id] ?? ''} onChange={(e) => setVals((s) => ({ ...s, [v.id]: e.target.value }))} />
          </div>
        ))}
      </div>
      <div className="row">
        <button type="submit" className="btn btn--primary">
          추가
        </button>
        <button type="button" className="btn" onClick={onDone}>
          닫기
        </button>
      </div>
    </form>
  )
}
