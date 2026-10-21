import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useBackend } from '../app/BackendContext'
import { EmptyState } from '../components/EmptyState'
import { ExternalChangeBanner } from '../components/ExternalChangeBanner'
import { ProgressBar } from '../components/ProgressBar'
import { RunDeviationPanel } from '../components/RunDeviationPanel'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { useExperimentData } from '../hooks/useExperimentData'
import type { DataItem, Step } from '../domain/types'
import {
  firstOpenIndex,
  nextOpenIndex,
  reopenExperiment,
  startRun,
  stepStats,
} from '../services/experimentService'
import { roman } from '../services/text'
import { getSettings } from '../services/settings'
import { logUsage } from '../services/usage'
import { useItemCatalog } from '../hooks/useItemCatalog'
import { CurrentStepPanel, RunRequirementBar } from '../components/RunEntryPanels'

/** 수행 모드: 앱 셸 없는 전체 화면. 체크와 메모·값 입력을 한 화면에서 한다. */
export function RunPage() {
  const { id = '' } = useParams()
  const data = useExperimentData(id)
  const backend = useBackend()
  const toast = useToast()
  const navigate = useNavigate()
  const { experiment, steps, items, deviations, status, setSteps, setItems, setExperiment, setDeviations } = data
  const [focus, setFocus] = useState<number | null>(null)
  const started = useRef(false)
  const catalog = useItemCatalog(experiment?.projectId)

  // 진입하면 준비 → 진행으로 바꾼다.
  useEffect(() => {
    if (status !== 'ready' || !experiment || started.current) return
    started.current = true
    if (experiment.status === 'ready') {
      startRun(backend, experiment)
        .then(setExperiment)
        .catch(() => {})
    }
  }, [status, experiment, backend, setExperiment])

  // 처음 보여 줄 단계: 아직 체크하지 않은 첫 단계
  useEffect(() => {
    if (status === 'ready' && focus === null && steps.length > 0) {
      const i = firstOpenIndex(steps)
      setFocus(i === -1 ? steps.length - 1 : i)
    }
  }, [status, steps, focus])

  // 수행 중 화면이 꺼지지 않게 한다. 지원하지 않으면 조용히 넘어간다.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    if (!getSettings().wakeLock) return
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    nav.wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => {})
    return () => {
      void lock?.release().catch(() => {})
    }
  }, [])

  // 방향키로 단계 이동 (입력칸에 글자를 쓰는 중에는 가로채지 않는다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setFocus((f) => {
          if (f === null) return f
          const n = f + (e.key === 'ArrowDown' ? 1 : -1)
          return n < 0 || n >= steps.length ? f : n
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [steps.length])

  const replaceStep = useCallback((s: Step) => setSteps((xs) => xs.map((x) => (x.id === s.id ? s : x))), [setSteps])

  const toggle = async (index: number) => {
    const step = steps[index]
    const was = step.done
    const updated = await backend.steps.setDone(step.id, !was)
    logUsage('step_toggle', { done: updated.done })
    const list = steps.map((x) => (x.id === updated.id ? updated : x))
    setSteps(list)
    if (updated.done && index === focus) {
      const n = nextOpenIndex(list, index)
      if (n !== -1) setFocus(n)
    } else if (!updated.done) {
      setFocus(index)
    }
    toast.show({
      message: `${roman(index + 1)}단계를 ${updated.done ? '체크' : '해제'}했습니다`,
      actionLabel: '되돌리기',
      onAction: () => {
        void backend.steps.setDone(step.id, was).then((back) => setSteps((xs) => xs.map((x) => (x.id === back.id ? back : x))))
      },
    })
  }

  const completeAndNext = async () => {
    if (focus === null) return
    const step = steps[focus]
    let list = steps
    if (!step.done) {
      const updated = await backend.steps.setDone(step.id, true)
      list = steps.map((x) => (x.id === updated.id ? updated : x))
      setSteps(list)
    }
    const n = nextOpenIndex(list, focus)
    if (n === -1) navigate(`/experiments/${id}/data?finish=1`)
    else setFocus(n)
  }

  if (status === 'loading') return <p className="run-msg muted">불러오는 중…</p>
  if (status !== 'ready' || !experiment) {
    return (
      <div className="run-msg">
        <EmptyState title="실험을 찾을 수 없습니다" description="삭제되었거나 주소가 잘못되었습니다.">
          <Link to="/" className="btn btn--primary">
            홈으로
          </Link>
        </EmptyState>
      </div>
    )
  }
  if (steps.length === 0) {
    return (
      <div className="run-msg">
        <EmptyState title="아직 단계가 없습니다" description="수행하려면 먼저 절차를 입력하세요.">
          <Link to={`/experiments/${id}/steps`} className="btn btn--primary">
            절차 입력하기
          </Link>
        </EmptyState>
      </div>
    )
  }

  const stats = stepStats(steps)
  const cur = focus === null ? 0 : focus
  const isLastOpen = steps[cur] && nextOpenIndex(steps.map((s, i) => (i === cur ? { ...s, done: true } : s)), cur) === -1
  const conditions = items.filter((i) => i.kind === 'condition')
  const results = items.filter((i) => i.kind === 'result')

  return (
    <div className="run">
      <header className="run__head">
        <Link to={`/experiments/${id}`} className="btn">
          ← 나가기
        </Link>
        <div className="run__title">
          <span className="run__crumb">수행 모드</span>
          <h1>{experiment.title}</h1>
        </div>
        <StatusBadge status={experiment.status} />
        <div className="run__progress">
          <span className="run__count">
            {stats.done} / {stats.total} 단계 · {stats.percent}%
          </span>
          <ProgressBar percent={stats.percent} />
        </div>
      </header>

      <ExternalChangeBanner />
      {experiment.status === 'done' && (
        <div className="run__banner" role="status">
          완료된 실험입니다.{' '}
          <button type="button" className="link" onClick={async () => setExperiment(await reopenExperiment(backend, experiment))}>
            다시 열기
          </button>
        </div>
      )}

      <div className="run__body">
        <ol className="run__steps" aria-label="절차">
          {steps.map((s, i) => {
            const isCur = i === cur
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={`step${s.done ? ' step--done' : ''}${isCur ? ' step--cur' : ''}`}
                  aria-pressed={s.done}
                  aria-label={`${roman(i + 1)}. ${s.content}`}
                  onClick={() => void toggle(i)}
                >
                  <span className="step__box" aria-hidden="true">
                    {s.done ? '✓' : ''}
                  </span>
                  <span className="step__label">
                    <span className="step__no">{roman(i + 1)}.</span> {s.content}
                  </span>
                </button>
                {isCur && <CurrentStepPanel key={s.id} step={s} items={items} catalog={catalog} onStep={replaceStep} onItem={(d) => setItems((xs) => [...xs, d])} />}
              </li>
            )
          })}
        </ol>

        <aside className="run__side">
          <RunRequirementBar experiment={experiment} items={items} />
          <div className="panel">
            <h2 className="panel__title">조건 · 결과</h2>
            {items.length === 0 && <p className="muted">아직 입력한 값이 없습니다.</p>}
            {[
              ['조건', conditions],
              ['결과', results],
            ].map(([label, rows]) =>
              (rows as DataItem[]).length > 0 ? (
                <div key={label as string}>
                  <h3 className="panel__sub">{label as string}</h3>
                  {(rows as DataItem[]).map((r) => (
                    <div key={r.id} className="kv">
                      <span>{r.name || '(이름 없음)'}</span>
                      <b>{r.value ? `${r.value}${r.unit ? ' ' + r.unit : ''}` : '—'}</b>
                    </div>
                  ))}
                </div>
              ) : null,
            )}
            <Link to={`/experiments/${id}/data`} className="link">
              조건·결과 편집
            </Link>
          </div>
          <RunDeviationPanel
            experimentId={id}
            steps={steps}
            currentStepId={steps[cur]?.id ?? null}
            deviations={deviations}
            onAdded={(d) => setDeviations((xs) => [...xs, d])}
          />
        </aside>
      </div>

      <footer className="run__foot">
        <button type="button" className="btn" onClick={() => setFocus(Math.max(0, cur - 1))} disabled={cur === 0}>
          이전
        </button>
        <button type="button" className="btn btn--primary run__next" onClick={() => void completeAndNext()}>
          {isLastOpen ? '수행 완료' : '완료하고 다음 단계'}
        </button>
      </footer>
    </div>
  )
}
