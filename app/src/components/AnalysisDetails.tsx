import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { columnSummaries, correlationView, columnValues, rankedExperiments } from '../services/insights'
import { histogram } from '../services/stats'
import { trendPoints, type Column, type Gap, type Matrix } from '../services/analysis'
import { GapList } from './GapList'
import { CorrelationHeatmap, HistogramChart } from './statCharts'
import { TrendChart } from './charts'

const label = (column: Column) => (column.unit ? `${column.name} (${column.unit})` : column.name)
const format = (value: number) => String(Number(value.toPrecision(4)))

interface Props {
  matrix: Matrix
  y: Column
  gaps?: Gap[]
}

export function AnalysisDetails({ matrix, y, gaps }: Props) {
  const heat = useMemo(() => correlationView(matrix), [matrix])
  const summaries = useMemo(() => columnSummaries(matrix), [matrix])
  const values = useMemo(() => columnValues(matrix, y.key).filter((value): value is number => value !== null), [matrix, y])
  const distribution = useMemo(() => histogram(values), [values])
  const summary = summaries.find((item) => item.column.key === y.key)?.summary ?? null
  const trend = trendPoints(matrix, y.key)
  const top = rankedExperiments(matrix, y.key, 'high', 5)
  const bottom = rankedExperiments(matrix, y.key, 'low', 5)
  const outliers = gaps?.filter((gap) => gap.type === 'outlier') ?? []
  const f = format
  const hist = distribution
  const ySummary = summary
  const sums = summaries
  return (
    <>
      <section className="panel" aria-labelledby="h-dist">
        <h2 id="h-dist" className="panel__title">
          {y.name}의 분포
        </h2>
        {hist && ySummary && (
          <>
            <HistogramChart hist={hist} mean={ySummary.mean} median={ySummary.median} xLabel={label(y)} />
            <p className="analysis__note">
              평균 {f(ySummary.mean)}, 중앙값 {f(ySummary.median)}, 표준편차 {f(ySummary.sd)}, 범위 {f(ySummary.min)}~{f(ySummary.max)}. 초록 실선은 중앙값, 붉은 점선은 평균입니다.
              {ySummary.cv !== null && ` 변동계수 ${(ySummary.cv * 100).toFixed(0)}%.`}
            </p>
          </>
        )}
      </section>

      {heat && (
        <section className="panel" aria-labelledby="h-heat">
          <h2 id="h-heat" className="panel__title">
            항목 사이의 상관 행렬
          </h2>
          <CorrelationHeatmap view={heat} />
          <p className="analysis__note">초록은 함께 커지는 관계, 붉은색은 한쪽이 클수록 다른 쪽이 작아지는 관계입니다. 조건끼리 상관이 높으면(재료를 함께 늘리는 배합 등) 각각의 영향을 따로 떼어 보기 어렵습니다.</p>
        </section>
      )}

      <section className="panel" aria-labelledby="h-trend">
        <h2 id="h-trend" className="panel__title">
          실험 순서에 따른 {label(y)}
        </h2>
        {trend.length < 3 ? <p className="muted">값이 있는 실험이 3건 이상 필요합니다.</p> : <TrendChart points={trend} yLabel={label(y)} />}
      </section>

      <section className="panel" aria-labelledby="h-top">
        <h2 id="h-top" className="panel__title">
          {y.name} 상위·하위 실험
        </h2>
        <div className="rank-grid">
          {[
            ['높은 순 5건', top],
            ['낮은 순 5건', bottom],
          ].map(([title, list]) => (
            <div key={title as string}>
              <h3 className="panel__sub">{title as string}</h3>
              <ol className="rank-list">
                {(list as typeof top).map((r) => (
                  <li key={r.row.experiment.id}>
                    <Link to={`/experiments/${r.row.experiment.id}`}>{r.row.experiment.title}</Link> <b>{f(r.value)}</b>
                    {y.unit && <span className="muted"> {y.unit}</span>}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      <section className="panel" aria-labelledby="h-sum">
        <h2 id="h-sum" className="panel__title">
          항목별 요약 통계
        </h2>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="항목별 요약 통계 표">
          <table className="stat-table">
            <thead>
              <tr>
                <th scope="col">항목</th>
                <th scope="col">구분</th>
                <th scope="col">실험 수</th>
                <th scope="col">결측</th>
                <th scope="col">평균</th>
                <th scope="col">표준편차</th>
                <th scope="col">최소</th>
                <th scope="col">중앙값</th>
                <th scope="col">최대</th>
                <th scope="col">이상치</th>
              </tr>
            </thead>
            <tbody>
              {sums.map((s) => (
                <tr key={s.column.key}>
                  <th scope="row">{label(s.column)}</th>
                  <td>{s.column.kind === 'condition' ? '조건' : '결과'}</td>
                  <td>{s.summary?.n ?? 0}</td>
                  <td>{s.missing}</td>
                  <td>{s.summary ? f(s.summary.mean) : '—'}</td>
                  <td>{s.summary ? f(s.summary.sd) : '—'}</td>
                  <td>{s.summary ? f(s.summary.min) : '—'}</td>
                  <td>{s.summary ? f(s.summary.median) : '—'}</td>
                  <td>{s.summary ? f(s.summary.max) : '—'}</td>
                  <td>{s.outliers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {gaps && (
        <section className="panel" aria-labelledby="h-out">
          <h2 id="h-out" className="panel__title">
            이상치 후보 <span className="muted">({outliers.length}건)</span>
          </h2>
          <p className="muted">중앙값에서 크게 벗어난 값입니다. 실제 결과일 수도, 입력·측정 오류일 수도 있으니 해당 실험에서 확인하세요.</p>
          <GapList gaps={outliers} limit={5} />
        </section>
      )}
    </>
  )
}
