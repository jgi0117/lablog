import type { Db, Goal, ID, Project, Run, Variable } from '../domain/types'
import { parseCsv, toNumber } from '../services/csv'
import { makeRandom } from '../services/model'
import { newId, now } from '../services/store'
import csv from './concrete/concrete.csv?raw'

/**
 * 예시 데이터: UCI 콘크리트 압축강도 공개 데이터(Yeh 1998, CC BY 4.0)에서 뽑은 네 프로젝트.
 * 실제 프로젝트처럼 "목표에서 먼 배합부터 시작해 점점 가까워지다가, 목표 ±허용 안에 들어오면 끝난다"는 순서로
 * 배합을 골라 실험 기록을 만들었다. 값은 바꾸지 않았고 프로젝트 이름·고객·목표는 지어낸 것이다.
 * 세 프로젝트는 목표를 달성해 끝났고, HB-50은 아직 진행 중이다.
 */

const NAMES = ['시멘트', '고로슬래그', '플라이애시', '물', '고성능 감수제', '굵은 골재', '잔골재']
const UNIT = 'kg/m³'

type Key = 'SM' | 'ES' | 'LF' | 'HB'

interface Def {
  key: Key
  name: string
  note: string
  /** 28일 압축강도 목표값 ± 허용 */
  target: number
  tol: number
  /** 입력 조건에 거는 목표 */
  limits: { name: string; op: '>=' | '<='; value: number; must: boolean }[]
  /** 목표를 달성해 끝났는가 */
  finished: boolean
  /** 달성 전까지의 실험 배합 수 */
  n: number
}

const DEFS: Def[] = [
  { key: 'SM', name: '스탠다드믹스 SM-00', note: '시멘트 단독 배합. 고객: 한빛건설 구조팀 (예시)', target: 35, tol: 3, limits: [{ name: '시멘트', op: '<=', value: 380, must: true }], finished: true, n: 12 },
  { key: 'ES', name: '에코슬래그 ES-30', note: '시멘트 + 고로슬래그. 고객: 그린인프라공사 (예시)', target: 50, tol: 4, limits: [{ name: '고로슬래그', op: '>=', value: 120, must: true }, { name: '시멘트', op: '<=', value: 300, must: true }], finished: true, n: 14 },
  { key: 'LF', name: '로히트 플라이 LF-20', note: '시멘트 + 플라이애시. 고객: 한솔플랜트 설비팀 (예시)', target: 45, tol: 4, limits: [{ name: '플라이애시', op: '>=', value: 80, must: true }], finished: true, n: 13 },
  { key: 'HB', name: '하이브리드본드 HB-50', note: '시멘트 + 고로슬래그 + 플라이애시. 고객: 미래전력 토목팀 (예시)', target: 70, tol: 3, limits: [{ name: '물', op: '<=', value: 170, must: true }], finished: false, n: 28 },
]

interface Mix {
  x: number[]
  byAge: Map<number, number>
}

function keyOf(x: number[]): Key {
  if (x[1] === 0 && x[2] === 0) return 'SM'
  if (x[2] === 0) return 'ES'
  if (x[1] === 0) return 'LF'
  return 'HB'
}

function mixesOf(rows: string[][]): Map<Key, Mix[]> {
  const out = new Map<Key, Map<string, Mix>>()
  for (const r of rows) {
    const nums = r.map((c) => toNumber(c) ?? 0)
    const x = nums.slice(0, 7)
    const age = nums[7]
    const strength = nums[8]
    const k = keyOf(x)
    const m = out.get(k) ?? new Map<string, Mix>()
    const id = x.join('|')
    const mix = m.get(id) ?? { x, byAge: new Map() }
    if (!mix.byAge.has(age)) mix.byAge.set(age, strength)
    m.set(id, mix)
    out.set(k, m)
  }
  return new Map([...out.entries()].map(([k, m]) => [k, [...m.values()]]))
}

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))]
}

