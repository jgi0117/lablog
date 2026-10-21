import { Link } from 'react-router-dom'
import type { Requirement } from '../../../domain/types'
import { normalizeName, type Matrix, type MatrixRow } from '../../../domain/analysis/analysis'
import { describeRequirement, projectStatus, type Recipe } from '../../../domain/analysis/requirements'

interface Props {
  matrix: Matrix
  requirements: Requirement[]
  customer?: string
  /** 요구를 고치는 곳으로 가는 링크(없으면 보여 주지 않는다) */
  editHref?: string
}

const f = (n: number) => String(Number(n.toPrecision(4)))

const STATUS_TEXT = { achieved: '달성', 'not-yet': '미달', 'no-data': '데이터 없음' } as const

/** 배합을 알아보게 하는 짧은 설명: 적용 조건(재령 등)을 뺀 조건 값 몇 개 */
function recipeLabel(m: Matrix, row: MatrixRow, reqs: Requirement[]): string {
  const at = new Set(reqs.filter((r) => r.at).map((r) => normalizeName(r.at!.name)))
  return m.columns
    .filter((c) => c.kind === 'condition' && !at.has(normalizeName(c.name)))
    .map((c) => ({ c, cell: row.cells[c.key] }))
    .filter((x) => x.cell && !x.cell.empty && x.cell.num !== 0)
    .slice(0, 4)
    .map((x) => `${x.c.name} ${x.cell?.value}`)
    .join(' · ')
}

function RecipeLinks({ m, recipe, reqs }: { m: Matrix; recipe: Recipe; reqs: Requirement[] }) {
  return (
    <>
      <span className="req-recipe__label">{recipeLabel(m, recipe.rows[0], reqs)}</span>{' '}
      <span className="req-recipe__rows">
        (
        {recipe.rows.map((r, i) => (
          <span key={r.experiment.id}>
            {i > 0 && ', '}
            <Link to={`/experiments/${r.experiment.id}`}>{r.experiment.title}</Link>
          </span>
        ))}
        )
      </span>
    </>
  )
}

/**
 * 고객 요구 달성 현황. 맨 위에 "필수 요구를 모두 만족한 배합이 있는가"를 한 문장으로 알리고,
 * 요구마다 판정한 실험 수, 만족한 수, 가장 가까운 값을 표로 보여 준다. 달성하지 못했으면 가장 가까운 배합과 모자란 요구를 알려 준다.
 */
export function RequirementStatus({ matrix, requirements, customer, editHref }: Props) {
  if (requirements.length === 0) {
    return (
      <section className="panel req-panel" aria-labelledby="h-req">
        <h2 id="h-req" className="panel__title">
          고객 요구 달성 현황
        </h2>
        <p className="muted">아직 고객 요구 특성이 없습니다. 고객이 요청한 특성(예: 28일 압축강도 40 MPa 이상)을 적어 두면, 실험마다 달성 여부를 자동으로 판정하고 목표에 가장 가까운 조건을 알려 줍니다.</p>
        {editHref && (
          <Link to={editHref} className="btn btn--primary">
            + 고객 요구 특성 입력하기
          </Link>
        )}
      </section>
    )
  }
  const s = projectStatus(matrix, requirements)

  return (
    <section className="panel req-panel" aria-labelledby="h-req">
      <h2 id="h-req" className="panel__title">
        고객 요구 달성 현황 {customer && <span className="muted">· {customer}</span>}
      </h2>

      {s.overall === 'achieved' && (
        <div className="req-banner req-banner--ok" role="status">
          <b>필수 요구를 모두 만족한 배합이 {s.achievedRecipes.length}개 있습니다.</b>
          <ul className="req-banner__list">
            {s.achievedRecipes.slice(0, 3).map((r, i) => (
              <li key={i}>
                <RecipeLinks m={matrix} recipe={r} reqs={requirements} />
              </li>
            ))}
          </ul>
          {s.achievedRecipes.length > 3 && <span className="muted">나머지 {s.achievedRecipes.length - 3}개는 데이터 표에서 볼 수 있습니다.</span>}
        </div>
      )}
      {s.overall === 'in-progress' && (
        <div className="req-banner req-banner--todo" role="status">
          <b>
            필수 요구 {s.mustTotal}개 중 {s.mustAchieved}개는 달성했지만, 모두 만족한 배합은 아직 없습니다.
          </b>
          {s.closest && (
            <div className="req-banner__closest">
              가장 가까운 배합: <RecipeLinks m={matrix} recipe={s.closest} reqs={requirements} />
              <ul className="req-banner__list">
                {s.closest.verdicts
                  .filter((v) => v.requirement.priority === 'must' && v.verdict !== 'pass')
                  .map((v) => (
                    <li key={v.requirement.id}>
                      {v.verdict === 'fail' && v.value !== null ? (
                        <>
                          {describeRequirement(v.requirement)}: 현재 {f(v.value)}
                          {v.requirement.unit ? ` ${v.requirement.unit}` : ''} 로 모자랍니다
                        </>
                      ) : (
                        <>{describeRequirement(v.requirement)}: 이 배합에는 아직 측정값이 없습니다</>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {s.overall === 'no-data' && (
        <div className="req-banner req-banner--todo" role="status">
          <b>아직 판정할 데이터가 없습니다.</b> 요구와 같은 이름의 조건·결과를 실험에 입력하면 판정이 시작됩니다.
        </div>
      )}

      <div className="table-scroll" tabIndex={0} role="region" aria-label="고객 요구별 달성 표">
        <table className="stat-table req-table">
          <thead>
            <tr>
              <th scope="col">요구</th>
              <th scope="col">중요도</th>
              <th scope="col">상태</th>
              <th scope="col">만족 / 판정</th>
              <th scope="col">가장 가까운 값</th>
            </tr>
          </thead>
          <tbody>
            {s.items.map((i) => (
              <tr key={i.requirement.id}>
                <th scope="row">{describeRequirement(i.requirement)}</th>
                <td>{i.requirement.priority === 'must' ? '필수' : '희망'}</td>
                <td>
                  <span className={`req-chip req-chip--${i.status}`}>{STATUS_TEXT[i.status]}</span>
                </td>
                <td>
                  {i.passing} / {i.judged}건
                </td>
                <td>
                  {i.best ? (
                    <>
                      {f(i.best.value)}
                      {i.requirement.unit ? ` ${i.requirement.unit}` : ''}{' '}
                      <Link to={`/experiments/${i.best.row.experiment.id}`} aria-label={`${i.best.row.experiment.title} 열기`}>
                        {i.best.row.experiment.title}
                      </Link>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editHref && (
        <p className="analysis__note">
          <Link to={editHref}>고객 요구 특성 편집</Link>
        </p>
      )}
    </section>
  )
}
