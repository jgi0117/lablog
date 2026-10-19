import Dexie, { type Table } from 'dexie'
import type { DataItem, Experiment, Project, Step } from '../../domain/types'

/**
 * 로컬 DB 스키마. 버전을 올릴 때는 새 version(n) 블록을 추가하고
 * upgrade 함수와 테스트를 같이 만든다. 이미 배포된 버전 블록은 고치지 않는다.
 */
export class LablogDB extends Dexie {
  projects!: Table<Project, string>
  experiments!: Table<Experiment, string>
  steps!: Table<Step, string>
  dataItems!: Table<DataItem, string>

  constructor(name = 'lablog') {
    super(name)
    this.version(1).stores({
      projects: 'id, deletedAt',
      experiments: 'id, status, projectId, updatedAt, deletedAt',
      steps: 'id, experimentId, [experimentId+order], deletedAt',
      dataItems: 'id, experimentId, [experimentId+kind], deletedAt',
    })
    // v2: 프로젝트별 최근순 조회용 복합 인덱스 추가. 예전에 저장된 실험에 빠져 있을 수 있는 필드를 채운다.
    this.version(2)
      .stores({
        experiments: 'id, status, projectId, updatedAt, deletedAt, [projectId+updatedAt]',
      })
      .upgrade((tx) =>
        tx
          .table('experiments')
          .toCollection()
          .modify((e: Record<string, unknown>) => {
            if (!Array.isArray(e.tags)) e.tags = []
            if (e.sourceExperimentId === undefined) e.sourceExperimentId = null
          }),
      )
  }
}
