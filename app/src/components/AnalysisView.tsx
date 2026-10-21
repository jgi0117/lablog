import { useMemo, useState } from 'react'
import { eulreul } from '../services/josa'
import {
  linearFit,
  scatterPoints,
  type Column,
  type Gap,
  type Matrix,
} from '../services/analysis'
import type { Requirement } from '../domain/types'
import {
  achievementInsights,
  buildInsights,
  columnValues,
  compareBy,
  groupCandidates,
  numericColumns,
  rankDrivers,
} from '../services/insights'
import { describeCorrelation, formatP } from '../services/stats'
import { EmptyState } from './EmptyState'
import { ScatterChart } from './charts'
import { DriverBars, GroupChart } from './statCharts'
import { AnalysisDetails } from './AnalysisDetails'

interface Props {
  matrix: Matrix
  /** 프로젝트 화면에서만: 빠짐 점검 결과(이상치 후보 목록에 쓴다) */
  gaps?: Gap[]
  /** 프로젝트의 고객 요구. 있으면 달성한 실험과 못 미친 실험의 조건 차이를 "한눈에 읽기"에 더한다 */
  requirements?: Requirement[]
}

const label = (c: Column) => (c.unit ? `${c.name} (${c.unit})` : c.name)
const f = (n: number) => String(Number(n.toPrecision(4)))

/**
 * 분석 화면: "무엇이 결과를 움직이는가"를 한눈에 읽도록 요약 문장, 영향 주는 조건, 그룹 비교, 분포, 상관 행렬, 요약 통계,
 * 관계·추세 차트, 상·하위 실험을 차례로 보여 준다. 프로젝트 하나일 때도, 모든 프로젝트를 합칠 때도 같은 화면을 쓴다.
 */
