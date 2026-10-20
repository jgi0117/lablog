import { useEffect, useMemo, useState } from 'react'
import { useBackend } from '../app/BackendContext'
import type { DataItem, Experiment, Requirement } from '../domain/types'
import { buildMatrix, normalizeName } from '../services/analysis'
import { describeRequirement, evaluateRow, type Verdict } from '../services/requirements'

export interface RequirementCheck {
  requirement: Requirement
  verdict: Verdict
  value: number | null
  text: string
}

export interface ExperimentRequirementState {
  customer?: string
  checks: RequirementCheck[]
  /** 항목 이름(정규화) → 그 항목에 걸린 요구들. 입력 줄 옆 표시에 쓴다 */
  byName: Map<string, RequirementCheck[]>
  mustPass: number
  mustTotal: number
  /** 적용되는(na가 아닌) 필수 요구가 모두 만족이면 true, 하나라도 미달이면 false, 아직 모르면 null */
  allMust: boolean | null
}

/** 실험이 속한 프로젝트의 고객 요구를 불러와, 이 실험의 값을 요구와 맞춰 본다. 프로젝트나 요구가 없으면 null. */
export function useRequirementCheck(experiment: Experiment, items: DataItem[]): ExperimentRequirementState | null {
  const backend = useBackend()
  const [project, setProject] = useState<{ customer?: string; requirements: Requirement[] } | null>(null)

  useEffect(() => {
    let alive = true
    if (!experiment.projectId) {
      setProject(null)
      return
    }
    backend.projects
      .list()
      .then((ps) => {
        const p = ps.find((x) => x.id === experiment.projectId)
        if (alive) setProject(p && (p.requirements?.length ?? 0) > 0 ? { customer: p.customer, requirements: p.requirements ?? [] } : null)
      })
      .catch(() => alive && setProject(null))
    return () => {
      alive = false
    }
  }, [backend, experiment.projectId])

  return useMemo(() => {
    if (!project) return null
    const m = buildMatrix([{ experiment, steps: [], items }])
    const row = m.rows[0]
    const checks: RequirementCheck[] = project.requirements.map((requirement) => {
      const ev = evaluateRow(m, row, requirement)
      return { requirement, verdict: ev.verdict, value: ev.value, text: describeRequirement(requirement) }
    })
    const byName = new Map<string, RequirementCheck[]>()
    for (const c of checks) {
      const key = normalizeName(c.requirement.name)
      byName.set(key, [...(byName.get(key) ?? []), c])
    }
    const musts = checks.filter((c) => c.requirement.priority === 'must' && c.verdict !== 'na')
    const mustPass = musts.filter((c) => c.verdict === 'pass').length
    const allMust = musts.length === 0 ? null : musts.some((c) => c.verdict === 'fail') ? false : musts.every((c) => c.verdict === 'pass') ? true : null
    return { customer: project.customer, checks, byName, mustPass, mustTotal: musts.length, allMust }
  }, [project, experiment, items])
}
