import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { importBackup, seedDemo, skipBulkImportOnWindowsWebKit } from './helpers'

test('Journey 3: 기존 실험 선택 → 복사 범위 확인 → 수행하며 달라진 점 기록', async ({ page }) => {
  await seedDemo(page)
  await page.goto('/experiments/concrete-395')
  await page.getByRole('link', { name: '이 실험에서 새로 시작' }).click()
  await expect(page.getByRole('radio', { name: '기존 실험 직접 선택' })).toBeChecked()
  await expect(page.getByLabel('이어받을 실험')).toHaveValue('concrete-395')
  await expect(page.getByRole('note', { name: '이어받기 미리보기' })).toContainText('결과 값·단계 체크·메모는 비워서 시작합니다.')
  await page.getByLabel('제목 (필수)').fill('배합 #395 후속 실험')
  await page.getByRole('button', { name: '실험 만들기' }).click()
  await page.getByRole('link', { name: '조건·결과' }).click()
  await expect(page.getByLabel('시멘트 값')).toHaveValue('405')
  await expect(page.getByLabel('압축강도 값')).toHaveValue('')

  await page.getByRole('link', { name: /수행 모드 시작/ }).click()
  await expect(page.getByRole('button', { pressed: true })).toHaveCount(0)
  await page.getByRole('button', { name: '+ 달라진 점 기록' }).click()
  await page.getByLabel('달라진 내용').fill('건조 온도를 70°C로 낮춤')
  await page.getByLabel('사유 (선택)').fill('기재 변형 방지')
  await page.getByRole('button', { name: '기록', exact: true }).click()
  await expect(page.getByLabel('기록한 달라진 점')).toContainText('건조 온도를 70°C로 낮춤')
})

test('숨긴 템플릿 데이터와 달라진 점은 백업·복원에서 보존된다', async ({ page, browser, baseURL }, testInfo) => {
  skipBulkImportOnWindowsWebKit(test, testInfo.project.name)
  await seedDemo(page)
  await page.goto('/settings')
  const [seedDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '백업 파일로 내보내기' }).click()])
  const seedFile = JSON.parse(await readFile(await seedDownload.path(), 'utf-8'))
  const at = new Date().toISOString()
  seedFile.templates = [{ id: 'legacy-template', name: '복원 확인용', steps: [{ content: '배합한다' }], defaultConditions: [], resultItems: [], createdAt: at, updatedAt: at, deletedAt: null, version: 1 }]
  await importBackup(page, JSON.stringify(seedFile), 'replace')

  await page.goto('/experiments/concrete-395/deviations')
  await page.getByLabel('달라진 내용').fill('농도를 5% 낮춤')
  await page.getByRole('button', { name: '기록', exact: true }).click()
  await page.goto('/settings')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '백업 파일로 내보내기' }).click()])
  const text = await readFile(await download.path(), 'utf-8')
  const file = JSON.parse(text)
  expect(file.templates).toHaveLength(1)
  expect(file.deviations).toHaveLength(1)

  const context = await browser.newContext({ baseURL: baseURL!, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
  try {
    const other = await context.newPage()
    await importBackup(other, text)
    await other.goto('/templates')
    await expect(other.getByText('템플릿 대신 기존 실험 이어받기를 사용하세요.')).toBeVisible()
    await other.goto('/experiments/concrete-395/deviations')
    await expect(other.getByRole('list', { name: '달라진 점 기록' })).toContainText('농도를 5% 낮춤')
  } finally {
    await context.close()
  }
})
