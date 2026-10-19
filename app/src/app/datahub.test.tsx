import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import { seedDemo } from '../data/seed'

const opened: LocalBackend[] = []
let seq = 0

async function demoBackend(): Promise<LocalBackend> {
  const b = createLocalBackend(`lablog-hub-${Date.now()}-${seq++}`)
  opened.push(b)
  await seedDemo(b)
  return b
}

function open(path: string, backend: LocalBackend) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App backend={backend} />
    </MemoryRouter>,
  )
}

/** 내려받기를 가로채 파일 이름과 내용을 모은다. */
function captureDownloads() {
  const files: { name: string; text: Promise<string> }[] = []
  URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
    files.push({
      name: '',
      text: new Promise((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.readAsText(b as Blob)
      }),
    })
    return 'blob:test'
  })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    files[files.length - 1].name = this.download
  })
  return files
}

beforeEach(() => localStorage.clear())
afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await new Promise((r) => setTimeout(r, 20))
  while (opened.length) opened.pop()?.close()
})

/** 표 본문 첫 열(실험 이름)들 */
const titles = (table: HTMLElement) => within(table).getAllByRole('rowheader').map((th) => th.textContent)
/** 열 머리글의 순서에서 이름이 들어간 열의 위치 */
const colIndex = (table: HTMLElement, name: RegExp) => within(table).getAllByRole('columnheader').findIndex((h) => name.test(h.textContent ?? ''))
const count = () => document.querySelector('.grid__count') as HTMLElement
/** 값 칸의 숫자(이상치 표시 ▲가 붙어 있어도 앞의 숫자를 읽는다). 숫자가 아니면 NaN */
const numbersIn = (table: HTMLElement, col: number) =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((r) => parseFloat(within(r).queryAllByRole('cell')[col - 1]?.textContent ?? ''))

describe('데이터 허브 (모든 프로젝트)', () => {
  it('프로젝트·실험·항목 규모를 보여 주고 표를 연다', async () => {
    open('/data', await demoBackend())
    expect(await screen.findByRole('heading', { name: '데이터' })).toBeInTheDocument()
    const box = document.querySelector('.data-hub__stats') as HTMLElement
    expect(box).toHaveTextContent('프로젝트4개')
    expect(box).toHaveTextContent('실험200건')
    expect(box).toHaveTextContent('항목(조건·결과)9개')
    expect(screen.getByRole('link', { name: '분석' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '내보내기' })).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(titles(table)).toHaveLength(50) // 한 번에 보기 기본 50건
    expect(count()).toHaveTextContent('1–50 / 200건')
  })

  it('머리글을 눌러 숫자 순으로 정렬하고, 다시 누르면 반대로, 세 번째에는 원래대로', async () => {
    const user = userEvent.setup()
    open('/data', await demoBackend())
    const table = await screen.findByRole('table')
    const original = titles(table)
    const col = colIndex(table, /압축강도/)
    await user.click(within(table).getByRole('button', { name: /압축강도/ }))
    const asc = numbersIn(table, col).filter((n) => !Number.isNaN(n))
    expect(asc).toEqual([...asc].sort((a, b) => a - b))
    expect(within(table).getByRole('columnheader', { name: /압축강도/ })).toHaveAttribute('aria-sort', 'ascending')
    await user.click(within(table).getByRole('button', { name: /압축강도/ }))
    const desc = numbersIn(table, col).filter((n) => !Number.isNaN(n))
    expect(desc).toEqual([...desc].sort((a, b) => b - a))
    expect(desc[0]).toBe(124.7) // 일부러 바꿔 둔 값이 맨 위
    await user.click(within(table).getByRole('button', { name: /압축강도/ }))
    expect(titles(table)).toEqual(original)
  })

  it('이름 검색, 상태, 프로젝트로 거르고 건수를 알려 준다', async () => {
    const user = userEvent.setup()
    open('/data', await demoBackend())
    await screen.findByRole('table')
    await user.selectOptions(screen.getByLabelText('프로젝트'), '하이브리드본드 HB-50')
    expect(count()).toHaveTextContent('1–49 / 49건')
    expect(count()).toHaveTextContent('전체 200건 중')
    await user.selectOptions(screen.getByLabelText('상태'), '진행')
    expect(count()).toHaveTextContent('1–3 / 3건')
    await user.selectOptions(screen.getByLabelText('상태'), '모두')
    await user.type(screen.getByLabelText('실험 이름 찾기'), '#895,')
    expect(titles(screen.getByRole('table'))).toEqual(['배합 #895, 재령 28일'])
    await user.clear(screen.getByLabelText('실험 이름 찾기'))
    await user.type(screen.getByLabelText('실험 이름 찾기'), '없는 이름')
    expect(count()).toHaveTextContent('조건에 맞는 실험이 없습니다')
  })

  it('페이지를 넘기고 한 번에 보기를 바꾸면 전체를 끝까지 볼 수 있다', async () => {
    const user = userEvent.setup()
    open('/data', await demoBackend())
    const table = await screen.findByRole('table')
    const first = titles(table)[0]
    await user.click(screen.getByRole('button', { name: '다음' }))
    expect(count()).toHaveTextContent('51–100 / 200건')
    expect(titles(table)[0]).not.toBe(first)
    await user.selectOptions(screen.getByLabelText('한 번에 보기'), '전체')
    expect(titles(table)).toHaveLength(200)
    expect(screen.queryByRole('navigation', { name: '표 페이지' })).toBeNull()
  })

  it('열 고르기로 조건만, 결과만, 하나씩 켜고 끈다', async () => {
    const user = userEvent.setup()
    open('/data', await demoBackend())
    const table = await screen.findByRole('table')
    await user.click(screen.getByText(/열 고르기/))
    await user.click(screen.getByRole('button', { name: '결과만' }))
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent).join(' ')).toContain('압축강도')
    expect(within(table).queryByRole('button', { name: /시멘트/ })).toBeNull()
    await user.click(screen.getByRole('checkbox', { name: /시멘트/ }))
    expect(within(table).getByRole('button', { name: /시멘트/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '모두 보기' }))
    expect(screen.getByText(/열 고르기 \(9\/9\)/)).toBeInTheDocument()
  })

  it('프로젝트 화면의 데이터 표도 같은 표로 끝까지 볼 수 있다', async () => {
    const user = userEvent.setup()
    open('/projects/demo-project-2/data', await demoBackend())
    const table = await screen.findByRole('table')
    expect(titles(table)).toHaveLength(50)
    expect(count()).toHaveTextContent('1–50 / 51건')
    await user.click(screen.getByRole('button', { name: '다음' }))
    expect(titles(table)).toHaveLength(1)
    expect(screen.getByRole('link', { name: /데이터 > 내보내기/ })).toHaveAttribute('href', '/data/export')
  })

  it('데이터가 없으면 안내한다', async () => {
    const b = createLocalBackend(`lablog-hub-empty-${Date.now()}`)
    opened.push(b)
    open('/data', b)
    expect(await screen.findByText('모을 데이터가 없습니다')).toBeInTheDocument()
  })
})

