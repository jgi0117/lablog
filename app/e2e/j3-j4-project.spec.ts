import { expect, test } from '@playwright/test'
import { openProject, seedDemo } from './helpers'

test('Journey 4: 빠진 것을 찾아 채우면 목록에서 사라진다', async ({ page }) => {
  await seedDemo(page)
  await openProject(page, '에코슬래그 ES-30')

  const gaps = page.getByRole('region', { name: /빠진 것 한눈에/ })
  await expect(gaps.getByText('빈 결과')).toBeVisible()
  await expect(gaps.getByText(/비어 있는 결과: 압축강도/)).toBeVisible()
  await expect(page.getByRole('link', { name: /^현황 · 확인 1/ })).toBeVisible()

  // 빈 결과(압축강도)로 가서 채운다
  await gaps.getByRole('link', { name: /#400/ }).first().click()
  await page.getByRole('link', { name: '조건·결과' }).click()
  await page.getByLabel('압축강도 값').fill('39.3')
  // 화면을 옮기면 입력 중이던 값이 저장된다. 같은 앱 안에서 프로젝트로 돌아간다.
  await openProject(page, '에코슬래그 ES-30')
  await expect(page.getByRole('link', { name: /^현황$/ })).toBeVisible()
  await expect(page.getByRole('region', { name: /빠진 것 한눈에/ }).getByText('빈 결과')).toHaveCount(0)
})

test('빠진 항목과 멈춘 실험(HB), 이상치 후보(LF)도 프로젝트 현황에 나온다', async ({ page }) => {
  await seedDemo(page)
  await openProject(page, '하이브리드본드 HB-50')
  const hb = page.getByRole('region', { name: /빠진 것 한눈에/ })
  await expect(hb.getByText('빠진 항목')).toBeVisible()
  await expect(hb.getByText('멈춘 실험')).toBeVisible()
  await expect(page.getByRole('link', { name: /^현황 · 확인 2/ })).toBeVisible()
  await openProject(page, '로히트 플라이 LF-20')
  await expect(page.getByRole('region', { name: /빠진 것 한눈에/ }).getByText('이상치 후보')).toBeVisible()
})

test('프로젝트 데이터 표를 CSV로 내려받는다', async ({ page }) => {
  await seedDemo(page)
  await page.goto('/projects/demo-project-1/data')
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('row')).toHaveCount(51) // 머리글 1줄 + 실험 50건(한 번에 보기 기본 50건)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV로 내보내기' }).click()])
  expect(download.suggestedFilename()).toBe('스탠다드믹스 SM-00-데이터.csv')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(c as Buffer)
  const text = Buffer.concat(chunks).toString('utf-8')
  expect(text.charCodeAt(0)).toBe(0xfeff) // 엑셀에서 한글이 깨지지 않도록 BOM
  expect(text).toContain('시멘트 (kg/m³)')
  expect(text).toContain('배합 #395, 재령 28일')
})

test('분석: 축을 바꿔 보고, 이상치 점을 눌러 그 실험으로 간다', async ({ page }) => {
  await seedDemo(page)
  await page.goto('/projects/demo-project-3/analysis')
  await expect(page.getByRole('group', { name: /상관계수/ })).toBeVisible()
  await page.getByLabel('세로축 (결과)').selectOption({ label: '압축강도 (MPa)' })
  await page.getByLabel('가로축 (조건 또는 결과)').selectOption({ label: '재령 (일)' })
  await expect(page.getByRole('group', { name: /재령 \(일\)에 따른 압축강도 \(MPa\)/ })).toBeVisible()
  // 이상치(#205, 압축강도 124.7)는 붉게 표시되고 눌러서 실험을 열 수 있다
  const outlier = page.getByRole('link', { name: /#205, 재령 3일: 재령 \(일\) 3, 압축강도 \(MPa\) 124\.7 \(이상치 후보\)/ })
  await expect(outlier).toBeVisible()
  await outlier.click()
  await expect(page.getByRole('heading', { name: /배합 #205, 재령 3일/ })).toBeVisible()
  await expect(page.getByText(/시연용으로 바꾼 값/)).toBeVisible() // 바꾼 값은 표시되어 있다
})

test('Journey 3: 프로젝트의 마지막 실험을 이어받아 새 실험을 시작한다', async ({ page }) => {
  await seedDemo(page)
  await page.goto('/projects/demo-project-1')
  await page.getByRole('link', { name: '+ 이 프로젝트에 새 실험' }).click()
  await expect(page.getByText(/마지막 실험\(/)).toBeVisible()
  await expect(page.getByRole('checkbox')).toBeChecked()
  await page.getByLabel('제목 (필수)').fill('배합 #1000, 재령 28일')
  await page.getByRole('button', { name: /만들고 절차 입력하기/ }).click()
  await expect(page.getByRole('heading', { name: /#1000/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /^절차 \(4\)/ })).toBeVisible() // 절차 4단계를 이어받음

  await page.getByRole('link', { name: '조건·결과' }).click()
  await expect(page.getByLabel('시멘트 값')).toHaveValue('480') // 조건 값은 그대로 (이어받은 배합 #827)
  await expect(page.getByLabel('물 값')).toHaveValue('192')

  // 수행 모드에서 이전 실험의 체크는 모두 비어 있다
  await page.getByRole('link', { name: '수행 모드 시작' }).click()
  await expect(page.getByRole('button', { pressed: true })).toHaveCount(0)
})