export function demoDb(): Db {
  const table = parseCsv(csv)
  const mixes = mixesOf(table.rows)
  const rand = makeRandom(2026)
  const projects: Project[] = []
  const runs: Run[] = []
  for (const def of DEFS) {
    const all = mixes.get(def.key) ?? []
    // 변수: 입력 7개(설계 범위는 이 결합재 종류 전체의 2~98 백분위), 재령(측정 시점), 압축강도
    const variables: Variable[] = NAMES.map((name, j) => {
      const vals = all.map((m) => m.x[j]).sort((a, b) => a - b)
      const lo = pct(vals, 0.02)
      const hi = pct(vals, 0.98)
      return { id: newId('v'), name, unit: UNIT, role: 'input', min: lo, max: hi, decimals: 1 }
    })
    const age: Variable = { id: newId('v'), name: '재령', unit: '일', role: 'level', decimals: 0, levels: [28] }
    const strength: Variable = { id: newId('v'), name: '압축강도', unit: 'MPa', role: 'output', decimals: 2 }
    variables.push(age, strength)
    const vid = (name: string) => variables.find((v) => v.name === name)!.id
    const goals: Goal[] = [
      { id: newId('g'), variable: strength.id, op: 'target', target: def.target, tol: def.tol, at: { variable: age.id, value: 28 }, must: true },
      ...def.limits.map((l): Goal => ({ id: newId('g'), variable: vid(l.name), op: l.op, ...(l.op === '>=' ? { lo: l.value } : { hi: l.value }), must: l.must })),
    ]
    const project: Project = { id: newId('p'), name: def.name, note: def.note, variables, goals, initialRuns: 8, created: now(), updated: now() }
    projects.push(project)

    // 배합 고르기: 입력 제한을 지키는 배합 중 28일 강도가 있는 것. 목표에서 먼 것부터 가까운 순으로 n개, 끝났으면 허용 안의 배합 하나로 마무리
    const okLimit = (m: Mix) => def.limits.filter((l) => l.must).every((l) => (l.op === '>=' ? m.x[NAMES.indexOf(l.name)] >= l.value : m.x[NAMES.indexOf(l.name)] <= l.value))
    const cands = all.filter((m) => m.byAge.has(28) && okLimit(m)).map((m) => ({ m, d: Math.abs((m.byAge.get(28) as number) - def.target) }))
    const outside = cands.filter((c) => c.d > def.tol).sort((a, b) => b.d - a.d)
    const inside = cands.filter((c) => c.d <= def.tol).sort((a, b) => a.d - b.d)
    const picked: Mix[] = []
    const n = Math.min(def.n, outside.length)
    for (let i = 0; i < n; i++) picked.push(outside[Math.round((i * (outside.length - 1)) / Math.max(1, n - 1))].m)
    // 실제 기록처럼 순서를 조금 흐트러뜨린다(대체로 가까워지지만 늘 그렇지는 않게)
    for (let i = 0; i + 1 < picked.length; i++) if (rand() < 0.35) [picked[i], picked[i + 1]] = [picked[i + 1], picked[i]]
    if (def.finished && inside.length > 0) picked.push(inside[0].m)

    let order = 1
    const day0 = Date.parse('2026-03-02T09:00:00Z')
    picked.forEach((m, i) => {
      const x: Record<ID, number> = {}
      NAMES.forEach((name, j) => (x[vid(name)] = m.x[j]))
      // 같은 배합을 7일에도 쟀으면 함께 기록한다(참고값)
      for (const a of [7, 28]) {
        const s = m.byAge.get(a)
        if (s === undefined) continue
        runs.push({
          id: newId('r'),
          project: project.id,
          order: order++,
          x: { ...x, [age.id]: a },
          y: { [strength.id]: s },
          status: 'done',
          source: i === 0 ? 'manual' : i < 8 ? 'plan' : 'model',
          note: '',
          date: new Date(day0 + (i * 9 + (a === 7 ? 7 : 28)) * 86400000).toISOString(),
        })
      }
    })
  }
  return { version: 3, projects, runs }
}
