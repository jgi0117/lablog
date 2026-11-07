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
  // 가로 전체를 쓴다: 왼쪽 이름 칸(labelW) + 가운데 0 축을 중심으로 좌우 half씩
  const rowH = 34
  const labelW = 150
  const half = (W - labelW - 56) / 2
  const mid = labelW + 28 + half
  const h = rows.length * rowH + 44
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${h}`} role="img" aria-label={`${y.name}에 대한 조건별 상관`}>
      {[-1, -0.5, 0.5, 1].map((t) => (
        <line key={t} x1={mid + t * half} x2={mid + t * half} y1={6} y2={h - 30} stroke={C.grid} strokeDasharray="3 4" />
      ))}
      <line x1={mid} x2={mid} y1={6} y2={h - 30} stroke={C.ink} strokeOpacity="0.4" />
      {rows.map((d, i) => {
        const r = d.r as number
        const w = Math.abs(r) * half
        return (
          <g key={d.v.id} transform={`translate(0 ${8 + i * rowH})`}>
            <text x={labelW} y={19} textAnchor="end" fontSize="15" fill={C.ink}>
              {d.v.name}
            </text>
            <rect x={r >= 0 ? mid : mid - w} y={5} width={w} height={20} rx="5" fill={r >= 0 ? C.point : C.neg} />
            <text x={r >= 0 ? mid + w + 6 : mid - w - 6} y={19} textAnchor={r >= 0 ? 'start' : 'end'} fontSize="14" fontWeight="600" fill={C.ink}>
              {r.toFixed(2)}
            </text>
          </g>
        )
      })}
      <text x={mid - half / 2} y={h - 8} textAnchor="middle" fontSize="13" fill={C.neg}>
        ← 클수록 {y.name} 낮아짐
      </text>
      <text x={mid + half / 2} y={h - 8} textAnchor="middle" fontSize="13" fill={C.point}>
        클수록 {y.name} 높아짐 →
      </text>
    </svg>
  )
}


// ---------- 입력 점검: 박스플롯 ----------

export interface BoxStats {
  q1: number
  med: number
  q3: number
  /** 수염 끝(1.5 IQR 안의 최소·최대) */
  lo: number
  hi: number
  /** 수염 밖 값의 번호 */
  outliers: number[]
}

export function boxStats(values: number[]): BoxStats | null {
  const v = values.filter((x) => Number.isFinite(x))
  if (v.length < 4) return null
  const s = [...v].sort((a, b) => a - b)
  const q = (p: number) => {
    const pos = (s.length - 1) * p
    const a = Math.floor(pos)
    const b = Math.ceil(pos)
    return s[a] + (s[b] - s[a]) * (pos - a)
  }
  const q1 = q(0.25)
  const med = q(0.5)
  const q3 = q(0.75)
  const iqr = q3 - q1
  const fenceLo = q1 - 1.5 * iqr
  const fenceHi = q3 + 1.5 * iqr
  const inside = v.filter((x) => x >= fenceLo && x <= fenceHi)
  const outliers = values.map((x, i) => (Number.isFinite(x) && (x < fenceLo || x > fenceHi) ? i : -1)).filter((i) => i >= 0)
  return { q1, med, q3, lo: inside.length ? Math.min(...inside) : q1, hi: inside.length ? Math.max(...inside) : q3, outliers }
}

/** 값이 중앙값의 10^k 배(k ≠ 0)에 가까우면 소수점 자리 실수일 수 있다 */
export function decimalSuspect(value: number, med: number): number | null {
  if (!(med > 0) || !(value > 0)) return null
  const k = Math.round(Math.log10(value / med))
  if (k === 0) return null
  const ratio = value / (med * 10 ** k)
  return ratio > 0.7 && ratio < 1.4 ? k : null
}

export interface BoxRow {
  key: string
  name: string
  unit: string
  values: number[]
  /** 각 값의 꼬리표(실험 번호 등) */
  labels: string[]
  stats: BoxStats
}

/**
 * 변수마다 한 줄: 상자(Q1~Q3), 가운데 선(중앙값), 수염(1.5 IQR), 밖의 점(이상치 후보).
 * scaled면 (값 − 중앙값) / IQR 로 표준화해 모든 변수를 한 축에 나란히 그린다(상자는 모두 −0.5~0.5, 수염 한계는 ±2).
 */
export function BoxPlots({ rows, scaled = true, onPick }: { rows: BoxRow[]; scaled?: boolean; onPick?: (key: string, index: number) => void }) {
  const rowH = 34
  const L = 150
  const RW = W - L - 110
  const top = scaled ? 26 : 4
  const h = rows.length * rowH + top + 8
  const LIM = 6
  const z = (r: BoxRow, v: number) => {
    const iqr = r.stats.q3 - r.stats.q1 || Math.abs(r.stats.med) * 0.1 || 1
    return Math.max(-LIM, Math.min(LIM, (v - r.stats.med) / iqr))
  }
  let dlo = -2.5
  let dhi = 2.5
  if (scaled) {
    for (const r of rows) for (const v of r.values) if (Number.isFinite(v)) {
      const s = z(r, v)
      dlo = Math.min(dlo, s)
      dhi = Math.max(dhi, s)
    }
  }
  const sxScaled = (v: number) => L + ((v - dlo) / (dhi - dlo)) * RW
  const ticks = [-4, -2, 0, 2, 4].filter((t) => t >= dlo && t <= dhi)
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${h}`} role="img" aria-label="변수별 분포와 이상치 후보">
      {scaled && (
        <g fontSize="11" fill={C.ink}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={sxScaled(t)} x2={sxScaled(t)} y1={top - 4} y2={h - 6} stroke={t === 0 ? C.bandLine : C.grid} strokeDasharray={Math.abs(t) === 2 ? '4 3' : undefined} />
              <text x={sxScaled(t)} y={top - 8} textAnchor="middle">
                {t === 0 ? '중앙값' : `${t > 0 ? '+' : ''}${t} IQR`}
              </text>
            </g>
          ))}
        </g>
      )}
      {rows.map((r, i) => {
        const all = r.values.filter((v) => Number.isFinite(v))
        const lo = Math.min(...all)
        const hi = Math.max(...all)
        const sx = scaled ? (v: number) => sxScaled(z(r, v)) : (v: number) => L + ((v - lo) / Math.max(hi - lo, 1e-9)) * RW
        const y = top + i * rowH
        const mid = y + 13
        return (
          <g key={r.key}>
            <text x={L - 10} y={mid + 4} textAnchor="end" fontSize="13" fill={C.ink}>
              {r.name}
            </text>
            <line x1={sx(r.stats.lo)} x2={sx(r.stats.q1)} y1={mid} y2={mid} stroke={C.ink} />
            <line x1={sx(r.stats.q3)} x2={sx(r.stats.hi)} y1={mid} y2={mid} stroke={C.ink} />
            <line x1={sx(r.stats.lo)} x2={sx(r.stats.lo)} y1={mid - 6} y2={mid + 6} stroke={C.ink} />
            <line x1={sx(r.stats.hi)} x2={sx(r.stats.hi)} y1={mid - 6} y2={mid + 6} stroke={C.ink} />
            <rect x={sx(r.stats.q1)} y={mid - 9} width={Math.max(2, sx(r.stats.q3) - sx(r.stats.q1))} height={18} fill={C.band} stroke={C.bandLine} rx="3" />
            <line x1={sx(r.stats.med)} x2={sx(r.stats.med)} y1={mid - 9} y2={mid + 9} stroke={C.bandLine} strokeWidth="2" />
            {r.stats.outliers.map((idx) => (
              <circle key={idx} cx={sx(r.values[idx])} cy={mid} r="5" fill={C.neg} stroke="#fff" strokeWidth="1.2" style={{ cursor: onPick ? 'pointer' : undefined }} onClick={() => onPick?.(r.key, idx)}>
                <title>
                  {r.labels[idx]}: {fmt(r.values[idx])} {r.unit}
                  {scaled ? ` (중앙값에서 ${((r.values[idx] - r.stats.med) / (r.stats.q3 - r.stats.q1 || 1)).toFixed(1)} IQR)` : ''}
                </title>
              </circle>
            ))}
            <text x={W - 6} y={mid + 4} textAnchor="end" fontSize="11" fill={C.ink}>
              {fmt(lo)} ~ {fmt(hi)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
