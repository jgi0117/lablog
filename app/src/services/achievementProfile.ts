import type { Requirement } from '../domain/types'
import { normalizeName, type Column, type Matrix, type MatrixRow } from './analysis'
import { evaluateRow } from './requirements'
import { pearson, quantile, summarize } from './stats'

export interface ProfileDriver {
  column: Column
  passMedian: number
  passLow: number
  passHigh: number
  failMedian: number
  r: number
  p: number
}

export interface AchievementProfile {
  requirement: Requirement
  passing: number
  failing: number
  drivers: ProfileDriver[]
}

/** 요구 달성/미달 집단에서 차이가 큰 조건을 찾는다. */
export function achievementProfile(m: Matrix, req: Requirement, minEach = 3): AchievementProfile | null {
  const pass: MatrixRow[] = []
  const fail: MatrixRow[] = []
  for (const row of m.rows) {
    const verdict = evaluateRow(m, row, req).verdict
    if (verdict === 'pass') pass.push(row)
    else if (verdict === 'fail') fail.push(row)
  }
  if (pass.length < minEach || fail.length < minEach) return null

  const skip = new Set([normalizeName(req.name), ...(req.at ? [normalizeName(req.at.name)] : [])])
  const drivers: ProfileDriver[] = []
  for (const column of m.columns) {
    if (column.kind !== 'condition' || skip.has(normalizeName(column.name))) continue
    const passValues = pass.map((row) => row.cells[column.key]?.num).filter((value): value is number => value !== null && value !== undefined)
    const failValues = fail.map((row) => row.cells[column.key]?.num).filter((value): value is number => value !== null && value !== undefined)
    if (passValues.length < minEach || failValues.length < minEach) continue
    const correlation = pearson([...passValues.map(() => 1), ...failValues.map(() => 0)], [...passValues, ...failValues])
    const passSummary = summarize(passValues)
    const failSummary = summarize(failValues)
    if (!correlation || !passSummary || !failSummary) continue
    const sorted = [...passValues].sort((a, b) => a - b)
    drivers.push({
      column,
      passMedian: passSummary.median,
      passLow: quantile(sorted, 0.1),
      passHigh: quantile(sorted, 0.9),
      failMedian: failSummary.median,
      r: correlation.r,
      p: correlation.p,
    })
  }
  drivers.sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
  return { requirement: req, passing: pass.length, failing: fail.length, drivers }
}
