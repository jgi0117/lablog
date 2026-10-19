import type { BackupFile, DataBackend } from './repositories'
import { BACKUP_SCHEMA_VERSION } from './repositories'
import type { DataItem, Experiment, ExperimentStatus, Project, Step } from '../domain/types'

/**
 * 개발·시연용 샘플 데이터. 필름 제품 개발(하드코팅, 방현, 유연 코팅) 업무를 기준으로 한다.
 * - seedSample: 작은 고정 데이터(테스트와 화면 확인용)
 * - seedDemo: 몇 주에 걸친 이력이 있는 데이터(프로젝트 화면, 차트, 빠짐 점검 시연용)
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

// ---------- 이력이 있는 시연 데이터 ----------
/**
 * n일 전 시각. 하루 중 시각이나 시간대에 상관없이 "며칠 전"으로 세어지도록 정확히 n일에 한 시간을 더해 뺀다.
 * (예전에는 날짜만 맞추고 시각을 15시로 고정해서, 한국과 UTC 서버에서 "10일 전"이 9일로 세어졌다.)
 */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000 - 3600000).toISOString()
}

type Cond = [name: string, value: string, unit: string]
interface DemoExperiment {
  key: string
  project: string
  title: string
  status: ExperimentStatus
  tags: string[]
  startedAgo: number
  /** 마지막으로 손댄 시점(며칠 전). 완료한 실험은 완료 시점과 같다. */
  touchedAgo: number
  steps: string[]
  doneCount: number
  conditions: Cond[]
  results: Cond[]
  note?: { step: number; text: string }
}

const P_HC = '하드코팅 필름 HC-300'
const P_AG = 'AG 방현 필름'
const P_FLEX = '접이식 유연 코팅'

/** 하드코팅 8건: 두께·건조·UV 조건을 바꿔 가며 경도, 투과율, 헤이즈를 본다. #8에는 일부러 빠진 것과 이상치를 넣었다. */
const HC_RUNS: {
  n: number
  ago: number
  thick: string
  temp: string
  time: string | null
  uv: string
  hard: string
  tr: string
  haze: string
  adh: string
  yi: string
}[] = [
  { n: 1, ago: 42, thick: '3', temp: '80', time: '2', uv: '300', hard: '1', tr: '91.2', haze: '0.6', adh: '100', yi: '0.8' },
  { n: 2, ago: 35, thick: '3', temp: '90', time: '2', uv: '500', hard: '2', tr: '91.0', haze: '0.6', adh: '100', yi: '0.9' },
  { n: 3, ago: 28, thick: '5', temp: '80', time: '2', uv: '300', hard: '2', tr: '90.8', haze: '0.7', adh: '100', yi: '0.9' },
  { n: 4, ago: 21, thick: '5', temp: '90', time: '2', uv: '500', hard: '3', tr: '90.6', haze: '0.7', adh: '100', yi: '1.0' },
  { n: 5, ago: 17, thick: '5', temp: '100', time: '3', uv: '700', hard: '3', tr: '90.3', haze: '0.8', adh: '95', yi: '1.2' },
  { n: 6, ago: 13, thick: '7', temp: '90', time: '3', uv: '500', hard: '3', tr: '90.1', haze: '0.9', adh: '100', yi: '1.1' },
  { n: 7, ago: 9, thick: '7', temp: '100', time: '3', uv: '700', hard: '4', tr: '89.8', haze: '1.0', adh: '90', yi: '1.4' },
  { n: 8, ago: 6, thick: '7', temp: '90', time: null, uv: '500', hard: '3', tr: '90.0', haze: '3.9', adh: '', yi: '1.1' },
]

