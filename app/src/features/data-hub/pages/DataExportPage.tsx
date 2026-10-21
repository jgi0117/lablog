import { useMemo, useState } from 'react'
import { useToast } from '../../../shared/ui/Toast'
import { useDataHub } from '../hooks/useDataHub'
import { buildMatrix } from '../../../domain/analysis/analysis'
import { columnLabel, dictionaryCsv, jsonExport, pandasSnippet, tidyCsv, wideCsv } from '../application/dataExport'
import { downloadText } from '../../settings/application/download'
import { columnSummaries } from '../../../domain/analysis/insights'
import { logUsage } from '../../settings/application/usage'

const today = () => new Date().toISOString().slice(0, 10)

/**
 * 데이터를 파일로 내보낸다. 통계 도구(엑셀, R)나 머신러닝(파이썬)에 바로 쓸 수 있는 형식 네 가지와, 열이 무엇인지 알려 주는 데이터 사전.
 * 모든 파일은 이 기기 안에서 만들어지고 어디로도 전송되지 않는다.
 */
export function DataExportPage() {
  const { bundles, projects, matrix, projectNames } = useDataHub()
  const toast = useToast()
  const [projectId, setProjectId] = useState('')
  const scoped = useMemo(
    () => (projectId ? buildMatrix(bundles.filter((b) => b.experiment.projectId === projectId)) : matrix),
    [bundles, matrix, projectId],
  )
  const numericCols = useMemo(() => scoped.columns.filter((c) => scoped.rows.some((r) => r.cells[c.key]?.num != null)), [scoped])
  const sums = useMemo(() => columnSummaries(scoped), [scoped])
  const emptyShare = useMemo(() => {
    const cells = numericCols.length * scoped.rows.length
    const filled = sums.reduce((n, s) => n + (s.summary?.n ?? 0), 0)
    return cells === 0 ? 0 : 1 - filled / cells
  }, [numericCols, scoped.rows.length, sums])
  const mixed = scoped.columns.filter((c) => c.units.length > 1)
  const resultCol = scoped.columns.find((c) => c.kind === 'result' && numericCols.includes(c))
  const scopeName = projectId ? (projectNames.get(projectId) ?? '프로젝트') : '전체'
  const base = `lablog-${scopeName.replace(/[\\/:*?"<>|\s]+/g, '-')}-${today()}`
  const opts = { projectNames }
  const [snippetOpen, setSnippetOpen] = useState(false)

  const save = (kind: string, name: string, text: string, mime?: string) => {
    const ok = downloadText(name, text, mime)
    if (ok) logUsage('csv_export', { kind, rows: scoped.rows.length })
    toast.show({ message: ok ? `${name} 파일을 저장했습니다` : '파일을 저장하지 못했습니다. 브라우저의 다운로드 설정을 확인하세요.' })
  }

  const snippet = pandasSnippet(`${base}-analysis.csv`, resultCol ? columnLabel(resultCol) : undefined)

  return (
    <div className="export">
      <div className="analysis__controls">
        <div className="field">
          <label htmlFor="export-scope">내보낼 범위</label>
          <select id="export-scope" className="input input--compact" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">모든 프로젝트 ({matrix.rows.length}건)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({bundles.filter((b) => b.experiment.projectId === p.id).length}건)
              </option>
            ))}
          </select>
        </div>
      </div>

      <section className="panel" aria-labelledby="h-quality">
        <h2 id="h-quality" className="panel__title">
          내보내기 전에 확인할 것
        </h2>
        <ul className="export__checks">
          <li>
            실험 <b>{scoped.rows.length}건</b> × 항목 <b>{scoped.columns.length}개</b> (숫자로 읽히는 항목 {numericCols.length}개)
          </li>
          <li>
            숫자 칸 중 비어 있는 비율 <b>{(emptyShare * 100).toFixed(0)}%</b>
            {emptyShare > 0.3 && <span className="muted"> — 많이 비어 있습니다. 모델에 쓰기 전에 결측을 어떻게 다룰지 정해야 합니다.</span>}
          </li>
          {mixed.length > 0 ? (
            <li className="export__warn">
              단위가 섞여 있는 항목: {mixed.map((c) => `${c.name} (${c.units.join(' / ')})`).join(', ')}. 내보낼 때 단위를 바꾸지 않으니 먼저 통일하세요.
            </li>
          ) : (
            <li>단위가 섞인 항목은 없습니다.</li>
          )}
          <li className="muted">진행 중이거나 준비 중인 실험은 결과가 비어 있을 수 있습니다. 학습·통계에는 완료한 실험만 쓰는 것이 안전합니다.</li>
        </ul>
      </section>

      <section className="panel" aria-labelledby="h-files">
        <h2 id="h-files" className="panel__title">
          파일로 내려받기
        </h2>
        <ul className="export__list">
          <li>
            <div>
              <h3 className="panel__sub">분석용 CSV (넓은 형식, 숫자만)</h3>
              <p className="muted">실험 한 건이 한 줄, 조건·결과가 열입니다. 숫자가 아닌 값과 빈 칸은 빈칸으로 둡니다. 파이썬·R·모델에 바로 읽힙니다.</p>
            </div>
            <button type="button" className="btn btn--primary" onClick={() => save('wide-numeric', `${base}-analysis.csv`, wideCsv(scoped, { ...opts, numericOnly: true }))}>
              분석용 CSV 받기
            </button>
          </li>
          <li>
            <div>
              <h3 className="panel__sub">엑셀용 CSV (원래 값 그대로)</h3>
              <p className="muted">"—", 범위, 문자 등 입력한 값 그대로 담습니다. 한글이 깨지지 않도록 엑셀용 표시(BOM)를 붙입니다.</p>
            </div>
            <button type="button" className="btn" onClick={() => save('wide', `${base}.csv`, wideCsv(scoped, opts))}>
              엑셀용 CSV 받기
            </button>
          </li>
          <li>
            <div>
              <h3 className="panel__sub">긴 형식 CSV (값 하나가 한 줄)</h3>
              <p className="muted">실험, 구분, 항목, 값, 숫자값, 단위. 항목이 실험마다 달라도 되고, 그룹별 통계를 낼 때 좋습니다.</p>
            </div>
            <button type="button" className="btn" onClick={() => save('tidy', `${base}-long.csv`, tidyCsv(scoped, opts))}>
              긴 형식 CSV 받기
            </button>
          </li>
          <li>
            <div>
              <h3 className="panel__sub">JSON</h3>
              <p className="muted">실험마다 조건과 결과를 이름으로 묶은 구조입니다. 웹, 노트북, 데이터베이스로 옮길 때 씁니다.</p>
            </div>
            <button type="button" className="btn" onClick={() => save('json', `${base}.json`, jsonExport(scoped, opts), 'application/json;charset=utf-8')}>
              JSON 받기
            </button>
          </li>
          <li>
            <div>
              <h3 className="panel__sub">데이터 사전</h3>
              <p className="muted">열마다 구분, 단위, 개수, 결측, 평균·표준편차·범위, 이상치 후보 수를 적은 설명서입니다. 데이터 파일과 함께 보관하세요.</p>
            </div>
            <button type="button" className="btn" onClick={() => save('dictionary', `${base}-dictionary.csv`, dictionaryCsv(scoped))}>
              데이터 사전 받기
            </button>
          </li>
        </ul>
      </section>

      <section className="panel" aria-labelledby="h-py">
        <h2 id="h-py" className="panel__title">
          파이썬으로 읽기
        </h2>
        <p className="muted">분석용 CSV를 받은 뒤 이렇게 불러 시작할 수 있습니다. 파일 이름과 결과 열이 지금 선택한 범위에 맞춰져 있습니다.</p>
        <button type="button" className="btn btn--quiet" aria-expanded={snippetOpen} onClick={() => setSnippetOpen((o) => !o)}>
          {snippetOpen ? '예시 접기' : '예시 코드 보기'}
        </button>
        {snippetOpen && (
          <>
            <pre className="export__code" tabIndex={0}>
              {snippet}
            </pre>
            <button
              type="button"
              className="btn"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(snippet)
                  .then(() => toast.show({ message: '코드를 복사했습니다' }))
                  .catch(() => toast.show({ message: '복사하지 못했습니다. 직접 선택해서 복사하세요.' }))
              }}
            >
              복사
            </button>
          </>
        )}
      </section>
    </div>
  )
}
