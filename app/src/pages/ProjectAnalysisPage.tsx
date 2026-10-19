import { useEffect } from 'react'
import { AnalysisView } from '../components/AnalysisView'
import { useProject } from '../hooks/useProjectContext'
import { describeCorrelation } from '../services/stats'
import { logUsage } from '../services/usage'

export { describeCorrelation }

/** 프로젝트 분석: 영향 주는 조건, 조건 값별 비교, 관계·분포·상관 행렬, 요약 통계, 추세, 이상치 후보. */
export function ProjectAnalysisPage() {
  const { matrix, gaps } = useProject()
  useEffect(() => {
    logUsage('analysis_view')
  }, [])
  return <AnalysisView matrix={matrix} gaps={gaps} />
}
