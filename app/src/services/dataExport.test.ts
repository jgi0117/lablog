import { describe, expect, it } from 'vitest'
import csv from '../data/concrete/concrete.csv?raw'
import { buildConcreteBackup, parseConcreteCsv } from '../data/concreteDemo'
import { buildMatrix } from './analysis'
import { dictionaryCsv, jsonExport, pandasSnippet, tidyCsv, wideCsv } from './dataExport'
import { bundlesFromBackup } from './projectData'

const file = buildConcreteBackup(parseConcreteCsv(csv), 'demo')
const names = new Map(file.projects.map((p) => [p.id, p.name]))
// 에코슬래그 프로젝트: 고로슬래그 열이 있고 플라이애시 열은 없다
const matrix = buildMatrix(bundlesFromBackup(file, (e) => e.projectId === 'demo-project-2'))
const lines = (s: string) => s.replace(/^﻿/, '').split('\r\n')

describe('넓은 형식 CSV', () => {
  it('실험 한 건이 한 줄이고 항목은 "이름 (단위)" 열이다', () => {
    const out = wideCsv(matrix, { projectNames: names })
    const [header, first] = lines(out)
    expect(out.charCodeAt(0)).toBe(0xfeff)
    expect(header.split(',').slice(0, 5)).toEqual(['experiment_id', '프로젝트', '실험', '상태', '시작일'])
    expect(header).toContain('시멘트 (kg/m³)')
    expect(header).toContain('압축강도 (MPa)')
    expect(lines(out)).toHaveLength(1 + matrix.rows.length)
    expect(first).toContain('에코슬래그 ES-30')
  })

  it('분석용(numericOnly)은 BOM이 없고 빈 결과는 빈칸이며 숫자만 담는다', () => {
    const out = wideCsv(matrix, { projectNames: names, numericOnly: true })
    expect(out.charCodeAt(0)).not.toBe(0xfeff)
    const rows = lines(out).map((l) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/))
    const header = rows[0]
    const strength = header.indexOf('압축강도 (MPa)')
    const blank = rows.find((r) => r[2].includes('#400'))!
    expect(blank[strength]).toBe('') // 일부러 비운 시연 값
    const other = rows.find((r) => r[2].includes('#9,'))!
    expect(Number(other[strength])).toBeGreaterThan(0)
    for (const r of rows.slice(1)) expect(r).toHaveLength(header.length)
  })

  it('고른 열만 내보낸다', () => {
    const key = matrix.columns.find((c) => c.name === '물')!.key
    const header = lines(wideCsv(matrix, { columnKeys: [key] }))[0].split(',')
    expect(header).toEqual(['experiment_id', '프로젝트', '실험', '상태', '시작일', '물 (kg/m³)'])
  })

  it('쉼표나 따옴표가 든 값은 따옴표로 감싼다', () => {
    const csvLine = lines(wideCsv(matrix))[1]
    expect(csvLine).toContain('"배합 #')
  })
})

describe('긴 형식 CSV', () => {
  it('값 하나가 한 줄이고 숫자값과 단위가 따로 있다', () => {
    const out = tidyCsv(matrix, { projectNames: names })
    const l = lines(out)
    expect(l[0]).toBe('experiment_id,프로젝트,실험,상태,시작일,구분,항목,값,숫자값,단위')
    const cementRow = l.find((x) => x.includes(',조건,시멘트,'))!
    expect(cementRow).toMatch(/,조건,시멘트,\d+(\.\d+)?,\d+(\.\d+)?,kg\/m³$/)
    // 일부러 비운 값은 값과 숫자값이 모두 빈칸
    expect(l.find((x) => x.includes('#400') && x.includes(',결과,압축강도,'))).toMatch(/,결과,압축강도,,,MPa$/)
  })
})

describe('데이터 사전과 JSON', () => {
  it('항목마다 구분, 단위, 건수, 결측, 기본 통계를 적는다', () => {
    const l = lines(dictionaryCsv(matrix))
    expect(l[0]).toContain('표준편차')
    const strength = l.find((x) => x.startsWith('압축강도 (MPa)'))!.split(',')
    expect(strength[1]).toBe('결과')
    expect(Number(strength[6])).toBeLessThan(Number(strength[5])) // 숫자 값 수 < 실험 수 (빈 결과, 진행 중)
    expect(Number(strength[7])).toBeGreaterThan(0) // 결측
  })

  it('JSON은 조건과 결과를 이름으로 묶는다', () => {
    const j = JSON.parse(jsonExport(matrix, { projectNames: names }))
    expect(j.experiments).toHaveLength(matrix.rows.length)
    const e = j.experiments.find((x: { title: string }) => x.title.includes('#9,'))
    expect(e.project).toBe('에코슬래그 ES-30')
    expect(e.conditions['시멘트']).toMatchObject({ unit: 'kg/m³' })
    expect(typeof e.conditions['시멘트'].number).toBe('number')
    expect(e.results['압축강도'].unit).toBe('MPa')
    expect(j.columns.some((c: { name: string }) => c.name === '재령')).toBe(true)
  })
})

describe('파이썬 예시', () => {
  it('파일 이름과 목표 열이 들어간다', () => {
    const s = pandasSnippet('lablog-data.csv', '압축강도 (MPa)')
    expect(s).toContain('pd.read_csv("lablog-data.csv")')
    expect(s).toContain('df["압축강도 (MPa)"]')
  })
})
