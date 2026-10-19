import type { DataBackend } from './repositories'
import type { ExperimentStatus } from '../domain/types'
import { buildConcreteBackup, parseConcreteCsv } from './concreteDemo'

/**
 * 개발·시연용 샘플 데이터.
 * - seedSample: 작은 고정 데이터(단위 테스트의 고정 입력. 필름 개발 업무 예시)
 * - seedDemo: 공개 데이터(UCI 콘크리트) 기반 시연 데이터 48건(프로젝트 화면, 차트, 빠짐 점검 시연용)
 * - seedConcreteFull: 같은 공개 데이터 전체 1,030건(성능 시험용)
 * - seedBulk: 성능·페이지 나눔 확인용 대량 데이터
 */

// ---------- 작은 고정 데이터 ----------
interface SampleExperiment {
  project: string
  title: string
  status: ExperimentStatus
  owner: string
  tags: string[]
  steps: string[]
  doneCount: number
  conditions: [string, string, string][]
  results: [string, string, string][]
}

const HC_STEPS = [
  'PET 기재(100 µm)를 세척하고 정전기를 제거한다',
  '코팅액(UV 경화 아크릴, 고형분 40%)을 조제한다',
  '코팅액 점도를 측정한다',
  '바 코터로 기재에 도포한다',
  '오븐에서 80°C로 용제를 건조한다',
  'UV 램프로 경화한다',
  '연필경도를 측정한다',
  '투과율과 헤이즈를 측정한다',
  '밀착성(크로스컷)을 평가한다',
]

const SAMPLES: SampleExperiment[] = [
  {
    project: '하드코팅 필름 HC-300',
    title: 'HC-300 하드코팅 조건 탐색 #4',
    status: 'running',
    owner: '지윤',
    tags: ['하드코팅', 'UV경화'],
    steps: HC_STEPS,
    doneCount: 4,
    conditions: [['건조 온도', '80', '°C'], ['건조 시간', '2', 'min'], ['UV 조사량', '500', 'mJ/cm²']],
    results: [['헤이즈', '—', '%']],
  },
  {
    project: '하드코팅 필름 HC-300',
    title: 'HC-300 하드코팅 조건 탐색 #3',
    status: 'done',
    owner: '지윤',
    tags: ['하드코팅', 'UV경화'],
    steps: ['기재 세척', '코팅액 조제', '도포', '80°C 건조', 'UV 경화', '물성 측정'],
    doneCount: 6,
    conditions: [['건조 온도', '80', '°C'], ['UV 조사량', '500', 'mJ/cm²']],
    results: [['투과율', '90.6', '%']],
  },
  {
    project: 'AG 방현 필름',
    title: 'AG 방현 필름 필러 함량 비교',
    status: 'ready',
    owner: '지윤',
    tags: ['방현'],
    steps: ['필러 분산액 3종을 조제한다', '바 코터로 도포한다', '건조 후 경화한다'],
    doneCount: 0,
    conditions: [['필러 함량', '3', 'wt%']],
    results: [],
  },
  {
    project: 'AG 방현 필름',
    title: 'AG 방현 필름 헤이즈 측정',
    status: 'running',
    owner: '지윤',
    tags: ['방현', '측정'],
    steps: ['시편을 50 mm × 50 mm로 재단한다', '헤이즈미터를 보정한다', '3회 측정해 평균을 낸다'],
    doneCount: 1,
    conditions: [['건조 온도', '80', '°C']],
    results: [['헤이즈', '12.3', '%']],
  },
  {
    project: '접이식 유연 코팅',
    title: '유연 코팅 필름 굴곡 시험 #1',
    status: 'done',
    owner: '지윤',
    tags: ['유연', '측정'],
    steps: ['시편을 재단한다', '굴곡 시험기(R=3 mm)에 장착한다', '굴곡 횟수를 기록한다'],
    doneCount: 3,
    conditions: [['건조 온도', '80', '°C']],
    results: [['굴곡 횟수', '20', '만회']],
  },
]

/** 작은 고정 샘플(실험 5건). 만든 실험 수를 돌려준다. */
export async function seedSample(db: DataBackend): Promise<number> {
  const projectIds = new Map<string, string>()
  for (const s of SAMPLES) {
    if (!projectIds.has(s.project)) {
      const p = await db.projects.create({ name: s.project, description: '' })
      projectIds.set(s.project, p.id)
    }
    const startedAt = s.status === 'ready' ? null : new Date(Date.now() - 86400000).toISOString()
    const e = await db.experiments.create({
      projectId: projectIds.get(s.project) ?? null,
      title: s.title,
      purpose: '',
      owner: s.owner,
      tags: s.tags,
      status: s.status,
      startedAt,
      completedAt: s.status === 'done' ? new Date().toISOString() : null,
      sourceExperimentId: null,
    })
    for (let i = 0; i < s.steps.length; i++) {
      const step = await db.steps.create({
        experimentId: e.id,
        order: i + 1,
        content: s.steps[i],
        done: false,
        doneAt: null,
        note: '',
      })
      if (i < s.doneCount) await db.steps.setDone(step.id, true)
    }
    let order = 1
    for (const [name, value, unit] of s.conditions) {
      await db.dataItems.create({ experimentId: e.id, kind: 'condition', order: order++, name, value, unit })
    }
    order = 1
    for (const [name, value, unit] of s.results) {
      await db.dataItems.create({ experimentId: e.id, kind: 'result', order: order++, name, value, unit })
    }
  }
  return SAMPLES.length
}

// ---------- 공개 데이터 기반 시연 데이터 ----------
// UCI 콘크리트 압축강도 데이터(Yeh, 1998, CC BY 4.0). 자세한 내용은 concrete/README.md.
// CSV(약 50KB)는 이 함수를 부를 때만 불러와서 처음 화면의 크기에 영향을 주지 않는다.

async function loadConcreteRows() {
  const { default: csv } = await import('./concrete/concrete.csv?raw')
  return parseConcreteCsv(csv)
}

/** 시연용 예시: 프로젝트 4개, 실험 48건(합치기). 만든 실험 수를 돌려준다. */
export async function seedDemo(db: DataBackend): Promise<number> {
  const file = buildConcreteBackup(await loadConcreteRows(), 'demo')
  await db.backup.importAll(file, 'merge')
  return file.experiments.length
}

/** 성능 시험용: 공개 데이터 전체 1,030건(프로젝트 4개). 화면에는 버튼이 없고 단위 테스트가 쓴다(E2E는 같은 내용을 백업 파일로 넣는다). */
export async function seedConcreteFull(db: DataBackend): Promise<number> {
  const file = buildConcreteBackup(await loadConcreteRows(), 'full')
  await db.backup.importAll(file, 'merge')
  return file.experiments.length
}

/** 성능·페이지 나눔 확인용 대량 데이터. */
export async function seedBulk(db: DataBackend, count: number, stepsEach = 8): Promise<void> {
  for (let i = 0; i < count; i++) {
    const e = await db.experiments.create({
      projectId: null,
      title: `대량 데이터 실험 ${String(i + 1).padStart(4, '0')}`,
      purpose: '',
      owner: '테스트',
      tags: [i % 2 === 0 ? '짝수' : '홀수'],
      status: (['ready', 'running', 'done'] as const)[i % 3],
      startedAt: null,
      completedAt: null,
      sourceExperimentId: null,
    })
    for (let k = 0; k < stepsEach; k++) {
      await db.steps.create({
        experimentId: e.id,
        order: k + 1,
        content: `단계 ${k + 1} 내용 ${i}`,
        done: false,
        doneAt: null,
        note: '',
      })
    }
  }
}
