import type { PlaywrightTestConfig } from '@playwright/test'

// Wrap a base Playwright config so it transparently turns into an ArkWeb/CDP
// run on OpenHarmony and stays stock everywhere else. Usage:
//
//   import { defineConfig, devices } from '@playwright/test'
//   import { withOpenHarmony } from 'ohos-playwright/config'
//
//   export default defineConfig(withOpenHarmony({ ...baseConfig }))
//
// On non-OpenHarmony hosts the input config is returned unchanged.
export function withOpenHarmony(config: PlaywrightTestConfig): PlaywrightTestConfig {
  // Consult OHOS_PW_HOST, not process.platform — register.mjs has already
  // overwritten platform to 'linux' by the time this function runs.
  if (!process.env.OHOS_PW_HOST) return config
  return {
    ...config,
    // Single ArkWeb instance via CDP — workers must be 1.
    workers: 1,
    globalSetup: 'ohos-playwright/setup',
    globalTeardown: 'ohos-playwright/teardown',
    // ArkWeb only speaks Chromium CDP; drop firefox/webkit projects.
    projects: config.projects?.filter((p) => p.name === 'chromium') ?? config.projects,
  }
}
