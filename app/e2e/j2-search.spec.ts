import { expect, test } from '@playwright/test'
import { seedDemo } from './helpers'

test('Journey 2: 검색 → 필터 → 실험 열기가 10초 안에 끝나고 일치한 부분이 강조된다 (KR1)', async ({ page, isMobile }) => {
  await seedDemo(page)
  const started = Date.now()

  const box = page.getByRole('searchbox', { name: '전역 검색' })
  if (isMobile) await box.click()
  else await page.keyboard.press('Control+K') // 단축키로 검색창에 포커스
  await expect(box).toBeFocused()
  await box.fill('헤이즈')
  await box.press('Enter')

  await expect(page.getByRole('heading', { name: '검색 결과' })).toBeVisible()
  await expect(page.locator('mark').first()).toBeVisible()
  await expect(page.getByText(/\d+건 · \d\.\d\d초/)).toBeVisible()

  // 프로젝트로 좁히고 첫 결과를 연다
  await page.getByLabel('프로젝트', { exact: true }).selectOption({ label: '하드코팅 필름 HC-300' })
  await page.getByRole('link', { name: /HC-300 하드코팅 조건 탐색 #8/ }).first().click()
  await expect(page.getByRole('heading', { name: /조건 탐색 #8/ })).toBeVisible()

  expect(Date.now() - started).toBeLessThan(10_000)
})

test('띄어쓰기를 무시하고 찾고, 철자가 틀리면 비슷한 낱말을 제안한다 (E4)', async ({ page }) => {
  await seedDemo(page)
  await page.goto('/search?q=' + encodeURIComponent('하드코팅조건'))
  await expect(page.getByRole('link', { name: /HC-300 하드코팅 조건 탐색 #1$/ }).first()).toBeVisible()

  await page.goto('/search?q=' + encodeURIComponent('하드코딩'))
  await expect(page.getByText('일치하는 실험이 없습니다')).toBeVisible()
  await page.getByRole('link', { name: '하드코팅', exact: true }).click()
  await expect(page.getByRole('link', { name: /HC-300 하드코팅 조건 탐색/ }).first()).toBeVisible()
})

test('실험 목록의 필터와 페이지 나눔, 마지막 필터 복원', async ({ page }) => {
  await seedDemo(page)
  await page.goto('/experiments')
  await expect(page.locator('.card')).toHaveCount(12)
  await expect(page.getByText('1–12 / 17')).toBeVisible()
  await page.getByRole('button', { name: '다음' }).click()
  await expect(page.getByText('13–17 / 17')).toBeVisible()

  await page.getByRole('button', { name: '진행', exact: true }).click()
  await expect(page.locator('.card')).toHaveCount(2)
  // 다시 열면 마지막으로 쓴 필터를 복원한다
  await page.goto('/experiments')
  await expect(page.locator('.card')).toHaveCount(2)
  await page.getByRole('button', { name: '필터 초기화' }).click()
  await expect(page.locator('.card')).toHaveCount(12)
})
