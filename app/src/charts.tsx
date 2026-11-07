import { fmt, goalCenter, label, type Goal, type Run, type Variable } from './domain/types'

/**
 * SVG 차트. 외부 라이브러리 없이 그린다. 색은 결과 점(파랑), 목표 범위(초록 띠), 음의 영향(주황) 셋뿐이다.
 * 실험(run)의 x·y는 호출하는 쪽이 보는 변수 id로 맞춰져 있어야 한다.
 */

const W = 640
const H = 300
const PAD = { l: 56, r: 16, t: 16, b: 40 }
const C = { point: '#2a78d6', band: '#d6f2e6', bandLine: '#1baf7a', neg: '#eb6834', grid: '#e5e8ec', ink: '#4b5563' }

function ticks(min: number, max: number, n = 5): number[] {
  if (!(max > min)) return [min]
  const raw = (max - min) / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(10)))
  return out
}

function band(g: Goal | undefined): [number, number] | null {
  if (!g) return null
  if (g.op === 'target') return [(g.target ?? 0) - (g.tol ?? 0), (g.target ?? 0) + (g.tol ?? 0)]
  if (g.op === 'between') return [g.lo ?? 0, g.hi ?? 0]
  return null
}

function Axes({ x0, x1, y0, y1, xLabel, yLabel, xTicks, yTicks, sx, sy }: { x0: number; x1: number; y0: number; y1: number; xLabel: string; yLabel: string; xTicks: number[]; yTicks: number[]; sx: (v: number) => number; sy: (v: number) => number }) {
  void x0
  void x1
  void y0
  void y1
  return (
    <g fontSize="12" fill={C.ink}>
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} stroke={C.grid} />
          <text x={PAD.l - 8} y={sy(t) + 4} textAnchor="end">
            {fmt(t)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={`x${t}`} x={sx(t)} y={H - PAD.b + 18} textAnchor="middle">
          {fmt(t)}
        </text>
      ))}
      <text x={(PAD.l + W - PAD.r) / 2} y={H - 6} textAnchor="middle" fontWeight="600">
        {xLabel}
      </text>
      <text x={14} y={(PAD.t + H - PAD.b) / 2} textAnchor="middle" fontWeight="600" transform={`rotate(-90 14 ${(PAD.t + H - PAD.b) / 2})`}>
        {yLabel}
      </text>
    </g>
  )
}

/** 실험 순서에 따른 결과값과 목표 범위 */
export function TrackChart({ runs, y, goal, levelVar }: { runs: Run[]; y: Variable; goal: Goal | undefined; levelVar: Variable | undefined }) {
  const pts = runs
    .filter((r) => r.status === 'done' && Number.isFinite(r.y[y.id]) && (!goal?.at || !levelVar || r.x[levelVar.id] === goal.at.value))
    .map((r) => ({ r, v: r.y[y.id] }))
  if (pts.length === 0) return <p className="muted">값이 있는 완료 실험이 없습니다.</p>
  const b = band(goal)
  const center = goal ? goalCenter(goal) : null
  const vals = pts.map((p) => p.v).concat(b ?? [], center !== null ? [center] : [])
  const y0 = Math.min(...vals)
  const y1 = Math.max(...vals)
  const padY = (y1 - y0 || 1) * 0.1
  const yl = y0 - padY
  const yh = y1 + padY
  const xs = pts.map((p) => p.r.order)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const sx = (v: number) => PAD.l + ((v - x0) / Math.max(x1 - x0, 1)) * (W - PAD.l - PAD.r)
  const sy = (v: number) => H - PAD.b - ((v - yl) / (yh - yl)) * (H - PAD.t - PAD.b)
  const inside = (v: number) => (b ? v >= b[0] && v <= b[1] : goal?.op === '>=' ? v >= (goal.lo ?? 0) : goal?.op === '<=' ? v <= (goal.hi ?? 0) : false)
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`실험 순서에 따른 ${y.name}`}>
      <Axes x0={x0} x1={x1} y0={yl} y1={yh} xLabel="실험 순서" yLabel={label(y)} xTicks={ticks(x0, x1, 8).filter(Number.isInteger)} yTicks={ticks(yl, yh)} sx={sx} sy={sy} />
      {b && <rect x={PAD.l} width={W - PAD.l - PAD.r} y={sy(b[1])} height={Math.max(2, sy(b[0]) - sy(b[1]))} fill={C.band} />}
      {center !== null && <line x1={PAD.l} x2={W - PAD.r} y1={sy(center)} y2={sy(center)} stroke={C.bandLine} strokeWidth="2" strokeDasharray={b ? undefined : '6 4'} />}
      <polyline fill="none" stroke={C.point} strokeWidth="2" opacity="0.5" points={pts.map((p) => `${sx(p.r.order)},${sy(p.v)}`).join(' ')} />
      {pts.map((p) => (
        <g key={p.r.id}>
          <circle cx={sx(p.r.order)} cy={sy(p.v)} r="5" fill={inside(p.v) ? C.bandLine : C.point} stroke="#fff" strokeWidth="1.5">
            <title>
              #{p.r.order}: {fmt(p.v)} {y.unit}
            </title>
          </circle>
        </g>
      ))}
    </svg>
  )
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 3) return null
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
    sxy += (xs[i] - mx) * (ys[i] - my)
  }
  if (sxx === 0 || syy === 0) return null
  return sxy / Math.sqrt(sxx * syy)
}

