import { expect, test } from '@playwright/test'
import { openProject, seedDemo } from './helpers'

test('Journey 4: 빠진 것을 찾아 채우면 목록에서 사라진다', async ({ page }) => {
  await seedDemo(page)
  await openProject(page, '하드코팅 필름 HC-300')

  const gaps = page.getByRole('region', { name: /빠진 것 한눈에/ })
  await expect(gaps.getByText('빈 결과')).toBeVisible()
  await expect(gaps.getByText('이상치 후보')).toBeVisible()
  await expect(gaps.getByText('멈춘 실험')).toBeVisible()
  await expect(gaps.getByText('빠진 항목')).toHaveCount(2)
  await expect(page.getByRole('link', { name: /^현황 · 확인 5/ })).toBeVisible()

  // 빈 결과(밀착성)로 가서 채운다
  await gaps.getByRole('link', { name: /#8$/ }).first().click()
  await page.getByRole('link', { name: '조건·결과' }).click()
  await page.getByLabel('밀착성 값').fill('100')
  // 화면을 옮기면 입력 중이던 값이 저장된다. 같은 앱 안에서 프로젝트로 돌아간다.
  await openProject(page, '하드코팅 필름 HC-300')
  await expect(page.getByRole('link', { name: /^현황 · 확인 4/ })).toBeVisible()
  await expect(page.getByRole('region', { name: /빠진 것 한눈에/ }).getByText('빈 결과')).toHaveCount(0)
})

test('프로젝트 데이터 표를 CSV로 내려받는다', async ({ page }) => {
  await seedDemo(page)
  await page.goto('/projects/demo-project-1/data')
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('row')).toHaveCount(12) // 머리글 2줄 + 실험 10건
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV로 내보내기' }).click()])
  expect(download.suggestedFilename()).toBe('하드코팅 필름 HC-300-데이터.csv')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(c as Buffer)
  const text = Buffer.concat(chunks).toString('utf-8')
  expect(text.charCodeAt(0)).toBe(0xfeff) // 엑셀에서 한글이 깨지지 않도록 BOM
  expect(text).toContain('건조 온도 (°C)')
  expect(text).toContain('HC-300 하드코팅 조건 탐색 #8')
})

test('분석: 축을 바꿔 보고, 이상치 점을 눌러 그 실험으로 간다', async ({ page }) => {
  await seedDemo(page)
  await page.goto('/projects/demo-project-1/analysis')
  await expect(page.getByRole('group', { name: /상관계수/ })).toBeVisible()
  await page.getByLabel('세로축 (결과)').selectOption({ label: '헤이즈 (%)' })
  await page.getByLabel('가로축 (조건 또는 결과)').selectOption({ label: '코팅 두께 (µm)' })
  await expect(page.getByRole('group', { name: /코팅 두께 \(µm\)에 따른 헤이즈 \(%\)/ })).toBeVisible()
  // 이상치(#8, 헤이즈 3.9)는 붉게 표시되고 눌러서 실험을 열 수 있다
  const outlier = page.getByRole('link', { name: /#8: 코팅 두께 \(µm\) 7, 헤이즈 \(%\) 3\.9 \(이상치 후보\)/ })
  await expect(outlier).toBeVisible()
  await outlier.click()
  await expect(page.getByRole('heading', { name: /조건 탐색 #8/ })).toBeVisible()
})

test('Journey 3: 프로젝트의 마지막 실험을 이어받아 새 실험을 시작한다', async ({ page }) => {
  await seedDemo(page)
  await page.goto('/projects/demo-project-1')
  await page.getByRole('link', { name: '+ 이 프로젝트에 새 실험' }).click()
  await expect(page.getByText(/마지막 실험\(/)).toBeVisible()
  await expect(page.getByRole('checkbox')).toBeChecked()
  await page.getByLabel('제목 (필수)').fill('HC-300 하드코팅 조건 탐색 #11')
  await page.getByRole('button', { name: /만들고 절차 입력하기/ }).click()
  await expect(page.getByRole('heading', { name: /#11/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /^절차 \(9\)/ })).toBeVisible() // 절차 9단계를 이어받음

  await page.getByRole('link', { name: '조건·결과' }).click()
  await expect(page.getByLabel('코팅 두께 값')).toHaveValue('5') // 조건 값은 그대로
  await expect(page.getByLabel('UV 조사량 값')).toHaveValue('600')

  // 수행 모드에서 이전 실험의 체크는 모두 비어 있다
  await page.getByRole('link', { name: '수행 모드 시작' }).click()
  await expect(page.getByRole('button', { pressed: true })).toHaveCount(0)
})