export function AnalysisView({ matrix, gaps, requirements }: Props) {
  const results = useMemo(() => numericColumns(matrix).filter((c) => c.kind === 'result'), [matrix])
  const numeric = useMemo(() => numericColumns(matrix), [matrix])
  const [yKey, setYKey] = useState<string | null>(null)
  const [xKey, setXKey] = useState<string | null>(null)
  const [gKey, setGKey] = useState<string | null>(null)

  const defaultY = useMemo(
    () => [...results].sort((a, b) => columnValues(matrix, b.key).filter((v) => v !== null).length - columnValues(matrix, a.key).filter((v) => v !== null).length)[0],
    [results, matrix],
  )
  const y = results.find((c) => c.key === (yKey ?? defaultY?.key)) ?? defaultY

  const drivers = useMemo(() => (y ? rankDrivers(matrix, y.key) : null), [matrix, y])
  const insights = useMemo(() => (y ? [...achievementInsights(matrix, requirements ?? []), ...buildInsights(matrix, y.key)] : []), [matrix, y, requirements])
  const groups = useMemo(() => (y ? groupCandidates(matrix, y.key) : []), [matrix, y])

  if (!y || numeric.length < 2) {
    return (
      <EmptyState
        title="분석할 수치가 아직 부족합니다"
        description="같은 이름의 조건과 결과를 숫자로 5건 이상의 실험에 입력하면 영향 분석, 그룹 비교, 상관 행렬이 나타납니다."
      />
    )
  }

  const xs = numeric.filter((c) => c.key !== y.key)
  const defaultX = drivers?.drivers[0]?.column ?? xs[0]
  const x = xs.find((c) => c.key === (xKey ?? defaultX?.key)) ?? xs[0]
  const points = scatterPoints(matrix, x.key, y.key)
  const fit = linearFit(points)
  const group = groups.find((g) => g.by.key === (gKey ?? groups[0]?.by.key)) ?? groups[0] ?? null
  const manualGroup = gKey && !group ? compareBy(matrix, gKey, y.key) : null
  const shownGroup = manualGroup ?? group

  return (
    <div className="analysis">
      <div className="analysis__controls" role="group" aria-label="분석할 결과">
        <div className="field">
          <label htmlFor="ay">세로축 (결과)</label>
          <select id="ay" className="input input--compact" value={y.key} onChange={(e) => setYKey(e.target.value)}>
            {results.map((c) => (
              <option key={c.key} value={c.key}>
                {label(c)}
              </option>
            ))}
          </select>
        </div>
        <p className="analysis__note analysis__scope">
          실험 {columnValues(matrix, y.key).filter((value) => value !== null).length}건의 {eulreul(y.name)} 분석합니다{y.unit ? ` (단위 ${y.unit})` : ''}.
        </p>
      </div>

      <section className="panel" aria-labelledby="h-insight">
        <h2 id="h-insight" className="panel__title">
          한눈에 읽기
        </h2>
        <ul className="insights">
          {insights.map((i, k) => (
            <li key={k} className={`insights__item insights__item--${i.kind}`}>
              {i.text}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" aria-labelledby="h-driver">
        <h2 id="h-driver" className="panel__title">
          {y.name}에 영향을 주는 조건
        </h2>
        {!drivers || drivers.drivers.length === 0 ? (
          <p className="muted">조건과 결과가 모두 숫자인 실험이 5건 이상인 조건이 없습니다.</p>
        ) : (
          <>
            <DriverBars drivers={drivers.drivers} targetLabel={label(y)} />
            <div className="table-scroll" tabIndex={0} role="region" aria-label="조건별 상관 분석 표">
              <table className="stat-table">
                <thead>
                  <tr>
                    <th scope="col">조건</th>
                    <th scope="col">실험 수</th>
                    <th scope="col">상관 r</th>
                    <th scope="col">유의성</th>
                    <th scope="col">순위상관</th>
                    <th scope="col" title="다른 조건을 함께 고려했을 때의 영향(표준화 계수)">
                      단독 영향 β
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.drivers.map((d) => (
                    <tr key={d.column.key}>
                      <th scope="row">{d.column.name}</th>
                      <td>{d.n}</td>
                      <td>{d.r.toFixed(2)}</td>
                      <td>{formatP(d.p)}{d.p < 0.05 ? ' ★' : ''}</td>
                      <td>{d.rho.toFixed(2)}</td>
                      <td>{d.beta === null ? '—' : `${d.beta.toFixed(2)}${d.betaP !== null && d.betaP < 0.05 ? ' ★' : ''}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="analysis__note">
              ★은 우연으로 보기 어려운 정도(p &lt; 0.05)입니다. <strong>단독 영향 β</strong>는 다른 조건을 함께 넣고 보았을 때의 영향이라, 재료끼리 함께 움직여서 생기는 착시를 가려냅니다.
              {drivers.regression && (
                <>
                  {' '}
                  이 조건들로 {y.name} 변동의 {(drivers.regression.r2 * 100).toFixed(0)}%를 설명합니다(실험 {drivers.regression.n}건).
                </>
              )}
            </p>
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="h-group">
        <h2 id="h-group" className="panel__title">
          조건 값별 비교
        </h2>
        {groups.length === 0 && !shownGroup ? (
          <p className="muted">값이 2~12가지이고 집단마다 실험이 2건 이상인 조건이 없습니다. (예: 재령, 필러 함량처럼 몇 가지 값으로 반복해서 실험하는 조건)</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="ag">나눌 조건</label>
              <select id="ag" className="input input--compact" value={shownGroup?.by.key ?? ''} onChange={(e) => setGKey(e.target.value)}>
                {groups.map((g) => (
                  <option key={g.by.key} value={g.by.key}>
                    {g.by.name} ({g.groups.length}가지 값)
                  </option>
                ))}
              </select>
            </div>
            {shownGroup && (
              <>
                <GroupChart cmp={shownGroup} yLabel={label(y)} xLabel={label(shownGroup.by)} />
                <p className="analysis__note">
                  <strong>
                    F({shownGroup.df1}, {shownGroup.df2}) = {Number.isFinite(shownGroup.f) ? shownGroup.f.toFixed(1) : '∞'}, {formatP(shownGroup.p)}, η² = {shownGroup.eta2.toFixed(2)}
                  </strong>{' '}
                  {shownGroup.p < 0.05
                    ? `${shownGroup.by.name}에 따라 평균이 다릅니다. 차이가 ${y.name} 변동의 ${(shownGroup.eta2 * 100).toFixed(0)}%를 설명합니다.`
                    : `${shownGroup.by.name}에 따른 평균 차이가 뚜렷하지 않습니다.`}{' '}
                  점은 평균, 수염은 표준편차, 옅은 막대는 값의 범위입니다. 집단 수가 많거나 한 집단의 실험 수가 적으면 해석에 주의하세요.
                </p>
                <div className="table-scroll" tabIndex={0} role="region" aria-label="조건 값별 요약 표">
                  <table className="stat-table">
                    <thead>
                      <tr>
                        <th scope="col">{label(shownGroup.by)}</th>
                        <th scope="col">실험 수</th>
                        <th scope="col">평균</th>
                        <th scope="col">표준편차</th>
                        <th scope="col">최소</th>
                        <th scope="col">최대</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownGroup.groups.map((g) => (
                        <tr key={g.label}>
                          <th scope="row">{g.label}</th>
                          <td>{g.n}</td>
                          <td>{f(g.mean)}</td>
                          <td>{f(g.sd)}</td>
                          <td>{f(g.min)}</td>
                          <td>{f(g.max)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="h-scatter">
        <h2 id="h-scatter" className="panel__title">
          조건과 결과의 관계
        </h2>
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
              {xs.filter((c) => c.kind === 'result').map((c) => (
                <option key={c.key} value={c.key}>
                  {label(c)}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        {points.length < 2 ? (
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

      <AnalysisDetails matrix={matrix} y={y} gaps={gaps} />
    </div>
  )
}