function demoExperiments(): DemoExperiment[] {
  const out: DemoExperiment[] = []
  for (const r of HC_RUNS) {
    const conditions: Cond[] = [
      ['코팅 두께', r.thick, 'µm'],
      ['건조 온도', r.temp, '°C'],
      ...(r.time ? ([['건조 시간', r.time, 'min']] as Cond[]) : []),
      ['UV 조사량', r.uv, 'mJ/cm²'],
    ]
    out.push({
      key: `hc${r.n}`,
      project: P_HC,
      title: `HC-300 하드코팅 조건 탐색 #${r.n}`,
      status: 'done',
      tags: ['하드코팅', 'UV경화'],
      startedAgo: r.ago,
      touchedAgo: r.ago - 1,
      steps: HC_STEPS,
      doneCount: HC_STEPS.length,
      conditions,
      results: [
        ['연필경도', r.hard, 'H'],
        ['투과율', r.tr, '%'],
        ['헤이즈', r.haze, '%'],
        ['밀착성', r.adh, '%'],
        ['황색도', r.yi, 'YI'],
      ],
      note: r.n === 8 ? { step: 4, text: '도포 중 기포 발생, 건조 시간 기록 누락' } : undefined,
    })
  }
  out.push(
    {
      key: 'hc9',
      project: P_HC,
      title: 'HC-300 하드코팅 조건 탐색 #9',
      status: 'running',
      tags: ['하드코팅', 'UV경화'],
      startedAgo: 12,
      touchedAgo: 10,
      steps: HC_STEPS,
      doneCount: 5,
      conditions: [['코팅 두께', '7', 'µm'], ['건조 온도', '90', '°C'], ['UV 조사량', '700', 'mJ/cm²']],
      results: [],
    },
    {
      key: 'hc10',
      project: P_HC,
      title: 'HC-300 하드코팅 조건 탐색 #10',
      status: 'running',
      tags: ['하드코팅', 'UV경화'],
      startedAgo: 2,
      touchedAgo: 1,
      steps: HC_STEPS,
      doneCount: 3,
      conditions: [['코팅 두께', '5', 'µm'], ['건조 온도', '90', '°C'], ['건조 시간', '2', 'min'], ['UV 조사량', '600', 'mJ/cm²']],
      results: [],
    },
  )

  const AG_STEPS = ['필러 분산액을 조제한다', '바 코터로 도포한다', '80°C로 건조한다', 'UV 경화한다', '헤이즈와 광택도를 측정한다']
  const ag: [number, number, string, string, string, string, number][] = [
    [1, 30, '2', '6.1', '92', '90.8', 29],
    [2, 22, '4', '12.4', '78', '90.1', 21],
    [3, 14, '6', '19.8', '61', '89.4', 13],
  ]
  for (const [n, ago, filler, haze, gloss, tr, touched] of ag) {
    out.push({
      key: `ag${n}`,
      project: P_AG,
      title: `AG 방현 필름 필러 함량 비교 #${n}`,
      status: 'done',
      tags: ['방현', '필러'],
      startedAgo: ago,
      touchedAgo: touched,
      steps: AG_STEPS,
      doneCount: AG_STEPS.length,
      conditions: [['필러 함량', filler, 'wt%'], ['코팅 두께', '4', 'µm'], ['건조 온도', '80', '°C']],
      results: [['헤이즈', haze, '%'], ['광택도', gloss, 'GU'], ['투과율', tr, '%']],
    })
  }
  out.push({
    key: 'ag4',
    project: P_AG,
    title: 'AG 방현 필름 필러 함량 비교 #4',
    status: 'ready',
    tags: ['방현', '필러'],
    startedAgo: 0,
    touchedAgo: 3,
    steps: AG_STEPS,
    doneCount: 0,
    conditions: [['필러 함량', '8', 'wt%'], ['코팅 두께', '4', 'µm'], ['건조 온도', '80', '°C']],
    results: [],
  })

  const FLEX_STEPS = ['시편을 재단한다', '굴곡 시험기(R=3 mm)에 장착한다', '굴곡을 반복하며 크랙을 확인한다', '연필경도를 측정한다']
  const flex: [number, number, string, string, string, string, number][] = [
    [1, 26, '3', '300', '15', '1', 25],
    [2, 18, '5', '500', '8', '3', 17],
    [3, 8, '4', '400', '12', '2', 7],
  ]
  for (const [n, ago, thick, uv, bends, hard, touched] of flex) {
    out.push({
      key: `fx${n}`,
      project: P_FLEX,
      title: `유연 코팅 굴곡 내구 평가 #${n}`,
      status: 'done',
      tags: ['유연', '굴곡'],
      startedAgo: ago,
      touchedAgo: touched,
      steps: FLEX_STEPS,
      doneCount: FLEX_STEPS.length,
      conditions: [['코팅 두께', thick, 'µm'], ['UV 조사량', uv, 'mJ/cm²']],
      results: [['굴곡 횟수', bends, '만회'], ['연필경도', hard, 'H']],
    })
  }
  return out
}

/** 이력이 있는 시연 데이터를 가져온다(병합). 만든 실험 수를 돌려준다. */
export async function seedDemo(db: DataBackend): Promise<number> {
  const exps = demoExperiments()
  const projects: Project[] = []
  const projectId = new Map<string, string>()
  for (const name of [P_HC, P_AG, P_FLEX]) {
    const id = `demo-project-${projects.length + 1}`
    projectId.set(name, id)
    projects.push({
      id,
      name,
      description:
        name === P_HC
          ? 'PET 기재 위 UV 경화 하드코팅. 목표: 연필경도 3H 이상, 투과율 90% 이상, 헤이즈 1% 이하'
          : name === P_AG
            ? '필러 함량으로 헤이즈와 광택도를 조절하는 방현 코팅'
            : '접이식 디스플레이용. 경도와 굴곡 내구의 균형',
      createdAt: daysAgo(45),
      updatedAt: daysAgo(45),
      deletedAt: null,
      version: 1,
    })
  }
  const experiments: Experiment[] = []
  const steps: Step[] = []
  const dataItems: DataItem[] = []
  for (const e of exps) {
    const id = `demo-${e.key}`
    const started = e.status === 'ready' ? null : daysAgo(e.startedAgo)
    const touched = daysAgo(Math.max(0, e.touchedAgo))
    experiments.push({
      id,
      createdAt: daysAgo(e.startedAgo + 1),
      updatedAt: touched,
      deletedAt: null,
      version: 1,
      projectId: projectId.get(e.project) ?? null,
      title: e.title,
      purpose: '',
      owner: '지윤',
      tags: e.tags,
      status: e.status,
      startedAt: started,
      completedAt: e.status === 'done' ? touched : null,
      sourceExperimentId: null,
    })
    e.steps.forEach((content, i) => {
      const done = i < e.doneCount
      steps.push({
        id: `${id}-s${i + 1}`,
        createdAt: daysAgo(e.startedAgo + 1),
        updatedAt: touched,
        deletedAt: null,
        version: 1,
        experimentId: id,
        order: i + 1,
        content,
        done,
        doneAt: done ? touched : null,
        note: e.note && e.note.step === i + 1 ? e.note.text : '',
      })
    })
    ;(['condition', 'result'] as const).forEach((kind) => {
      ;(kind === 'condition' ? e.conditions : e.results).forEach(([name, value, unit], i) => {
        dataItems.push({
          id: `${id}-${kind[0]}${i + 1}`,
          createdAt: daysAgo(e.startedAgo + 1),
          updatedAt: touched,
          deletedAt: null,
          version: 1,
          experimentId: id,
          kind,
          order: i + 1,
          name,
          value,
          unit,
        })
      })
    })
  }
  const file: BackupFile = { schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: new Date().toISOString(), projects, experiments, steps, dataItems }
  await db.backup.importAll(file, 'merge')
  return experiments.length
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
