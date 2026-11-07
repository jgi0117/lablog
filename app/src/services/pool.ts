import { inputsOf, levelsOf, outputsOf, type Db, type ID, type Project, type Run, type Variable } from '../domain/types'

/**
 * 같은 변수를 가진 프로젝트의 완료 실험을 모아 한 모델로 학습한다.
 * 프로젝트 하나에 실험 20여 건이면 모델이 약하지만, 같은 제품군의 프로젝트를 모으면 수백 건이 된다.
 * 프로젝트마다 다를 수 있는 것(원료 로트, 설비)은 "프로젝트" 표시 변수(0/1)로 넣어 모델이 그 차이를 배우게 한다.
 * 다른 프로젝트의 변수는 이름(공백·대소문자 무시)과 구분으로 맞춘다.
 */

export const PROJECT_PREFIX = 'proj:'

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')

export interface Pooled {
  /** 이 프로젝트의 변수 id로 바꾼 완료 실험(자기 것 포함) */
  runs: Run[]
  /** 함께 학습한 프로젝트(자기 것 포함) */
  projects: Project[]
  /** 프로젝트 표시 변수(2개 이상 모였을 때만) */
  extras: Variable[]
  /** 이 프로젝트에서 예측할 때 표시 변수에 넣을 값 */
  fixed: Record<ID, number>
}

/** 다른 프로젝트 q의 변수를 p의 변수에 이름으로 맞춘다. p의 입력·측정 시점·출력이 모두 q에 있어야 한다 */
function mapping(p: Project, q: Project): Map<ID, ID> | null {
  const need = [...inputsOf(p), ...levelsOf(p), ...outputsOf(p)]
  const byKey = new Map(q.variables.map((v) => [`${v.role}:${norm(v.name)}`, v.id]))
  const m = new Map<ID, ID>()
  for (const v of need) {
    const qid = byKey.get(`${v.role}:${norm(v.name)}`)
    if (!qid) return null
    m.set(qid, v.id)
  }
  return m
}

export function pool(db: Db, p: Project): Pooled {
  const own = db.runs.filter((r) => r.project === p.id)
  if (p.pool === false) return { runs: own, projects: [p], extras: [], fixed: {} }
  const others = db.projects.filter((q) => q.id !== p.id).map((q) => ({ q, m: mapping(p, q) })).filter((x): x is { q: Project; m: Map<ID, ID> } => x.m !== null)
  const usable = others.filter(({ q }) => db.runs.some((r) => r.project === q.id && r.status === 'done'))
  if (usable.length === 0) return { runs: own, projects: [p], extras: [], fixed: {} }
  const projects = [p, ...usable.map((x) => x.q)]
  const extras: Variable[] = projects.map((q) => ({ id: `${PROJECT_PREFIX}${q.id}`, name: `프로젝트 ${q.name}`, unit: '', role: 'level', decimals: 0, levels: [0, 1] }))
  const flag = (pid: ID): Record<ID, number> => Object.fromEntries(projects.map((q) => [`${PROJECT_PREFIX}${q.id}`, q.id === pid ? 1 : 0]))
  const runs: Run[] = own.map((r) => ({ ...r, x: { ...r.x, ...flag(p.id) } }))
  for (const { q, m } of usable) {
    for (const r of db.runs) {
      if (r.project !== q.id || r.status !== 'done') continue
      const x: Record<ID, number> = {}
      const y: Record<ID, number> = {}
      for (const [qid, pid] of m) {
        if (Number.isFinite(r.x[qid])) x[pid] = r.x[qid]
        if (Number.isFinite(r.y[qid])) y[pid] = r.y[qid]
      }
      runs.push({ ...r, project: q.id, x: { ...x, ...flag(q.id) }, y })
    }
  }
  return { runs, projects, extras, fixed: flag(p.id) }
}
