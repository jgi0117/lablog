import { useOutletContext } from 'react-router-dom'
import type { ExperimentData } from './useExperimentData'

/** ExperimentLayout이 내려주는 실험 데이터. 개요·절차·조건·결과 탭이 함께 쓴다. */
export function useExperiment(): ExperimentData & { experiment: NonNullable<ExperimentData['experiment']> } {
  const ctx = useOutletContext<ExperimentData>()
  if (!ctx.experiment) throw new Error('실험을 불러온 뒤에만 사용할 수 있습니다')
  return ctx as ExperimentData & { experiment: NonNullable<ExperimentData['experiment']> }
}
