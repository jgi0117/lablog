import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import App from '../App'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'

const opened: LocalBackend[] = []

afterEach(async () => {
  cleanup()
  await new Promise((r) => setTimeout(r, 20))
  while (opened.length) opened.pop()?.close()
})

/**
 * Journey 1 (새 실험 → 절차 입력 → 수행 → 조건·결과 → 완료)를 화면 조작으로 끝까지 따라간다.
 * 실제 브라우저 E2E(Playwright)는 브라우저 설치 후 같은 시나리오로 옮긴다.
 */
describe('Journey 1: 새 실험 수행', () => {
  it('만들기부터 완료까지 막힘 없이 진행하고 모든 값이 저장된다', async () => {
    const user = userEvent.setup()
    const backend = createLocalBackend(`lablog-j1-${Date.now()}`)
    opened.push(backend)
    render(
      <MemoryRouter initialEntries={['/']}>
        <App backend={backend} />
      </MemoryRouter>,
    )

    // 1. 홈 → 새 실험
    await user.click(await screen.findByRole('link', { name: '+ 새 실험' }, { timeout: 3000 }))
    await user.type(await screen.findByLabelText('제목 (필수)'), 'HC-300 하드코팅 조건 탐색 #11')
    await user.type(screen.getByLabelText('태그'), '하드코팅, UV경화')
    await user.click(screen.getByRole('button', { name: '실험 만들기' }))

    // 2. 절차 붙여넣기
    expect(await screen.findByRole('heading', { name: /HC-300 하드코팅 조건 탐색 #11/ })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('붙여넣을 절차'), {
      target: { value: '1. 코팅액을 조제한다\n2. 80°C로 건조한다\n3. 경화 후 연필경도를 잰다' },
    })
    await user.click(screen.getByRole('button', { name: '3개 단계 추가' }))
    expect(await screen.findByLabelText('3번째 단계')).toHaveValue('경화 후 연필경도를 잰다')
    expect(screen.getByRole('link', { name: /^절차 \(3\)/ })).toBeInTheDocument()

    // 3. 수행 모드 시작 (앱 셸 없는 전체 화면, 준비 → 진행)
    await user.click(screen.getByRole('link', { name: '수행 모드 시작 ▶' }))
    const first = await screen.findByRole('button', { name: 'I. 코팅액을 조제한다' })
    expect(first).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('navigation', { name: '메인 메뉴' })).toBeNull()
    await waitFor(async () => {
      const [exp] = (await backend.experiments.list()).items
      expect(exp.status).toBe('running')
      expect(exp.startedAt).not.toBeNull()
    })

    // 4. 첫 단계: 메모와 조건 값 입력 후 다음 단계로
    await user.type(screen.getByLabelText('단계 메모'), '고형분 40% 확인')
    await user.type(screen.getByLabelText('항목'), '건조 온도')
    await user.type(screen.getByLabelText('값'), '80')
    await user.type(screen.getByLabelText('단위'), '°C')
    await user.click(screen.getByRole('button', { name: '추가' }))
    expect(await screen.findByText('80 °C')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '완료하고 다음 단계' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'I. 코팅액을 조제한다' })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByText(/1 \/ 3 단계 · 33%/)).toBeInTheDocument()

    // 메모는 자동 저장된다 (E1 대응의 정상 경로)
    await waitFor(
      async () => {
        const exp = (await backend.experiments.list()).items[0]
        const steps = await backend.steps.listByExperiment(exp.id)
        expect(steps[0].note).toBe('고형분 40% 확인')
        expect(steps[0].done).toBe(true)
      },
      { timeout: 3000 },
    )

    // 5. 실수로 체크했다가 되돌리기 (E2)
    await user.click(screen.getByRole('button', { name: 'III. 경화 후 연필경도를 잰다' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'III. 경화 후 연필경도를 잰다' })).toHaveAttribute('aria-pressed', 'true'))
    const toast = (await screen.findByText('III단계를 체크했습니다')).closest('.toast') as HTMLElement
    await user.click(within(toast).getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'III. 경화 후 연필경도를 잰다' })).toHaveAttribute('aria-pressed', 'false'))

    // 6. 남은 단계를 마치고 완료 화면으로
    await user.click(screen.getByRole('button', { name: '완료하고 다음 단계' })) // II 체크
    await user.click(await screen.findByRole('button', { name: '수행 완료' })) // III 체크 → 조건·결과
    expect(await screen.findByText('실험을 완료할까요?')).toBeInTheDocument()

    // 7. 완료
    await user.click(screen.getByRole('button', { name: '완료하기' }))
    await waitFor(async () => {
      const exp = (await backend.experiments.list()).items[0]
      expect(exp.status).toBe('done')
      expect(exp.completedAt).not.toBeNull()
      expect(exp.tags).toEqual(['하드코팅', 'UV경화'])
    })
    expect((await backend.dataItems.listByExperiment((await backend.experiments.list()).items[0].id))[0]).toMatchObject({
      name: '건조 온도',
      value: '80',
      unit: '°C',
      kind: 'condition',
    })
  }, 30000)

  it('완료할 때 미완료 단계와 빈 결과를 알려 주고, 그래도 완료할 수 있다 (E3, E8)', async () => {
    const user = userEvent.setup()
    const backend = createLocalBackend(`lablog-j1b-${Date.now()}`)
    opened.push(backend)
    const exp = await backend.experiments.create({
      projectId: null,
      title: '경고 확인',
      purpose: '',
      owner: '',
      tags: [],
      status: 'running',
      startedAt: new Date().toISOString(),
      completedAt: null,
      sourceExperimentId: null,
    })
    await backend.steps.create({ experimentId: exp.id, order: 1, content: '가', done: true, doneAt: new Date().toISOString(), note: '' })
    await backend.steps.create({ experimentId: exp.id, order: 2, content: '나', done: false, doneAt: null, note: '' })
    await backend.dataItems.create({ experimentId: exp.id, kind: 'result', order: 1, name: '수율', value: '', unit: '%' })

    render(
      <MemoryRouter initialEntries={[`/experiments/${exp.id}/data?finish=1`]}>
        <App backend={backend} />
      </MemoryRouter>,
    )
    expect(await screen.findByText('완료하기 전에 확인하세요')).toBeInTheDocument()
    expect(screen.getByText('미완료 단계 1개')).toBeInTheDocument()
    expect(screen.getByText('비어 있는 결과 1개')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '돌아가서 입력' })).toHaveAttribute('href', `/experiments/${exp.id}/run`)
    await user.click(screen.getByRole('button', { name: '나중에 입력하고 완료' }))
    await waitFor(async () => expect((await backend.experiments.get(exp.id)).status).toBe('done'))
  })
})

describe('절차 입력', () => {
  it('Enter를 빠르게 이어서 눌러도 단계가 빠지거나 순서가 섞이지 않는다', async () => {
    const user = userEvent.setup({ delay: null })
    const backend = createLocalBackend(`lablog-fast-${Date.now()}`)
    opened.push(backend)
    const exp = await backend.experiments.create({
      projectId: null,
      title: '빠른 입력',
      purpose: '',
      owner: '',
      tags: [],
      status: 'ready',
      startedAt: null,
      completedAt: null,
      sourceExperimentId: null,
    })
    render(
      <MemoryRouter initialEntries={[`/experiments/${exp.id}/steps`]}>
        <App backend={backend} />
      </MemoryRouter>,
    )
    const box = await screen.findByPlaceholderText('새 단계를 입력하고 Enter')
    const names = ['가', '나', '다', '라', '마']
    for (const n of names) await user.type(box, `${n}{Enter}`)
    await waitFor(async () => {
      expect((await backend.steps.listByExperiment(exp.id)).map((s) => s.content)).toEqual(names)
    })
  })
})
