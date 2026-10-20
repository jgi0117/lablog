import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import App from '../App'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import { appendSteps, createExperiment } from '../services/experimentService'

const opened: LocalBackend[] = []
let seq = 0

function backendWith(): LocalBackend {
  const b = createLocalBackend(`lablog-pages-${Date.now()}-${seq++}`)
  opened.push(b)
  return b
}

function open(path: string, backend: LocalBackend) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App backend={backend} />
    </MemoryRouter>,
  )
}

afterEach(async () => {
  cleanup()
  await new Promise((r) => setTimeout(r, 20))
  while (opened.length) opened.pop()?.close()
})

describe('실험 만들기', () => {
  it('제목이 비어 있으면 안내하고 만들지 않는다', async () => {
    const backend = backendWith()
    open('/experiments/new', backend)
    await userEvent.click(await screen.findByRole('button', { name: '실험 만들기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('제목을 입력하세요')
    expect((await backend.experiments.list()).total).toBe(0)
  })

  it('새 프로젝트를 고르면 프로젝트도 함께 만든다', async () => {
    const user = userEvent.setup()
    const backend = backendWith()
    open('/experiments/new', backend)
    await user.type(await screen.findByLabelText('제목 (필수)'), '프로젝트 포함 실험')
    await user.selectOptions(screen.getByLabelText('프로젝트'), '+ 새 프로젝트…')
    await user.type(screen.getByLabelText('새 프로젝트 이름'), 'PROJECT-Z')
    await user.click(screen.getByRole('button', { name: '실험 만들기' }))
    await waitFor(async () => {
      const [exp] = (await backend.experiments.list()).items
      const [project] = await backend.projects.list()
      expect(project.name).toBe('PROJECT-Z')
      expect(exp.projectId).toBe(project.id)
    })
  })
})

describe('절차 편집', () => {
  async function withSteps() {
    const backend = backendWith()
    const exp = await createExperiment(backend, { title: '절차 편집' })
    await appendSteps(backend, exp.id, ['가', '나', '다'], [])
    return { backend, exp }
  }

  it('위·아래로 순서를 바꾸면 저장소 순서도 바뀐다', async () => {
    const { backend, exp } = await withSteps()
    open(`/experiments/${exp.id}/steps`, backend)
    await userEvent.click(await screen.findByRole('button', { name: '3번째 단계 위로' }))
    await waitFor(async () => {
      expect((await backend.steps.listByExperiment(exp.id)).map((s) => s.content)).toEqual(['가', '다', '나'])
    })
    expect(screen.getByLabelText('2번째 단계')).toHaveValue('다')
  })

  it('삭제하면 되돌리기로 같은 단계가 돌아온다', async () => {
    const { backend, exp } = await withSteps()
    open(`/experiments/${exp.id}/steps`, backend)
    await userEvent.click(await screen.findByRole('button', { name: '2번째 단계 삭제' }))
    await waitFor(() => expect(screen.queryByDisplayValue('나')).toBeNull())
    const toast = screen.getByText('단계를 삭제했습니다').closest('.toast') as HTMLElement
    await userEvent.click(within(toast).getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(screen.getByDisplayValue('나')).toBeInTheDocument())
    expect((await backend.steps.listByExperiment(exp.id)).map((s) => s.content)).toEqual(['가', '나', '다'])
  })

  it('수정한 내용은 입력을 멈추면 저장된다', async () => {
    const { backend, exp } = await withSteps()
    open(`/experiments/${exp.id}/steps`, backend)
    const input = await screen.findByLabelText('1번째 단계')
    fireEvent.change(input, { target: { value: '가를 수정함' } })
    fireEvent.blur(input)
    await waitFor(async () => expect((await backend.steps.listByExperiment(exp.id))[0].content).toBe('가를 수정함'))
  })
})

describe('조건·결과 (E7)', () => {
  it('숫자가 아닌 값은 막지 않고 경고만 보여 준다', async () => {
    const backend = backendWith()
    const exp = await createExperiment(backend, { title: '값 검증' })
    await backend.dataItems.create({ experimentId: exp.id, kind: 'condition', order: 1, name: '온도', value: '', unit: '°C' })
    open(`/experiments/${exp.id}/data`, backend)
    const value = await screen.findByLabelText('온도 값')
    fireEvent.change(value, { target: { value: '약 80도' } })
    expect(await screen.findByText(/숫자가 아닌 값/)).toBeInTheDocument()
    fireEvent.blur(value)
    await waitFor(async () => {
      expect((await backend.dataItems.listByExperiment(exp.id))[0].value).toBe('약 80도')
    })
  })

  it('항목을 삭제했다가 되돌릴 수 있다', async () => {
    const backend = backendWith()
    const exp = await createExperiment(backend, { title: '값 삭제' })
    await backend.dataItems.create({ experimentId: exp.id, kind: 'result', order: 1, name: '수율', value: '88', unit: '%' })
    open(`/experiments/${exp.id}/data`, backend)
    await userEvent.click(await screen.findByRole('button', { name: '수율 삭제' }))
    await waitFor(() => expect(screen.queryByLabelText('수율 값')).toBeNull())
    const toast = screen.getByText(/수율 항목을 삭제했습니다/).closest('.toast') as HTMLElement
    await userEvent.click(within(toast).getByRole('button', { name: '되돌리기' }))
    expect(await screen.findByLabelText('수율 값')).toHaveValue('88')
  })
})

describe('개요', () => {
  it('제목을 바꾸면 자동 저장되고, 비우면 안내만 한다', async () => {
    const backend = backendWith()
    const exp = await createExperiment(backend, { title: '원래 제목' })
    open(`/experiments/${exp.id}`, backend)
    const title = await screen.findByLabelText('제목')
    fireEvent.change(title, { target: { value: '' } })
    expect(await screen.findByText('제목은 비워 둘 수 없습니다')).toBeInTheDocument()
    fireEvent.change(title, { target: { value: '새 제목' } })
    await waitFor(async () => expect((await backend.experiments.get(exp.id)).title).toBe('새 제목'), { timeout: 3000 })
  })

  it('삭제하면 휴지통으로 가고 되돌리기로 복원된다', async () => {
    const backend = backendWith()
    const exp = await createExperiment(backend, { title: '삭제할 실험' })
    open(`/experiments/${exp.id}`, backend)
    await userEvent.click(await screen.findByRole('button', { name: '실험 삭제' }))
    await waitFor(async () => expect((await backend.experiments.get(exp.id)).deletedAt).not.toBeNull())
    const toast = (await screen.findByText(/휴지통으로 보냈습니다/)).closest('.toast') as HTMLElement
    await userEvent.click(within(toast).getByRole('button', { name: '되돌리기' }))
    await waitFor(async () => expect((await backend.experiments.get(exp.id)).deletedAt).toBeNull())
  })
})
