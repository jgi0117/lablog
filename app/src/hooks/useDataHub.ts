import { useOutletContext } from 'react-router-dom'
import type { Project } from '../domain/types'
import type { ExperimentBundle, Matrix } from '../services/analysis'

export interface DataHubContext {
  projects: Project[]
  /** 프로젝트 id → 이름 */
  projectNames: Map<string, string>
  bundles: ExperimentBundle[]
  /** 모든 프로젝트의 실험을 한 표로 합친 것. 같은 이름의 조건·결과는 한 열이다. */
  matrix: Matrix
}

/** DataLayout이 내려주는 전체 데이터. 표·분석·내보내기 탭이 함께 쓴다. */
export function useDataHub(): DataHubContext {
  return useOutletContext<DataHubContext>()
}
