import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { demoDb } from '../data/demo'
import { type Project, type Role, type Variable } from '../domain/types'
import { parseCsv, tableToProject, type Table } from '../services/csv'
import { initialPlan } from '../services/plan'
import { addProject, newId, now, replaceDb, useDb } from '../services/store'

interface VarDraft {
  key: string
  name: string
  unit: string
  role: Role
  min: string
  max: string
  decimals: string
  levels: string
}

const blank = (role: Role): VarDraft => ({ key: newId('d'), name: '', unit: '', role, min: '', max: '', decimals: '1', levels: '' })

/** 새 프로젝트: 변수와 목표를 적으면 앱이 첫 실험 계획을 짠다. CSV가 있으면 그 표로 바로 만든다 */
export function NewProjectPage() {
  const navigate = useNavigate()
  const db = useDb()
  const [name, setName] = useState('')
  const [vars, setVars] = useState<VarDraft[]>([blank('input'), blank('input'), blank('output')])
  const [initialRuns, setInitialRuns] = useState('8')
  const [error, setError] = useState('')
  const [table, setTable] = useState<{ table: Table; roles: Record<string, Role | 'skip'>; name: string } | null>(null)

  const update = (key: string, patch: Partial<VarDraft>) => setVars((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch } : v)))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const rows = vars.filter((v) => v.name.trim())
    if (!name.trim()) return setError('프로젝트 이름을 적어 주세요')
    if (!rows.some((v) => v.role === 'input')) return setError('입력 조건이 하나는 있어야 합니다')
    if (!rows.some((v) => v.role === 'output')) return setError('출력(측정 결과)이 하나는 있어야 합니다')
    const variables: Variable[] = []
    for (const v of rows) {
      const variable: Variable = { id: newId('v'), name: v.name.trim(), unit: v.unit.trim(), role: v.role, decimals: Math.max(0, Math.min(4, Number(v.decimals) || 0)) }
      if (v.role === 'input') {
        const lo = Number(v.min)
        const hi = Number(v.max)
        if (v.min === '' || v.max === '' || !Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) return setError(`"${v.name}"의 범위(최소·최대)를 숫자로 적어 주세요`)
        variable.min = lo
        variable.max = hi
      }
      if (v.role === 'level') {
        const levels = v.levels.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n))
        if (levels.length === 0) return setError(`"${v.name}"의 측정 시점 값을 쉼표로 적어 주세요 (예: 7, 28)`)
        variable.levels = [...new Set(levels)].sort((a, b) => a - b)
      }
      variables.push(variable)
    }
    const project: Project = { id: newId('p'), name: name.trim(), note: '', variables, goals: [], initialRuns: Math.max(1, Math.min(60, Number(initialRuns) || 8)), created: now(), updated: now() }
    const runs = initialPlan(project, 1, () => newId('r'))
    addProject(project, runs)
    navigate(`/p/${project.id}/setup?first=1`)
  }

  const onCsv = async (f: File) => {
    const t = parseCsv(await f.text())
    if (t.headers.length === 0 || t.rows.length === 0) return setError('표를 읽지 못했습니다. 첫 줄이 머리글인 CSV여야 합니다')
    const roles: Record<string, Role | 'skip'> = {}
    t.headers.forEach((h, j) => {
      const numeric = t.rows.some((r) => r[j] !== '' && Number.isFinite(Number(r[j].replace(/,/g, ''))))
      roles[h] = numeric ? (j === t.headers.length - 1 ? 'output' : 'input') : 'skip'
    })
    setTable({ table: t, roles, name: f.name.replace(/\.[^.]+$/, '') })
    setError('')
  }

  const createFromTable = () => {
    if (!table) return
    const outputs = new Set(Object.entries(table.roles).filter(([, r]) => r === 'output').map(([h]) => h))
    const levels = new Set(Object.entries(table.roles).filter(([, r]) => r === 'level').map(([h]) => h))
    const skip = new Set(Object.entries(table.roles).filter(([, r]) => r === 'skip').map(([h]) => h))
    if (outputs.size === 0) return setError('출력(측정 결과) 열을 하나는 골라 주세요')
    const keep = table.table.headers.map((h, j) => [h, j] as const).filter(([h]) => !skip.has(h))
    const t: Table = { headers: keep.map(([h]) => h), rows: table.table.rows.map((r) => keep.map(([, j]) => r[j])) }
    const { project, runs } = tableToProject(table.name.trim() || '가져온 프로젝트', t, { outputs, levels, initialRuns: 8 })
    addProject(project, runs)
    navigate(`/p/${project.id}/setup?first=1`)
  }

  return (
    <div className="stack">
      <p className="small">
        <Link to="/">← 프로젝트</Link>
      </p>
      <h1>새 프로젝트</h1>

      <div className="split">
        <form className="card stack" onSubmit={submit} noValidate>
          <h2>직접 만들기</h2>
          <div className="field">
            <label htmlFor="np-name">프로젝트 이름</label>
            <input id="np-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 하드코팅 필름 HC-2" autoFocus />
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <h3>변수</h3>
            <p className="hint">입력 = 앱이 값을 정해 주는 조건(범위 필요). 측정 시점 = 재령처럼 정해진 값에서 재는 조건. 출력 = 측정 결과.</p>
            {vars.map((v, i) => (
              <div key={v.key} className="var-row">
                <div className="field">
                  <label htmlFor={`vn-${i}`}>이름</label>
                  <input id={`vn-${i}`} className="input input--sm" value={v.name} onChange={(e) => update(v.key, { name: e.target.value })} placeholder={v.role === 'output' ? '예) 헤이즈' : '예) 두께'} />
                </div>
                <div className="field">
                  <label htmlFor={`vu-${i}`}>단위</label>
                  <input id={`vu-${i}`} className="input input--sm" value={v.unit} onChange={(e) => update(v.key, { unit: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor={`vr-${i}`}>구분</label>
                  <select id={`vr-${i}`} className="input input--sm" value={v.role} onChange={(e) => update(v.key, { role: e.target.value as Role })}>
                    <option value="input">입력</option>
                    <option value="level">측정 시점</option>
                    <option value="output">출력</option>
                  </select>
                </div>
                {v.role === 'input' && (
                  <>
                    <div className="field">
                      <label htmlFor={`vmin-${i}`}>최소</label>
                      <input id={`vmin-${i}`} className="input input--sm" inputMode="decimal" value={v.min} onChange={(e) => update(v.key, { min: e.target.value })} />
                    </div>
                    <div className="field">
                      <label htmlFor={`vmax-${i}`}>최대</label>
                      <input id={`vmax-${i}`} className="input input--sm" inputMode="decimal" value={v.max} onChange={(e) => update(v.key, { max: e.target.value })} />
                    </div>
                  </>
                )}
                {v.role === 'level' && (
                  <div className="field" style={{ gridColumn: 'span 2' }}>
                    <label htmlFor={`vl-${i}`}>측정 시점 값들</label>
                    <input id={`vl-${i}`} className="input input--sm" value={v.levels} onChange={(e) => update(v.key, { levels: e.target.value })} placeholder="예) 7, 28" />
                  </div>
                )}
                {v.role === 'output' && <div style={{ gridColumn: 'span 2' }} />}
                <div className="field">
                  <label htmlFor={`vd-${i}`}>소수</label>
                  <input id={`vd-${i}`} className="input input--sm" inputMode="numeric" value={v.decimals} onChange={(e) => update(v.key, { decimals: e.target.value })} />
                </div>
                <button type="button" className="btn btn--ghost" aria-label={`변수 ${i + 1} 지우기`} onClick={() => setVars((vs) => vs.filter((x) => x.key !== v.key))}>
                  ✕
                </button>
              </div>
            ))}
            <div className="row">
              <button type="button" className="btn" onClick={() => setVars((vs) => [...vs, blank('input')])}>
                + 입력 조건
              </button>
              <button type="button" className="btn" onClick={() => setVars((vs) => [...vs, blank('output')])}>
                + 출력
              </button>
              <button type="button" className="btn" onClick={() => setVars((vs) => [...vs, blank('level')])}>
                + 측정 시점
              </button>
            </div>
          </div>
          <div className="field" style={{ maxWidth: 240 }}>
            <label htmlFor="np-n">처음 탐색할 조건 수</label>
            <input id="np-n" className="input" inputMode="numeric" value={initialRuns} onChange={(e) => setInitialRuns(e.target.value)} />
            <span className="hint">앱이 범위를 고르게 덮도록 이만큼 조건을 짭니다. 보통 입력 수의 2~3배.</span>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="submit" className="btn btn--primary btn--big">
              만들고 실험 계획 받기 →
            </button>
          </div>
          <p className="hint">다음 화면에서 목표(예: 헤이즈 ≤ 1%)를 적습니다. 나중에 설정에서 바꿀 수 있습니다.</p>
        </form>

        <div className="stack">
          <div className="card stack">
            <h2>표(CSV)로 만들기</h2>
            <p className="hint">이미 쌓인 실험 표가 있으면 그대로 가져옵니다. 첫 줄은 머리글("이름 (단위)" 형식이면 단위도 읽습니다), 한 줄이 실험 한 건.</p>
            <input type="file" accept=".csv,.txt,.tsv,text/csv" aria-label="CSV 파일" onChange={(e) => e.target.files?.[0] && onCsv(e.target.files[0])} />
            {table && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="field">
                  <label htmlFor="tn">프로젝트 이름</label>
                  <input id="tn" className="input input--sm" value={table.name} onChange={(e) => setTable({ ...table, name: e.target.value })} />
                </div>
                <p className="small muted">
                  {table.table.rows.length}행 · 열마다 구분을 고르세요
                </p>
                {table.table.headers.map((h) => (
                  <div key={h} className="row between">
                    <span>{h}</span>
                    <select className="input input--sm" style={{ width: 130 }} aria-label={`${h} 구분`} value={table.roles[h]} onChange={(e) => setTable({ ...table, roles: { ...table.roles, [h]: e.target.value as Role | 'skip' } })}>
                      <option value="input">입력</option>
                      <option value="level">측정 시점</option>
                      <option value="output">출력</option>
                      <option value="skip">안 씀</option>
                    </select>
                  </div>
                ))}
                <button type="button" className="btn btn--primary" onClick={createFromTable}>
                  이 표로 프로젝트 만들기 →
                </button>
              </div>
            )}
          </div>
          {db.projects.length === 0 && (
            <div className="card stack">
              <h2>예시로 둘러보기</h2>
              <p className="hint">공개 콘크리트 데이터 1,030건을 네 프로젝트로 나눠 넣습니다.</p>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  replaceDb(demoDb())
                  navigate('/')
                }}
              >
                예시 데이터 넣기
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
