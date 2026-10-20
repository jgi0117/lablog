import type { BackupFile } from './repositories'
import { BACKUP_SCHEMA_VERSION } from './repositories'
import type { DataItem, Experiment, ExperimentStatus, Project, Requirement, Step } from '../domain/types'

/**
 * 시연용 예시 데이터: UCI 콘크리트 압축강도 공개 데이터(Yeh, 1998, CC BY 4.0).
 * 원본과 가공 내용은 concrete/README.md에 있다. 한 행이 실험 한 건이다.
 */

export interface ConcreteRow {
  /** 원본 행 번호(머리글 제외, 1부터) */
  row: number
  cement: number
  slag: number
  flyAsh: number
  water: number
  superplasticizer: number
  coarse: number
  fine: number
  age: number
  strength: number
}

export function parseConcreteCsv(text: string): ConcreteRow[] {
  const lines = text.trim().split(/\r?\n/).slice(1)
  return lines.map((line, i) => {
    const [cement, slag, flyAsh, water, superplasticizer, coarse, fine, age, strength] = line.split(',').map(Number)
    return { row: i + 1, cement, slag, flyAsh, water, superplasticizer, coarse, fine, age, strength }
  })
}

export type BinderKey = 'SM' | 'ES' | 'LF' | 'HB'

/** 결합재 종류: 고로슬래그와 플라이애시를 쓰는지로 나눈다. */
export function binderOf(r: ConcreteRow): BinderKey {
  if (r.slag === 0 && r.flyAsh === 0) return 'SM'
  if (r.flyAsh === 0) return 'ES'
  if (r.slag === 0) return 'LF'
  return 'HB'
}

export const SOURCE_NOTE = '공개 데이터(UCI 콘크리트) 기반 예시'

/** 프로젝트 이름과 제품 코드의 숫자는 지어낸 예시이며 실제 치환율이 아니다. */
/** 고객 요구를 짧게 쓰는 도우미(예시 데이터용). 재령을 적용 조건으로 거는 강도 요구가 많다. */
function req(id: string, name: string, kind: 'min' | 'max', value: number, unit: string, opts: { at?: number; nice?: boolean } = {}): Requirement {
  return {
    id,
    name,
    unit,
    kind,
    ...(kind === 'min' ? { min: value } : { max: value }),
    ...(opts.at ? { at: { name: '재령', value: opts.at } } : {}),
    priority: opts.nice ? 'nice' : 'must',
  }
}

export const CONCRETE_PROJECTS: { key: BinderKey; id: string; name: string; subtitle: string; detail: string; customer: string; requirements: Requirement[] }[] = [
  { key: 'SM', id: 'demo-project-1', name: '스탠다드믹스 SM-00', subtitle: '표준 배합 강도 기준 확립', detail: '결합재: 시멘트 단독. 재령별 압축강도의 기준값을 세운다.',
    customer: '한빛건설 구조팀 (예시)',
    requirements: [req('demo-req-1-1', '압축강도', 'min', 30, 'MPa', { at: 28 }), req('demo-req-1-2', '압축강도', 'min', 20, 'MPa', { at: 7 }), req('demo-req-1-3', '시멘트', 'max', 400, 'kg/m³', { nice: true })] },
  { key: 'ES', id: 'demo-project-2', name: '에코슬래그 ES-30', subtitle: '저탄소 콘크리트 개발, 슬래그 치환', detail: '결합재: 시멘트 + 고로슬래그. 시멘트를 슬래그로 바꿔도 강도가 유지되는 조건을 찾는다.',
    customer: '그린인프라공사 (예시)',
    requirements: [req('demo-req-2-1', '압축강도', 'min', 50, 'MPa', { at: 28 }), req('demo-req-2-2', '고로슬래그', 'min', 120, 'kg/m³'), req('demo-req-2-3', '시멘트', 'max', 300, 'kg/m³')] },
  { key: 'LF', id: 'demo-project-3', name: '로히트 플라이 LF-20', subtitle: '저발열·장기강도 콘크리트 개발, 플라이애시 치환', detail: '결합재: 시멘트 + 플라이애시. 낮은 수화열과 재령에 따른 강도 증진을 본다.',
    customer: '한솔플랜트 설비팀 (예시)',
    requirements: [req('demo-req-3-1', '압축강도', 'min', 55, 'MPa', { at: 56 }), req('demo-req-3-2', '압축강도', 'min', 45, 'MPa', { at: 28 }), req('demo-req-3-3', '플라이애시', 'min', 80, 'kg/m³', { nice: true })] },
  { key: 'HB', id: 'demo-project-4', name: '하이브리드본드 HB-50', subtitle: '고성능 복합 결합재 콘크리트 개발', detail: '결합재: 시멘트 + 고로슬래그 + 플라이애시. 세 가지를 함께 쓴 배합의 강도를 평가한다.',
    customer: '미래전력 토목팀 (예시)',
    requirements: [req('demo-req-4-1', '압축강도', 'min', 80, 'MPa', { at: 28 }), req('demo-req-4-2', '물', 'max', 170, 'kg/m³'), req('demo-req-4-3', '고성능 감수제', 'max', 12, 'kg/m³', { nice: true })] },
]

