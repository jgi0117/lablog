import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useBackend } from '../app/BackendContext'
import { EmptyState } from '../components/EmptyState'
import { SaverIndicator } from '../components/SaverIndicator'
import { useLatest } from '../hooks/useLatest'
import { useToast } from '../components/Toast'
import { useDebouncedSave } from '../hooks/useDebouncedSave'
import { useExperiment } from '../hooks/useExperimentContext'
import type { Step } from '../domain/types'
import { appendSteps } from '../services/experimentService'
import { parseSteps, roman } from '../services/text'

interface RowProps {
  step: Step
  index: number
  count: number
  onChanged: (s: Step) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}

function StepEditRow({ step, index, count, onChanged, onMove, onRemove }: RowProps) {
  const backend = useBackend()
  const [text, setText] = useState(step.content)
  const version = useLatest(step.version)
  const saver = useDebouncedSave<string>(async (content, { force }) => {
    onChanged(await backend.steps.update(step.id, { content }, force ? undefined : version.current))
  })

  return (
    <li className="step-edit">
      <span className="step-edit__no" aria-hidden="true">
        {roman(index + 1)}.
      </span>
      <input
        className="input"
        aria-label={`${index + 1}번째 단계`}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (e.target.value.trim()) saver.schedule(e.target.value.trim())
        }}
        onBlur={() => void saver.flush()}
      />
      <div className="step-edit__tools">
        <button type="button" className="btn btn--icon" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`${index + 1}번째 단계 위로`}>
          ↑
        </button>
        <button type="button" className="btn btn--icon" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`${index + 1}번째 단계 아래로`}>
          ↓
        </button>
        <button type="button" className="btn btn--icon" onClick={onRemove} aria-label={`${index + 1}번째 단계 삭제`}>
          ✕
        </button>
      </div>
      {(saver.status === 'error' || saver.status === 'conflict') && <SaverIndicator saver={saver} />}
    </li>
  )
}

/** 절차 탭: 단계 추가·수정·삭제·순서 변경, 여러 줄 붙여넣기. */
export function StepsPage() {
  const { experiment, steps, setSteps } = useExperiment()
  const backend = useBackend()
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const queue = useRef<Promise<void>>(Promise.resolve())
  const [bulk, setBulk] = useState('')

  const replace = (s: Step) => setSteps((xs) => xs.map((x) => (x.id === s.id ? s : x)))

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const content = draft.trim()
    if (!content) return
    // 저장을 기다리는 동안 다음 단계를 바로 쓸 수 있도록 입력칸을 먼저 비운다.
    // (비우기를 저장 뒤로 미루면 빠르게 이어 쓴 글자가 앞 단계에 붙어 한 단계로 합쳐진다.)
    setDraft('')
    // 빠르게 이어서 추가해도 순서가 겹치지 않도록 한 번에 하나씩, 저장소의 최신 단계를 기준으로 추가한다.
    queue.current = queue.current.then(async () => {
      try {
        const existing = await backend.steps.listByExperiment(experiment.id)
        await appendSteps(backend, experiment.id, [content], existing)
        setSteps(await backend.steps.listByExperiment(experiment.id))
      } catch {
        setDraft((d) => (d ? d : content))
      }
    })
  }

  const addBulk = async () => {
    const lines = parseSteps(bulk)
    if (lines.length === 0) return
    const created = await appendSteps(backend, experiment.id, lines, steps)
    setSteps((xs) => [...xs, ...created])
    setBulk('')
    toast.show({ message: `단계 ${lines.length}개를 추가했습니다` })
  }

  const move = async (index: number, dir: -1 | 1) => {
    const ids = steps.map((s) => s.id)
    const target = index + dir
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    setSteps(await backend.steps.reorder(experiment.id, ids))
  }

  const remove = async (step: Step) => {
    await backend.steps.remove(step.id)
    setSteps((xs) => xs.filter((x) => x.id !== step.id))
    toast.show({
      message: '단계를 삭제했습니다',
      actionLabel: '되돌리기',
      onAction: () => {
        void backend.steps
          .create({
            id: step.id,
            experimentId: step.experimentId,
            order: step.order,
            content: step.content,
            done: step.done,
            doneAt: step.doneAt,
            note: step.note,
          })
          .then(() => backend.steps.listByExperiment(experiment.id))
          .then(setSteps)
      },
    })
  }

  return (
    <div className="steps-page">
      {steps.length === 0 ? (
        <EmptyState title="아직 단계가 없습니다" description="아래에서 단계를 하나씩 추가하거나, 메모해 둔 절차를 붙여넣으세요." />
      ) : (
        <ol className="step-edit-list">
          {steps.map((s, i) => (
            <StepEditRow
              key={s.id}
              step={s}
              index={i}
              count={steps.length}
              onChanged={replace}
              onMove={(d) => void move(i, d)}
              onRemove={() => void remove(s)}
            />
          ))}
        </ol>
      )}

      <form className="step-add" onSubmit={add}>
        <label htmlFor="new-step" className="visually-hidden">
          새 단계
        </label>
        <input id="new-step" className="input" placeholder="새 단계를 입력하고 Enter" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn" disabled={!draft.trim()}>
          추가
        </button>
      </form>

      <details className="bulk">
        <summary>여러 단계 붙여넣기</summary>
        <p className="muted">한 줄이 한 단계가 됩니다. 앞의 번호(1. 2) ① - 등)는 자동으로 지웁니다.</p>
        <textarea
          className="input input--area"
          aria-label="붙여넣을 절차"
          rows={6}
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
          placeholder={'1. 코팅액을 조제한다\n2. 바 코터로 도포한다\n3. 80°C 오븐에서 건조한다'}
        />
        <button type="button" className="btn" onClick={() => void addBulk()} disabled={parseSteps(bulk).length === 0}>
          {parseSteps(bulk).length > 0 ? `${parseSteps(bulk).length}개 단계 추가` : '단계 추가'}
        </button>
      </details>

      {steps.length > 0 && experiment.status !== 'done' && (
        <div className="steps-page__go">
          <Link to={`/experiments/${experiment.id}/run`} className="btn btn--primary">
            {experiment.status === 'ready' ? '수행 모드 시작 ▶' : '이어서 하기 ▶'}
          </Link>
        </div>
      )}
    </div>
  )
}
