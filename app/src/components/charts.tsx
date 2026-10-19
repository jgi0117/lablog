import { useNavigate } from 'react-router-dom'
import { linearFit, median, niceTicks, type Point, type TimelineBar } from '../services/analysis'

const W = 640
const H = 340
const M = { top: 20, right: 24, bottom: 52, left: 64 }

function scale(domain: [number, number], range: [number, number]) {
  const span = domain[1] - domain[0] || 1
  return (v: number) => range[0] + ((v - domain[0]) / span) * (range[1] - range[0])
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(4)))
}

function shortTitle(title: string): string {
  const m = title.match(/#\d+/)
  return m ? m[0] : title.slice(0, 6)
}

interface FrameProps {
  title: string
  summary: string
  children: React.ReactNode
  height?: number
}

/**
 * 차트 공통 틀. 스크린 리더에는 summary를 읽어 주고, 자세한 값은 "데이터" 탭의 표에 있다.
 * 점과 막대가 눌러서 열 수 있는 링크라서 role은 img가 아니라 group이다(img 안에 조작 요소를 두면 접근성 위반).
 */
function Frame({ title, summary, children, height = H }: FrameProps) {
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="group" aria-label={`${title}. ${summary}`} preserveAspectRatio="xMidYMid meet">
      {children}
    </svg>
  )
}

interface AxesProps {
  xTicks: number[]
  yTicks: number[]
  x: (v: number) => number
  y: (v: number) => number
  xLabel: string
  yLabel: string
  xFormat?: (v: number) => string
}

function Axes({ xTicks, yTicks, x, y, xLabel, yLabel, xFormat = fmt }: AxesProps) {
  const x0 = M.left
  const x1 = W - M.right
  const y0 = H - M.bottom
  const y1 = M.top
  return (
    <g>
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line className="chart__grid" x1={x0} x2={x1} y1={y(t)} y2={y(t)} />
          <text className="chart__tick" x={x0 - 8} y={y(t) + 4} textAnchor="end">
            {fmt(t)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <g key={`x${t}`}>
          <line className="chart__grid chart__grid--v" x1={x(t)} x2={x(t)} y1={y0} y2={y1} />
          <text className="chart__tick" x={x(t)} y={y0 + 18} textAnchor="middle">
            {xFormat(t)}
          </text>
        </g>
      ))}
      <line className="chart__axis" x1={x0} x2={x1} y1={y0} y2={y0} />
      <line className="chart__axis" x1={x0} x2={x0} y1={y0} y2={y1} />
      <text className="chart__label" x={(x0 + x1) / 2} y={H - 10} textAnchor="middle">
        {xLabel}
      </text>
      <text className="chart__label" transform={`translate(16 ${(y0 + y1) / 2}) rotate(-90)`} textAnchor="middle">
        {yLabel}
      </text>
    </g>
  )
}

function useOpen() {
  const navigate = useNavigate()
  return (id: string) => navigate(`/experiments/${id}`)
}

interface ScatterProps {
  points: Point[]
  xLabel: string
  yLabel: string
}

