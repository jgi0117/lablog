import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { seedDemo } from './helpers'

// axe는 브라우저와 상관없이 같은 규칙을 검사하므로 Chromium에서만 돌린다.
test.skip(({ browserName }) => browserName !== 'chromium', '접근성 규칙 검사는 Chromium에서만')

const PAGES: [string, string][] = [
  ['/', '홈'],
  ['/projects', '프로젝트 목록'],
  ['/projects/demo-project-1', '프로젝트 현황'],
  ['/projects/demo-project-1/data', '프로젝트 데이터'],
  ['/projects/demo-project-1/analysis', '프로젝트 분석'],
  ['/experiments', '실험 목록'],
  ['/experiments/new?project=demo-project-1', '새 실험'],
  ['/search?q=' + encodeURIComponent('헤이즈'), '검색 결과'],
  ['/search?q=' + encodeURIComponent('하드코딩'), '검색 결과 없음'],
  ['/experiments/demo-hc10', '실험 개요'],
  ['/experiments/demo-hc10/steps', '절차'],
  ['/experiments/demo-hc10/data', '조건·결과'],
  ['/experiments/demo-hc10/run', '수행 모드'],
  ['/settings', '설정'],
  ['/trash', '휴지통'],
]

async function scan(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((v) => `${v.id}(${v.impact}) ${v.help} — ${v.nodes.length}곳: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)
}

test('모든 화면에서 WCAG AA 자동 검사(axe)에 걸리는 위반이 없다', async ({ page }) => {
  await seedDemo(page)
  const found: string[] = []
  for (const [path, label] of PAGES) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h1, h2').first()).toBeVisible()
    for (const v of await scan(page)) found.push(`[${label}] ${v}`)
  }
  expect(found, found.join('\n')).toEqual([])
})

test('열려 있는 대화상자와 가져오기 미리보기에서도 위반이 없다', async ({ page }) => {
  await seedDemo(page)
  await page.goto('/settings')
  const sample = JSON.stringify({ schemaVersion: 1, exportedAt: '2026-10-01T00:00:00.000Z', projects: [], experiments: [], steps: [], dataItems: [] })
  await page.getByLabel('백업 파일 가져오기').setInputFiles({ name: 'a.json', mimeType: 'application/json', buffer: Buffer.from(sample) })
  const preview = page.getByRole('region', { name: '가져올 내용 미리보기' })
  await expect(preview).toBeVisible()
  await preview.getByRole('radio', { name: /바꾸기/ }).check()
  await preview.getByRole('button', { name: '가져오기' }).click()
  await expect(page.getByRole('dialog', { name: '현재 데이터를 바꿀까요?' })).toBeVisible()
  expect(await scan(page)).toEqual([])
})