/**
 * 시연용 실험의 원본 행 번호(프로젝트당 약 50건, 모두 200건). 재령 90일 이하에서 균등한 간격으로 고른 뒤,
 * 값이 다른 실험들과 많이 달라 이상치로 잡히는 행은 빼서, 일부러 심은 것 말고는 이상치로 잡히지 않게 했다
 * (압축강도는 시험을 마친 실험만 센다). analysis.test.ts가 확인한다.
 * 위에서 아래로 시작이 빠른 실험부터이고, 맨 뒤 두 건은 진행 중(LF의 마지막은 준비)이다.
 */
export const DEMO_ROWS: Record<BinderKey, number[]> = {
  SM: [
    395, 535, 538, 541, 544, 548, 551, 563, 570, 587, 592, 599, 602, 608, 613, 618, 626, 629,
    632, 635, 639, 642, 645, 724, 729, 733, 737, 740, 744, 747, 750, 754, 759, 762, 766, 772,
    775, 778, 781, 785, 788, 791, 800, 804, 807, 810, 816, 819, 823, 827,
  ],
  ES: [
    9, 17, 37, 50, 58, 72, 83, 89, 94, 99, 105, 110, 115, 132, 148, 154, 159, 391, 400, 553,
    558, 567, 575, 582, 588, 598, 651, 656, 661, 666, 671, 676, 682, 687, 692, 697, 702, 708,
    713, 718, 840, 856, 872, 889, 905, 918, 947, 966, 981, 1004, 1024,
  ],
  LF: [
    187, 192, 197, 202, 205, 207, 212, 217, 223, 243, 248, 253, 258, 263, 268, 275, 280, 285,
    300, 305, 310, 315, 321, 326, 331, 336, 341, 346, 351, 372, 389, 417, 428, 432, 443, 454,
    836, 853, 861, 875, 887, 893, 912, 941, 951, 963, 977, 999, 1011, 1019,
  ],
  HB: [
    227, 232, 237, 293, 298, 360, 365, 401, 410, 414, 425, 435, 439, 440, 450, 472, 477, 481,
    485, 490, 494, 499, 503, 507, 512, 516, 520, 525, 529, 832, 839, 849, 866, 874, 890, 895,
    907, 916, 926, 930, 934, 946, 958, 971, 986, 990, 1002, 1012, 1026,
  ],
};

/**
 * 시연용으로 값을 바꾼 곳. 공개 데이터와 다르다. 해당 실험의 목적 칸에 "※ 시연용으로 바꾼 값"으로 적는다.
 * - blank-strength: 압축강도를 비워 "빈 결과"가 나오게 한다.
 * - decimal-slip: 압축강도의 소수점을 한 자리 잘못 옮긴 입력 실수를 흉내 내 "이상치 후보"가 나오게 한다.
 * - drop-superplasticizer: 고성능 감수제 항목을 지워 "빠진 항목"이 나오게 한다.
 */
