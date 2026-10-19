import { readFile } from 'node:fs/promises'
import { expect, test, type Browser, type Download } from '@playwright/test'
import { createExperiment, importBackup, seedDemo } from './helpers'

async function readDownload(d: Download): Promise<string> {
  const path = await d.path()
  return readFile(path, 'utf-8')
}

/** 저장 공간이 비어 있는 새 브라우저(다른 기기를 흉내). */
async function freshDevice(browser: Browser, baseURL: string) {
  const context = await browser.newContext({ baseURL, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
  return { context, page: await context.newPage() }
}

test('백업 파일을 다른 브라우저에서 가져오면 그대로 복원된다', async ({ page, browser, baseURL }) => {
  await seedDemo(page)
  await page.goto('/settings')
  await expect(page.getByText('아직 없음')).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '백업 파일로 내보내기' }).click()])
  expect(download.suggestedFilename()).toMatch(/^lablog-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/)
  const text = await readDownload(download)
  const original = JSON.parse(text)
  expect(original.experiments).toHaveLength(17)
  await expect(page.getByText(/백업 파일을 저장했습니다 \(실험 17건\)/)).toBeVisible()
  await expect(page.getByText('아직 없음')).toHaveCount(0) // 마지막 백업 시각이 남는다

  const other = await freshDevice(browser, baseURL!)
  try {
    await other.page.goto('/')
    await expect(other.page.getByText('첫 실험을 만들어 보세요')).toBeVisible()
    await importBackup(other.page, text)
    await other.page.goto('/')
    await expect(other.page.getByRole('heading', { name: '놓친 것 (5)' })).toBeVisible()
    await other.page.goto('/projects')
    await expect(other.page.locator('a.project-card')).toHaveCount(3)
    // 가져온 데이터로 다시 내보낸 내용이 원본과 같다
    await other.page.goto('/settings')
    const [again] = await Promise.all([other.page.waitForEvent('download'), other.page.getByRole('button', { name: '백업 파일로 내보내기' }).click()])
    const copy = JSON.parse(await readDownload(again))
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort()
    expect(ids(copy.experiments)).toEqual(ids(original.experiments))
    expect(ids(copy.steps)).toEqual(ids(original.steps))
    expect(ids(copy.dataItems)).toEqual(ids(original.dataItems))
  } finally {
    await other.context.close()
  }
})

test('이상한 파일은 이유를 알려 주고 아무것도 바꾸지 않는다', async ({ page }) => {
  await createExperiment(page, '지켜야 할 실험', ['단계'])
  await page.goto('/settings')
  const input = page.getByLabel('백업 파일 가져오기')
  await input.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{ 깨진 json') })
  await expect(page.getByRole('alert')).toContainText('파일을 읽을 수 없습니다')
  const wrong = JSON.stringify({ schemaVersion: 1, projects: [], experiments: [{ id: 'x', title: '상태 없음', updatedAt: '2026-10-01T00:00:00.000Z' }], steps: [], dataItems: [] })
  await input.setInputFiles({ name: 'wrong.json', mimeType: 'application/json', buffer: Buffer.from(wrong) })
  await expect(page.getByRole('alert')).toContainText('상태가 올바르지 않습니다')
  await page.goto('/experiments')
  await expect(page.locator('.card')).toHaveCount(1)
})

test('바꾸기는 먼저 현재 데이터를 백업 파일로 저장한 뒤 바꾼다', async ({ page, browser, baseURL }) => {
  // 다른 기기에서 만든 백업 파일
  const other = await freshDevice(browser, baseURL!)
  let demoBackup = ''
  try {
    await seedDemo(other.page)
    await other.page.goto('/settings')
    const [d] = await Promise.all([other.page.waitForEvent('download'), other.page.getByRole('button', { name: '백업 파일로 내보내기' }).click()])
    demoBackup = await readDownload(d)
  } finally {
    await other.context.close()
  }

  await createExperiment(page, '지금 있던 실험', ['단계'])
  await page.goto('/settings')
  await page.getByLabel('백업 파일 가져오기').setInputFiles({ name: 'demo.json', mimeType: 'application/json', buffer: Buffer.from(demoBackup) })
  const preview = page.getByRole('region', { name: '가져올 내용 미리보기' })
  await preview.getByRole('radio', { name: /바꾸기/ }).check()
  await preview.getByRole('button', { name: '가져오기' }).click()
  const dialog = page.getByRole('dialog', { name: '현재 데이터를 바꿀까요?' })
  await dialog.getByRole('button', { name: '취소' }).click()
  await expect(dialog).toHaveCount(0)

  await preview.getByRole('button', { name: '가져오기' }).click()
  const [auto] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: '백업하고 바꾸기' }).click()])
  const before = JSON.parse(await readDownload(auto))
  expect(before.experiments.map((e: { title: string }) => e.title)).toEqual(['지금 있던 실험']) // 바꾸기 전 자동 백업
  await expect(page.getByText(/가져오기를 마쳤습니다 \(바꾸기/)).toBeVisible()
  await page.goto('/experiments')
  await expect(page.getByText('지금 있던 실험')).toHaveCount(0)
  await expect(page.getByText('1–12 / 17')).toBeVisible()
})

test('새로고침과 브라우저 재시작 뒤에도 입력한 내용이 남는다', async ({ page, browser, baseURL }) => {
  await createExperiment(page, '지속성 확인', ['첫 단계', '둘째 단계'])
  await page.getByRole('link', { name: '수행 모드 시작 ▶' }).click()
  await page.getByRole('button', { name: '완료하고 다음 단계' }).click()
  await expect(page.getByText(/1 \/ 2 단계 · 50%/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(/1 \/ 2 단계 · 50%/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'I. 첫 단계' })).toHaveAttribute('aria-pressed', 'true')
  void browser
  void baseURL
})

test('두 탭에서 같은 항목을 고치면 충돌을 알리고 덮어쓰기를 고를 수 있다 (E6, E9)', async ({ page, context }) => {
  await seedDemo(page)
  const tabB = await context.newPage()
  await page.goto('/experiments/demo-hc10')
  await tabB.goto('/experiments/demo-hc10')
  const titleA = page.getByLabel('제목', { exact: true })
  const titleB = tabB.getByLabel('제목', { exact: true })
  await expect(titleA).toHaveValue('HC-300 하드코팅 조건 탐색 #10')

  // B가 먼저 고친다
  await titleB.fill('탭 B에서 바꾼 제목')
  await expect(tabB.getByText(/저장됨/).first()).toBeVisible()
  // A에 "다른 탭에서 바뀌었다"는 알림이 뜬다 (실제 BroadcastChannel)
  await expect(page.getByText('다른 탭에서 데이터가 바뀌었습니다.')).toBeVisible()

  // A가 이전 내용을 기준으로 고치면 충돌
  await titleA.fill('탭 A에서 바꾼 제목')
  await expect(page.getByText('다른 탭에서 이 항목을 먼저 수정했습니다.')).toBeVisible()
  await page.getByRole('button', { name: '내 내용으로 덮어쓰기' }).click()
  await expect(page.getByText('다른 탭에서 이 항목을 먼저 수정했습니다.')).toHaveCount(0)

  // 새로 불러 보면 A의 내용이 남아 있다
  await page.reload()
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue('탭 A에서 바꾼 제목')
})
