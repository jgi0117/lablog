import type { Driver, CorrelationView } from '../services/insights'
import { niceTicks } from '../services/analysis'
import type { GroupComparison, Histogram as Hist } from '../services/stats'

const W = 640

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(3)))
}

function scale(domain: [number, number], range: [number, number]) {
  const span = domain[1] - domain[0] || 1
  return (v: number) => range[0] + ((v - domain[0]) / span) * (range[1] - range[0])
}

// ---------- 영향 주는 조건: 상관계수 막대 ----------

interface DriverBarsProps {
  drivers: Driver[]
  targetLabel: string
}

/**
 * 조건마다 결과와의 상관계수(−1~+1)를 막대로 그린다. 오른쪽(초록)은 같이 커지는 관계, 왼쪽(붉음)은 반대로 움직이는 관계.
 * 통계적으로 유의하지 않은(p ≥ 0.05) 조건은 속이 빈 막대로 그려 눈에 덜 띄게 한다. 정확한 값은 아래 표에 있다.
 */
export function DriverBars({ drivers, targetLabel }: DriverBarsProps) {
  const rowH = 30
  const left = 150
  const right = 90
  const top = 8
  const height = top + drivers.length * rowH + 30
  const x = scale([-1, 1], [left, W - right])
  const zero = x(0)
  const summary = `${targetLabel}에 대한 조건별 r 값. ${drivers
    .slice(0, 3)
    .map((d) => `${d.column.name} ${d.r.toFixed(2)}`)
    .join(', ')}${drivers.length > 3 ? ' 등' : ''}`
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="group" aria-label={summary}>
      {[-1, -0.5, 0, 0.5, 1].map((t) => (
        <g key={t}>
          <line className="chart__grid chart__grid--v" x1={x(t)} x2={x(t)} y1={top} y2={height - 24} />
          <text className="chart__tick" x={x(t)} y={height - 8} textAnchor="middle">
            {t > 0 ? `+${t}` : t}
          </text>
        </g>
      ))}
      <line className="chart__axis" x1={zero} x2={zero} y1={top} y2={height - 24} />
      {drivers.map((d, i) => {
        const y = top + i * rowH
        const sig = d.p < 0.05
        const x1 = Math.min(zero, x(d.r))
        const w = Math.max(2, Math.abs(x(d.r) - zero))
        return (
          <g key={d.column.key}>
            <text className="chart__tick" x={left - 8} y={y + 18} textAnchor="end">
              {d.column.name}
            </text>
            <rect className={`driver-bar driver-bar--${d.r >= 0 ? 'pos' : 'neg'}${sig ? '' : ' driver-bar--weak'}`} x={x1} y={y + 5} width={w} height={rowH - 12} />
            <text className="chart__note chart__note--ink" x={W - right + 8} y={y + 18}>
              {d.r.toFixed(2)}
              {sig ? ' ★' : ''}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ---------- 분포: 히스토그램 ----------

interface HistogramProps {
  hist: Hist
  mean: number
  median: number
  xLabel: string
}

export function HistogramChart({ hist, mean, median, xLabel }: HistogramProps) {
  const H = 240
  const M = { top: 16, right: 20, bottom: 44, left: 48 }
  const lo = hist.edges[0]
  const hi = hist.edges[hist.edges.length - 1]
  const x = scale([lo, hi], [M.left, W - M.right])
  const maxC = Math.max(...hist.counts)
  const yTicks = niceTicks(0, maxC, 4)
  const y = scale([0, yTicks[yTicks.length - 1]], [H - M.bottom, M.top])
  const xTicks = niceTicks(lo, hi, 6).filter((t) => t >= lo - 1e-9 && t <= hi + 1e-9)
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${xLabel} 분포. 평균 ${fmt(mean)}, 중앙값 ${fmt(median)}, 가장 많은 구간 ${maxC}건`}>
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line className="chart__grid" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
          <text className="chart__tick" x={M.left - 8} y={y(t) + 4} textAnchor="end">
            {fmt(t)}
          </text>
        </g>
      ))}
      {hist.counts.map((c, i) => (
        <rect key={i} className="hist-bar" x={x(hist.edges[i]) + 1} y={y(c)} width={Math.max(1, x(hist.edges[i + 1]) - x(hist.edges[i]) - 2)} height={Math.max(0, H - M.bottom - y(c))}>
          <title>{`${fmt(hist.edges[i])} ~ ${fmt(hist.edges[i + 1])}: ${c}건`}</title>
        </rect>
      ))}
      <line className="chart__axis" x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} />
      {xTicks.map((t) => (
        <text key={`x${t}`} className="chart__tick" x={x(t)} y={H - M.bottom + 16} textAnchor="middle">
          {fmt(t)}
        </text>
      ))}
      <line className="hist-mean" x1={x(mean)} x2={x(mean)} y1={M.top} y2={H - M.bottom} />
      <line className="hist-median" x1={x(median)} x2={x(median)} y1={M.top} y2={H - M.bottom} />
      <text className="chart__note" x={Math.min(W - M.right, x(mean) + 4)} y={M.top + 10}>
        평균 {fmt(mean)}
      </text>
      <text className="chart__label" x={(M.left + W - M.right) / 2} y={H - 8} textAnchor="middle">
        {xLabel}
      </text>
    </svg>
  )
}

// ---------- 그룹 비교: 평균 ± 표준편차 ----------

interface GroupChartProps {
  cmp: GroupComparison
  yLabel: string
  xLabel: string
}

/** 집단마다 평균(점)과 표준편차(수염), 값의 범위(옅은 막대)를 보여 준다. 집단 아래에 실험 수를 적는다. */
export function GroupChart({ cmp, yLabel, xLabel }: GroupChartProps) {
  const H = 300
  const M = { top: 16, right: 20, bottom: 62, left: 56 }
  const all = cmp.groups.flatMap((g) => [g.min, g.max])
  const ticks = niceTicks(Math.min(0, ...all), Math.max(...all), 5)
  const y = scale([ticks[0], ticks[ticks.length - 1]], [H - M.bottom, M.top])
  const slot = (W - M.left - M.right) / cmp.groups.length
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${xLabel}별 ${yLabel} 평균. ${cmp.groups.map((g) => `${g.label} ${fmt(g.mean)}`).join(', ')}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="chart__grid" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
          <text className="chart__tick" x={M.left - 8} y={y(t) + 4} textAnchor="end">
            {fmt(t)}
          </text>
        </g>
      ))}
      <line className="chart__axis" x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} />
      {cmp.groups.map((g, i) => {
        const cx = M.left + slot * (i + 0.5)
        const bw = Math.min(46, slot * 0.6)
        return (
          <g key={g.label}>
            <rect className="group-range" x={cx - bw / 2} y={y(g.max)} width={bw} height={Math.max(1, y(g.min) - y(g.max))} />
            <line className="group-whisker" x1={cx} x2={cx} y1={y(g.mean + g.sd)} y2={y(g.mean - g.sd)} />
            <line className="group-whisker" x1={cx - 8} x2={cx + 8} y1={y(g.mean + g.sd)} y2={y(g.mean + g.sd)} />
            <line className="group-whisker" x1={cx - 8} x2={cx + 8} y1={y(g.mean - g.sd)} y2={y(g.mean - g.sd)} />
            <circle className="group-mean" cx={cx} cy={y(g.mean)} r={5.5}>
              <title>{`${g.label}: 평균 ${fmt(g.mean)}, 표준편차 ${fmt(g.sd)}, 실험 ${g.n}건`}</title>
            </circle>
            <text className="chart__tick" x={cx} y={H - M.bottom + 16} textAnchor="middle">
              {g.label}
            </text>
            <text className="chart__tick" x={cx} y={H - M.bottom + 30} textAnchor="middle">
              n={g.n}
            </text>
          </g>
        )
      })}
      <text className="chart__label" x={(M.left + W - M.right) / 2} y={H - 8} textAnchor="middle">
        {xLabel}
      </text>
    </svg>
  )
}

// ---------- 상관 행렬 ----------

/** 색을 입힌 표. 초록은 같이 커지는 관계, 붉은색은 반대. 글자로 값을 모두 적어 색을 못 보는 사람도 읽을 수 있다. */
export function CorrelationHeatmap({ view }: { view: CorrelationView }) {
  const tint = (r: number) => {
    const a = Math.min(0.45, Math.abs(r) * 0.5)
    return r >= 0 ? `rgba(46, 107, 94, ${a})` : `rgba(139, 42, 42, ${a})`
  }
  return (
    <div className="heatmap-wrap" tabIndex={0} role="region" aria-label="항목 사이 상관 행렬">
      <table className="heatmap">
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">항목</span>
            </th>
            {view.columns.map((c) => (
              <th key={c.key} scope="col">
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.columns.map((row, i) => (
            <tr key={row.key}>
              <th scope="row">{row.name}</th>
              {view.cells[i].map((cell, j) =>
                cell === null ? (
                  <td key={view.columns[j].key} className="heatmap__none" aria-label="값이 모자람">
                    ·
                  </td>
                ) : (
                  <td
                    key={view.columns[j].key}
                    style={i === j ? undefined : { background: tint(cell.r) }}
                    className={i === j ? 'heatmap__self' : undefined}
                    title={`${row.name} × ${view.columns[j].name}: r = ${cell.r.toFixed(2)}, 실험 ${cell.n}건`}
                  >
                    {i === j ? '—' : cell.r.toFixed(2)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
