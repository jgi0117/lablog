import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ProjectHeader, useProject } from '../components'
import { type Goal, type GoalOp, type ID, type Role, type Variable } from '../domain/types'
import { initialPlan } from '../services/plan'
import { deleteProject, newId, nextOrder, replacePlanned, updateProject, useDb } from '../services/store'

interface VarDraft extends Omit<Variable, 'min' | 'max' | 'decimals' | 'levels'> {
  min: string
  max: string
  decimals: string
  levels: string
}
interface GoalDraft {
  id: ID
  variable: ID
  op: GoalOp
  lo: string
  hi: string
  target: string
  tol: string
  atVar: ID
  atValue: string
  must: boolean
}

const toVarDraft = (v: Variable): VarDraft => ({ ...v, min: v.min === undefined ? '' : String(v.min), max: v.max === undefined ? '' : String(v.max), decimals: String(v.decimals), levels: (v.levels ?? []).join(', ') })
const toGoalDraft = (g: Goal): GoalDraft => ({ id: g.id, variable: g.variable, op: g.op, lo: g.lo === undefined ? '' : String(g.lo), hi: g.hi === undefined ? '' : String(g.hi), target: g.target === undefined ? '' : String(g.target), tol: g.tol === undefined ? '' : String(g.tol), atVar: g.at?.variable ?? '', atValue: g.at ? String(g.at.value) : '', must: g.must })

