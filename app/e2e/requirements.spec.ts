import { expect, test } from '@playwright/test'
import { seedDemo } from './helpers'

// 신제품 개발: 고객이 요청한 특성을 프로젝트에 적어 두고, 실험마다 달성 여부를 본다.

test('Journey 6: 고객 요구 입력 → 새 실험에 항목이 미리 만들어짐 → 값을 넣으면 달성 판정', async ({ page }) => {
  // 1. 프로젝트 만들기(고객과 함께)
  await page.goto('/projects')
  await page.getByRole('button', { name: '+ 프로젝트 만들기' }).first().click()
  await page.getByLabel('프로젝트 이름').fill('컬러 필름 CF-10')
  await page.getByLabel('고객 또는 요청 부서 (선택)').fill('한빛디스플레이')
  await page.getByRole('button', { name: '만들기', exact: true }).click()
  await expect(page.getByRole('heading', { name: '컬러 필름 CF-10' })).toBeVisible()

  // 2. 아직 요구가 없으니 입력으로 안내한다 → 요구 입력(헤이즈 1% 이하)
  await page.getByRole('link', { name: '+ 고객 요구 특성 입력하기' }).click()
  await page.getByRole('button', { name: '+ 요구 특성 추가' }).click()
  await page.getByLabel('요구 1 · 항목 이름').fill('헤이즈')
  await page.getByLabel('조건', { exact: true }).selectOption('max')
  await page.getByLabel('이하').fill('1')
  await page.getByLabel('단위').fill('%')
  await expect(page.getByRole('region', { name: '고객 요구별 달성 표' }).getByRole('rowheader', { name: '헤이즈 ≤ 1 %' })).toBeVisible()
  // 자동 저장이 끝나 저장소에 들어갔는지 확인한다(저장 표시는 잠깐만 보여서 저장소를 직접 읽는다)
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const open = indexedDB.open('lablog')
              open.onsuccess = () => {
                const all = open.result.transaction('projects').objectStore('projects').getAll()
                all.onsuccess = () => resolve((all.result as { requirements?: unknown[] }[]).reduce((n, p) => n + (p.requirements?.length ?? 0), 0))
              }
            }),
        ),
      { timeout: 10_000 },
    )
    .toBe(1)

  // 3. 새 실험: 제목은 비워 두면 제안대로, 요구 항목(헤이즈)이 빈칸으로 미리 만들어진다
  await page.getByRole('link', { name: '+ 이 프로젝트에 새 실험' }).click()
  await expect(page.getByLabel('제목 (필수)')).toHaveAttribute('placeholder', /컬러 필름 CF-10 #1/)
  await expect(page.getByRole('note')).toContainText('고객 요구 1개(헤이즈)')
  await page.getByRole('button', { name: '실험 만들기' }).click()
  await expect(page.getByRole('heading', { name: '컬러 필름 CF-10 #1' })).toBeVisible()

  // 4. 조건·결과 탭: 헤이즈 칸이 있고, 값을 넣으면 곧바로 요구 만족으로 바뀐다
  await page.getByRole('link', { name: '조건·결과' }).click()
  const haze = page.getByLabel('헤이즈 값')
  await expect(haze).toBeVisible()
  await expect(page.getByRole('region', { name: '고객 요구 판정' })).toContainText('· 값 없음')
  await haze.fill('1.4')
  await expect(page.getByText(/✗ 요구 미달/)).toBeVisible({ timeout: 10_000 })
  await haze.fill('0.8')
  await expect(page.getByText(/✓ 요구 만족/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('region', { name: '고객 요구 판정' })).toContainText('모두 만족')

  // 5. 프로젝트 현황과 홈에 달성이 반영된다
  await page.getByRole('link', { name: '실험 개요' }).or(page.getByRole('link', { name: '개요' })).first().click()
  await page.goto('/projects')
  await page.getByRole('link', { name: /컬러 필름 CF-10/ }).click()
  await expect(page.getByText(/필수 요구를 모두 만족한 배합이 1개 있습니다/)).toBeVisible()
  await page.getByRole('navigation', { name: '메인 메뉴' }).getByRole('link', { name: '홈' }).click()
  const card = page.locator('.project-summary .project-card', { hasText: '컬러 필름 CF-10' })
  await expect(card).toContainText('요구 달성')
  await expect(card).toContainText('필수 요구 1/1')
})

test('예시 데이터: 홈에서 프로젝트마다 요구 달성 상태가 보이고, 표에서 요구를 만족한 실험만 거를 수 있다', async ({ page }) => {
  await seedDemo(page)
  await expect(page.getByRole('heading', { name: '프로젝트 현황 (4)' })).toBeVisible()
  const cards = page.locator('.project-summary .project-card')
  await expect(cards).toHaveCount(4)
  const hb = cards.filter({ hasText: '하이브리드본드 HB-50' })
  await expect(hb).toContainText('진행 중') // 80 MPa 요구는 아직 못 미친다
  await expect(hb).toContainText('가장 가까운 배합에서')

  await page.goto('/projects/demo-project-2/data')
  await expect(page.locator('.grid__count')).toContainText('/ 51건')
  await page.getByLabel('고객 요구').selectOption({ label: '필수 요구를 모두 만족한 것' })
  const met = await page.locator('.grid__count').innerText()
  expect(met).toMatch(/전체 51건 중/)
  await expect(page.locator('td.cell--pass').first()).toBeVisible()

  // 프로젝트 분석: 달성한 실험과 못 미친 실험의 조건 차이
  await page.goto('/projects/demo-project-2/analysis')
  await expect(page.locator('.insights')).toContainText('다음 실험은 이 범위에서 시작해 보세요')
})

test('수행 모드에서도 고객 요구가 곁에 보인다', async ({ page }) => {
  await seedDemo(page)
  await page.goto('/experiments/concrete-827/run')
  await expect(page.getByRole('region', { name: '고객 요구 판정' })).toBeVisible()
})
