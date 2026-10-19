import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { seedDemo } from './helpers'

// 모든 실험을 한곳에 모아 보고(표), 통계로 읽고(분석), 파일로 가져간다(내보내기).

test('데이터 허브: 전체를 표로 훑고 정렬·필터·페이지로 끝까지 본다', async ({ page }) => {
  await seedDemo(page)
  await page.getByRole('navigation', { name: '메인 메뉴' }).getByRole('link', { name: '데이터' }).click()
  await expect(page.getByRole('heading', { name: '데이터', exact: true })).toBeVisible()
  await expect(page.locator('.data-hub__stats')).toContainText('실험200건')
  await expect(page.locator('.grid__count')).toContainText('1–50 / 200건')

  // 숫자 열 정렬: 내림차순 맨 위는 일부러 바꿔 둔 값(124.7)이다
  const strength = page.getByRole('button', { name: /압축강도/ })
  await strength.click()
  await strength.click()
  await expect(page.getByRole('columnheader', { name: /압축강도/ })).toHaveAttribute('aria-sort', 'descending')
  await expect(page.getByRole('row').nth(1)).toContainText('배합 #205, 재령 3일')
  await expect(page.getByRole('row').nth(1)).toContainText('124.7')

  // 거르기와 페이지
  await page.getByLabel('프로젝트').selectOption({ label: '하이브리드본드 HB-50' })
  await expect(page.locator('.grid__count')).toContainText('1–49 / 49건')
  await page.getByLabel('프로젝트').selectOption({ label: '모든 프로젝트' })
  await page.getByLabel('한 번에 보기').selectOption({ label: '전체' })
  await expect(page.getByRole('rowheader')).toHaveCount(200)

  // 열 고르기
  await page.getByText(/열 고르기/).click()
  await page.getByRole('button', { name: '결과만' }).click()
  await expect(page.getByRole('button', { name: /시멘트/ }).first()).toBeHidden()
})

test('데이터 허브: 분석 탭은 요약 문장과 영향 주는 조건, 그룹 비교를 보여 준다', async ({ page }) => {
  await seedDemo(page)
  await page.goto('/data/analysis')
  await expect(page.getByRole('heading', { name: '한눈에 읽기' })).toBeVisible()
  await expect(page.locator('.insights')).toContainText('상관이 곧 원인은 아닙니다')
  await expect(page.getByRole('heading', { name: '압축강도에 영향을 주는 조건' })).toBeVisible()
  await expect(page.getByRole('region', { name: '조건별 상관 분석 표' }).getByRole('rowheader', { name: '시멘트' })).toBeVisible()
  await expect(page.getByRole('group', { name: /조건별 r 값/ })).toBeVisible()
  await expect(page.getByRole('group', { name: /별 압축강도 \(MPa\) 평균/ })).toBeVisible()

  // 프로젝트로 좁히면 실험 수가 바뀐다
  await page.getByLabel('분석할 범위').selectOption({ label: '하이브리드본드 HB-50 (49건)' })
  await expect(page.getByText(/실험 46건의 압축강도를 분석합니다/)).toBeVisible()
})

test('데이터 허브: 분석용 CSV와 데이터 사전을 내려받는다', async ({ page }) => {
  await seedDemo(page)
  await page.goto('/data/export')
  await expect(page.getByRole('heading', { name: '내보내기 전에 확인할 것' })).toBeVisible()
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '분석용 CSV 받기' }).click()])
  expect(csv.suggestedFilename()).toMatch(/^lablog-전체-\d{4}-\d{2}-\d{2}-analysis\.csv$/)
  const text = await readFile(await csv.path(), 'utf-8')
  expect(text.charCodeAt(0)).not.toBe(0xfeff)
  const lines = text.split('\r\n')
  expect(lines).toHaveLength(201)
  expect(lines[0]).toContain('시멘트 (kg/m³)')
  expect(lines[0]).toContain('압축강도 (MPa)')

  const [dict] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '데이터 사전 받기' }).click()])
  const dictText = await readFile(await dict.path(), 'utf-8')
  expect(dictText).toContain('압축강도 (MPa)')
  expect(dictText).toContain('표준편차')

  await page.getByRole('button', { name: '예시 코드 보기' }).click()
  await expect(page.locator('.export__code')).toContainText('pd.read_csv("lablog-전체-')
})

test('프로젝트 데이터 표도 끝까지 볼 수 있고 분석 화면에 새 분석이 있다', async ({ page }) => {
  await seedDemo(page)
  await page.goto('/projects/demo-project-2/data')
  await expect(page.locator('.grid__count')).toContainText('1–50 / 51건')
  await page.getByRole('button', { name: '다음' }).click()
  await expect(page.locator('.grid__count')).toContainText('51–51 / 51건')
  await page.goto('/projects/demo-project-2/analysis')
  await expect(page.getByRole('heading', { name: '한눈에 읽기' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '항목 사이의 상관 행렬' })).toBeVisible()
})
