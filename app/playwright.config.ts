import { defineConfig, devices } from '@playwright/test'

const PORT = 5174

/**
 * E2E: 실제 브라우저(Chromium, Firefox, WebKit)에서 사용자 흐름을 처음부터 끝까지 따라간다.
 * 개발 서버를 띄워서 쓴다. 홈의 "데모 데이터 넣기(개발용)" 버튼이 개발 서버에만 있기 때문이다.
 * 테스트마다 새 브라우저 컨텍스트라서 IndexedDB와 localStorage가 비어 있는 상태로 시작한다.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 개발 서버 하나를 세 브라우저가 나눠 쓴다. 너무 많이 동시에 돌리면 측정과 시간 제한이 흔들린다.
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium-laptop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'firefox-laptop',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } },
    },
    // 태블릿: 가로 1194×834(디자인 기준), 터치
    { name: 'webkit-tablet', use: { ...devices['iPad Pro 11 landscape'] } },
  ],
})
