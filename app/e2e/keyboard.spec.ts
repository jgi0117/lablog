import { expect, test } from '@playwright/test'
import { seedDemo, tabTo } from './helpers'

// 키보드가 없는 터치 기기(태블릿 프로젝트)에서는 건너뛴다.
test.skip(({ isMobile }) => isMobile, '키보드 전용 흐름은 데스크톱 브라우저에서 확인한다')

test('키보드만으로 새 실험 만들기 → 절차 입력 → 수행 → 완료까지 갈 수 있다', async ({ page }) => {
  await page.goto('/')
  // 건너뛰기 링크가 첫 Tab으로 오고, Enter를 누르면 본문으로 간다
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: '본문으로 건너뛰기' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main')).toBeFocused()

  // + 새 실험 (Tab으로 찾아 Enter)
  await tabTo(page, '+ 새 실험')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '새 실험' })).toBeVisible()

  // 제목은 처음부터 포커스 → 입력하고 Enter로 제출
  await expect(page.getByLabel('제목 (필수)')).toBeFocused()
  await page.keyboard.type('키보드로 만든 실험')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '키보드로 만든 실험' })).toBeVisible()

  // 단계를 하나씩 입력하고 Enter
  await tabTo(page, '새 단계')
  await page.keyboard.type('코팅액을 조제한다')
  await page.keyboard.press('Enter')
  await page.keyboard.type('오븐에서 건조한다')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('2번째 단계', { exact: true })).toHaveValue('오븐에서 건조한다')

  // 수행 모드 시작
  await tabTo(page, '수행 모드 시작')
  await page.keyboard.press('Enter')
  const step1 = page.getByRole('button', { name: 'I. 코팅액을 조제한다' })
  await expect(step1).toBeVisible()

  // 단계를 Tab으로 찾아 Space로 체크
  await tabTo(page, 'I. 코팅액을 조제한다')
  await page.keyboard.press('Space')
  await expect(step1).toHaveAttribute('aria-pressed', 'true')

  // 완료하고 다음 단계 → 수행 완료 → 완료하기
  await tabTo(page, '수행 완료')
  await page.keyboard.press('Enter')
  await expect(page.getByText('실험을 완료할까요?')).toBeVisible()
  await tabTo(page, '완료하기')
  await page.keyboard.press('Enter')
  await expect(page.locator('.badge', { hasText: '완료' })).toBeVisible()
})

test('키보드만으로 검색해서 결과를 열 수 있다', async ({ page }) => {
  await seedDemo(page)
  await page.keyboard.press('Control+K')
  await expect(page.getByRole('searchbox', { name: '전역 검색' })).toBeFocused()
  await page.keyboard.type('압축강도')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '검색 결과' })).toBeVisible()
  await tabTo(page, /배합 #\d+, 재령/)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: /배합 #\d+, 재령/ })).toBeVisible()
})

test('수행 모드에서 방향키로 단계를 옮기고 Space로 체크한다', async ({ page }) => {
  await seedDemo(page)
  await page.goto('/experiments/concrete-794/run')
  await expect(page.getByRole('button', { name: /^IV\./ })).toBeVisible()
  // 방향키는 입력칸 밖에서만 단계를 옮긴다. 단계 버튼에 포커스를 두고 누른다.
  await page.getByRole('button', { name: /^III\./ }).focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowUp')
  await page.getByRole('button', { name: /^IV\./ }).focus()
  await expect(page.getByRole('button', { name: /^IV\./ })).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: /^IV\./ })).toHaveAttribute('aria-pressed', 'true')
})

test('차트의 점을 키보드로 열 수 있다', async ({ page }) => {
  await seedDemo(page)
  await page.goto('/projects/demo-project-3/analysis')
  await page.getByLabel('세로축 (결과)').selectOption({ label: '압축강도 (MPa)' })
  const point = page.getByRole('link', { name: /이상치 후보\)$/ }).first()
  await point.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: /배합 #205, 재령 3일/ })).toBeVisible()
})