describe('데이터 허브: 분석', () => {
  it('요약 문장, 영향 주는 조건, 조건 값별 비교, 상관 행렬, 요약 통계를 보여 준다', async () => {
    open('/data/analysis', await demoBackend())
    expect(await screen.findByRole('heading', { name: '한눈에 읽기' })).toBeInTheDocument()
    const insights = document.querySelector('.insights') as HTMLElement
    expect(insights.textContent).toMatch(/r = -?0\.\d\d, p/)
    expect(insights.textContent).toContain('상관이 곧 원인은 아닙니다')
    expect(screen.getByRole('heading', { name: '압축강도에 영향을 주는 조건' })).toBeInTheDocument()
    const driverTable = screen.getByRole('region', { name: '조건별 상관 분석 표' })
    expect(within(driverTable).getByRole('rowheader', { name: '시멘트' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /조건별 r 값/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '조건 값별 비교' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /별 압축강도 \(MPa\) 평균/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '항목 사이 상관 행렬' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '항목별 요약 통계 표' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /압축강도 \(MPa\) 분포/ })).toBeInTheDocument()
  })

  it('프로젝트를 고르면 그 프로젝트만 분석한다', async () => {
    const user = userEvent.setup()
    open('/data/analysis', await demoBackend())
    await screen.findByRole('heading', { name: '한눈에 읽기' })
    await user.selectOptions(screen.getByLabelText('분석할 범위'), screen.getByRole('option', { name: /하이브리드본드 HB-50/ }))
    await waitFor(() => expect(screen.getByText(/실험 46건의 압축강도를 분석합니다/)).toBeInTheDocument())
  })

  it('조건 값별 비교에서 나눌 조건을 바꿀 수 있다', async () => {
    const user = userEvent.setup()
    open('/data/analysis', await demoBackend())
    const select = (await screen.findByLabelText('나눌 조건')) as HTMLSelectElement
    const options = [...select.options].map((o) => o.textContent ?? '')
    expect(options.some((o) => o.includes('재령'))).toBe(true)
    await user.selectOptions(select, select.options[select.options.length - 1].value)
    expect(screen.getByRole('group', { name: /별 압축강도 \(MPa\) 평균/ })).toBeInTheDocument()
  })

  it('값이 모자란 데이터는 분석 대신 안내한다', async () => {
    const b = createLocalBackend(`lablog-hub-few-${Date.now()}`)
    opened.push(b)
    const e = await b.experiments.create({ projectId: null, title: '하나뿐', purpose: '', owner: '', tags: [], status: 'done', startedAt: null, completedAt: null, sourceExperimentId: null })
    await b.dataItems.create({ experimentId: e.id, kind: 'condition', order: 1, name: '온도', value: '80', unit: '°C' })
    await b.dataItems.create({ experimentId: e.id, kind: 'result', order: 1, name: '강도', value: '3', unit: 'MPa' })
    open('/data/analysis', b)
    expect(await screen.findByText('분석할 수치가 아직 부족합니다')).toBeInTheDocument()
  })
})

