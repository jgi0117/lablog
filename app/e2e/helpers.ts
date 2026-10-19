import { expect, type Page } from '@playwright/test'

/** 예시 데이터(UCI 콘크리트 공개 데이터 기반: 프로젝트 4개, 실험 48건, 놓친 것 4건)를 넣는다. 빈 홈 화면의 버튼을 그대로 누른다. */
export async function seedDemo(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /예시 데이터 넣기/ }).click()
  // 예시 48건을 넣는 데 WebKit(Windows)에서는 10초를 넘길 수 있어 넉넉히 기다린다. 이 시간은 성능 기준이 아니다.
  await expect(page.getByRole('heading', { name: '놓친 것 (4)' })).toBeVisible({ timeout: 60_000 })
}

/** 새 실험을 만들고 절차를 붙여넣어 절차 탭까지 간다. */
export async function createExperiment(page: Page, title: string, steps: string[], tags = '') {
  await page.goto('/experiments/new')
  await page.getByLabel('제목 (필수)').fill(title)
  if (tags) await page.getByLabel('태그').fill(tags)
  await page.getByRole('button', { name: /만들고 절차 입력하기/ }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  if (steps.length) {
    await page.getByText('여러 단계 붙여넣기').click()
    await page.getByLabel('붙여넣을 절차').fill(steps.map((s, i) => `${i + 1}. ${s}`).join('\n'))
    await page.getByRole('button', { name: `${steps.length}개 단계 추가` }).click()
    await expect(page.getByLabel(`${steps.length}번째 단계`, { exact: true })).toHaveValue(
      steps[steps.length - 1],
    )
  }
}

/** 큰 데이터(실험 n건, 실험마다 단계 steps개)의 백업 파일 내용. 설정의 가져오기로 넣는다. */
export function bulkBackupJson(n: number, steps = 8): string {
  const at = new Date().toISOString()
  const base = { createdAt: at, updatedAt: at, deletedAt: null, version: 1 }
  const experiments = []
  const stepRows = []
  for (let i = 0; i < n; i++) {
    const id = `bulk-${i}`
    experiments.push({
      ...base,
      id,
      projectId: null,
      title: `대량 실험 ${String(i + 1).padStart(4, '0')}`,
      purpose: '',
      owner: '',
      tags: [],
      status: 'done',
      startedAt: at,
      completedAt: at,
      sourceExperimentId: null,
    })
    for (let k = 0; k < steps; k++) {
      stepRows.push({
        ...base,
        id: `${id}-s${k}`,
        experimentId: id,
        order: k + 1,
        content: `단계 ${k + 1} 시약 ${i}`,
        done: true,
        doneAt: at,
        note: k === 3 ? `메모 ${i}` : '',
      })
    }
  }
  return JSON.stringify({
    schemaVersion: 1,
    exportedAt: at,
    projects: [],
    experiments,
    steps: stepRows,
    dataItems: [],
  })
}

/** 설정 화면에서 백업 파일을 가져온다(합치기). */
export async function importBackup(page: Page, json: string, mode: 'merge' | 'replace' = 'merge') {
  await page.goto('/settings')
  await page
    .getByLabel('백업 파일 가져오기')
    .setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(json) })
  const preview = page.getByRole('region', { name: '가져올 내용 미리보기' })
  await expect(preview).toBeVisible()
  if (mode === 'replace') await preview.getByRole('radio', { name: /바꾸기/ }).check()
  await preview.getByRole('button', { name: '가져오기' }).click()
  if (mode === 'replace')
    await page.getByRole('dialog').getByRole('button', { name: '백업하고 바꾸기' }).click()
  // 큰 백업(500건)은 WebKit에서 10초를 넘길 수 있어 넉넉히 기다린다. 이 시간은 성능 기준이 아니다.
  await expect(page.getByText(/가져오기를 마쳤습니다/)).toBeVisible({ timeout: 60_000 })
}

/** 키보드로만 이동: Tab을 눌러 이름이 맞는 요소에 포커스가 갈 때까지. 못 찾으면 실패한다. */
export async function tabTo(page: Page, name: RegExp | string, max = 80) {
  const matches = (label: string) =>
    typeof name === 'string' ? label.includes(name) : name.test(label)
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    const label = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el) return ''
      return (
        el.getAttribute('aria-label') ||
        (el as HTMLInputElement).labels?.[0]?.textContent ||
        el.textContent ||
        ''
      )
    })
    if (matches(label.trim())) return
  }
  throw new Error(`키보드 Tab ${max}번 안에 "${name}"에 닿지 못했습니다`)
}

/** 왼쪽 메뉴로 프로젝트 목록에 가서 이름이 맞는 프로젝트를 연다. */
export async function openProject(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: '메인 메뉴' })
    .getByRole('link', { name: '프로젝트' })
    .click()
  await expect(page.getByRole('heading', { name: '프로젝트', exact: true })).toBeVisible()
  await page.locator('a.project-card', { hasText: name }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
}
