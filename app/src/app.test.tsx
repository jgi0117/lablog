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
  it('새 프로젝트를 만들면 첫 실험 계획이 생기고, 목표값 ± 허용을 적은 뒤 결과를 넣으면 다음 실험으로 넘어간다', async () => {
    const user = userEvent.setup()
    open('/new')
    await user.type(screen.getByLabelText('프로젝트 이름'), '하드코팅')
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

    expect(await screen.findByText(/첫 실험 계획도 짰습니다/)).toBeInTheDocument()
    const p = getDb().projects[0]
    expect(runsOf(getDb(), p.id)).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: '+ 목표' }))
    await user.type(screen.getByLabelText('목표값'), '1')
    await user.type(screen.getByLabelText('± 허용'), '0.2')
    await user.click(screen.getByRole('button', { name: '저장' }))

    expect(await screen.findByRole('heading', { name: /다음 실험 #1/ })).toBeInTheDocument()
    const conds = screen.getByRole('list', { name: '실험 조건' })
    expect(within(conds).getByText('두께')).toBeInTheDocument()
    expect(within(conds).getByText('4.0')).toBeInTheDocument()
    const hz = screen.getByLabelText('헤이즈')
    expect(hz).toHaveFocus()
    await user.type(hz, '1.5{Enter}')
    expect(await screen.findByRole('heading', { name: /다음 실험 #2/ })).toBeInTheDocument()
    const runs = runsOf(getDb(), p.id)
    expect(runs[0].status).toBe('done')
    expect(runs[0].y[p.variables[2].id]).toBe(1.5)
    expect(screen.getByText('미달')).toBeInTheDocument()
    // 목표 안의 값을 넣으면 달성으로 끝난다
    await user.type(screen.getByLabelText('헤이즈'), '1.1{Enter}')
    expect(await screen.findByText(/목표 달성\. 실험 2건으로 끝났습니다/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /다음 실험 #/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '그래도 실험을 더 하려면 →' }))
    expect(await screen.findByRole('heading', { name: /다음 실험 #3/ })).toBeInTheDocument()
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
    expect(await screen.findByRole('heading', { name: /다음 실험 #2/ })).toBeInTheDocument()
  }, 30000)
})

describe('예시 데이터', () => {
  it('홈: 끝난 프로젝트 아홉과 진행 중 셋. 끝난 프로젝트는 다음 실험을 만들지 않는다', async () => {
    const user = userEvent.setup()
    replaceDb(demoDb())
    open('/')
    // 참고 데이터(과거 배합 기록 4개)는 프로젝트 목록에 두지 않는다
    expect(await screen.findAllByRole('heading', { level: 2 })).toHaveLength(12)
    expect(screen.getAllByText('목표 달성 · 종료')).toHaveLength(9)
    expect(screen.queryByText('참고 데이터')).not.toBeInTheDocument()
    expect(screen.queryByText(/참고 · 과거 배합 기록/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '결과 보기 →' })).toHaveLength(9)
    await user.click(screen.getByRole('link', { name: '스탠다드믹스 SM-35' }))
    expect(await screen.findByText(/목표 달성\. 실험 \d+건으로 끝났습니다/)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.queryByRole('heading', { name: /다음 실험 #/ })).not.toBeInTheDocument()
    const sm = getDb().projects.find((x) => x.name.includes('SM-35'))!
    expect(runsOf(getDb(), sm.id).filter((r) => r.status === 'planned')).toHaveLength(0)
  }, 30000)

  it('진행 중 프로젝트를 열면 모아 학습한 모델이 다음 실험을 제안하고, 추적 차트가 보이며, 모델 탭은 그 프로젝트 기준으로 열린다', async () => {
    const user = userEvent.setup()
    replaceDb(demoDb())
    const hb = getDb().projects.find((x) => x.name.includes('HB-70'))!
    const n = runsOf(getDb(), hb.id).length
    open(`/p/${hb.id}`)
    expect(await screen.findByRole('heading', { name: new RegExp(`다음 실험 #${n + 1}`) }, { timeout: 15000 })).toBeInTheDocument()
    expect(screen.getByText(/아직 목표를 만족한 조건이 없습니다/)).toBeInTheDocument()
    expect(screen.getByText('모델 제안')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /목표에 가까워지고 있는가/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /실험 순서에 따른 압축강도/ })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: '자세히 →' }))
    expect(await screen.findByRole('heading', { name: '모델' })).toBeInTheDocument()
    expect(screen.getByLabelText('프로젝트', { selector: '#mp' })).toHaveValue(hb.id)
    expect(await screen.findByText(/같은 변수 프로젝트 15개/)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '목표를 만족할 가능성이 큰 조건' })).toBeInTheDocument()
  }, 40000)

  it('상단 탭: 데이터와 모델은 프로젝트 옆에 있고, 데이터 탭은 같은 변수를 가진 프로젝트를 함께 보여 준다', async () => {
    const user = userEvent.setup()
    replaceDb(demoDb())
    open('/')
    await user.click(await screen.findByRole('link', { name: '데이터' }))
    expect(await screen.findByRole('heading', { name: '데이터' })).toBeInTheDocument()
    // 기본은 고른 프로젝트의 실험만, 체크하면 같은 변수 프로젝트를 합친다
    const picked = (screen.getByRole('combobox', { name: '프로젝트' }) as HTMLSelectElement).value
    const own = getDb().runs.filter((r) => r.project === picked).length
    expect(own).toBeGreaterThan(0)
    expect(own).toBeLessThan(getDb().runs.length)
    expect(screen.getByRole('button', { name: /전체 \d+/ })).toHaveTextContent(`전체 ${own}`)
    await user.click(screen.getByLabelText(/같은 변수 프로젝트 15개 함께/))
    expect(screen.getByRole('button', { name: /전체 \d+/ })).toHaveTextContent(`전체 ${getDb().runs.length}`)
    // 전체 프로젝트 보기: 변수 이름 기준으로 합쳐 읽기만
    await user.selectOptions(screen.getByLabelText('프로젝트'), 'all')
    expect(await screen.findByText(/전체 보기 · 변수 이름이 같으면 한 열/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /전체 \d+/ })).toHaveTextContent(`전체 ${getDb().runs.length}`)
    expect(screen.queryByRole('button', { name: 'CSV 더하기' })).not.toBeInTheDocument()
    // 표준화 ↔ 원래 값
    expect(screen.getByRole('button', { name: '표준화 (중앙값·IQR)' })).toHaveClass('btn--primary')
    await user.click(screen.getByRole('button', { name: '원래 값' }))
    expect(screen.getByRole('button', { name: '원래 값' })).toHaveClass('btn--primary')
    await user.click(screen.getByRole('link', { name: '모델' }))
    expect(await screen.findByRole('heading', { name: '모델' })).toBeInTheDocument()
  }, 30000)

  it('모델 탭에서 직접 학습해 버전으로 저장·적용하면 적용 중인 모델이 바뀐다', async () => {
    const user = userEvent.setup()
    replaceDb(demoDb())
    const hb = getDb().projects.find((x) => x.name.includes('HB-70'))!
    open(`/model?p=${hb.id}`)
    expect(await screen.findByText(/자동 RF|자동 선형/, {}, { timeout: 15000 })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('알고리즘'), 'gbm')
    // 조건 둘만 빼고 학습
    await user.click(screen.getByLabelText('굵은 골재'))
    await user.click(screen.getByLabelText('잔골재'))
    expect(screen.getByText(/조건 \(feature\) · 22개 선택/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '학습하기' }))
    expect(await screen.findByRole('button', { name: '저장하고 적용' }, { timeout: 20000 })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '저장하고 적용' }))
    expect(await screen.findByText('적용 중')).toBeInTheDocument()
    expect(getDb().models).toHaveLength(1)
    expect(getDb().models![0]).toMatchObject({ version: 1, algo: 'gbm', applied: true, target: '압축강도' })
    expect(getDb().models![0].features).toHaveLength(22)
    expect(await screen.findByText(/v1 GBM/, {}, { timeout: 15000 })).toBeInTheDocument()
    // 자동으로 되돌리기
    await user.click(screen.getByRole('button', { name: '자동으로' }))
    expect(await screen.findByText(/자동 RF|자동 선형/, {}, { timeout: 15000 })).toBeInTheDocument()
  }, 60000)

  it('데이터 화면에서 CSV를 내려받고 값을 고칠 수 있다', async () => {
    replaceDb(demoDb())
    const p = getDb().projects.find((x) => x.name.includes('HB-70'))!
    open(`/data?p=${p.id}`)
    expect(await screen.findByRole('button', { name: 'CSV 내려받기' })).toBeInTheDocument()
    // 한 쪽에 10건, 다음 쪽으로 넘어갔다가 돌아온다
    expect(screen.getByText(/1 \/ \d+ 쪽/)).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(11 + (screen.queryByRole('heading', { name: /입력 점검/ }) ? screen.getAllByRole('row').length - 11 : 0))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '다음 ›' }))
    expect(screen.getByText(/2 \/ \d+ 쪽/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '‹ 이전' }))
    // 입력 점검: 변수별 박스플롯과 이상치 후보
    expect(screen.getByRole('heading', { name: /입력 점검/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '변수별 분포와 이상치 후보' })).toBeInTheDocument()
    const last = runsOf(getDb(), p.id).at(-1)!
    const cell = screen.getByLabelText(`#${last.order} 압축강도`)
    await user.clear(cell)
    await user.type(cell, '99')
    await user.tab()
    await waitFor(() => expect(getDb().runs.find((r) => r.id === last.id)!.y[p.variables.find((v) => v.name === '압축강도')!.id]).toBe(99))
  })
})
