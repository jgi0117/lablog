import { useState } from 'react'
import { useBackend } from '../app/BackendContext'
import { ExperimentRequirementBar } from './ExperimentRequirementBar'
import { SaverIndicator } from './SaverIndicator'
import { useRequirementCheck } from '../hooks/useRequirementCheck'
import { useLatest } from '../hooks/useLatest'
import { useDebouncedSave } from '../hooks/useDebouncedSave'
import type { DataItem, DataKind, Experiment, Step } from '../domain/types'
import { numericHistory } from '../services/experimentService'
import { catalogNames, findCatalogUnit, type CatalogItem } from '../services/catalog'
import { COMMON_UNITS, valueWarning } from '../services/validation'

/** 수행 중에도 고객 요구를 곁에 두고 본다(값을 입력하면 곧바로 만족·미달이 바뀐다). 요구가 없으면 아무것도 그리지 않는다. */
export function RunRequirementBar({ experiment, items }: { experiment: Experiment; items: DataItem[] }) {
  const state = useRequirementCheck(experiment, items)
  return state ? <ExperimentRequirementBar state={state} /> : null
}

interface PanelProps {
  step: Step
  items: DataItem[]
  catalog: CatalogItem[]
  onStep: (s: Step) => void
  onItem: (d: DataItem) => void
}

/** 지금 보고 있는 단계 아래의 입력: 값(조건·결과)과 단계 메모. 입력은 잠깐 뒤 자동 저장된다. */
export function CurrentStepPanel({ step, items, catalog, onStep, onItem }: PanelProps) {
  const backend = useBackend()
  const [note, setNote] = useState(step.note)
  const [kind, setKind] = useState<DataKind>('condition')
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState('')
  const version = useLatest(step.version)
  const saver = useDebouncedSave<string>(async (text, { force }) => {
    onStep(await backend.steps.update(step.id, { note: text }, force ? undefined : version.current))
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
      <SaverIndicator saver={saver} />
    </div>
  )
}