/** 설정: 이름·변수·목표를 고친다. 저장하면 바로 반영되고, 계획을 다시 짤 수 있다 */
export function SetupPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const db = useDb()
  const { project, runs } = useProject(id)
  const [name, setName] = useState(project?.name ?? '')
  const [note, setNote] = useState(project?.note ?? '')
  const [initialRuns, setInitialRuns] = useState(String(project?.initialRuns ?? 8))
  const [vars, setVars] = useState<VarDraft[]>(project ? project.variables.map(toVarDraft) : [])
  const [goals, setGoals] = useState<GoalDraft[]>(project ? project.goals.map(toGoalDraft) : [])
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  if (!project) {
    return (
      <p className="muted">
        프로젝트가 없습니다. <Link to="/">홈으로</Link>
      </p>
    )
  }
  const uv = (vid: ID, patch: Partial<VarDraft>) => setVars((vs) => vs.map((v) => (v.id === vid ? { ...v, ...patch } : v)))
  const ug = (gid: ID, patch: Partial<GoalDraft>) => setGoals((gs) => gs.map((g) => (g.id === gid ? { ...g, ...patch } : g)))
  const levelVars = vars.filter((v) => v.role === 'level')

  const build = (): { variables: Variable[]; goals: Goal[] } | null => {
    const variables: Variable[] = []
    for (const v of vars) {
      if (!v.name.trim()) continue
      const out: Variable = { id: v.id, name: v.name.trim(), unit: v.unit.trim(), role: v.role, decimals: Math.max(0, Math.min(4, Number(v.decimals) || 0)) }
      if (v.role === 'input') {
        if (v.min !== '' && v.max !== '') {
          const lo = Number(v.min)
          const hi = Number(v.max)
          if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) {
            setError(`"${v.name}"의 범위가 이상합니다`)
            return null
          }
          out.min = lo
          out.max = hi
        }
      }
      if (v.role === 'level') {
        const levels = v.levels.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n))
        out.levels = [...new Set(levels)].sort((a, b) => a - b)
      }
      variables.push(out)
    }
    if (!variables.some((v) => v.role === 'input')) {
      setError('입력 조건이 하나는 있어야 합니다')
      return null
    }
    const gs: Goal[] = []
    for (const g of goals) {
      if (!variables.some((v) => v.id === g.variable)) continue
      const lo = g.lo === '' ? undefined : Number(g.lo)
      const hi = g.hi === '' ? undefined : Number(g.hi)
      if (g.op === 'target') {
        const t = Number(g.target)
        const tol = g.tol === '' ? 0 : Number(g.tol)
        if (g.target === '' || !Number.isFinite(t) || !Number.isFinite(tol) || tol < 0) {
          setError('목표값과 허용 오차(0 이상)를 적어 주세요')
          return null
        }
        const goal: Goal = { id: g.id, variable: g.variable, op: 'target', target: t, tol, must: g.must }
        if (g.atVar && g.atValue !== '' && Number.isFinite(Number(g.atValue)) && variables.some((v) => v.id === g.atVar)) goal.at = { variable: g.atVar, value: Number(g.atValue) }
        gs.push(goal)
        continue
      }
      if (g.op === '>=' && lo === undefined) {
        setError('목표의 "이상" 값을 적어 주세요')
        return null
      }
      if (g.op === '<=' && hi === undefined) {
        setError('목표의 "이하" 값을 적어 주세요')
        return null
      }
      if (g.op === 'between' && (lo === undefined || hi === undefined || lo > hi)) {
        setError('목표 범위의 최소·최대를 적어 주세요')
        return null
      }
      const goal: Goal = { id: g.id, variable: g.variable, op: g.op, must: g.must }
      if (g.op !== '<=') goal.lo = lo
      if (g.op !== '>=') goal.hi = hi
      if (g.atVar && g.atValue !== '' && Number.isFinite(Number(g.atValue)) && variables.some((v) => v.id === g.atVar)) goal.at = { variable: g.atVar, value: Number(g.atValue) }
      gs.push(goal)
    }
    // 목표의 적용 조건 값은 level 변수의 계획 값에 더한다
    for (const v of variables.filter((x) => x.role === 'level')) {
      const fromGoals = gs.filter((g) => g.at?.variable === v.id).map((g) => g.at!.value)
      v.levels = [...new Set([...(v.levels ?? []), ...fromGoals])].sort((a, b) => a - b)
    }
    return { variables, goals: gs }
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) return setError('이름을 적어 주세요')
    const built = build()
    if (!built) return
    updateProject(project.id, { name: name.trim(), note: note.trim(), initialRuns: Math.max(1, Math.min(60, Number(initialRuns) || 8)), ...built })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    if (params.get('first')) navigate(`/p/${project.id}`)
  }

  const replan = () => {
    const built = build()
    if (!built) return
    const p = { ...project, name: name.trim() || project.name, initialRuns: Math.max(1, Math.min(60, Number(initialRuns) || 8)), ...built }
    updateProject(project.id, { name: p.name, note: note.trim(), initialRuns: p.initialRuns, variables: p.variables, goals: p.goals })
    const start = nextOrder({ ...db, runs: db.runs.filter((r) => !(r.project === project.id && r.status === 'planned')) }, project.id)
    replacePlanned(project.id, initialPlan(p, start, () => newId('r'), Date.now() % 100000))
    navigate(`/p/${project.id}`)
  }

  return (
    <div className="stack">
      <ProjectHeader project={project} runs={runs} />
      {params.get('first') && (
        <div className="banner">
          <b>프로젝트가 만들어졌고 첫 실험 계획도 짰습니다.</b> 목표(예: 압축강도 ≥ 30 MPa)를 적고 저장하면, 실험 화면에서 결과만 넣으면 됩니다.
        </div>
      )}
      <form className="stack" onSubmit={save} noValidate>
        <div className="card stack">
          <h2>프로젝트</h2>
          <div className="field" style={{ maxWidth: 480 }}>
            <label htmlFor="s-name">이름</label>
            <input id="s-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field" style={{ maxWidth: 640 }}>
            <label htmlFor="s-note">메모</label>
            <input id="s-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="고객, 배경, 제약 등" />
          </div>
          <div className="field" style={{ maxWidth: 240 }}>
            <label htmlFor="s-n">처음 탐색할 조건 수</label>
            <input id="s-n" className="input" inputMode="numeric" value={initialRuns} onChange={(e) => setInitialRuns(e.target.value)} />
          </div>
        </div>

        <div className="card stack">
          <h2>변수</h2>
          <p className="hint">입력은 범위(최소·최대) 안에서 앱이 값을 정합니다. 범위를 비우거나 최소=최대면 그 값으로 고정합니다. 측정 시점(예: 재령)은 적은 값마다 한 번씩 잽니다.</p>
          {vars.map((v, i) => (
            <div key={v.id} className="var-row">
              <div className="field">
                <label htmlFor={`sv-${i}`}>이름</label>
                <input id={`sv-${i}`} className="input input--sm" value={v.name} onChange={(e) => uv(v.id, { name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`su-${i}`}>단위</label>
                <input id={`su-${i}`} className="input input--sm" value={v.unit} onChange={(e) => uv(v.id, { unit: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`sr-${i}`}>구분</label>
                <select id={`sr-${i}`} className="input input--sm" value={v.role} onChange={(e) => uv(v.id, { role: e.target.value as Role })}>
                  <option value="input">입력</option>
                  <option value="level">측정 시점</option>
                  <option value="output">출력</option>
                </select>
              </div>
              {v.role === 'input' ? (
                <>
                  <div className="field">
                    <label htmlFor={`smin-${i}`}>최소</label>
                    <input id={`smin-${i}`} className="input input--sm" inputMode="decimal" value={v.min} onChange={(e) => uv(v.id, { min: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`smax-${i}`}>최대</label>
                    <input id={`smax-${i}`} className="input input--sm" inputMode="decimal" value={v.max} onChange={(e) => uv(v.id, { max: e.target.value })} />
                  </div>
                </>
              ) : v.role === 'level' ? (
                <div className="field" style={{ gridColumn: 'span 2' }}>
                  <label htmlFor={`sl-${i}`}>측정 시점 값들</label>
                  <input id={`sl-${i}`} className="input input--sm" value={v.levels} onChange={(e) => uv(v.id, { levels: e.target.value })} placeholder="예) 7, 28" />
                </div>
              ) : (
                <div style={{ gridColumn: 'span 2' }} />
              )}
              <div className="field">
                <label htmlFor={`sd-${i}`}>소수</label>
                <input id={`sd-${i}`} className="input input--sm" inputMode="numeric" value={v.decimals} onChange={(e) => uv(v.id, { decimals: e.target.value })} />
              </div>
              <button type="button" className="btn btn--ghost" aria-label={`변수 ${v.name || i + 1} 지우기`} onClick={() => setVars((vs) => vs.filter((x) => x.id !== v.id))}>
                ✕
              </button>
            </div>
          ))}
          <div className="row">
            <button type="button" className="btn" onClick={() => setVars((vs) => [...vs, { id: newId('v'), name: '', unit: '', role: 'input', min: '', max: '', decimals: '1', levels: '' }])}>
              + 입력 조건
            </button>
            <button type="button" className="btn" onClick={() => setVars((vs) => [...vs, { id: newId('v'), name: '', unit: '', role: 'output', min: '', max: '', decimals: '1', levels: '' }])}>
              + 출력
            </button>
            <button type="button" className="btn" onClick={() => setVars((vs) => [...vs, { id: newId('v'), name: '', unit: '', role: 'level', min: '', max: '', decimals: '0', levels: '' }])}>
              + 측정 시점
            </button>
          </div>
        </div>

        <div className="card stack">
          <h2>목표</h2>
          <p className="hint">"목표값 ±"는 목표값에 가까울수록 좋고 허용 오차 안이면 만족입니다(예: 강도 35 ± 3). 필수 목표를 모두 만족한 조건이 나오면 "목표 달성"이고 실험이 끝납니다. 입력 조건에 목표를 걸면(예: 시멘트 ≤ 300) 그 범위 안에서만 제안합니다.</p>
          {goals.map((g, i) => (
            <div key={g.id} className="goal-row">
              <div className="field">
                <label htmlFor={`gv-${i}`}>항목</label>
                <select id={`gv-${i}`} className="input input--sm" value={g.variable} onChange={(e) => ug(g.id, { variable: e.target.value })}>
                  <option value="">선택</option>
                  {vars
                    .filter((v) => v.role !== 'level' && v.name.trim())
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                        {v.unit ? ` (${v.unit})` : ''} · {v.role === 'output' ? '출력' : '입력'}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`go-${i}`}>조건</label>
                <select id={`go-${i}`} className="input input--sm" value={g.op} onChange={(e) => ug(g.id, { op: e.target.value as GoalOp })}>
                  <option value="target">목표값 ±</option>
                  <option value=">=">이상</option>
                  <option value="<=">이하</option>
                  <option value="between">범위</option>
                </select>
              </div>
              {g.op === 'target' ? (
                <>
                  <div className="field">
                    <label htmlFor={`gt-${i}`}>목표값</label>
                    <input id={`gt-${i}`} className="input input--sm" inputMode="decimal" value={g.target} onChange={(e) => ug(g.id, { target: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`gtol-${i}`}>± 허용</label>
                    <input id={`gtol-${i}`} className="input input--sm" inputMode="decimal" value={g.tol} onChange={(e) => ug(g.id, { tol: e.target.value })} />
                  </div>
                </>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor={`glo-${i}`}>{g.op === '<=' ? '—' : g.op === '>=' ? '이상' : '최소'}</label>
                    <input id={`glo-${i}`} className="input input--sm" inputMode="decimal" value={g.lo} disabled={g.op === '<='} onChange={(e) => ug(g.id, { lo: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`ghi-${i}`}>{g.op === '>=' ? '—' : g.op === '<=' ? '이하' : '최대'}</label>
                    <input id={`ghi-${i}`} className="input input--sm" inputMode="decimal" value={g.hi} disabled={g.op === '>='} onChange={(e) => ug(g.id, { hi: e.target.value })} />
                  </div>
                </>
              )}
              <div className="field">
                <label htmlFor={`ga-${i}`}>측정 시점일 때</label>
                <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                  <select id={`ga-${i}`} className="input input--sm" value={g.atVar} disabled={levelVars.length === 0} onChange={(e) => ug(g.id, { atVar: e.target.value })}>
                    <option value="">항상</option>
                    {levelVars.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <input className="input input--sm" style={{ width: 70 }} aria-label={`목표 ${i + 1} 측정 시점 값`} inputMode="decimal" value={g.atValue} disabled={!g.atVar} onChange={(e) => ug(g.id, { atValue: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label htmlFor={`gm-${i}`}>중요도</label>
                <select id={`gm-${i}`} className="input input--sm" value={g.must ? 'must' : 'nice'} onChange={(e) => ug(g.id, { must: e.target.value === 'must' })}>
                  <option value="must">필수</option>
                  <option value="nice">참고</option>
                </select>
              </div>
              <button type="button" className="btn btn--ghost" aria-label={`목표 ${i + 1} 지우기`} onClick={() => setGoals((gs) => gs.filter((x) => x.id !== g.id))}>
                ✕
              </button>
            </div>
          ))}
          <div className="row">
            <button type="button" className="btn" onClick={() => setGoals((gs) => [...gs, { id: newId('g'), variable: vars.find((v) => v.role === 'output')?.id ?? '', op: 'target', lo: '', hi: '', target: '', tol: '', atVar: '', atValue: '', must: true }])}>
              + 목표
            </button>
          </div>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn btn--primary btn--big">
            저장
          </button>
          {saved && <span className="chip chip--ok">저장됨</span>}
          <button type="button" className="btn" onClick={replan}>
            계획 실험 다시 짜기
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              if (confirm(`"${project.name}"과 실험 ${runs.length}건을 모두 지울까요?`)) {
                deleteProject(project.id)
                navigate('/')
              }
            }}
          >
            프로젝트 지우기
          </button>
        </div>
        <p className="hint">"계획 실험 다시 짜기"는 아직 하지 않은 계획만 새로 뽑습니다. 완료한 실험은 그대로입니다.</p>
      </form>
    </div>
  )
}
