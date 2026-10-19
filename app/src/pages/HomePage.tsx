import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useBackend } from '../app/BackendContext'
import { EmptyState } from '../components/EmptyState'
import { ExperimentCard } from '../components/ExperimentCard'
import { useToast } from '../components/Toast'
import { seedSample } from '../data/seed'
import type { Experiment } from '../domain/types'
import { stepStats } from '../services/experimentService'

interface Row {
  experiment: Experiment
  percent: number
  open: number
}

interface Dashboard {
  running: Row[]
  recent: Row[]
  projects: Map<string, string>
  total: number
}

/** 홈(대시보드): 진행 중 실험(남은 단계 포함), 최근 실험. 실험이 없으면 첫 실험 안내. */
export function HomePage() {
  const backend = useBackend()
  const toast = useToast()
  const [data, setData] = useState<Dashboard | null>(null)

  const load = useCallback(async (): Promise<Dashboard> => {
    const [runningRes, recentRes, projects] = await Promise.all([
      backend.experiments.list({ status: 'running' }, 'updated_desc'),
      backend.experiments.list({}, 'updated_desc', { limit: 6, offset: 0 }),
      backend.projects.list(),
    ])
    const toRow = async (experiment: Experiment): Promise<Row> => {
      const stats = stepStats(await backend.steps.listByExperiment(experiment.id))
      return { experiment, percent: stats.percent, open: stats.total - stats.done }
    }
    const [running, recent] = await Promise.all([
      Promise.all(runningRes.items.map(toRow)),
      Promise.all(recentRes.items.map(toRow)),
    ])
    return { running, recent, projects: new Map(projects.map((p) => [p.id, p.name])), total: recentRes.total }
  }, [backend])

  useEffect(() => {
    let alive = true
    load()
      .then((d) => alive && setData(d))
      .catch(() => {
        // 저장소를 읽지 못해도 화면은 비어 있는 상태로 둔다. 저장 실패 안내는 Phase 5에서 다룬다.
        if (alive) setData({ running: [], recent: [], projects: new Map(), total: 0 })
      })
    return () => {
      alive = false
    }
  }, [load])

  const onSeed = async () => {
    const n = await seedSample(backend)
    toast.show({ message: `샘플 실험 ${n}건을 넣었습니다` })
    setData(await load())
  }

  if (data === null) return <p className="muted">불러오는 중…</p>

  const card = (r: Row) => (
    <ExperimentCard
      key={r.experiment.id}
      experiment={r.experiment}
      projectName={r.experiment.projectId ? data.projects.get(r.experiment.projectId) : undefined}
      percent={r.percent}
      openSteps={r.experiment.status === 'running' ? r.open : undefined}
    />
  )

  return (
    <section>
      <h1 className="page-title">오늘의 실험</h1>
      {data.total === 0 ? (
        <EmptyState title="첫 실험을 만들어 보세요" description="실험 기록을 한 곳에 모읍니다.">
          <Link to="/experiments/new" className="btn btn--primary">
            + 새 실험
          </Link>
          {import.meta.env.DEV && (
            <button type="button" className="btn" onClick={onSeed}>
              샘플 데이터 넣기 (개발용)
            </button>
          )}
        </EmptyState>
      ) : (
        <>
          <h2 className="section-title section-title--first">진행 중 ({data.running.length})</h2>
          {data.running.length === 0 ? (
            <p className="muted">진행 중인 실험이 없습니다.</p>
          ) : (
            <div className="card-grid">{data.running.map(card)}</div>
          )}
          <h2 className="section-title">최근 실험</h2>
          <div className="card-grid">{data.recent.map(card)}</div>
          <p className="muted home__total">전체 실험 {data.total}건</p>
        </>
      )}
    </section>
  )
}
