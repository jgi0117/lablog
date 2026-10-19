import { Link } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { useToast } from '../components/Toast'
import { useProject } from '../hooks/useProjectContext'
import { matrixToCsv } from '../services/analysis'
import { STATUS_LABEL } from '../components/StatusBadge'

/** CSV를 내려받는다. 브라우저가 파일 저장을 막으면 false. */
export function downloadText(filename: string, text: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch {
    return false
  }
}

/** 프로젝트의 모든 실험을 항목별로 한 표에 모은다. 같은 이름의 조건·결과는 한 열이 된다. */
export function ProjectDataPage() {
  const { project, matrix } = useProject()
  const toast = useToast()
  if (matrix.rows.length === 0 || matrix.columns.length === 0) {
    return (
      <EmptyState title="모을 데이터가 없습니다" description="실험에 조건과 결과를 입력하면 이 표에 항목별로 모입니다.">
        <Link to={`/experiments/new?project=${project.id}`} className="btn btn--primary">
          + 이 프로젝트에 새 실험
        </Link>
      </EmptyState>
    )
  }
  const conditions = matrix.columns.filter((c) => c.kind === 'condition')
  const results = matrix.columns.filter((c) => c.kind === 'result')

  const exportCsv = () => {
    const ok = downloadText(`${project.name}-데이터.csv`, matrixToCsv(matrix))
    toast.show({ message: ok ? 'CSV 파일을 저장했습니다' : '파일을 저장하지 못했습니다. 브라우저의 다운로드 설정을 확인하세요.' })
  }

  return (
    <div>
      <div className="data-toolbar">
        <p className="muted">
          실험 {matrix.rows.length}건 × 항목 {matrix.columns.length}개. 같은 이름의 조건·결과는 한 열로 모았습니다. 붉은 ▲는 다른 실험과 많이 다른 값입니다.
        </p>
        <button type="button" className="btn" onClick={exportCsv}>
          CSV로 내보내기
        </button>
      </div>
      <div className="matrix-wrap" tabIndex={0} role="region" aria-label="실험 × 항목 데이터 표">
        <table className="matrix">
          <thead>
            <tr>
              <th rowSpan={2} className="matrix__exp">
                실험
              </th>
              <th rowSpan={2}>상태</th>
              {conditions.length > 0 && (
                <th colSpan={conditions.length} className="matrix__group">
                  조건
                </th>
              )}
              {results.length > 0 && (
                <th colSpan={results.length} className="matrix__group matrix__group--result">
                  결과
                </th>
              )}
            </tr>
            <tr>
              {[...conditions, ...results].map((c) => (
                <th key={c.key} scope="col" className="matrix__col">
                  {c.name}
                  {c.unit && <span className="matrix__unit"> ({c.unit})</span>}
                  {c.units.length > 1 && <span className="matrix__warn" title={`여러 단위가 섞여 있습니다: ${c.units.join(', ')}`}> 단위 확인</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((r) => (
              <tr key={r.experiment.id}>
                <th scope="row" className="matrix__exp">
                  <Link to={`/experiments/${r.experiment.id}`}>{r.experiment.title}</Link>
                </th>
                <td>{STATUS_LABEL[r.experiment.status]}</td>
                {[...conditions, ...results].map((c) => {
                  const cell = r.cells[c.key]
                  if (!cell) return <td key={c.key} className="cell cell--none" aria-label="항목 없음">·</td>
                  return (
                    <td key={c.key} className={`cell${cell.outlier ? ' cell--out' : ''}${cell.empty ? ' cell--empty' : ''}`}>
                      {cell.empty ? '—' : cell.value}
                      {cell.outlier && (
                        <>
                          <span className="cell__flag" aria-hidden="true">
                            {' '}
                            ▲
                          </span>
                          <span className="visually-hidden"> (이상치 후보)</span>
                        </>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
