import { useMemo, useState } from 'react'
import { AnalysisView } from '../components/AnalysisView'
import { useDataHub } from '../hooks/useDataHub'
import { buildMatrix } from '../services/analysis'

/** 전체 데이터의 분석. 프로젝트를 고르면 그 프로젝트만, 고르지 않으면 모두 합쳐서 본다. */
export function DataAnalysisPage() {
  const { bundles, projects, matrix } = useDataHub()
  const [projectId, setProjectId] = useState('')
  const scoped = useMemo(
    () => (projectId ? buildMatrix(bundles.filter((b) => b.experiment.projectId === projectId)) : matrix),
    [bundles, matrix, projectId],
  )
  return (
    <div>
      <div className="analysis__controls">
        <div className="field">
          <label htmlFor="scope">분석할 범위</label>
          <select id="scope" className="input input--compact" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">모든 프로젝트 ({matrix.rows.length}건)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({bundles.filter((b) => b.experiment.projectId === p.id).length}건)
              </option>
            ))}
          </select>
        </div>
        {!projectId && projects.length > 1 && (
          <p className="analysis__note analysis__scope">서로 성격이 다른 프로젝트를 합치면 경향이 섞여 흐려질 수 있습니다. 프로젝트별로도 비교해 보세요.</p>
        )}
      </div>
      <AnalysisView key={projectId} matrix={scoped} />
    </div>
  )
}
