import { defineConfig } from '@playwright/test'
import { withOpenHarmony } from 'ohos-playwright/config'
import { join } from 'node:path'

// SNAPSHOT_ENGINE lets A/B probes keep separate baselines per engine
// (ArkWeb vs Edge) without mutual overwrite. Set e.g. SNAPSHOT_ENGINE=arkweb
// or SNAPSHOT_ENGINE=edge before running toHaveScreenshot probes.
const snapshotDir = process.env.SNAPSHOT_ENGINE
  ? join(import.meta.dirname, `snapshots-${process.env.SNAPSHOT_ENGINE}`)
  : undefined

export default defineConfig(withOpenHarmony({
  testDir: import.meta.dirname,
  fullyParallel: false,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  ...(snapshotDir ? { snapshotDir } : {}),
  use: {
    baseURL: 'http://localhost',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
}))
