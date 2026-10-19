import { expect, test } from '@playwright/test'
import { createExperiment } from './helpers'

test('Journey 1: 새 실험 → 절차 → 수행 → 되돌리기 → 완료, 새로고침 뒤에도 남는다', async ({ page }) => {
  await createExperiment(page, 'HC-300 하드코팅 조건 탐색 #11', ['코팅액을 조제한다', '80°C로 건조한다', '경화 후 연필경도를 잰다'], '하드코팅, UV경화')

  await page.getByRole('link', { name: '수행 모드 시작 ▶' }).click()
  const step1 = page.getByRole('button', { name: 'I. 코팅액을 조제한다' })
  const step3 = page.getByRole('button', { name: 'III. 경화 후 연필경도를 잰다' })
  await expect(step1).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('navigation', { name: '메인 메뉴' })).toHaveCount(0) // 전체 화면

  // 첫 단계: 메모와 조건 값을 한 화면에서 입력
  await page.getByLabel('단계 메모').fill('고형분 40% 확인')
  await page.getByLabel('항목', { exact: true }).fill('건조 온도')
  await page.getByLabel('값', { exact: true }).fill('80')
  await page.getByLabel('단위', { exact: true }).fill('°C')
  await page.getByRole('button', { name: '추가', exact: true }).click()
  await expect(page.getByText('80 °C')).toBeVisible()
  await page.getByRole('button', { name: '완료하고 다음 단계' }).click()
  await expect(step1).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(/1 \/ 3 단계 · 33%/)).toBeVisible()

  // 실수로 체크했다가 5초 되돌리기 (E2)
  await step3.click()
  await expect(step3).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.toast').getByRole('button', { name: '되돌리기' }).click()
  await expect(step3).toHaveAttribute('aria-pressed', 'false')

  // 남은 단계를 마치고 완료
  await page.getByRole('button', { name: '완료하고 다음 단계' }).click()
  await page.getByRole('button', { name: '수행 완료' }).click()
  await expect(page.getByText('실험을 완료할까요?')).toBeVisible()
  await page.getByRole('button', { name: '완료하기' }).click()
  await expect(page.getByRole('heading', { name: 'HC-300 하드코팅 조건 탐색 #11' })).toBeVisible()
  await expect(page.locator('.badge', { hasText: '완료' })).toBeVisible()

  // 새로고침 뒤에도 남는다 (IndexedDB). 단계 메모는 검색 색인에서도 찾아진다.
  await page.reload()
  await expect(page.locator('.badge', { hasText: '완료' })).toBeVisible()
  await expect(page.getByText(/3 \/ 3 단계 완료/)).toBeVisible()
  await page.goto('/search?q=' + encodeURIComponent('고형분'))
  await expect(page.getByRole('link', { name: /HC-300 하드코팅 조건 탐색 #11/ })).toBeVisible()
})

test('완료할 때 미완료 단계와 빈 결과를 알리고, 그래도 완료할 수 있다 (E3, E8)', async ({ page }) => {
  await createExperiment(page, '경고 확인 실험', ['가', '나'])
  await page.getByRole('link', { name: '조건·결과' }).click()
  await page.getByRole('button', { name: '+ 결과 추가' }).click()
  await page.getByLabel('결과 이름').fill('헤이즈')
  await page.getByRole('link', { name: '수행 모드 시작' }).click()
  await page.getByRole('button', { name: '완료하고 다음 단계' }).click() // 가만 체크
  await page.getByRole('link', { name: '← 나가기' }).click()
  await page.goto(page.url().replace(/\/?$/, '') + '/data?finish=1')
  await expect(page.getByText('완료하기 전에 확인하세요')).toBeVisible()
  await expect(page.getByText('미완료 단계 1개')).toBeVisible()
  await expect(page.getByText('비어 있는 결과 1개')).toBeVisible()
  await page.getByRole('button', { name: '나중에 입력하고 완료' }).click()
  await expect(page.locator('.badge', { hasText: '완료' })).toBeVisible()
})
