import { useBackend } from '../../../app/BackendContext'
import { DeviationForm } from '../components/DeviationForm'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { useToast } from '../../../shared/ui/Toast'
import { useExperiment } from '../hooks/useExperimentContext'
import { formatDateTime } from '../../../shared/lib/format'
import { roman } from '../../../shared/lib/text'

/** 달라진 점 탭: 계획한 절차와 다르게 한 일의 기록. 따라 하는 실험에서 "무엇을 바꿨고 왜"를 남긴다. */
export function DeviationsPage() {
  const { experiment, steps, deviations, setDeviations } = useExperiment()
  const backend = useBackend()
  const toast = useToast()

  const stepLabel = (id: string | null) => {
    if (!id) return '실험 전체'
    const i = steps.findIndex((s) => s.id === id)
    return i === -1 ? '삭제된 단계' : `${roman(i + 1)}. ${steps[i].content}`
  }

  const remove = async (id: string) => {
    await backend.deviations.remove(id)
    setDeviations((xs) => xs.filter((x) => x.id !== id))
    toast.show({ message: '달라진 점 기록을 지웠습니다' })
  }

  return (
    <div className="deviations">
      <div className="deviations__list">
        {deviations.length === 0 ? (
          <EmptyState title="기록된 달라진 점이 없습니다" description="계획한 절차와 다르게 했다면 오른쪽에 적어 두세요. 다음에 이 실험을 따라 하는 사람이 이유를 알 수 있습니다." />
        ) : (
          <ul className="deviation-list" aria-label="달라진 점 기록">
            {deviations.map((d) => (
              <li key={d.id} className="deviation">
                <p className="deviation__target">{stepLabel(d.stepId)}</p>
                <p className="deviation__change">{d.change}</p>
                {d.reason && <p className="deviation__reason">사유: {d.reason}</p>}
                <p className="deviation__meta">
                  {formatDateTime(d.createdAt)}{' '}
                  <button type="button" className="link" aria-label={`"${d.change.slice(0, 20)}" 기록 지우기`} onClick={() => void remove(d.id)}>
                    지우기
                  </button>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <aside className="panel">
        <h2 className="panel__title">달라진 점 기록</h2>
        <DeviationForm
          steps={steps}
          onSave={async (input) => {
            const created = await backend.deviations.create({ experimentId: experiment.id, ...input })
            setDeviations((xs) => [...xs, created])
            toast.show({ message: '달라진 점을 기록했습니다' })
          }}
        />
      </aside>
    </div>
  )
}
