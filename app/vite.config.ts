import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // npm 스크립트로 실행하면 package.json의 version이 들어온다.
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev') },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
