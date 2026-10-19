import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import App from '../App'
import { createLocalBackend, type LocalBackend } from '../data/local/localBackend'
import { seedSample } from '../data/seed'

const opened: LocalBackend[] = []
let seq = 0

function setup(path: string) {
  const backend = createLocalBackend(`lablog-routes-${Date.now()}-${seq++}`)
  opened.push(backend)
  render(
    <MemoryRouter initialEntries={[path]}>
      <App backend={backend} />
    </MemoryRouter>,
  )
  return backend
}

afterEach(async () => {
  cleanup() // 화면을 먼저 내리고
  await new Promise((r) => setTimeout(r, 20)) // 진행 중인 읽기가 끝나기를 기다린 뒤
  while (opened.length) opened.pop()?.close() // DB를 닫는다
})

describe('라우팅과 앱 셸', () => {
  it('홈은 실험이 없으면 첫 실험 안내를 보여 준다', async () => {
    setup('/')
    expect(await screen.findByText('첫 실험을 만들어 보세요')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '+ 새 실험' }).length).toBeGreaterThan(0)
  })

  it('왼쪽 메뉴로 이동한다', async () => {
    setup('/')
    await screen.findByText('첫 실험을 만들어 보세요')
    await userEvent.click(screen.getByRole('link', { name: '실험' }))
    expect(await screen.findByRole('heading', { name: /^실험/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '실험' })).toHaveClass('is-active')
  })

  it('전역 검색은 검색어를 주소에 담아 이동한다', async () => {
    setup('/')
    await screen.findByText('첫 실험을 만들어 보세요')
    await userEvent.type(screen.getByRole('searchbox', { name: '전역 검색' }), '80°C{Enter}')
    expect(await screen.findByRole('heading', { name: /^검색/ })).toBeInTheDocument()
  })

  it('실험 상세에는 개요/절차/조건·결과 탭이 있다', async () => {
    setup('/experiments/abc/steps')
    expect(await screen.findByRole('navigation', { name: '실험 상세 탭' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '절차' })).toHaveClass('is-active')
    expect(screen.getByRole('link', { name: '수행 모드 시작' })).toHaveAttribute('href', '/experiments/abc/run')
  })

  it('수행 모드는 앱 셸 없이 전체 화면이다', async () => {
    setup('/experiments/abc/run')
    expect(await screen.findByRole('heading', { name: /수행 모드/ })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '메인 메뉴' })).toBeNull()
  })

  it('없는 주소는 안내와 홈 링크를 보여 준다', async () => {
    setup('/nowhere')
    expect(await screen.findByText('페이지를 찾을 수 없습니다')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '홈으로' })).toHaveAttribute('href', '/')
  })

  it('저장소에 진행 중 실험이 있으면 홈에 나열한다', async () => {
    const backend = createLocalBackend(`lablog-routes-seed-${Date.now()}-${seq++}`)
    opened.push(backend)
    await seedSample(backend)
    render(
      <MemoryRouter>
        <App backend={backend} />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText(/진행 중 \(2\)/)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: '나노입자 합성 조건 최적화 #12' })).toBeInTheDocument()
  })
})
