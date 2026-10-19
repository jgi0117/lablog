import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { importBackup, seedDemo } from './helpers'

// Journey 3: 선배의 실험을 복제해서 따라 하고, 달라진 점을 남기고, 잘 된 것은 템플릿으로 저장한다.

test('Journey 3: 복제 → 수행하며 달라진 점 기록 → 템플릿 저장 → 템플릿으로 새 실험', async ({ page }) => {
  await seedDemo(page)

  // 완료된 실험(배합 #47)을 연다. 압축강도 값이 있는 실험이다.
  await page.goto('/experiments/concrete-47/data')
  await expect(page.getByLabel('압축강도 값')).toHaveValue('15.05')

  // 1. 복제: 클릭 한 번. 새 실험이 열리고 결과 값은 비어 있다고 알려 준다.
  await page.goto('/experiments/concrete-47')
  await page.getByRole('button', { name: '복제하여 새 실험' }).click()
  await expect(page.getByText(/결과 값과 체크·메모는 비워졌습니다/)).toBeVisible()
  await expect(page.getByRole('heading', { name: /\(복제\)$/ })).toBeVisible()
  await page.getByRole('link', { name: '조건·결과' }).click()
  await expect(page.getByLabel('시멘트 값')).toHaveValue('349') // 조건 값은 그대로
  await expect(page.getByLabel('압축강도 값')).toHaveValue('') // 결과 값은 비어 있다

  // 2. 수행 모드에서 달라진 점을 기록한다.
  await page.getByRole('link', { name: /수행 모드 시작/ }).click()
  await page.getByRole('button', { name: '+ 달라진 점 기록' }).click()
  await expect(page.getByLabel('달라진 내용')).toBeFocused()
  await page.getByLabel('달라진 내용').fill('건조 온도를 70°C로 낮춤')
  await page.getByLabel('사유 (선택)').fill('기재 변형 방지')
  await page.getByRole('button', { name: '기록', exact: true }).click()
  await expect(page.getByLabel('기록한 달라진 점')).toContainText('건조 온도를 70°C로 낮춤')

  // 3. 달라진 점 탭에서 확인
  await page.getByRole('link', { name: '← 나가기' }).click()
  await page.getByRole('link', { name: /^달라진 점 \(1\)/ }).click()
  await expect(page.getByRole('list', { name: '달라진 점 기록' })).toContainText('기재 변형 방지')

  // 4. 템플릿으로 저장
  await page.getByRole('link', { name: '개요' }).click()
  await page.getByRole('button', { name: '템플릿으로 저장' }).click()
  await page.getByLabel('템플릿 이름').fill('콘크리트 표준 배합')
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await page.getByRole('button', { name: '템플릿 보기' }).click()
  await expect(page.getByRole('heading', { name: '콘크리트 표준 배합' })).toBeVisible()

  // 5. 템플릿으로 새 실험을 시작한다
  await page.getByRole('link', { name: '이 템플릿으로 새 실험' }).click()
  await page.getByLabel('제목 (필수)').fill('배합 템플릿 첫 실험')
  await expect(page.getByLabel('템플릿에서 시작')).not.toHaveValue('')
  await page.getByRole('button', { name: /만들고 절차 입력하기/ }).click()
  await expect(page.getByRole('heading', { name: '배합 템플릿 첫 실험' })).toBeVisible()
  await expect(page.getByLabel('1번째 단계', { exact: true })).not.toHaveValue('')
})

test('백업에 템플릿과 달라진 점이 들어가고, 다른 브라우저에서 복원된다', async ({ page, browser, baseURL }) => {
  await seedDemo(page)
  await page.goto('/experiments/concrete-47/deviations')
  await page.getByLabel('달라진 내용').fill('농도를 5% 낮춤')
  await page.getByRole('button', { name: '기록', exact: true }).click()
  await expect(page.getByRole('list', { name: '달라진 점 기록' })).toContainText('농도를 5% 낮춤')
  await page.goto('/experiments/concrete-47')
  await page.getByRole('button', { name: '템플릿으로 저장' }).click()
  await page.getByLabel('템플릿 이름').fill('복원 확인용')
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByText(/템플릿 "복원 확인용"을 저장했습니다/)).toBeVisible()

  await page.goto('/settings')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '백업 파일로 내보내기' }).click()])
  const text = await readFile(await download.path(), 'utf-8')
  const file = JSON.parse(text)
  expect(file.schemaVersion).toBe(2)
  expect(file.templates).toHaveLength(1)
  expect(file.deviations).toHaveLength(1)

  const context = await browser.newContext({ baseURL: baseURL!, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
  try {
    const other = await context.newPage()
    await importBackup(other, text)
    await other.goto('/templates')
    await expect(other.getByRole('heading', { name: '복원 확인용' })).toBeVisible()
    await other.goto('/experiments/concrete-47/deviations')
    await expect(other.getByRole('list', { name: '달라진 점 기록' })).toContainText('농도를 5% 낮춤')
  } finally {
    await context.close()
  }
})
