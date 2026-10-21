import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { DataGrid } from '../../data-hub/components/DataGrid'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { useToast } from '../../../shared/ui/Toast'
import { useProject } from '../hooks/useProjectContext'
import { matrixToCsv } from '../../../domain/analysis/analysis'
import { downloadText } from '../../settings/application/download'
import { logUsage } from '../../settings/application/usage'

/** 프로젝트의 모든 실험을 항목별로 한 표에 모은다. 같은 이름의 조건·결과는 한 열이 된다. */
export function ProjectDataPage() {
  const { project, matrix } = useProject()
  const toast = useToast()
  const reqs = useMemo(() => new Map([[project.id, project.requirements ?? []]]), [project])
  if (matrix.rows.length === 0 || matrix.columns.length === 0) {
    return (
      <EmptyState title="모을 데이터가 없습니다" description="실험에 조건과 결과를 입력하면 이 표에 항목별로 모입니다.">
        <Link to={`/experiments/new?project=${project.id}`} className="btn btn--primary">
          + 이 프로젝트에 새 실험
        </Link>
      </EmptyState>
    )
  }

  const exportCsv = () => {
    const ok = downloadText(`${project.name}-데이터.csv`, matrixToCsv(matrix))
    if (ok) logUsage('csv_export', { rows: matrix.rows.length })
    toast.show({ message: ok ? 'CSV 파일을 저장했습니다' : '파일을 저장하지 못했습니다. 브라우저의 다운로드 설정을 확인하세요.' })
  }

  return (
    <div>
      <div className="data-toolbar">
        <p className="muted">
          실험 {matrix.rows.length}건 × 항목 {matrix.columns.length}개. 같은 이름의 조건·결과는 한 열로 모았습니다. 머리글을 눌러 정렬하고, 붉은 ▲는 다른 실험과 많이 다른 값입니다.{' '}
          <Link to="/data/export">분석·머신러닝용 파일은 데이터 &gt; 내보내기</Link>에서 받을 수 있습니다.
        </p>
        <button type="button" className="btn" onClick={exportCsv}>
          CSV로 내보내기
        </button>
      </div>
      <DataGrid matrix={matrix} requirementsByProject={reqs} />
    </div>
  )
}
