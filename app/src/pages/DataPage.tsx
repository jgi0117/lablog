import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ProjectHeader, useProject, valueText } from '../components'
import { checkGoal, describeGoal, inputsOf, label, levelsOf, outputsOf, type Goal, type ID, type Project, type Run } from '../domain/types'
import { download, parseCsv, runsToCsv, tableToRuns } from '../services/csv'
import { nextRun } from '../services/plan'
import { addRuns, deleteRuns, insertPlanned, newId, nextOrder, now, updateRun, useDb } from '../services/store'

function runGoal(p: Project, r: Run, g: Goal): boolean | null {
  if (g.at && r.x[g.at.variable] !== g.at.value) return null
  const v = p.variables.find((x) => x.id === g.variable)
  if (!v) return null
  const val = v.role === 'output' ? r.y[v.id] : r.x[v.id]
  return Number.isFinite(val) ? checkGoal(g, val).ok : null
}

/** 데이터: 모든 실험을 한 표로. 완료 값은 칸을 눌러 고치고, 계획 실험은 "지금 하기"로 순서를 당긴다 */
export function DataPage() {
  const { id } = useParams()
  const db = useDb()
  const { project, runs } = useProject(id)
  const [filter, setFilter] = useState<'all' | 'done' | 'planned'>('all')
  const [adding, setAdding] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const [limit, setLimit] = useState(60)
  const next = useMemo(() => nextRun(runs), [runs])

  if (!project) {
    return (
      <p className="muted">
        프로젝트가 없습니다. <Link to="/">홈으로</Link>
      </p>
    )
  }
  const inputs = inputsOf(project)
  const levels = levelsOf(project)
  const outputs = outputsOf(project)
  const musts = project.goals.filter((g) => g.must)
  const filtered = [...runs].filter((r) => filter === 'all' || r.status === filter).sort((a, b) => b.order - a.order)
  const shown = filtered.slice(0, limit)

  const importCsv = async (f: File) => {
    const t = parseCsv(await f.text())
    const { runs: rs, matched, unmatched } = tableToRuns(project, t, nextOrder(db, project.id))
    if (rs.length === 0) {
      setMsg(`맞는 열이 없습니다. 머리글이 변수 이름(${project.variables.map((v) => v.name).join(', ')})과 같아야 합니다.`)
      return
    }
    addRuns(rs)
    setMsg(`${rs.length}건을 더했습니다 (맞은 열: ${matched.map((v) => v.name).join(', ')}${unmatched.length ? ` · 안 쓴 열: ${unmatched.join(', ')}` : ''})`)
  }

  const editCell = (r: Run, v: (typeof outputs)[number] | (typeof inputs)[number], raw: string) => {
    const t = raw.trim()
    if (v.role === 'output') {
      const y = { ...r.y }
      if (t === '') delete y[v.id]
      else if (Number.isFinite(Number(t))) y[v.id] = Number(t)
      else return
      updateRun(r.id, { y, status: Object.keys(y).length > 0 ? 'done' : r.status === 'done' ? 'planned' : r.status, date: r.date ?? now() })
    } else if (Number.isFinite(Number(t)) && t !== '') updateRun(r.id, { x: { ...r.x, [v.id]: Number(t) } })
  }

  return (
    <div className="stack">
      <ProjectHeader project={project} runs={runs} />
      <div className="row between">
        <div className="row" role="group" aria-label="보기">
          {(['all', 'done', 'planned'] as const).map((f) => (
            <button key={f} type="button" className={`btn ${filter === f ? 'btn--primary' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? `전체 ${runs.length}` : f === 'done' ? `완료 ${runs.filter((r) => r.status === 'done').length}` : `계획 ${runs.filter((r) => r.status === 'planned').length}`}
            </button>
          ))}
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => setAdding((a) => !a)}>
            + 직접 추가
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            CSV 더하기
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,text/csv" hidden aria-label="CSV 파일" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          <button type="button" className="btn" onClick={() => download(`${project.name}.csv`, runsToCsv(project, runs), 'text/csv')}>
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
            {shown.map((r) => (
              <tr key={r.id} className={r.status === 'planned' ? (next?.id === r.id ? 'is-next' : 'is-planned') : ''}>
                <td>{r.order}</td>
                <td>{r.status === 'done' ? '완료' : r.status === 'planned' ? (next?.id === r.id ? '다음' : '계획') : '건너뜀'}</td>
                {[...inputs, ...levels].map((v) => (
                  <td key={v.id}>
                    <input className="input input--sm input--num" style={{ width: 90, fontSize: 14, minHeight: 30 }} aria-label={`#${r.order} ${v.name}`} defaultValue={valueText(v, r.x[v.id]) === '—' ? '' : valueText(v, r.x[v.id])} onBlur={(e) => editCell(r, v, e.target.value)} />
                  </td>
                ))}
                {outputs.map((v) => (
                  <td key={v.id}>
                    <input className="input input--sm input--num" style={{ width: 90, fontSize: 14, minHeight: 30 }} aria-label={`#${r.order} ${v.name}`} defaultValue={Number.isFinite(r.y[v.id]) ? String(r.y[v.id]) : ''} onBlur={(e) => editCell(r, v, e.target.value)} />
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
                <td style={{ textAlign: 'left' }}>
                  <input className="input input--sm" style={{ width: 140, fontSize: 13, minHeight: 30 }} aria-label={`#${r.order} 메모`} defaultValue={r.note} onBlur={(e) => e.target.value !== r.note && updateRun(r.id, { note: e.target.value })} />
                </td>
                <td>
                  <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                    {r.status === 'planned' && next && next.id !== r.id && (
                      <button type="button" className="btn btn--ghost small" onClick={() => {
                          deleteRuns([r.id])
                          insertPlanned(project.id, [{ ...r, id: newId('r') }], next.order)
                        }}>
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > shown.length && (
        <button type="button" className="btn" onClick={() => setLimit((l) => l + 200)}>
          더 보기 ({shown.length} / {filtered.length})
        </button>
      )}
      <p className="hint">칸을 고치면 바로 저장됩니다. 계획 실험의 조건도 고칠 수 있습니다.</p>
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
      <h2>실험 직접 추가</h2>
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
