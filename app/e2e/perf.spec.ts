import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { buildConcreteBackup, parseConcreteCsv } from '../src/data/concreteDemo'
import { bulkBackupJson, createExperiment, importBackup } from './helpers'

// 성능은 브라우저마다 달라서 세 브라우저 모두에서 같은 기준으로 잰다. 기준은 넉넉하게 두고 실제 값을 기록한다.

test('실험 500건·단계 4,000개에서 홈과 목록 검색이 2초 안에 뜬다', async ({ page }, testInfo) => {
  // Playwright의 Windows용 WebKit은 IndexedDB 쓰기가 매우 느려(훅 없는 bulkPut도 실험 100건에 14초) 대량 가져오기가 끝나지 않는다.
  // 앱의 문제가 아니라 시험 환경의 한계라서, 이 측정은 Chromium·Firefox와 CI(Linux)에서 하고 WebKit은 실제 기기 확인으로 넘긴다.
  test.skip(
    testInfo.project.name.startsWith('webkit') && process.platform === 'win32',
    'Windows WebKit의 IndexedDB 쓰기 속도 한계',
  )
  test.setTimeout(120_000)
  await importBackup(page, bulkBackupJson(500, 8))
  const numbers: Record<string, number> = {}

  // 홈: 데이터를 읽어 카드가 뜰 때까지
  let t = Date.now()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '오늘의 실험' })).toBeVisible()
  await expect(page.getByText('전체 실험 500건')).toBeVisible()
  numbers['홈 열기(ms)'] = Date.now() - t
  expect(numbers['홈 열기(ms)']).toBeLessThan(2000)

  // 실험 목록
  t = Date.now()
  await page.goto('/experiments')
  await expect(page.getByText('1–12 / 500')).toBeVisible()
  numbers['실험 목록(ms)'] = Date.now() - t
  expect(numbers['실험 목록(ms)']).toBeLessThan(2000)

  // 목록의 제목·목적 검색
  t = Date.now()
  await page.goto('/experiments?q=' + encodeURIComponent('대량 실험 0250'))
  await expect(page.getByRole('link', { name: /대량 실험 0250/ })).toBeVisible()
  numbers['검색 처음 열기(ms)'] = Date.now() - t
  expect(numbers['검색 처음 열기(ms)']).toBeLessThan(2000)

  const box = page.getByRole('searchbox', { name: '실험 검색' })
  await box.fill('대량 실험 0251')
  t = Date.now()
  await expect(page.getByRole('link', { name: /대량 실험 0251/ })).toBeVisible()
  numbers['검색 이후(ms)'] = Date.now() - t
  expect(numbers['검색 이후(ms)']).toBeLessThan(2000)

  console.log(`[성능 ${testInfo.project.name}] ${JSON.stringify(numbers)}`)
})

test('단계를 체크하면 곧바로 반응한다 (수행 모드)', async ({ page }, testInfo) => {
  await createExperiment(page, '반응 속도 확인', ['가', '나', '다', '라', '마'])
  await page.getByRole('link', { name: '수행 모드 시작 ▶' }).click()
  const times: number[] = []
  for (const [i, name] of ['I. 가', 'II. 나', 'III. 다', 'IV. 라', 'V. 마'].entries()) {
    const step = page.getByRole('button', { name })
    const t = Date.now()
    await step.click()
    await expect(step).toHaveAttribute('aria-pressed', 'true')
    times.push(Date.now() - t)
    void i
  }
  const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]
  console.log(
    `[체크 반응 ${testInfo.project.name}] 클릭부터 표시까지(자동화 오버헤드 포함) ${JSON.stringify(times)} 중앙값 ${median}ms`,
  )
  expect(median).toBeLessThan(500)
})

test('공개 데이터 전체 1,030건에서 홈, 프로젝트 표, 분석이 5초 안에 뜬다', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('webkit') && process.platform === 'win32', 'Windows WebKit의 IndexedDB 쓰기 속도 한계')
  test.setTimeout(180_000)
  // 공개 데이터 전체를 백업 파일로 만들어 설정의 가져오기로 넣는다(화면에 성능 시험용 버튼을 두지 않는다).
  const rows = parseConcreteCsv(readFileSync('src/data/concrete/concrete.csv', 'utf-8'))
  await importBackup(page, JSON.stringify(buildConcreteBackup(rows, 'full')))
  const numbers: Record<string, number> = {}
  // 다른 시험과 함께 돌면 느려질 수 있어 기준은 넉넉히 5초로 둔다(혼자 돌리면 Chromium 0.7~1.4초, Firefox 0.5~1.3초).
  const timed = async (name: string, path: string, limit: number, ready: () => Promise<void>) => {
    const t = Date.now()
    await page.goto(path)
    await ready()
    numbers[name + '(ms)'] = Date.now() - t
    expect(numbers[name + '(ms)'], name).toBeLessThan(limit)
  }
  await timed('홈', '/', 5000, () => expect(page.getByText('전체 실험 1030건')).toBeVisible())
  await timed('ES 프로젝트 데이터 표(334건)', '/projects/demo-project-2/data', 5000, () => expect(page.getByRole('table')).toBeVisible())
  await timed('ES 프로젝트 분석', '/projects/demo-project-2/analysis', 5000, () => expect(page.getByRole('group', { name: /상관계수/ })).toBeVisible())
  console.log(`[성능(1,030건) ${testInfo.project.name}] ${JSON.stringify(numbers)}`)
})
