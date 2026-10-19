import { useState } from 'react'
import { useBackend } from '../app/BackendContext'
import type { Deviation, Step } from '../domain/types'
import { roman } from '../services/text'
import { logUsage } from '../services/usage'
import { useToast } from './Toast'
import { DeviationForm } from './DeviationForm'

interface Props {
  experimentId: string
  steps: Step[]
  /** 지금 보고 있는 단계. 새 기록의 대상 단계로 미리 골라 둔다. */
  currentStepId: string | null
  deviations: Deviation[]
  onAdded: (d: Deviation) => void
}

/**
 * 수행 모드 옆 패널. 버튼 한 번으로 입력칸이 열리고(포커스가 바로 입력칸에 간다), 적고 기록을 누르면 끝난다.
 * 이 실험에서 이미 기록한 달라진 점은 아래에 짧게 보여 준다.
 */
export function RunDeviationPanel({ experimentId, steps, currentStepId, deviations, onAdded }: Props) {
  const backend = useBackend()
  const toast = useToast()
  const [open, setOpen] = useState(false)

  const label = (d: Deviation) => {
    const i = d.stepId ? steps.findIndex((s) => s.id === d.stepId) : -1
    return i === -1 ? '전체' : `${roman(i + 1)}단계`
  }

  return (
    <div className="panel">
      <h2 className="panel__title">절차와 달라진 점</h2>
      {deviations.length === 0 && !open && <p className="muted">계획과 다르게 했다면 바로 적어 두세요.</p>}
      {deviations.length > 0 && (
        <ul className="run-deviations" aria-label="기록한 달라진 점">
          {deviations.map((d) => (
            <li key={d.id}>
              <b>{label(d)}</b> {d.change}
              {d.reason && <span className="muted"> — {d.reason}</span>}
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <DeviationForm
          compact
          steps={steps}
          defaultStepId={currentStepId}
          onCancel={() => setOpen(false)}
          onSave={async (input) => {
            const created = await backend.deviations.create({ experimentId, ...input })
            logUsage('deviation_add', { fromRun: true })
            onAdded(created)
            setOpen(false)
            toast.show({ message: '달라진 점을 기록했습니다' })
          }}
        />
      ) : (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          + 달라진 점 기록
        </button>
      )}
    </div>
  )
}
