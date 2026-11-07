import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { demoDb } from './data/demo'
import { getDb, replaceDb, resetDb, runsOf } from './services/store'

function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

beforeEach(() => resetDb())

describe('핵심 흐름: 프로젝트 만들기 → 결과만 넣기', () => {
  it('새 프로젝트를 만들면 첫 실험 계획이 생기고, 결과를 넣으면 다음 실험으로 넘어간다', async () => {
    const user = userEvent.setup()
    open('/new')
    await user.type(screen.getByLabelText('프로젝트 이름'), '하드코팅')
    // 기본 줄: 입력 2, 출력 1
    await user.type(screen.getByLabelText('이름', { selector: '#vn-0' }), '두께')
    await user.type(screen.getByLabelText('최소', { selector: '#vmin-0' }), '2')
    await user.type(screen.getByLabelText('최대', { selector: '#vmax-0' }), '6')
    await user.type(screen.getByLabelText('이름', { selector: '#vn-1' }), '온도')
    await user.type(screen.getByLabelText('최소', { selector: '#vmin-1' }), '80')
    await user.type(screen.getByLabelText('최대', { selector: '#vmax-1' }), '120')
    await user.type(screen.getByLabelText('이름', { selector: '#vn-2' }), '헤이즈')
    await user.clear(screen.getByLabelText('처음 탐색할 조건 수'))
    await user.type(screen.getByLabelText('처음 탐색할 조건 수'), '4')
    await user.click(screen.getByRole('button', { name: '만들고 실험 계획 받기 →' }))

    // 설정 화면: 목표를 적고 저장
    expect(await screen.findByText(/첫 실험 계획도 짰습니다/)).toBeInTheDocument()
    const p = getDb().projects[0]
    expect(runsOf(getDb(), p.id)).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: '+ 목표' }))
    await user.selectOptions(screen.getByLabelText('조건'), '<=')
    await user.type(screen.getByLabelText('이하'), '1')
    await user.click(screen.getByRole('button', { name: '저장' }))

    // 실험 화면: 다음 실험 #1 카드에 조건이 보이고, 결과만 넣는다
    expect(await screen.findByRole('heading', { name: /다음 실험 #1/ })).toBeInTheDocument()
    const conds = screen.getByRole('list', { name: '실험 조건' })
    expect(within(conds).getByText('두께')).toBeInTheDocument()
    expect(within(conds).getByText('4.0')).toBeInTheDocument() // 가운데 점
    const hz = screen.getByLabelText('헤이즈')
    expect(hz).toHaveFocus()
    await user.type(hz, '1.3{Enter}')
    expect(await screen.findByRole('heading', { name: /다음 실험 #2/ })).toBeInTheDocument()
    const runs = runsOf(getDb(), p.id)
    expect(runs[0].status).toBe('done')
    expect(runs[0].y[p.variables[2].id]).toBe(1.3)
    expect(screen.getByText('미달')).toBeInTheDocument()
  }, 30000)

  it('계획이 바닥나면 자동으로 다음 조건을 더 짠다', async () => {
    const user = userEvent.setup()
    open('/new')
    await user.type(screen.getByLabelText('프로젝트 이름'), '한 번만')
    await user.type(screen.getByLabelText('이름', { selector: '#vn-0' }), '두께')
    await user.type(screen.getByLabelText('최소', { selector: '#vmin-0' }), '2')
    await user.type(screen.getByLabelText('최대', { selector: '#vmax-0' }), '6')
    await user.click(screen.getByLabelText('변수 2 지우기'))
    await user.type(screen.getByLabelText('이름', { selector: '#vn-1' }), '헤이즈')
    await user.clear(screen.getByLabelText('처음 탐색할 조건 수'))
    await user.type(screen.getByLabelText('처음 탐색할 조건 수'), '1')
    await user.click(screen.getByRole('button', { name: '만들고 실험 계획 받기 →' }))
    await user.click(await screen.findByRole('button', { name: '저장' }))
    await user.type(await screen.findByLabelText('헤이즈'), '2{Enter}')
    // 계획 1건뿐이었지만 다음 실험이 또 생긴다
    expect(await screen.findByRole('heading', { name: /다음 실험 #2/ })).toBeInTheDocument()
  }, 30000)
})

describe('예시 데이터', () => {
  it('예시 데이터가 들어 있으면 프로젝트 4개가 보이고, 프로젝트를 열면 모델 제안으로 다음 실험이 생긴다', async () => {
    const user = userEvent.setup()
    replaceDb(demoDb())
    open('/')
    expect(await screen.findAllByRole('heading', { level: 2 })).toHaveLength(4)
    expect(screen.getAllByText('목표 달성').length).toBeGreaterThanOrEqual(2)
    await user.click(screen.getByRole('link', { name: '스탠다드믹스 SM-00' }))
    expect(await screen.findByRole('heading', { name: /다음 실험 #233/ }, { timeout: 15000 })).toBeInTheDocument()
    expect(screen.getByText('모델 제안')).toBeInTheDocument()
    expect(await screen.findByText(/R² 0\.\d\d/)).toBeInTheDocument()
    expect(screen.getByText('후보 1')).toBeInTheDocument()
    const p = getDb().projects.find((x) => x.name.includes('SM-00'))!
    expect(runsOf(getDb(), p.id).filter((r) => r.status === 'planned')).toHaveLength(6)
  }, 40000)

  it('데이터 화면에서 CSV를 내려받고 값을 고칠 수 있다', async () => {
    replaceDb(demoDb())
    const p = getDb().projects.find((x) => x.name.includes('HB-50'))!
    open(`/p/${p.id}/data`)
    expect(await screen.findByRole('button', { name: 'CSV 내려받기' })).toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    expect(rows.length).toBeGreaterThan(50)
    const user = userEvent.setup()
    const last = runsOf(getDb(), p.id).at(-1)!
    const cell = screen.getByLabelText(`#${last.order} 압축강도`)
    await user.clear(cell)
    await user.type(cell, '99')
    await user.tab()
    await waitFor(() => expect(getDb().runs.find((r) => r.id === last.id)!.y[p.variables.find((v) => v.name === '압축강도')!.id]).toBe(99))
  })
})
