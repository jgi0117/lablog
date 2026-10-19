import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useBackend } from '../app/BackendContext'
import { EmptyState } from '../components/EmptyState'
import { useToast } from '../components/Toast'
import { seedSample } from '../data/seed'
import type { Experiment } from '../domain/types'

/** 홈(대시보드). Phase 3에서 진행 중 실험·미완료 단계 영역을 채운다. 지금은 연결 확인용 최소 화면. */
export function HomePage() {
  const backend = useBackend()
  const toast = useToast()
  const [running, setRunning] = useState<Experiment[] | null>(null)
  const [total, setTotal] = useState(0)

  const load = useCallback(async () => {
    const [r, all] = await Promise.all([
      backend.experiments.list({ status: 'running' }),
      backend.experiments.list({}, 'updated_desc', { limit: 1, offset: 0 }),
    ])
    return { running: r.items, total: all.total }
  }, [backend])

  useEffect(() => {
    let alive = true
    load()
      .then((d) => {
        if (!alive) return
        setRunning(d.running)
        setTotal(d.total)
      })
      .catch(() => {
        // 저장소를 읽지 못해도 화면은 비어 있는 상태로 둔다. 저장 실패 안내는 Phase 5에서 다룬다.
        if (alive) setRunning([])
      })
    return () => {
      alive = false
    }
  }, [load])

  const onSeed = async () => {
    const n = await seedSample(backend)
    toast.show({ message: `샘플 실험 ${n}건을 넣었습니다` })
    const d = await load()
    setRunning(d.running)
    setTotal(d.total)
  }

  if (running === null) return <p className="muted">불러오는 중…</p>

  return (
    <section>
      <h1 className="page-title">오늘의 실험</h1>
      {total === 0 ? (
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
          <h2 className="section-title">진행 중 ({running.length})</h2>
          <ul className="plain-list">
            {running.map((e) => (
              <li key={e.id}>
                <Link to={`/experiments/${e.id}`}>{e.title}</Link>
              </li>
            ))}
          </ul>
          <p className="muted">전체 실험 {total}건</p>
        </>
      )}
    </section>
  )
}
