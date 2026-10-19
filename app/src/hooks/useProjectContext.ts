import { useOutletContext } from 'react-router-dom'
import type { Project } from '../domain/types'
import type { ExperimentBundle, Gap, Matrix } from '../services/analysis'

export interface ProjectContext {
  project: Project
  bundles: ExperimentBundle[]
  matrix: Matrix
  gaps: Gap[]
  reload: () => Promise<void>
}

/** ProjectLayout이 내려주는 프로젝트 데이터. 현황·데이터·분석 탭이 함께 쓴다. */
export function useProject(): ProjectContext {
  return useOutletContext<ProjectContext>()
}
