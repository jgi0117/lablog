import type { DataBackend } from './repositories'
import type { ExperimentStatus } from '../domain/types'

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

const SAMPLES: SampleExperiment[] = [
  {
    project: 'PROJECT-A',
    title: '나노입자 합성 조건 최적화 #12',
    status: 'running',
    owner: '지윤',
    tags: ['합성', '나노입자'],
    steps: [
      '반응 용기를 세척하고 건조한다',
      '용매 100 mL를 준비한다',
      '시약 A를 50 mL 계량한다',
      '반응 용기에 시약 A를 천천히 투입한다',
      '용액을 80°C로 가열하며 교반한다',
      '냉각 후 pH를 측정한다',
      '원심분리 후 상층액을 분리한다',
      '세척 후 건조한다',
      '수율을 계산하고 결과를 정리한다',
    ],
    doneCount: 4,
    conditions: [['온도', '80', '°C'], ['시간', '30', 'min'], ['교반 속도', '450', 'rpm']],
    results: [['pH', '—', '']],
  },
  {
    project: 'PROJECT-A',
    title: '나노입자 합성 조건 최적화 #11',
    status: 'done',
    owner: '지윤',
    tags: ['합성', '나노입자'],
    steps: ['시약 계량', '가열 교반', '냉각', '분리'],
    doneCount: 4,
    conditions: [['온도', '80', '°C'], ['교반 속도', '400', 'rpm']],
    results: [['수율', '88', '%']],
  },
  {
    project: 'PROJECT-B',
    title: '촉매 활성 비교 시험',
    status: 'ready',
    owner: '민호',
    tags: ['촉매'],
    steps: ['촉매 3종을 준비한다', '반응기에 충전한다', '온도별 활성을 측정한다'],
    doneCount: 0,
    conditions: [['온도', '250', '°C']],
    results: [],
  },
  {
    project: 'PROJECT-B',
    title: '고분자 필름 인장 강도 측정',
    status: 'running',
    owner: '서연',
    tags: ['고분자', '측정'],
    steps: ['시편을 재단한다', '80°C에서 열처리한다', '인장 시험기에 장착한다'],
    doneCount: 1,
    conditions: [['열처리 온도', '80', '°C']],
    results: [['평균 인장 강도', '42.3', 'MPa']],
  },
  {
    project: 'PROJECT-C',
    title: '전해질 이온전도도 측정 #3',
    status: 'done',
    owner: '지윤',
    tags: ['전해질', '측정'],
    steps: ['전해질을 조제한다', '80°C 오븐에서 건조한 뒤 글러브박스로 옮긴다', '임피던스를 측정한다'],
    doneCount: 3,
    conditions: [['건조 온도', '80', '°C']],
    results: [['이온전도도', '1.2', 'mS/cm']],
  },
]

/** 개발용 샘플 데이터. 만든 실험 수를 돌려준다. */
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
