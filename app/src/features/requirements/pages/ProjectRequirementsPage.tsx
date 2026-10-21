import { useMemo, useState } from 'react'
import { useBackend } from '../../../app/BackendContext'
import { RequirementStatus } from '../../projects/components/RequirementStatus'
import { RequirementsEditor } from '../../projects/components/RequirementsEditor'
import { SaverIndicator } from '../../../shared/ui/SaverIndicator'
import type { Patch, Project, Requirement } from '../../../domain/types'
import { useDebouncedSave } from '../../../shared/hooks/useDebouncedSave'
import { useLatest } from '../../../shared/hooks/useLatest'
import { useProject } from '../../projects/hooks/useProjectContext'
import { validateRequirement } from '../../../domain/analysis/requirements'

/**
 * 고객 요구 특성 탭: 고객(또는 요청 부서)과 요구를 입력한다. 고칠 때마다 자동 저장되고,
 * 아래 현황이 바로 바뀌어서 "이 요구면 지금 실험 중 무엇이 만족하나"를 곧바로 볼 수 있다.
 */
export function ProjectRequirementsPage() {
  const { project, matrix, setProject } = useProject()
  const backend = useBackend()
  const [customer, setCustomer] = useState(project.customer ?? '')
  const [reqs, setReqs] = useState<Requirement[]>(project.requirements ?? [])
  const version = useLatest(project.version)
  const saver = useDebouncedSave<Patch<Project>>(async (patch, { force }) => {
    setProject(await backend.projects.update(project.id, patch, force ? undefined : version.current))
  })

  const valid = useMemo(() => reqs.filter((r) => validateRequirement(r) === null), [reqs])
  const names = useMemo(() => matrix.columns.map((c) => c.name), [matrix])
  const conds = useMemo(() => matrix.columns.filter((c) => c.kind === 'condition').map((c) => c.name), [matrix])

  const save = (c: string, r: Requirement[]) => saver.schedule({ customer: c.trim(), requirements: r.filter((x) => validateRequirement(x) === null) })

  return (
    <div className="req-page">
      <section className="panel" aria-labelledby="h-req-edit">
        <h2 id="h-req-edit" className="panel__title">
          고객이 요청한 특성
        </h2>
        <div className="field req-page__customer">
          <label htmlFor="req-customer">고객 또는 요청 부서 (선택)</label>
          <input
            id="req-customer"
            className="input"
            value={customer}
            placeholder="예) ○○건설 구조팀"
            onChange={(e) => {
              setCustomer(e.target.value)
              save(e.target.value, reqs)
            }}
          />
        </div>
        <RequirementsEditor
          value={reqs}
          knownNames={names}
          knownConditions={conds}
          onChange={(next) => {
            setReqs(next)
            save(customer, next)
          }}
        />
        <SaverIndicator saver={saver} />
      </section>
      <RequirementStatus matrix={matrix} requirements={valid} customer={customer.trim() || undefined} />
    </div>
  )
}
