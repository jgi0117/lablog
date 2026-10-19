import { DataGrid } from '../components/DataGrid'
import { useDataHub } from '../hooks/useDataHub'

/** 모든 실험을 항목별로 한 표에 모은다. 검색·필터·정렬·열 고르기로 끝까지 훑어볼 수 있다. */
export function DataTablePage() {
  const { matrix, projectNames } = useDataHub()
  return (
    <div>
      <p className="muted data-toolbar__note">
        실험 {matrix.rows.length}건 × 항목 {matrix.columns.length}개. 같은 이름의 조건·결과는 프로젝트가 달라도 한 열로 모았습니다. 머리글을 눌러 정렬하고, 붉은 ▲는 다른 실험과 많이 다른 값입니다.
      </p>
      <DataGrid matrix={matrix} projectNames={projectNames} />
    </div>
  )
}
