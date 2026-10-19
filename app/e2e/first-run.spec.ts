import { expect, test } from '@playwright/test'

// 처음 여는 브라우저: 데이터가 없으면 공개 데이터 전체(1,030건)가 들어 있는 상태로 시작한다.
// 이 시험은 자동 입력을 켠 별도 서버(first-run 프로젝트)에서만 돈다.

test('처음 열면 예시 데이터 1,030건이 들어 있고 몇 초 안에 뜬다', async ({ page }) => {
  test.setTimeout(120_000)
  const t = Date.now()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '오늘의 실험' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('전체 실험 1030건')).toBeVisible()
  console.log(`[처음 열기 ${test.info().project.name}] 예시 1,030건을 넣고 홈이 뜰 때까지 ${Date.now() - t}ms`)
  expect(Date.now() - t).toBeLessThan(30_000)

  await page.goto('/projects')
  await expect(page.locator('a.project-card')).toHaveCount(4)
  await expect(page.getByText('실험 334건')).toBeVisible()

  // 다시 열어도 늘지 않는다
  await page.goto('/')
  await expect(page.getByText('전체 실험 1030건')).toBeVisible()
})

test('예시 데이터를 지우면 다시 들어오지 않고, 빈 화면에서 다시 넣을 수 있다', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/settings')
  await page.getByRole('button', { name: /예시 데이터 지우기 \(실험 1030건\)/ }).click({ timeout: 60_000 })
  await page.getByRole('dialog').getByRole('button', { name: '예시 데이터 지우기' }).click()
  await expect(page.getByText('예시 실험 1030건을 지웠습니다')).toBeVisible({ timeout: 120_000 })

  await page.goto('/')
  await expect(page.getByText('첫 실험을 만들어 보세요')).toBeVisible() // 다시 들어오지 않는다
  await page.getByRole('button', { name: /예시 데이터 넣기/ }).click()
  await expect(page.getByText('전체 실험 1030건')).toBeVisible({ timeout: 60_000 })
  await page.goto('/projects')
  await expect(page.locator('a.project-card')).toHaveCount(4)
})
