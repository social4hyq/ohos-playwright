// Tests upstream Playwright specs against the ohos-playwright adapter.
// We replicate what withOpenHarmony() does but resolve globalSetup/globalTeardown
// as absolute paths (avoiding `require('ohos-playwright/setup')` which fails
// when running from inside the package itself without a self-link in node_modules).

import { defineConfig } from '@playwright/test'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(__dirname, '..', '..')
const pkgDist = join(pkgRoot, 'dist')

// OhosDevice.browser() 自动设置 PW_CHROMIUM_ATTACH_TO_OTHER=1；上游测试始终启用多 context。
const multiContextOk = true

// OHOS_PW_HOST is set by register.mts (injected via ohos-playwright CLI).
// When not set (e.g. plain `npx playwright test`), run as a vanilla Playwright
// test (useful for CI baseline against a local Chromium).
const isOhos = !!process.env.OHOS_PW_HOST

export default defineConfig({
  testDir: __dirname,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  workers: isOhos ? (process.env.OHOS_PW_WORKERS ? parseInt(process.env.OHOS_PW_WORKERS) : 1) : undefined,
  ...(isOhos && !process.env.OHOS_PW_CDP_URL ? {
    globalSetup: join(pkgDist, 'setup.mjs'),
    globalTeardown: join(pkgDist, 'teardown.mjs'),
  } : {}),
  use: {
    browserName: 'chromium',
    ...(process.env.OHOS_PW_LOOPBACK ? { loopback: process.env.OHOS_PW_LOOPBACK } : {}),
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
})
