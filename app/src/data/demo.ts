import type { Db, Goal, Project, Run } from '../domain/types'
import { parseCsv, tableToProject, type Table } from '../services/csv'
import { newId } from '../services/store'
import csv from './concrete/concrete.csv?raw'

/**
 * 예시 데이터: UCI 콘크리트 압축강도 공개 데이터(Yeh 1998, CC BY 4.0) 1,030행.
 * 결합재 종류로 네 프로젝트로 나누고, 각 프로젝트에 지어낸 고객 목표를 붙인다. 값은 바꾸지 않았다.
 */

const HEADERS = ['시멘트 (kg/m³)', '고로슬래그 (kg/m³)', '플라이애시 (kg/m³)', '물 (kg/m³)', '고성능 감수제 (kg/m³)', '굵은 골재 (kg/m³)', '잔골재 (kg/m³)', '재령 (일)', '압축강도 (MPa)']

type Key = 'SM' | 'ES' | 'LF' | 'HB'

const PROJECTS: { key: Key; name: string; note: string; goals: (p: Project) => Goal[] }[] = [
  { key: 'SM', name: '스탠다드믹스 SM-00', note: '시멘트 단독 배합. 고객: 한빛건설 구조팀 (예시)', goals: (p) => [g(p, '압축강도', '>=', 30, 28), g(p, '압축강도', '>=', 20, 7), g(p, '시멘트', '<=', 400, undefined, false)] },
  { key: 'ES', name: '에코슬래그 ES-30', note: '시멘트 + 고로슬래그. 고객: 그린인프라공사 (예시)', goals: (p) => [g(p, '압축강도', '>=', 50, 28), g(p, '고로슬래그', '>=', 120), g(p, '시멘트', '<=', 300)] },
  { key: 'LF', name: '로히트 플라이 LF-20', note: '시멘트 + 플라이애시. 고객: 한솔플랜트 설비팀 (예시)', goals: (p) => [g(p, '압축강도', '>=', 55, 56), g(p, '압축강도', '>=', 45, 28), g(p, '플라이애시', '>=', 80, undefined, false)] },
  { key: 'HB', name: '하이브리드본드 HB-50', note: '시멘트 + 고로슬래그 + 플라이애시. 고객: 미래전력 토목팀 (예시)', goals: (p) => [g(p, '압축강도', '>=', 80, 28), g(p, '물', '<=', 170), g(p, '고성능 감수제', '<=', 12, undefined, false)] },
]

function g(p: Project, name: string, op: '>=' | '<=', value: number, at?: number, must = true): Goal {
  const v = p.variables.find((x) => x.name === name)!
  const age = p.variables.find((x) => x.name === '재령')!
  return { id: newId('g'), variable: v.id, op, ...(op === '>=' ? { lo: value } : { hi: value }), ...(at ? { at: { variable: age.id, value: at } } : {}), must }
}

function keyOf(row: string[]): Key {
  const slag = Number(row[1])
  const fly = Number(row[2])
  if (slag === 0 && fly === 0) return 'SM'
  if (fly === 0) return 'ES'
  if (slag === 0) return 'LF'
  return 'HB'
}

export function demoDb(): Db {
  const table = parseCsv(csv)
  const projects: Project[] = []
  const runs: Run[] = []
  for (const def of PROJECTS) {
    const rows = table.rows.filter((r) => keyOf(r) === def.key)
    const t: Table = { headers: HEADERS, rows }
    const { project, runs: rs } = tableToProject(def.name, t, { outputs: new Set([HEADERS[8]]), levels: new Set([HEADERS[7]]), note: def.note, initialRuns: 8 })
    project.goals = def.goals(project)
    // level(재령)은 목표의 적용 조건 값에서 계획한다
    const age = project.variables.find((v) => v.name === '재령')!
    age.levels = [...new Set(project.goals.filter((x) => x.at).map((x) => x.at!.value))].sort((a, b) => a - b)
    // 입력 범위는 실제 배합 범위(이상치 제외를 위해 2~98 백분위)로 둔다
    for (const v of project.variables.filter((x) => x.role === 'input')) {
      const vals = rs.map((r) => r.x[v.id]).filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
      if (vals.length > 10) {
        v.min = vals[Math.floor(vals.length * 0.02)]
        v.max = vals[Math.ceil(vals.length * 0.98) - 1]
      }
      v.decimals = Math.min(v.decimals, 1)
    }
    projects.push(project)
    runs.push(...rs)
  }
  return { version: 3, projects, runs }
}
