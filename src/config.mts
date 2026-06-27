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
  const multiContextOk = process.env.PW_CHROMIUM_ATTACH_TO_OTHER === '1'
  const configuredWorkers = typeof config.workers === 'number' ? config.workers : 0
  if (multiContextOk && configuredWorkers > 1) {
    console.warn(
      '[ohos-playwright] workers > 1 with PW_CHROMIUM_ATTACH_TO_OTHER=1: ' +
      'make sure you import { test } from \'ohos-playwright/parallel\' — ' +
      'the default fixture shares contexts()[0] across workers and will race. ' +
      'See README "Multi-worker mode".',
    )
  }
  return {
    ...config,
    // Without PW_CHROMIUM_ATTACH_TO_OTHER, all workers connect to the same
    // endpoint and share contexts()[0].pages()[0] — parallel workers would
    // race on the same page. Force workers:1. With the opt-in env, each
    // worker can browser.newContext() + ctx.newPage() independently via
    // ohos-playwright/parallel, so respect the user's workers setting.
    workers: multiContextOk ? config.workers : 1,
    globalSetup: 'ohos-playwright/setup',
    globalTeardown: 'ohos-playwright/teardown',
    // ArkWeb only speaks Chromium CDP; drop firefox/webkit projects.
    projects: config.projects?.filter((p) => p.name === 'chromium') ?? config.projects,
  }
}
