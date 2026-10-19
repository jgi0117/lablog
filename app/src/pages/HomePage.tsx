import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useBackend } from '../app/BackendContext'
import { EmptyState } from '../components/EmptyState'
import { ExperimentCard } from '../components/ExperimentCard'
import { BackupReminder } from '../components/BackupReminder'
import { GapList } from '../components/GapList'
import { useToast } from '../components/Toast'
import { useAllBundles } from '../hooks/useBundles'
import { useBackupExport } from '../hooks/useBackupExport'
import { seedConcreteFull, seedDemo } from '../data/seed'
import { findGaps, type Gap } from '../services/analysis'
import { backupReminder, backupSnoozedUntil, lastBackupAt, snoozeBackupReminder } from '../services/backup'
import { dataTimestamps } from '../services/projectData'
import { logGapsSnapshot } from '../services/usage'
import { formatRelative } from '../services/format'
import { stepStats } from '../services/experimentService'

/** 홈: 진행 중인 실험, 놓친 것(모든 프로젝트), 최근 실험. 실험이 없으면 첫 실험 안내. */
export function HomePage() {
  const backend = useBackend()
  const toast = useToast()
  const { state, reload } = useAllBundles()
  const exportNow = useBackupExport()
  // 백업 기록(마지막 백업, 미루기)이 바뀌면 다시 계산하려고 쓰는 숫자
  const [backupTick, setBackupTick] = useState(0)

  const view = useMemo(() => {
    if (!state) return null
    const names = new Map(state.projects.map((p) => [p.id, p.name]))
    const rows = state.bundles.map((b) => {
      const s = stepStats(b.steps)
      return { b, percent: s.percent, open: s.total - s.done }
    })
    const running = rows.filter((r) => r.b.experiment.status === 'running')
    const recent = [...rows].sort((a, c) => c.b.experiment.updatedAt.localeCompare(a.b.experiment.updatedAt)).slice(0, 6)
    // 프로젝트별로 점검하고 합친다. 프로젝트에 속하지 않은 실험은 점검 대상에서 뺀다(비교할 기준이 없다).
    const gapProject = new Map<string, string>()
    const gaps: Gap[] = []
    for (const p of state.projects) {
      for (const g of findGaps(state.bundles.filter((b) => b.experiment.projectId === p.id))) {
        gaps.push(g)
        gapProject.set(g.id, p.id)
      }
    }
    const order = { high: 0, mid: 1, low: 2 } as const
    gaps.sort((a, c) => order[a.severity] - order[c.severity])
    return { names, running, recent, gaps, gapProject, total: state.bundles.length }
  }, [state])

  // 모든 프로젝트의 확인할 것 개수를 이 기기에 기록해 둔다(주마다 줄어드는지 보기 위해).
  const gapCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const g of view?.gaps ?? []) counts[g.type] = (counts[g.type] ?? 0) + 1
    return counts
  }, [view])
  useEffect(() => {
    if (view) logGapsSnapshot(gapCounts)
  }, [view, gapCounts])

  const reminder = useMemo(() => {
    if (!state) return null
    const { newestChange, oldestCreated } = dataTimestamps(state.bundles)
    return backupReminder({
      now: new Date(),
      hasData: state.bundles.length > 0,
      lastBackup: lastBackupAt(),
      newestChange,
      oldestCreated,
      snoozedUntil: backupSnoozedUntil(),
    })
    // backupTick이 바뀌면 localStorage의 백업 기록을 다시 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, backupTick])

  const onSeed = async () => {
    const n = await seedDemo(backend)
    toast.show({ message: `예시 실험 ${n}건을 넣었습니다 (콘크리트 배합 프로젝트 4개)` })
    await reload()
  }

  // 개발 서버에서만: 공개 데이터 전체 1,030건으로 성능을 본다.
  const onSeedFull = async () => {
    const n = await seedConcreteFull(backend)
    toast.show({ message: `공개 데이터 전체 ${n}건을 넣었습니다 (성능 시험용)` })
    await reload()
  }

  if (!view) return <p className="muted">불러오는 중…</p>

  const card = (r: (typeof view.running)[number]) => (
    <ExperimentCard
      key={r.b.experiment.id}
      experiment={r.b.experiment}
      projectName={r.b.experiment.projectId ? view.names.get(r.b.experiment.projectId) : undefined}
      percent={r.percent}
      openSteps={r.b.experiment.status === 'running' ? r.open : undefined}
    />
  )

  return (
    <section>
      <h1 className="page-title">오늘의 실험</h1>
      {reminder && (
        <BackupReminder
          kind={reminder}
          lastBackupLabel={lastBackupAt() ? formatRelative(lastBackupAt() as string) : undefined}
          onBackup={async () => {
            await exportNow()
            setBackupTick((n) => n + 1)
          }}
          onSnooze={() => {
            snoozeBackupReminder(3)
            setBackupTick((n) => n + 1)
          }}
        />
      )}
      {view.total === 0 ? (
        <EmptyState title="첫 실험을 만들어 보세요" description="맡은 프로젝트의 실험 기록을 한곳에 모읍니다.">
          <Link to="/experiments/new" className="btn btn--primary">
            + 새 실험
          </Link>
          <button type="button" className="btn" onClick={onSeed}>
            예시 데이터 넣기 (둘러보기용)
          </button>
          {import.meta.env.DEV && (
            <button type="button" className="btn" onClick={() => void onSeedFull()}>
              전체 1,030건 넣기 (성능 시험용)
            </button>
          )}
          <p className="muted">데이터는 이 브라우저에만 저장됩니다. 설정에서 백업 파일을 자주 내려받아 두세요. 예시 데이터는 프로젝트·실험 삭제로 지울 수 있습니다.</p>
        </EmptyState>
      ) : (
        <>
          <h2 className="section-title section-title--first">진행 중 ({view.running.length})</h2>
          {view.running.length === 0 ? <p className="muted">진행 중인 실험이 없습니다.</p> : <div className="card-grid">{view.running.map(card)}</div>}

          <h2 className="section-title">놓친 것 ({view.gaps.length})</h2>
          <div className="panel">
            <GapList gaps={view.gaps} limit={5} prefix={(g) => view.names.get(view.gapProject.get(g.id) ?? '')} />
            {view.gaps.length > 0 && (
              <p className="gaps__foot">
                프로젝트별로 자세히 보려면 <Link to="/projects">프로젝트</Link>를 여세요.
              </p>
            )}
          </div>

          <h2 className="section-title">최근 실험</h2>
          <div className="card-grid">{view.recent.map(card)}</div>
          <p className="muted home__total">전체 실험 {view.total}건</p>
        </>
      )}
    </section>
  )
}
