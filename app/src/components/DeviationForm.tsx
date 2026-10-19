import { useId, useRef, useState, type FormEvent } from 'react'
import type { Step } from '../domain/types'
import { roman } from '../services/text'

interface Props {
  steps: Step[]
  /** 처음 골라 둘 단계(수행 모드에서는 지금 보고 있는 단계). 없으면 "실험 전체". */
  defaultStepId?: string | null
  /** 수행 모드 옆 패널처럼 좁은 곳에서는 입력칸을 낮게 */
  compact?: boolean
  onSave: (input: { stepId: string | null; change: string; reason: string }) => Promise<void>
  onCancel?: () => void
}

/** 절차와 달라진 점 입력. "무엇이 달라졌나"만 쓰면 기록할 수 있고, 사유와 대상 단계는 선택이다. */
export function DeviationForm({ steps, defaultStepId = null, compact = false, onSave, onCancel }: Props) {
  const uid = useId()
  const [stepId, setStepId] = useState(defaultStepId ?? '')
  const [change, setChange] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const changeRef = useRef<HTMLTextAreaElement>(null)

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (busy) return
    if (!change.trim()) {
      setError('무엇이 달라졌는지 적어 주세요')
      changeRef.current?.focus()
      return
    }
    setBusy(true)
    try {
      await onSave({ stepId: stepId || null, change: change.trim(), reason: reason.trim() })
      setChange('')
      setReason('')
      setError('')
    } catch {
      setError('저장하지 못했습니다. 다시 시도하세요. 적은 내용은 그대로 남아 있습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="deviation-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={`${uid}-change`}>달라진 내용</label>
        <textarea
          id={`${uid}-change`}
          ref={changeRef}
          className="input input--area"
          rows={compact ? 2 : 3}
          placeholder="예) 건조 온도를 80°C에서 70°C로 낮춤"
          value={change}
          autoFocus
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setChange(e.target.value)
            if (error) setError('')
          }}
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter로 바로 기록
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit()
          }}
        />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-reason`}>사유 (선택)</label>
        <input id={`${uid}-reason`} className="input" placeholder="예) 기재가 열에 약해 변형됨" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-step`}>대상 단계 (선택)</label>
        <select id={`${uid}-step`} className="input" value={stepId} onChange={(e) => setStepId(e.target.value)}>
          <option value="">실험 전체</option>
          {steps.map((s, i) => (
            <option key={s.id} value={s.id}>
              {roman(i + 1)}. {s.content.length > 30 ? s.content.slice(0, 30) + '…' : s.content}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          기록
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            닫기
          </button>
        )}
      </div>
    </form>
  )
}
