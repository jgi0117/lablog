import { useMemo, useState } from 'react'
import { EmptyState } from '../components/EmptyState'
import { GapList } from '../components/GapList'
import { ScatterChart, TrendChart } from '../components/charts'
import { useProject } from '../hooks/useProjectContext'
import { linearFit, scatterPoints, trendPoints, type Column } from '../services/analysis'

/** 상관계수를 말로 풀어 쓴다. 숫자만 보여 주면 오해하기 쉽다. */
export function describeCorrelation(r: number): string {
  const a = Math.abs(r)
  const strength = a >= 0.8 ? '강한' : a >= 0.5 ? '뚜렷한' : a >= 0.3 ? '약한' : '거의 없는'
  if (a < 0.3) return '두 항목 사이에 뚜렷한 관계가 보이지 않습니다.'
  return `${strength} ${r > 0 ? '양의' : '음의'} 관계: 가로 값이 커질수록 세로 값이 ${r > 0 ? '커지는' : '작아지는'} 경향입니다.`
}

/** 프로젝트 분석: 조건과 결과의 관계, 실험 순서에 따른 추세, 이상치 후보. */
export function ProjectAnalysisPage() {
  const { matrix, gaps } = useProject()

  const numericCount = (c: Column) => matrix.rows.filter((r) => r.cells[c.key]?.num != null).length
  const numeric = useMemo(() => matrix.columns.filter((c) => numericCount(c) >= 3), [matrix]) // eslint-disable-line react-hooks/exhaustive-deps
  const xs = numeric
  const ys = numeric.filter((c) => c.kind === 'result')
  const defaultX = xs.find((c) => c.kind === 'condition' && new Set(matrix.rows.map((r) => r.cells[c.key]?.num)).size > 2) ?? xs[0]
  const [xKey, setXKey] = useState<string | null>(null)
  const [yKey, setYKey] = useState<string | null>(null)

  if (ys.length === 0 || xs.length < 2) {
    return (
      <EmptyState
        title="분석할 수치가 아직 부족합니다"
        description="같은 이름의 조건과 결과를 숫자로 3건 이상의 실험에 입력하면 관계와 추세 차트가 나타납니다."
      />
    )
  }

  const x = xs.find((c) => c.key === (xKey ?? defaultX?.key)) ?? xs[0]
  // 기본 세로축은 숫자 값이 가장 많은 결과 항목
  const defaultY = [...ys].sort((a, b) => numericCount(b) - numericCount(a))[0]
  const y = ys.find((c) => c.key === (yKey ?? defaultY.key)) ?? defaultY
  const label = (c: Column) => (c.unit ? `${c.name} (${c.unit})` : c.name)
  const points = scatterPoints(matrix, x.key, y.key)
  const fit = linearFit(points)
  const trend = trendPoints(matrix, y.key)
  const outliers = gaps.filter((g) => g.type === 'outlier')

  return (
    <div className="analysis">
      <div className="analysis__controls" role="group" aria-label="차트 항목">
        <div className="field">
          <label htmlFor="ax">가로축 (조건 또는 결과)</label>
          <select id="ax" className="input input--compact" value={x.key} onChange={(e) => setXKey(e.target.value)}>
            <optgroup label="조건">
              {xs.filter((c) => c.kind === 'condition').map((c) => (
                <option key={c.key} value={c.key}>
                  {label(c)}
                </option>
              ))}
            </optgroup>
            <optgroup label="결과">
              {xs.filter((c) => c.kind === 'result' && c.key !== y.key).map((c) => (
                <option key={c.key} value={c.key}>
                  {label(c)}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="field">
          <label htmlFor="ay">세로축 (결과)</label>
          <select id="ay" className="input input--compact" value={y.key} onChange={(e) => setYKey(e.target.value)}>
            {ys.map((c) => (
              <option key={c.key} value={c.key}>
                {label(c)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <section className="panel" aria-labelledby="h-scatter">
        <h2 id="h-scatter" className="panel__title">
          조건과 결과의 관계
        </h2>
        {x.key === y.key || points.length < 2 ? (
          <p className="muted">두 항목이 모두 숫자인 실험이 2건 이상 필요합니다.</p>
        ) : (
          <>
            <ScatterChart points={points} xLabel={label(x)} yLabel={label(y)} />
            <p className="analysis__note">
              {fit ? (
                <>
                  <strong>
                    상관계수 r = {fit.r.toFixed(2)} (실험 {points.length}건)
                  </strong>{' '}
                  {describeCorrelation(fit.r)} 상관이 곧 원인을 뜻하지는 않으며, 실험 수가 적으면 우연일 수 있습니다.
                </>
              ) : (
                '점이 3개 이상이고 두 값이 모두 달라야 경향선을 그립니다.'
              )}
            </p>
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="h-trend">
        <h2 id="h-trend" className="panel__title">
          실험 순서에 따른 {label(y)}
        </h2>
        {trend.length < 3 ? <p className="muted">값이 있는 실험이 3건 이상 필요합니다.</p> : <TrendChart points={trend} yLabel={label(y)} />}
      </section>

      <section className="panel" aria-labelledby="h-out">
        <h2 id="h-out" className="panel__title">
          이상치 후보 <span className="muted">({outliers.length}건)</span>
        </h2>
        <p className="muted">중앙값에서 크게 벗어난 값입니다. 실제 결과일 수도, 입력·측정 오류일 수도 있으니 해당 실험에서 확인하세요.</p>
        <GapList gaps={outliers} limit={5} />
      </section>
    </div>
  )
}
