import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages처럼 하위 경로에 올릴 때는 빌드 때 VITE_BASE=/lablog/ 로 지정한다.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  // npm 스크립트로 실행하면 package.json의 version이 들어온다.
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev') },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // 예시 데이터(200건)를 넣고 지우는 시험이 파일이 많이 동시에 돌 때 느려질 수 있어 여유를 둔다.
    testTimeout: 20000,
    // 시험은 숫자가 고정된 200건 구성을 쓴다(실제 앱의 기본은 전체 1,030건).
    env: { VITE_EXAMPLE_SET: 'curated' },
  },
})
