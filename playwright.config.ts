import { defineConfig } from '@playwright/test'

const developmentOrigin = 'http://127.0.0.1:5179'
const productionOrigin = 'http://127.0.0.1:4179'
const projects = ['chromium', 'webkit'].flatMap((browserName) => [
  {
    name: `${browserName}-development`,
    use: {
      browserName: browserName as 'chromium' | 'webkit',
      baseURL: developmentOrigin,
      viewport: { width: 390, height: 844 },
    },
  },
  {
    name: `${browserName}-production`,
    use: {
      browserName: browserName as 'chromium' | 'webkit',
      baseURL: productionOrigin,
      viewport: { width: 390, height: 844 },
    },
  },
])

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  reporter: 'list',
  projects,
  webServer: [
    {
      command: 'node tests/fixtures/e2e-runtime.cjs development',
      url: developmentOrigin,
      env: { E2E_VITE_PORT: '5179' },
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
      timeout: 60_000,
    },
    {
      command: 'node tests/fixtures/e2e-runtime.cjs production',
      url: productionOrigin,
      env: { E2E_PRODUCTION_PORT: '4179' },
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
      timeout: 60_000,
    },
  ],
})