export const ALTERED: { row: number; kind: 'blank-strength' | 'decimal-slip' | 'drop-superplasticizer'; original: string; changed: string }[] = [
  { row: 400, kind: 'blank-strength', original: '39.3 MPa', changed: '(비어 있음)' },
  { row: 205, kind: 'decimal-slip', original: '12.47 MPa', changed: '124.7 MPa' },
  { row: 439, kind: 'drop-superplasticizer', original: '고성능 감수제 항목 있음', changed: '항목 없음' },
]

/** 진행이 멈춘 실험(값은 바꾸지 않고 날짜와 상태만 그렇게 둔다). 7일 넘게 손대지 않은 진행 중 실험. */
const STALE_ROW = 895

const STEPS = ['배합한다', '타설한다', '양생한다', '강도 시험을 한다']

/**
 * n일 전 시각. 하루 중 시각이나 시간대에 상관없이 "며칠 전"으로 세어지도록 정확히 n일에 한 시간을 더해 뺀다.
 */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000 - 3600000).toISOString()
}

const num = (n: number) => String(n)

interface Plan {
  status: ExperimentStatus
  startedAgo: number
  touchedAgo: number
  doneCount: number
}

/**
 * 시연용 실험의 날짜와 상태. 시작이 빠른 순서대로 약 6개월에 걸쳐 흩어 두고(k는 프로젝트 안의 순서, n은 개수),
 * 맨 뒤 두 건이 진행 중이다(LF의 마지막은 준비). 멈춘 실험은 값은 그대로 두고 날짜와 상태만 그렇게 둔다.
 */
function demoPlan(key: BinderKey, k: number, n: number, row: number): Plan {
  const p = CONCRETE_PROJECTS.findIndex((x) => x.key === key)
  const startedAgo = Math.max(3, Math.round(180 - (170 * k) / (n - 1)) - p)
  if (row === STALE_ROW) return { status: 'running', startedAgo, touchedAgo: 10, doneCount: 2 }
  if (k === n - 1) {
    if (key === 'LF') return { status: 'ready', startedAgo: 0, touchedAgo: 3, doneCount: 0 }
    return { status: 'running', startedAgo: Math.min(startedAgo, 4), touchedAgo: 1, doneCount: key === 'SM' ? 3 : 2 }
  }
  if (k === n - 2) return { status: 'running', startedAgo: Math.min(startedAgo, 6), touchedAgo: 2, doneCount: 3 }
  return { status: 'done', startedAgo, touchedAgo: startedAgo - 2, doneCount: STEPS.length }
}

/** 시연 목록에 없는 행(전체 1,030건 경로)은 모두 완료한 실험으로 두고 날짜를 흩뿌린다. */
function bulkPlan(row: number): Plan {
  const startedAgo = 100 + (row % 120)
  return { status: 'done', startedAgo, touchedAgo: startedAgo - 2, doneCount: STEPS.length }
}

