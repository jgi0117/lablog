import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useProjectParam, valueText } from '../components'
import { BoxPlots, InfluenceBars, ScatterChart, boxStats, decimalSuspect, type BoxRow } from '../charts'
import { checkGoal, describeGoal, fmt, inputsOf, label, levelsOf, outputsOf, type Goal, type ID, type Project, type Run, type Variable } from '../domain/types'
import { download, exportDb, parseBackup, parseCsv, runsToCsv, tableToRuns } from '../services/csv'
import { nextRun } from '../services/plan'
import { scopeRuns } from '../services/pool'
import { addRuns, deleteRuns, insertPlanned, newId, nextOrder, now, replaceDb, updateRun, useDb } from '../services/store'

function runGoal(p: Project, r: Run, g: Goal): boolean | null {
  if (g.at && r.x[g.at.variable] !== g.at.value) return null
  const v = p.variables.find((x) => x.id === g.variable)
  if (!v) return null
  const val = v.role === 'output' ? r.y[v.id] : r.x[v.id]
  return Number.isFinite(val) ? checkGoal(g, val).ok : null
}

/**
 * 데이터: 모든 실험을 한 표로. 같은 변수를 가진 프로젝트를 함께 보면 모델이 학습하는 바로 그 표가 된다.
 * 고른 프로젝트의 실험은 칸을 눌러 고치고, CSV로 더하거나 내려받는다. 아래에 산점도와 조건별 영향.
 */
