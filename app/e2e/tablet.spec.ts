import { expect, test, type Page } from '@playwright/test'
import { seedDemo } from './helpers'

/** 현장에서 쓸 기기 폭: 태블릿 가로(디자인 기준), 태블릿 세로, 좁은 화면(휴대전화) */
const SIZES = [
  { name: '태블릿 가로 1194', width: 1194, height: 834 },
  { name: '태블릿 세로 810', width: 810, height: 1080 },
  { name: '좁은 화면 390', width: 390, height: 844 },
] as const

const PAGES = [
  '/',
  '/projects',
  '/projects/demo-project-1',
  '/projects/demo-project-1/data',
  '/projects/demo-project-1/analysis',
  '/projects/demo-project-4',
  '/projects/demo-project-4/requirements',
  '/data',
  '/data/analysis',
  '/data/export',
  '/experiments',
  '/search?q=' + encodeURIComponent('압축강도'),
  '/settings',
  '/experiments/concrete-827',
  '/experiments/concrete-827/steps',
  '/experiments/concrete-827/data',
  '/experiments/concrete-827/run',
]

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    test('모든 화면에서 가로로 넘치지 않는다', async ({ page }) => {
      await seedDemo(page)
      for (const path of PAGES) {
        await page.goto(path)
        await page.waitForLoadState('networkidle')
        await expect(page.locator('h1, h2').first()).toBeVisible()
        const over = await horizontalOverflow(page)
        expect(over, `${path} 가 ${over}px 넘칩니다`).toBeLessThanOrEqual(1)
      }
    })

    test('수행 모드의 눌러야 하는 요소는 모두 44px 이상이다 (장갑 낀 손 기준)', async ({ page }) => {
      await seedDemo(page)
      await page.goto('/experiments/concrete-827/run')
      await expect(page.getByRole('button', { name: /^IV\./ })).toBeVisible()
      const small = await page.evaluate(() => {
        const out: string[] = []
        const selectors = ['.step', '.run__foot .btn', '.run__head .btn', '.entry .btn', '.entry select', '.entry input', '.entry textarea']
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach((el) => {
            const r = (el as HTMLElement).getBoundingClientRect()
            if (r.height < 44 && r.width > 0) out.push(`${sel} ${Math.round(r.width)}×${Math.round(r.height)} "${(el.textContent || (el as HTMLInputElement).placeholder || '').trim().slice(0, 12)}"`)
          })
        }
        return out
      })
      expect(small, `44px보다 작은 요소: ${small.join(', ')}`).toEqual([])
    })
  })
}

test.describe('좁은 화면 배치', () => {
  test.use({ viewport: { width: 810, height: 1080 } })

  test('태블릿 세로에서는 메뉴가 아래로 가고 수행 모드의 옆 패널이 단계 아래로 내려간다', async ({ page }) => {
    await seedDemo(page)
    await page.goto('/')
    const rail = await page.locator('.rail').boundingBox()
    expect(rail!.y).toBeGreaterThan(500) // 화면 아래쪽
    await page.goto('/experiments/concrete-827/run')
    const steps = await page.locator('.run__steps').boundingBox()
    const side = await page.locator('.run__side').boundingBox()
    expect(side!.y).toBeGreaterThan(steps!.y + steps!.height - 4) // 한 열로 쌓임
  })
})

test('태블릿 가로에서는 왼쪽 메뉴, 수행 모드는 단계와 옆 패널이 나란히 보인다', async ({ page }) => {
  await page.setViewportSize({ width: 1194, height: 834 })
  await seedDemo(page)
  const rail = await page.locator('.rail').boundingBox()
  expect(rail!.x).toBeLessThan(5)
  expect(rail!.width).toBeLessThan(120)
  await page.goto('/experiments/concrete-827/run')
  const steps = await page.locator('.run__steps').boundingBox()
  const side = await page.locator('.run__side').boundingBox()
  expect(side!.x).toBeGreaterThan(steps!.x + steps!.width - 4)
})
