import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { fmt, groupKeyOf, type Goal, type Project, type Run, type Variable } from './domain/types'
import { trainModel, type Model } from './services/model'
import { status, type Status } from './services/plan'
import { pool } from './services/pool'
import { modelsOf, runsOf, useDb } from './services/store'

/** 프로젝트 하나와 그 실험들. 없는 프로젝트면 project가 null */
export function useProject(id: string | undefined): { project: Project | null; runs: Run[] } {
  const db = useDb()
  const project = db.projects.find((p) => p.id === id) ?? null
  const runs = useMemo(() => (id ? runsOf(db, id) : []), [db, id])
  return { project, runs }
}

/** 완료 실험이 바뀔 때마다 모델을 다시 만든다. 같은 변수를 가진 프로젝트의 실험을 모아 학습한다. 화면이 먼저 그려지도록 한 박자 뒤에 계산한다 */
export function useModel(project: Project | null): { model: Model | null; busy: boolean } {
  const db = useDb()
  const pooled = useMemo(() => (project ? pool(db, project) : null), [db, project])
  const versions = useMemo(() => (project ? modelsOf(db, groupKeyOf(project)).filter((m) => m.applied) : []), [db, project])
  const sig = useMemo(
    () =>
      project && pooled
        ? `${project.id}|${project.pool !== false}|${versions.map((v) => v.id).join(',')}|${project.variables.map((v) => `${v.id}:${v.role}`).join(',')}|${pooled.runs
            .filter((r) => r.status === 'done')
            .map((r) => `${r.id}:${Object.values(r.y).join('/')}`)
            .join(',')}`
        : '',
    [project, pooled, versions],
  )
  const [state, setState] = useState<{ sig: string; model: Model } | null>(null)
  useEffect(() => {
    if (!project || !pooled) return
    const h = setTimeout(() => setState({ sig, model: trainModel(project, pooled.runs, { extras: pooled.extras, fixed: pooled.fixed, pooledProjects: pooled.projects.length, versions }) }), 20)
    return () => clearTimeout(h)
    // pooled는 sig로 대표된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, project])
  return { model: state?.sig === sig ? state.model : null, busy: state?.sig !== sig }
}

export function useStatus(project: Project | null, runs: Run[]): Status | null {
  return useMemo(() => (project ? status(project, runs) : null), [project, runs])
}

export const OVERALL: Record<Status['overall'], { text: string; cls: string }> = {
  achieved: { text: '목표 달성 · 종료', cls: 'chip--ok' },
  'in-progress': { text: '진행 중', cls: 'chip--warn' },
  'no-data': { text: '측정 전', cls: '' },
  'no-goal': { text: '목표 없음', cls: '' },
}

export function StatusChip({ s }: { s: Status }) {
  const o = OVERALL[s.overall]
  return <span className={`chip ${o.cls}`}>{o.text}</span>
}

export function valueText(v: Variable, n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—'
  return fmt(n, v.decimals)
}

export function ProjectHeader({ project, runs, children }: { project: Project; runs: Run[]; children?: ReactNode }) {
  const s = status(project, runs)
  return (
    <div className="proj">
      <p className="small">
        <Link to="/">← 프로젝트</Link>
      </p>
      <div className="row between">
        <h1 className="row">
          {project.name} <StatusChip s={s} />
        </h1>
        <div className="row">
          <Link to={`/data?p=${project.id}`} className="btn">
            데이터 ({runs.filter((r) => r.status === 'done').length})
          </Link>
          <Link to={`/model?p=${project.id}`} className="btn">
            모델
          </Link>
          <Link to={`/p/${project.id}/setup`} className="btn">
            설정
          </Link>
          {children}
        </div>
      </div>
      {project.note && <p className="muted small">{project.note}</p>}
    </div>
  )
}

/** 데이터·모델 화면의 프로젝트 고르기. 주소의 ?p= 를 쓰고, 없으면 진행 중인 첫 프로젝트 */
export function useProjectParam(): { project: Project | null; setProject: (id: string) => void; projects: Project[] } {
  const db = useDb()
  const [params, setParams] = useSearchParams()
  const id = params.get('p')
  const projects = db.projects
  const fallback = projects.find((p) => !status(p, runsOf(db, p.id)).finished) ?? projects[0] ?? null
  const project = projects.find((p) => p.id === id) ?? fallback
  const setProject = (pid: string) => setParams({ p: pid })
  return { project, setProject, projects }
}

export function GoalMark({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="chip">값 없음</span>
  return <span className={`chip ${ok ? 'chip--ok' : 'chip--bad'}`}>{ok ? '만족' : '미달'}</span>
}

export function goalVariable(p: Project, g: Goal): Variable | undefined {
  return p.variables.find((v) => v.id === g.variable)
}
