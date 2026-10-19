import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useBackend } from '../app/BackendContext'
import { EmptyState } from '../components/EmptyState'
import { ProgressBar } from '../components/ProgressBar'
import { SaveIndicator } from '../components/SaveIndicator'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { useDebouncedSave } from '../hooks/useDebouncedSave'
import { useExperimentData } from '../hooks/useExperimentData'
import type { DataItem, DataKind, Step } from '../domain/types'
import {
  firstOpenIndex,
  nextOpenIndex,
  numericHistory,
  reopenExperiment,
  startRun,
  stepStats,
} from '../services/experimentService'
import { roman } from '../services/text'
import { catalogNames, findCatalogUnit, type CatalogItem } from '../services/catalog'
import { useItemCatalog } from '../hooks/useItemCatalog'
import { COMMON_UNITS, valueWarning } from '../services/validation'

interface PanelProps {
  step: Step
  items: DataItem[]
  catalog: CatalogItem[]
  onStep: (s: Step) => void
  onItem: (d: DataItem) => void
}

/** 지금 보고 있는 단계 아래의 입력: 값(조건·결과)과 단계 메모. 입력은 잠깐 뒤 자동 저장된다. */
function CurrentStepPanel({ step, items, catalog, onStep, onItem }: PanelProps) {
  const backend = useBackend()
  const [note, setNote] = useState(step.note)
  const [kind, setKind] = useState<DataKind>('condition')
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState('')
  const saver = useDebouncedSave<string>(async (text) => {
    onStep(await backend.steps.update(step.id, { note: text }))
  })
  const warning = valueWarning(value, numericHistory(items, name))

  const addItem = async () => {
    if (!name.trim()) return
    const order = items.filter((i) => i.kind === kind).reduce((m, i) => Math.max(m, i.order), 0) + 1
    const created = await backend.dataItems.create({
      experimentId: step.experimentId,
      kind,
      order,
      name: name.trim(),
      value: value.trim(),
      unit: unit.trim(),
    })
    onItem(created)
    setName('')
    setValue('')
    setUnit('')
  }

  return (
    <div className="entry">
      <div className="entry__row">
        <div className="field">
          <label htmlFor="run-kind">구분</label>
          <select id="run-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as DataKind)}>
            <option value="condition">조건</option>
            <option value="result">결과</option>
          </select>
        </div>
        <div className="field entry__grow">
          <label htmlFor="run-name">항목</label>
          <input
            id="run-name"
            className="input"
            placeholder="예) 건조 온도"
            list="run-names"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              // 같은 프로젝트에서 쓴 항목과 이름이 같고 단위를 비워 뒀으면 단위를 채운다.
              const known = unit.trim() === '' ? findCatalogUnit(catalog, kind, e.target.value) : null
              if (known) setUnit(known)
            }}
          />
          <datalist id="run-names">
            {catalogNames(catalog, kind).map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div className="field entry__num">
          <label htmlFor="run-value">값</label>
          <input id="run-value" className="input input--num" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="field entry__num">
          <label htmlFor="run-unit">단위</label>
          <input id="run-unit" className="input input--unit" list="run-units" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <datalist id="run-units">
            {COMMON_UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>
        <button type="button" className="btn" onClick={() => void addItem()} disabled={!name.trim()}>
          추가
        </button>
      </div>
      {warning && (
        <p className="field__warn" role="status">
          {warning}
        </p>
      )}
      <div className="field">
        <label htmlFor="run-note">단계 메모</label>
        <textarea
          id="run-note"
          className="input input--area"
          rows={2}
          placeholder="예) 도포 후 줄무늬 없음, 건조 오븐 편차 ±2°C"
          value={note}
          onChange={(e) => {
            setNote(e.target.value)
            saver.schedule(e.target.value)
          }}
          onBlur={() => void saver.flush()}
        />
      </div>
      <SaveIndicator status={saver.status} savedAt={saver.savedAt} onRetry={() => void saver.retry()} />
    </div>
  )
}

/** 수행 모드: 앱 셸 없는 전체 화면. 체크와 메모·값 입력을 한 화면에서 한다. */
export function RunPage() {
  const { id = '' } = useParams()
  const data = useExperimentData(id)
  const backend = useBackend()
  const toast = useToast()
  const navigate = useNavigate()
  const { experiment, steps, items, status, setSteps, setItems, setExperiment } = data
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
          <div className="panel">
            <h2 className="panel__title">절차와 달라진 점</h2>
            <p className="muted">계획과 다르게 진행한 내용 기록은 다음 버전에서 추가됩니다.</p>
            <button type="button" className="btn" disabled>
              + 달라진 점 기록
            </button>
          </div>
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
