import { defineConfig } from '@playwright/test'
import { withOpenHarmony } from 'ohos-playwright/config'

export default defineConfig(withOpenHarmony({
  testDir: import.meta.dirname,
  fullyParallel: false,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
}))