describe('데이터 허브: 내보내기', () => {
  it('내보내기 전에 규모, 결측, 단위 혼합 여부를 알려 준다', async () => {
    const b = await demoBackend()
    const e = await b.experiments.create({ projectId: null, title: '단위가 다른 실험', purpose: '', owner: '', tags: [], status: 'done', startedAt: null, completedAt: null, sourceExperimentId: null })
    await b.dataItems.create({ experimentId: e.id, kind: 'condition', order: 1, name: '물', value: '180', unit: 'L/m³' })
    open('/data/export', b)
    const checks = (await screen.findByRole('heading', { name: '내보내기 전에 확인할 것' })).closest('section') as HTMLElement
    expect(checks).toHaveTextContent('실험 201건')
    expect(checks).toHaveTextContent(/숫자 칸 중 비어 있는 비율 \d+%/)
    expect(checks).toHaveTextContent('단위가 섞여 있는 항목: 물 (')
  })

  it('분석용 CSV는 숫자만 담고 BOM이 없으며 파일 이름에 범위와 날짜가 들어간다', async () => {
    const user = userEvent.setup()
    const files = captureDownloads()
    open('/data/export', await demoBackend())
    await user.click(await screen.findByRole('button', { name: '분석용 CSV 받기' }))
    const text = await (await waitFor(() => files[0])).text
    expect(files[0].name).toMatch(/^lablog-전체-\d{4}-\d{2}-\d{2}-analysis\.csv$/)
    expect(text.charCodeAt(0)).not.toBe(0xfeff)
    const lines = text.split('\r\n')
    expect(lines).toHaveLength(201)
    expect(lines[0]).toContain('압축강도 (MPa)')
    expect(await screen.findByText(/analysis\.csv 파일을 저장했습니다/)).toBeInTheDocument()
  })

  it('프로젝트를 고르면 그 프로젝트만 내보낸다 (긴 형식, JSON, 데이터 사전)', async () => {
    const user = userEvent.setup()
    const files = captureDownloads()
    open('/data/export', await demoBackend())
    await user.selectOptions(await screen.findByLabelText('내보낼 범위'), screen.getByRole('option', { name: /로히트 플라이 LF-20/ }))
    await user.click(screen.getByRole('button', { name: '긴 형식 CSV 받기' }))
    await user.click(screen.getByRole('button', { name: 'JSON 받기' }))
    await user.click(screen.getByRole('button', { name: '데이터 사전 받기' }))
    await waitFor(() => expect(files).toHaveLength(3))
    const [long, json, dict] = await Promise.all(files.map((f) => f.text))
    expect(files.map((f) => f.name.replace(/\d{4}-\d{2}-\d{2}/, 'DATE'))).toEqual([
      'lablog-로히트-플라이-LF-20-DATE-long.csv',
      'lablog-로히트-플라이-LF-20-DATE.json',
      'lablog-로히트-플라이-LF-20-DATE-dictionary.csv',
    ])
    expect(long.split('\r\n')[0]).toBe('experiment_id,프로젝트,실험,상태,시작일,구분,항목,값,숫자값,단위')
    expect(new Set(long.split('\r\n').slice(1).map((l) => l.split(',')[1])).size).toBe(1)
    expect(JSON.parse(json).experiments).toHaveLength(50)
    expect(dict).toContain('압축강도 (MPa)')
  })

  it('파이썬 읽기 예시는 펼쳐서 볼 수 있고 파일 이름이 맞춰져 있다', async () => {
    const user = userEvent.setup()
    open('/data/export', await demoBackend())
    await user.click(await screen.findByRole('button', { name: '예시 코드 보기' }))
    const code = document.querySelector('.export__code') as HTMLElement
    expect(code.textContent).toContain('pd.read_csv("lablog-전체-')
    expect(code.textContent).toContain('df["압축강도 (MPa)"]')
  })
})