/** 조건과 결과의 관계. 점 하나가 실험 하나이며, 이상치 후보는 붉게 표시한다. 점을 누르면 그 실험으로 간다. */
export function ScatterChart({ points, xLabel, yLabel }: ScatterProps) {
  const open = useOpen()
  const fit = linearFit(points)
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const xTicks = niceTicks(Math.min(...xs), Math.max(...xs), 5)
  const yTicks = niceTicks(Math.min(...ys), Math.max(...ys), 5)
  const x = scale([xTicks[0], xTicks[xTicks.length - 1]], [M.left, W - M.right])
  const y = scale([yTicks[0], yTicks[yTicks.length - 1]], [H - M.bottom, M.top])
  const summary = `점 ${points.length}개${fit ? `, 상관계수 ${fit.r.toFixed(2)}` : ''}${points.some((p) => p.outlier) ? ', 이상치 후보 포함' : ''}`
  return (
    <Frame title={`${xLabel}에 따른 ${yLabel}`} summary={summary}>
      <Axes xTicks={xTicks} yTicks={yTicks} x={x} y={y} xLabel={xLabel} yLabel={yLabel} />
      {fit && (
        <line
          className="chart__fit"
          x1={x(xTicks[0])}
          x2={x(xTicks[xTicks.length - 1])}
          y1={y(fit.slope * xTicks[0] + fit.intercept)}
          y2={y(fit.slope * xTicks[xTicks.length - 1] + fit.intercept)}
        />
      )}
      {points.map((p) => (
        <g
          key={p.experimentId}
          className={`chart__pt${p.outlier ? ' chart__pt--out' : ''}`}
          role="link"
          tabIndex={0}
          aria-label={`${p.title}: ${xLabel} ${fmt(p.x)}, ${yLabel} ${fmt(p.y)}${p.outlier ? ' (이상치 후보)' : ''}`}
          onClick={() => open(p.experimentId)}
          onKeyDown={(e) => e.key === 'Enter' && open(p.experimentId)}
        >
          <title>{`${p.title}\n${xLabel} ${fmt(p.x)} / ${yLabel} ${fmt(p.y)}`}</title>
          <circle cx={x(p.x)} cy={y(p.y)} r={p.outlier ? 8 : 6} />
          {p.outlier && (
            <text x={x(p.x) + 12} y={y(p.y) + 4} className="chart__note">
              {shortTitle(p.title)}
            </text>
          )}
        </g>
      ))}
    </Frame>
  )
}

interface TrendProps {
  points: Point[]
  yLabel: string
}

/** 실험 순서(시작한 날짜순)에 따른 값의 변화. 점선은 중앙값. */
export function TrendChart({ points, yLabel }: TrendProps) {
  const open = useOpen()
  const ys = points.map((p) => p.y)
  const yTicks = niceTicks(Math.min(...ys), Math.max(...ys), 5)
  const n = points.length
  const x = scale([1, Math.max(n, 2)], [M.left + 12, W - M.right - 12])
  const y = scale([yTicks[0], yTicks[yTicks.length - 1]], [H - M.bottom, M.top])
  const med = median(ys)
  const byX = new Map(points.map((p) => [p.x, p]))
  // 실험이 많으면 눈금을 10개 안팎으로 솎아 글자가 겹치지 않게 한다.
  const step = Math.max(1, Math.ceil(n / 10))
  const xTicks = points.filter((_, i) => i % step === 0).map((p) => p.x)
  const dot = n > 80 ? 2.5 : n > 30 ? 4 : 5.5
  return (
    <Frame title={`실험 순서에 따른 ${yLabel}`} summary={`${n}건, 중앙값 ${fmt(med)}${points.some((p) => p.outlier) ? ', 이상치 후보 포함' : ''}`}>
      <Axes xTicks={xTicks} yTicks={yTicks} x={x} y={y} xLabel="실험 순서 (시작한 날짜순)" yLabel={yLabel} xFormat={(v) => shortTitle(byX.get(v)?.title ?? String(v))} />
      <line className="chart__median" x1={M.left} x2={W - M.right} y1={y(med)} y2={y(med)} />
      <text className="chart__note" x={W - M.right - 4} y={y(med) - 6} textAnchor="end">
        중앙값 {fmt(med)}
      </text>
      <polyline className="chart__line" points={points.map((p) => `${x(p.x)},${y(p.y)}`).join(' ')} />
      {points.map((p) => (
        <g
          key={p.experimentId}
          className={`chart__pt${p.outlier ? ' chart__pt--out' : ''}`}
          role="link"
          tabIndex={0}
          aria-label={`${p.title}: ${yLabel} ${fmt(p.y)}${p.outlier ? ' (이상치 후보)' : ''}`}
          onClick={() => open(p.experimentId)}
          onKeyDown={(e) => e.key === 'Enter' && open(p.experimentId)}
        >
          <title>{`${p.title}\n${yLabel} ${fmt(p.y)}`}</title>
          <circle cx={x(p.x)} cy={y(p.y)} r={p.outlier ? Math.max(dot + 2.5, 5) : dot} />
        </g>
      ))}
    </Frame>
  )
}