export function DataPage() {
  const db = useDb()
  const { project, setProject, projects } = useProjectParam()
  const [together, setTogether] = useState(true)
  const [filter, setFilter] = useState<'all' | 'done' | 'planned'>('all')
  const [adding, setAdding] = useState(false)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [hl, setHl] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [yId, setYId] = useState('')
  const [xId, setXId] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const backupRef = useRef<HTMLInputElement>(null)
  const scope = useMemo(() => (project ? scopeRuns(db, project, together) : { runs: [], projects: [] }), [db, project, together])
  const names = useMemo(() => new Map(db.projects.map((p) => [p.id, p.name])), [db])

  const importBackup = async (f: File) => {
    const parsed = parseBackup(await f.text())
    if (!parsed) return alert('읽을 수 없는 백업 파일입니다. lablog에서 내보낸 JSON이어야 합니다.')
    const add = db.projects.length === 0 || confirm(`프로젝트 ${parsed.projects.length}개, 실험 ${parsed.runs.length}건을 읽었습니다.\n확인: 지금 데이터에 더합니다 / 취소: 지금 데이터를 모두 지우고 바꿉니다`)
    if (add) replaceDb({ version: 3, projects: [...db.projects, ...parsed.projects], runs: [...db.runs, ...parsed.runs] })
    else replaceDb(parsed)
  }

  if (!project) {
    return (
      <div className="stack">
        <h1>데이터</h1>
        <p className="muted">
          프로젝트가 없습니다. <Link to="/new">새 프로젝트</Link>를 만들거나 백업을 가져오세요.
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
  const inputs = inputsOf(project)
  const levels = levelsOf(project)
  const outputs = outputsOf(project)
  const musts = project.goals.filter((g) => g.must)
  const next = nextRun(db.runs.filter((r) => r.project === project.id))
  const filtered = [...scope.runs].filter((r) => filter === 'all' || r.status === filter).sort((a, b) => (a.project === b.project ? b.order - a.order : a.project === project.id ? -1 : b.project === project.id ? 1 : 0))
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const cur = Math.min(page, pageCount - 1)
  const shown = filtered.slice(cur * pageSize, (cur + 1) * pageSize)
  /** 이상치 후보를 누르면 표에서 그 실험이 있는 쪽으로 간다 */
  const jumpTo = (runId: string) => {
    const all = [...scope.runs].sort((a, b) => (a.project === b.project ? b.order - a.order : a.project === project.id ? -1 : b.project === project.id ? 1 : 0))
    const i = all.findIndex((r) => r.id === runId)
    if (i < 0) return
    setFilter('all')
    setPage(Math.floor(i / pageSize))
    setHl(runId)
  }
  const doneScope = scope.runs.filter((r) => r.status === 'done')

  const importCsv = async (f: File) => {
    const t = parseCsv(await f.text())
    const { runs: rs, matched, unmatched } = tableToRuns(project, t, nextOrder(db, project.id))
    if (rs.length === 0) return setMsg(`맞는 열이 없습니다. 머리글이 변수 이름(${project.variables.map((v) => v.name).join(', ')})과 같아야 합니다.`)
    addRuns(rs)
    setMsg(`${project.name}에 ${rs.length}건을 더했습니다 (맞은 열: ${matched.map((v) => v.name).join(', ')}${unmatched.length ? ` · 안 쓴 열: ${unmatched.join(', ')}` : ''})`)
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

  // 입력 점검: 변수마다 분포와 이상치 후보(1.5 IQR 밖). 중앙값의 10^k 배면 소수점 의심
  const checkRows: BoxRow[] = []
  const suspects: { row: BoxRow; idx: number; run: Run; k: number | null }[] = []
  const withValues = scope.runs.filter((r) => Object.keys(r.x).length > 0 || Object.keys(r.y).length > 0)
  for (const v of [...inputs, ...levels, ...outputs]) {
    const vals = withValues.map((r) => (v.role === 'output' ? r.y[v.id] : r.x[v.id]))
    const st = boxStats(vals.map((x) => (Number.isFinite(x) ? x : NaN)))
    if (!st || new Set(vals.filter((x) => Number.isFinite(x))).size < 2) continue
    const row: BoxRow = { key: v.id, name: v.name, unit: v.unit, values: vals, labels: withValues.map((r) => `#${r.order}${together ? ` ${names.get(r.project) ?? ''}` : ''}`), stats: st }
    checkRows.push(row)
    for (const idx of st.outliers) suspects.push({ row, idx, run: withValues[idx], k: decimalSuspect(vals[idx], st.med) })
  }
  suspects.sort((a, b) => Number(b.k !== null) - Number(a.k !== null))

  // 차트
  const y = outputs.find((v) => v.id === yId) ?? outputs[0]
  const goal = y ? (project.goals.find((g) => g.variable === y.id && g.must) ?? project.goals.find((g) => g.variable === y.id)) : undefined
  const levelVar = levels[0]
  const xCands = [...inputs, ...levels].filter((v) => new Set(doneScope.map((r) => r.x[v.id])).size > 1)
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
              value={project.id}
              onChange={(e) => {
                setProject(e.target.value)
                setPage(0)
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <label className="row small" style={{ marginTop: 18 }}>
            <input type="checkbox" checked={together} onChange={(e) => setTogether(e.target.checked)} />
            같은 변수를 가진 프로젝트 {scope.projects.length > 1 ? `${scope.projects.length - 1}개` : ''} 함께 보기 (모델이 학습하는 표)
          </label>
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
              {f === 'all' ? `전체 ${scope.runs.length}` : f === 'done' ? `완료 ${doneScope.length}` : `계획 ${scope.runs.filter((r) => r.status === 'planned').length}`}
            </button>
          ))}
        </div>
      </div>

      <div className="row between">
        <p className="muted small">
          <Link to={`/p/${project.id}`}>{project.name} 실험 화면 →</Link> · 고른 프로젝트 칸만 수정 가능
        </p>
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
      </div>
      {msg && <p className="small">{msg}</p>}
      {adding && <ManualRun project={project} onDone={() => setAdding(false)} />}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {together && <th>프로젝트</th>}
              <th>#</th>
              <th>상태</th>
              {[...inputs, ...levels].map((v) => (
                <th key={v.id}>{label(v)}</th>
              ))}
              {outputs.map((v) => (
                <th key={v.id}>{label(v)}</th>
              ))}
              {musts.map((g) => (
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
              const own = r.project === project.id
              return (
                <tr key={r.id} className={`${r.status === 'planned' ? (next?.id === r.id ? 'is-next' : 'is-planned') : ''}${hl === r.id ? ' is-hl' : ''}`}>
                  {together && <td>{own ? <b>{names.get(r.project)}</b> : <span className="muted">{names.get(r.project)}</span>}</td>}
                  <td>{r.order}</td>
                  <td>{r.status === 'done' ? '완료' : r.status === 'planned' ? (next?.id === r.id ? '다음' : '계획') : '건너뜀'}</td>
                  {[...inputs, ...levels].map((v) => (
                    <td key={v.id}>
                      {own ? (
                        <input className="input input--sm input--num" style={{ width: 90, fontSize: 14, minHeight: 30 }} aria-label={`#${r.order} ${v.name}`} defaultValue={valueText(v, r.x[v.id]) === '—' ? '' : valueText(v, r.x[v.id])} onBlur={(e) => editCell(r, v, e.target.value)} />
                      ) : (
                        valueText(v, r.x[v.id])
                      )}
                    </td>
                  ))}
                  {outputs.map((v) => (
                    <td key={v.id}>
                      {own ? (
                        <input className="input input--sm input--num" style={{ width: 90, fontSize: 14, minHeight: 30 }} aria-label={`#${r.order} ${v.name}`} defaultValue={Number.isFinite(r.y[v.id]) ? String(r.y[v.id]) : ''} onBlur={(e) => editCell(r, v, e.target.value)} />
                      ) : (
                        <b>{valueText(v, r.y[v.id])}</b>
                      )}
                    </td>
                  ))}
                  {musts.map((g) => {
                    const ok = own ? runGoal(project, r, g) : null
                    return (
                      <td key={g.id} className={ok === null ? '' : ok ? 'pass' : 'fail'}>
                        {ok === null ? '' : ok ? '✓' : '✗'}
                      </td>
                    )
                  })}
                  <td style={{ textAlign: 'left' }}>{own ? <input className="input input--sm" style={{ width: 140, fontSize: 13, minHeight: 30 }} aria-label={`#${r.order} 메모`} defaultValue={r.note} onBlur={(e) => e.target.value !== r.note && updateRun(r.id, { note: e.target.value })} /> : <span className="muted small">{r.note}</span>}</td>
                  <td>
                    {own && (
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
          <h2 id="h-check">입력 점검 · 분포와 이상치 후보</h2>
          <p className="hint">변수마다 상자 = 가운데 50%(Q1~Q3), 선 = 중앙값, 수염 = 1.5 IQR 안 · 주황 점 = 밖(이상치 후보, 누르면 표에서 찾기) · 소수점 실수(×10, ×0.1)는 따로 표시</p>
          <BoxPlots rows={checkRows} onPick={(_, idx) => jumpTo(withValues[idx].id)} />
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
                        {together && q.run.project !== project.id ? ` · ${names.get(q.run.project)}` : ''}
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
            <h2 id="h-scatter">조건과 결과의 관계</h2>
            <div className="row">
              {outputs.length > 1 && (
                <div className="field">
                  <label htmlFor="cy">결과</label>
                  <select id="cy" className="input input--sm" value={y.id} onChange={(e) => setYId(e.target.value)}>
                    {outputs.map((v) => (
                      <option key={v.id} value={v.id}>
                        {label(v)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {x && (
                <div className="field">
                  <label htmlFor="cx">조건</label>
                  <select id="cx" className="input input--sm" value={x.id} onChange={(e) => setXId(e.target.value)}>
                    {xCands.map((v) => (
                      <option key={v.id} value={v.id}>
                        {label(v)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            {x ? <ScatterChart pts={pts} x={x} y={y} goal={goal} /> : <p className="muted">값이 달라지는 조건이 없습니다.</p>}
            <p className="hint">
              {together ? `같은 변수를 가진 프로젝트 ${scope.projects.length}개의 완료 실험` : `${project.name}의 완료 실험`}
              {goal?.at && levelVar ? ` 중 ${levelVar.name} ${goal.at.value}${levelVar.unit}인 것` : ''}. 초록 띠는 {project.name}의 목표 범위.
            </p>
          </section>
          <section className="card stack" aria-labelledby="h-infl">
            <h2 id="h-infl">어떤 조건이 {y.name}을(를) 움직이는가</h2>
            <p className="hint">상관계수(−1~1) · 상관 ≠ 원인 · 실험 적으면 우연일 수 있음 · 모델 중요도는 모델 탭</p>
            <InfluenceBars variables={[...inputs, ...levels]} runs={doneScope} y={y} levelVar={levelVar} goal={goal} />
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
      <p className="hint">결과를 비워 두면 계획 실험으로, 넣으면 완료 실험으로 들어갑니다.</p>
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