function buildExperiment(
  r: ConcreteRow,
  plan: Plan,
  projectId: string,
  parts: { experiments: Experiment[]; steps: Step[]; dataItems: DataItem[] },
) {
  const key = binderOf(r)
  const id = `concrete-${r.row}`
  const alt = ALTERED.find((a) => a.row === r.row)
  const touched = daysAgo(Math.max(0, plan.touchedAgo))
  const created = daysAgo(plan.startedAgo + 1)
  const base = { deletedAt: null, version: 1 }
  const purposeLines = [`UCI 콘크리트 공개 데이터 원본 행 #${r.row}`]
  if (alt) purposeLines.push(`※ 시연용으로 바꾼 값: ${alt.kind === 'drop-superplasticizer' ? '고성능 감수제 항목을 지움' : `압축강도 ${alt.original} → ${alt.changed}`} (공개 데이터와 다름)`)
  parts.experiments.push({
    ...base,
    id,
    createdAt: created,
    updatedAt: touched,
    projectId,
    title: `배합 #${r.row}, 재령 ${r.age}일`,
    purpose: purposeLines.join('\n'),
    owner: '지윤',
    tags: ['콘크리트', '압축강도'],
    status: plan.status,
    startedAt: plan.status === 'ready' ? null : daysAgo(plan.startedAgo),
    completedAt: plan.status === 'done' ? touched : null,
    sourceExperimentId: null,
  })
  STEPS.forEach((content, i) => {
    const done = i < plan.doneCount
    parts.steps.push({
      ...base,
      id: `${id}-s${i + 1}`,
      createdAt: created,
      updatedAt: touched,
      experimentId: id,
      order: i + 1,
      content,
      done,
      doneAt: done ? touched : null,
      note: alt?.kind === 'blank-strength' && i === 3 ? '시험기 오류로 압축강도 기록 누락 (시연용)' : '',
    })
  })
  const conditions: [string, number, string][] = [['시멘트', r.cement, 'kg/m³']]
  if (key === 'ES' || key === 'HB') conditions.push(['고로슬래그', r.slag, 'kg/m³'])
  if (key === 'LF' || key === 'HB') conditions.push(['플라이애시', r.flyAsh, 'kg/m³'])
  conditions.push(['물', r.water, 'kg/m³'])
  if (alt?.kind !== 'drop-superplasticizer') conditions.push(['고성능 감수제', r.superplasticizer, 'kg/m³'])
  conditions.push(['굵은 골재', r.coarse, 'kg/m³'], ['잔골재', r.fine, 'kg/m³'], ['재령', r.age, '일'])
  const push = (kind: 'condition' | 'result', order: number, name: string, value: string, unit: string) =>
    parts.dataItems.push({ ...base, id: `${id}-${kind[0]}${order}`, createdAt: created, updatedAt: touched, experimentId: id, kind, order, name, value, unit })
  conditions.forEach(([name, value, unit], i) => push('condition', i + 1, name, num(value), unit))
  // 시험 전(진행·준비)에는 결과 항목이 아직 없다.
  if (plan.status === 'done') {
    const value = alt?.kind === 'blank-strength' ? '' : alt?.kind === 'decimal-slip' ? '124.7' : num(r.strength)
    push('result', 1, '압축강도', value, 'MPa')
  }
}

function projects(): Project[] {
  return CONCRETE_PROJECTS.map((p) => ({
    id: p.id,
    name: p.name,
    description: `${p.subtitle}\n${p.detail}\n${SOURCE_NOTE}`,
    customer: p.customer,
    requirements: p.requirements,
    createdAt: daysAgo(70),
    // 수정 시각은 지금보다 살짝 뒤로 둔다. 예시를 지운 직후 다시 넣어도 "지운 프로젝트"보다 새것으로 쳐서 되살아나게 하기 위함이다
    // (저장소의 시각은 연달아 저장할 때 실제 시계보다 조금 앞서 갈 수 있다).
    updatedAt: new Date(Date.now() + 5000).toISOString(),
    deletedAt: null,
    version: 1,
  }))
}

/** mode 'projects': 예시 프로젝트 4개만. 'demo': 시연용 200건. 'full': 공개 데이터 전체 1,030건(시연 목록의 실험은 같은 모양으로 들어간다). */
export function buildConcreteBackup(rows: ConcreteRow[], mode: 'demo' | 'full' | 'projects'): BackupFile {
  if (mode === 'projects') return { schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: new Date().toISOString(), projects: projects(), experiments: [], steps: [], dataItems: [] }
  const parts = { experiments: [] as Experiment[], steps: [] as Step[], dataItems: [] as DataItem[] }
  const byRow = new Map(rows.map((r) => [r.row, r]))
  const idOf = (key: BinderKey) => CONCRETE_PROJECTS.find((p) => p.key === key)?.id as string
  const planned = new Set<number>()
  for (const key of Object.keys(DEMO_ROWS) as BinderKey[]) {
    DEMO_ROWS[key].forEach((row, k) => {
      const r = byRow.get(row)
      if (!r) throw new Error(`원본 행 #${row}을 찾을 수 없습니다`)
      if (binderOf(r) !== key) throw new Error(`원본 행 #${row}은 ${key}가 아닙니다`)
      planned.add(row)
      buildExperiment(r, demoPlan(key, k, DEMO_ROWS[key].length, row), idOf(key), parts)
    })
  }
  if (mode === 'full') {
    for (const r of rows) if (!planned.has(r.row)) buildExperiment(r, bulkPlan(r.row), idOf(binderOf(r)), parts)
  }
  return { schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: new Date().toISOString(), projects: projects(), ...parts }
}
