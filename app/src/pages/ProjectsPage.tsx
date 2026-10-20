import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useBackend } from '../app/BackendContext'
import { EmptyState } from '../components/EmptyState'
import { useAllBundles } from '../hooks/useBundles'
import { findGaps, statusCounts, type ExperimentBundle } from '../services/analysis'
import { formatRelative } from '../services/format'
import { stepStats } from '../services/experimentService'

/** 프로젝트 목록: 맡은 프로젝트마다 실험 수, 진행률, 최근 활동, 빠진 것 개수를 한눈에. */
export function ProjectsPage() {
  const backend = useBackend()
  const navigate = useNavigate()
  const { state } = useAllBundles()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [customer, setCustomer] = useState('')
  const [error, setError] = useState('')

  const cards = useMemo(() => {
    if (!state) return []
    return state.projects.map((p) => {
      const bundles = state.bundles.filter((b) => b.experiment.projectId === p.id)
      const counts = statusCounts(bundles)
      const steps = bundles.flatMap((b) => b.steps)
      const gaps = findGaps(bundles)
      const last = bundles.map((b) => b.experiment.updatedAt).sort().at(-1)
      return { p, bundles, counts, percent: stepStats(steps).percent, gaps, last }
    })
  }, [state])

  const unassigned: ExperimentBundle[] = state ? state.bundles.filter((b) => !b.experiment.projectId) : []

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('프로젝트 이름을 입력하세요')
      return
    }
    const p = await backend.projects.create({ name: name.trim(), description: description.trim(), ...(customer.trim() ? { customer: customer.trim() } : {}) })
    navigate(`/projects/${p.id}`)
  }

  if (!state) return <p className="muted">불러오는 중…</p>

  return (
    <section>
      <div className="list-head">
        <h1 className="page-title">프로젝트</h1>
        <span className="list-head__count">{state.projects.length}개</span>
        <button type="button" className="btn btn--primary list-head__sort" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
          + 프로젝트 만들기
        </button>
      </div>

      {adding && (
        <form className="panel project-form" onSubmit={create} noValidate>
          <div className="field">
            <label htmlFor="pname">프로젝트 이름</label>
            <input id="pname" className="input" value={name} autoFocus onChange={(e) => (setName(e.target.value), setError(''))} placeholder="예) 하드코팅 필름 HC-300" aria-invalid={error ? true : undefined} />
            {error && (
              <p className="field__error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="pcustomer">고객 또는 요청 부서 (선택)</label>
            <input id="pcustomer" className="input" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="예) ○○건설 구조팀" />
          </div>
          <div className="field">
            <label htmlFor="pdesc">목표·설명 (선택)</label>
            <textarea id="pdesc" className="input input--area" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="예) 연필경도 3H 이상, 투과율 90% 이상, 헤이즈 1% 이하" />
          </div>
          <div className="panel__actions">
            <button type="submit" className="btn btn--primary">
              만들기
            </button>
            <button type="button" className="btn" onClick={() => setAdding(false)}>
              취소
            </button>
          </div>
        </form>
      )}

      {state.projects.length === 0 && !adding ? (
        <EmptyState title="아직 프로젝트가 없습니다" description="맡은 프로젝트를 만들고 실험을 묶으면 진행 현황, 빠진 것, 데이터 비교를 한곳에서 볼 수 있습니다.">
          <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
            + 프로젝트 만들기
          </button>
        </EmptyState>
      ) : (
        <div className="card-grid">
          {cards.map(({ p, bundles, counts, percent, gaps, last }) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="card project-card">
              <h2 className="card__title">{p.name}</h2>
              {p.customer && <p className="project-card__customer">고객·요청: {p.customer}</p>}
              {p.description && <p className="project-card__desc">{p.description}</p>}
              <div className="project-card__stats">
                <span>실험 {bundles.length}건</span>
                <span>완료 {counts.done}</span>
                <span>진행 {counts.running}</span>
                <span>준비 {counts.ready}</span>
              </div>
              <div className="progress">
                <div className="progress__track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${p.name} 전체 단계 진행률`}>
                  <div className="progress__fill" style={{ width: `${percent}%` }} />
                </div>
                <span className="progress__pct">{percent}%</span>
              </div>
              <span className={`project-card__gaps${gaps.length ? ' has-gaps' : ''}`}>{gaps.length ? `빠진 것·확인할 것 ${gaps.length}건` : '확인할 것 없음'}</span>
              <span className="card__meta">{last ? `${formatRelative(last)} 활동` : '아직 실험이 없습니다'}</span>
            </Link>
          ))}
        </div>
      )}
      {unassigned.length > 0 && (
        <p className="list-foot muted">
          프로젝트에 넣지 않은 실험 {unassigned.length}건이 있습니다. <Link to="/experiments">실험 목록에서 프로젝트를 정해 주세요</Link>
        </p>
      )}
    </section>
  )
}