export function ScatterChart({ pts, x, y, goal }: { pts: { r: Run; xv: number; yv: number }[]; x: Variable; y: Variable; goal: Goal | undefined }) {
  if (pts.length < 2) return <p className="muted">두 값이 모두 있는 실험이 2건 이상 필요합니다.</p>
  const b = band(goal)
  const xv = pts.map((p) => p.xv)
  const yv = pts.map((p) => p.yv).concat(b ?? [])
  const x0 = Math.min(...xv)
  const x1 = Math.max(...xv)
  const y0 = Math.min(...yv)
  const y1 = Math.max(...yv)
  const px = (x1 - x0 || 1) * 0.08
  const py = (y1 - y0 || 1) * 0.1
  const sx = (v: number) => PAD.l + ((v - (x0 - px)) / (x1 - x0 + 2 * px)) * (W - PAD.l - PAD.r)
  const sy = (v: number) => H - PAD.b - ((v - (y0 - py)) / (y1 - y0 + 2 * py)) * (H - PAD.t - PAD.b)
  const r = pearson(pts.map((p) => p.xv), pts.map((p) => p.yv))
  let fit: { a: number; b: number } | null = null
  if (r !== null) {
    const mx = xv.reduce((a, c) => a + c, 0) / xv.length
    const my = pts.reduce((a, p) => a + p.yv, 0) / pts.length
    const sxx = xv.reduce((a, c) => a + (c - mx) ** 2, 0)
    const sxy = pts.reduce((a, p) => a + (p.xv - mx) * (p.yv - my), 0)
    const slope = sxy / sxx
    fit = { a: slope, b: my - slope * mx }
  }
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${x.name}에 따른 ${y.name}`}>
        <Axes x0={x0} x1={x1} y0={y0} y1={y1} xLabel={label(x)} yLabel={label(y)} xTicks={ticks(x0, x1)} yTicks={ticks(y0, y1)} sx={sx} sy={sy} />
        {b && <rect x={PAD.l} width={W - PAD.l - PAD.r} y={sy(b[1])} height={Math.max(2, sy(b[0]) - sy(b[1]))} fill={C.band} />}
        {fit && <line x1={sx(x0)} y1={sy(fit.a * x0 + fit.b)} x2={sx(x1)} y2={sy(fit.a * x1 + fit.b)} stroke={C.ink} strokeDasharray="6 4" />}
        {pts.map((p) => (
          <circle key={p.r.id} cx={sx(p.xv)} cy={sy(p.yv)} r="5" fill={C.point} stroke="#fff" strokeWidth="1.5" opacity="0.9">
            <title>
              #{p.r.order}: {x.name} {fmt(p.xv)}, {y.name} {fmt(p.yv)}
            </title>
          </circle>
        ))}
      </svg>
      <p className="hint">{r === null ? '점이 3개 이상이고 값이 달라야 상관을 구합니다.' : `상관계수 r = ${r.toFixed(2)} (실험 ${pts.length}건). ${Math.abs(r) >= 0.5 ? '뚜렷한' : Math.abs(r) >= 0.3 ? '약한' : '거의 없는'} ${r > 0 ? '양의' : '음의'} 관계. 점선은 직선 경향.`}</p>
    </>
  )
}

export function InfluenceBars({ variables, runs, y, levelVar, goal }: { variables: Variable[]; runs: Run[]; y: Variable; levelVar: Variable | undefined; goal: Goal | undefined }) {
  const done = runs.filter((r) => r.status === 'done' && Number.isFinite(r.y[y.id]) && (!goal?.at || !levelVar || r.x[levelVar.id] === goal.at.value))
  const rows = variables
    .map((v) => {
      const pts = done.filter((r) => Number.isFinite(r.x[v.id]))
      return { v, r: pearson(pts.map((r) => r.x[v.id]), pts.map((r) => r.y[y.id])), n: pts.length }
    })
    .filter((d) => d.r !== null)
    .sort((a, b) => Math.abs(b.r as number) - Math.abs(a.r as number))
  if (rows.length === 0) return <p className="muted">값이 달라지는 조건이 3건 이상 있어야 합니다.</p>
  const rowH = 30
  const h = rows.length * rowH + 30
  const mid = 240
  const half = 180
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${h}`} role="img" aria-label={`${y.name}에 대한 조건별 상관`}>
      <line x1={mid} x2={mid} y1={8} y2={h - 22} stroke={C.grid} />
      {rows.map((d, i) => {
        const r = d.r as number
        const w = Math.abs(r) * half
        return (
          <g key={d.v.id} transform={`translate(0 ${10 + i * rowH})`}>
            <text x={mid - half - 10} y={16} textAnchor="end" fontSize="13" fill={C.ink}>
              {d.v.name}
            </text>
            <rect x={r >= 0 ? mid : mid - w} y={4} width={w} height={18} rx="4" fill={r >= 0 ? C.point : C.neg} />
            <text x={r >= 0 ? mid + w + 6 : mid - w - 6} y={17} textAnchor={r >= 0 ? 'start' : 'end'} fontSize="12" fill={C.ink}>
              {r.toFixed(2)}
            </text>
          </g>
        )
      })}
      <text x={mid - half / 2} y={h - 6} textAnchor="middle" fontSize="12" fill={C.ink}>
        ← 클수록 {y.name} 낮아짐
      </text>
      <text x={mid + half / 2} y={h - 6} textAnchor="middle" fontSize="12" fill={C.ink}>
        클수록 {y.name} 높아짐 →
      </text>
    </svg>
  )
}