interface TimelineProps {
  bars: TimelineBar[]
  now?: Date
}

const MONTH_DAY = (t: number) => {
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 프로젝트 타임라인. 실험마다 시작부터 완료(진행 중이면 오늘)까지의 막대. */
export function TimelineChart({ bars, now = new Date() }: TimelineProps) {
  const open = useOpen()
  const rowH = 26
  const top = 14
  const left = 150
  const right = 20
  const height = top + bars.length * rowH + 34
  const min = Math.min(...bars.map((b) => b.start))
  const max = Math.max(now.getTime(), ...bars.map((b) => b.end))
  const x = scale([min, max], [left, W - right])
  const weeks: number[] = []
  for (let t = min; t <= max; t += 7 * 86400000) weeks.push(t)
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="group" aria-label={`프로젝트 타임라인. 실험 ${bars.length}건, ${MONTH_DAY(min)}부터 ${MONTH_DAY(max)}까지`}>
      {weeks.map((t) => (
        <g key={t}>
          <line className="chart__grid chart__grid--v" x1={x(t)} x2={x(t)} y1={top - 4} y2={height - 28} />
          <text className="chart__tick" x={x(t)} y={height - 12} textAnchor="middle">
            {MONTH_DAY(t)}
          </text>
        </g>
      ))}
      {bars.map((b, i) => {
        const y = top + i * rowH
        return (
          <g
            key={b.experiment.id}
            className={`chart__bar chart__bar--${b.experiment.status}`}
            role="link"
            tabIndex={0}
            aria-label={`${b.experiment.title}: ${MONTH_DAY(b.start)}부터 ${b.open ? '진행 중' : MONTH_DAY(b.end) + '까지'}`}
            onClick={() => open(b.experiment.id)}
            onKeyDown={(e) => e.key === 'Enter' && open(b.experiment.id)}
          >
            <title>{`${b.experiment.title}\n${MONTH_DAY(b.start)} → ${b.open ? '진행 중' : MONTH_DAY(b.end)}`}</title>
            <text className="chart__tick" x={left - 8} y={y + 15} textAnchor="end">
              {shortTitle(b.experiment.title)}
            </text>
            <rect x={x(b.start)} y={y + 3} width={Math.max(4, x(b.end) - x(b.start))} height={rowH - 8} rx={1} />
          </g>
        )
      })}
      <line className="chart__today" x1={x(now.getTime())} x2={x(now.getTime())} y1={top - 6} y2={height - 28} />
      <text className="chart__note" x={x(now.getTime())} y={top - 4} textAnchor="end">
        오늘
      </text>
    </svg>
  )
}

interface StatusBarProps {
  counts: { ready: number; running: number; done: number }
}

/** 준비·진행·완료 개수를 한 줄 막대로. 글자(개수)를 함께 적어 색에만 의존하지 않는다. */
export function StatusBar({ counts }: StatusBarProps) {
  const total = counts.ready + counts.running + counts.done
  const parts = [
    { key: 'done', label: '완료', n: counts.done },
    { key: 'running', label: '진행', n: counts.running },
    { key: 'ready', label: '준비', n: counts.ready },
  ] as const
  return (
    <div>
      <div className="statusbar" role="img" aria-label={`완료 ${counts.done}건, 진행 ${counts.running}건, 준비 ${counts.ready}건`}>
        {parts.map((p) => (p.n > 0 ? <span key={p.key} className={`statusbar__seg statusbar__seg--${p.key}`} style={{ flexGrow: p.n }} /> : null))}
        {total === 0 && <span className="statusbar__seg" style={{ flexGrow: 1 }} />}
      </div>
      <ul className="statusbar__legend">
        {parts.map((p) => (
          <li key={p.key}>
            <span className={`statusbar__dot statusbar__dot--${p.key}`} aria-hidden="true" /> {p.label} {p.n}
          </li>
        ))}
      </ul>
    </div>
  )
}
