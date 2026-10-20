import { expect, test } from '@playwright/test'
import { seedDemo } from './helpers'

test('Journey 2: 실험 목록 검색 → 필터 → 실험 열기가 10초 안에 끝난다', async ({ page }) => {
  await seedDemo(page)
  const started = Date.now()
  await page.goto('/experiments')
  const box = page.getByRole('searchbox', { name: '실험 검색' })
  await box.fill('배합 #400')
  await expect(page.getByRole('link', { name: /배합 #400, 재령 28일/ })).toBeVisible()
  await page.getByLabel('프로젝트', { exact: true }).selectOption({ label: '에코슬래그 ES-30' })
  await page.getByRole('link', { name: /배합 #400, 재령 28일/ }).click()
  await expect(page.getByRole('heading', { name: /배합 #400, 재령 28일/ })).toBeVisible()
  expect(Date.now() - started).toBeLessThan(10_000)
})

test('구 검색 주소는 검색어를 유지해 실험 목록으로 안내한다', async ({ page }) => {
  await seedDemo(page)
  await page.goto('/search?q=' + encodeURIComponent('배합 #400'))
  await expect(page.getByText('검색은 실험 목록의 제목·목적 검색으로 이동했습니다.')).toBeVisible()
  await expect(page.getByRole('searchbox', { name: '실험 검색' })).toHaveValue('배합 #400')
  await expect(page.getByRole('link', { name: /배합 #400, 재령 28일/ })).toBeVisible()
})

test('실험 목록의 검색·필터와 페이지 나눔, 마지막 조건 복원', async ({ page }) => {
  await seedDemo(page)
  await page.goto('/experiments')
  await expect(page.locator('.card')).toHaveCount(12)
  await expect(page.getByText('1–12 / 200')).toBeVisible()
  await page.getByRole('button', { name: '다음' }).click()
  await expect(page.getByText('13–24 / 200')).toBeVisible()
  await page.getByRole('button', { name: '진행', exact: true }).click()
  await expect(page.locator('.card')).toHaveCount(8)
  await page.goto('/experiments')
  await expect(page.locator('.card')).toHaveCount(8)
  await page.getByRole('button', { name: '필터 초기화' }).click()
  await expect(page.locator('.card')).toHaveCount(12)
})
