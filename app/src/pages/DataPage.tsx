import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useBackend } from '../app/BackendContext'
import { useToast } from '../components/Toast'
import { useDebouncedSave } from '../hooks/useDebouncedSave'
import { useExperiment } from '../hooks/useExperimentContext'
import { completionWarnings } from '../domain/rules'
import type { DataItem, DataKind } from '../domain/types'
import { completeExperiment, numericHistory, reopenExperiment } from '../services/experimentService'
import { COMMON_UNITS, valueWarning } from '../services/validation'

const KIND_LABEL: Record<DataKind, string> = { condition: '조건', result: '결과' }

interface RowProps {
  item: DataItem
  items: DataItem[]
  autoFocus: boolean
  onChanged: (d: DataItem) => void
  onRemove: () => void
}

function DataRow({ item, items, autoFocus, onChanged, onRemove }: RowProps) {
  const backend = useBackend()
  const [name, setName] = useState(item.name)
  const [value, setValue] = useState(item.value)
  const [unit, setUnit] = useState(item.unit)
  const saver = useDebouncedSave<{ name: string; value: string; unit: string }>(async (patch) => {
    onChanged(await backend.dataItems.update(item.id, patch))
  })
  const warning = valueWarning(value, numericHistory(items, name, item.id))
  const save = (n: string, v: string, u: string) => saver.schedule({ name: n, value: v, unit: u })

  return (
    <li className="data-row">
      <input
        className="input"
        aria-label={`${KIND_LABEL[item.kind]} 이름`}
        placeholder="항목 (예: 온도)"
        value={name}
        autoFocus={autoFocus}
        onChange={(e) => {
          setName(e.target.value)
          save(e.target.value, value, unit)
        }}
        onBlur={() => void saver.flush()}
      />
      <input
        className="input input--num"
        aria-label={`${name || KIND_LABEL[item.kind]} 값`}
        placeholder="값"
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          save(name, e.target.value, unit)
        }}
        onBlur={() => void saver.flush()}
      />
      <input
        className="input input--unit"
        aria-label={`${name || KIND_LABEL[item.kind]} 단위`}
        placeholder="단위"
        list="units"
        value={unit}
        onChange={(e) => {
          setUnit(e.target.value)
          save(name, value, e.target.value)
        }}
        onBlur={() => void saver.flush()}
      />
      <button type="button" className="btn btn--icon" onClick={onRemove} aria-label={`${name || KIND_LABEL[item.kind]} 삭제`}>
        ✕
      </button>
      {warning && (
        <p className="field__warn" role="status">
          {warning}
        </p>
      )}
      {saver.status === 'error' && (
        <p className="field__error" role="alert">
          저장하지 못했습니다.{' '}
          <button type="button" className="link" onClick={() => void saver.retry()}>
            다시 시도
          </button>
        </p>
      )}
    </li>
  )
}

/** 조건·결과 탭: 이름-값-단위 입력과 완료 처리. 완료는 막지 않고 미완료 단계와 빈 결과를 알려 준다. */
export function DataPage() {
  const { experiment, steps, items, setItems, setExperiment } = useExperiment()
  const backend = useBackend()
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [focusId, setFocusId] = useState<string | null>(null)
  const finishing = params.get('finish') === '1'

  const replace = (d: DataItem) => setItems((xs) => xs.map((x) => (x.id === d.id ? d : x)))

  const add = async (kind: DataKind) => {
    const order = items.filter((i) => i.kind === kind).reduce((m, i) => Math.max(m, i.order), 0) + 1
    const created = await backend.dataItems.create({ experimentId: experiment.id, kind, order, name: '', value: '', unit: '' })
    setItems((xs) => [...xs, created])
    setFocusId(created.id)
  }

  const remove = async (d: DataItem) => {
    await backend.dataItems.remove(d.id)
    setItems((xs) => xs.filter((x) => x.id !== d.id))
    toast.show({
      message: `${d.name || KIND_LABEL[d.kind]} 항목을 삭제했습니다`,
      actionLabel: '되돌리기',
      onAction: () => {
        void backend.dataItems
          .create({ id: d.id, experimentId: d.experimentId, kind: d.kind, order: d.order, name: d.name, value: d.value, unit: d.unit })
          .then(() => backend.dataItems.listByExperiment(experiment.id))
          .then(setItems)
      },
    })
  }

  const results = items.filter((i) => i.kind === 'result')
  const warn = completionWarnings(steps, results)
  const hasWarn = warn.openSteps > 0 || warn.emptyResults > 0

  const complete = async () => {
    setExperiment(await completeExperiment(backend, experiment))
    toast.show({ message: '실험을 완료했습니다' })
    navigate(`/experiments/${experiment.id}`)
  }

  return (
    <div className="data-page">
      <datalist id="units">
        {COMMON_UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      <div className="data-grid">
        {(['condition', 'result'] as const).map((kind) => {
          const rows = items.filter((i) => i.kind === kind)
          return (
            <section key={kind} aria-label={KIND_LABEL[kind]}>
              <h2 className="section-title section-title--first">{KIND_LABEL[kind]}</h2>
              {rows.length === 0 && <p className="muted">아직 {KIND_LABEL[kind]}이 없습니다.</p>}
              <ul className="plain-list">
                {rows.map((r) => (
                  <DataRow key={r.id} item={r} items={items} autoFocus={r.id === focusId} onChanged={replace} onRemove={() => void remove(r)} />
                ))}
              </ul>
              <button type="button" className="btn btn--dashed" onClick={() => void add(kind)}>
                + {KIND_LABEL[kind]} 추가
              </button>
            </section>
          )
        })}
      </div>

      <section className={`finish${finishing ? ' finish--focus' : ''}`} aria-label="실험 완료">
        {experiment.status === 'ready' && <p>수행 모드를 시작하면 실험을 완료할 수 있습니다.</p>}
        {experiment.status === 'done' && (
          <>
            <p>완료한 실험입니다.</p>
            <button type="button" className="btn" onClick={async () => setExperiment(await reopenExperiment(backend, experiment))}>
              다시 열기
            </button>
          </>
        )}
        {experiment.status === 'running' && (
          <>
            <h2 className="section-title section-title--first">{hasWarn ? '완료하기 전에 확인하세요' : '실험을 완료할까요?'}</h2>
            {hasWarn && (
              <ul className="finish__list">
                {warn.openSteps > 0 && <li>미완료 단계 {warn.openSteps}개</li>}
                {warn.emptyResults > 0 && <li>비어 있는 결과 {warn.emptyResults}개</li>}
              </ul>
            )}
            <div className="finish__actions">
              {warn.openSteps > 0 && (
                <Link to={`/experiments/${experiment.id}/run`} className="btn">
                  돌아가서 입력
                </Link>
              )}
              <button type="button" className="btn btn--primary" onClick={() => void complete()}>
                {hasWarn ? '나중에 입력하고 완료' : '완료하기'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
