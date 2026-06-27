import type { Browser, BrowserContext, Page } from '@playwright/test'
import { test as base, installPageWrappers } from './fixture.mts'

// Parallel-safe test fixture for ohos-playwright.
//
// Requirements:
//   - PW_CHROMIUM_ATTACH_TO_OTHER=1 must be set before importing @playwright/test
//   - Use withOpenHarmony() in your playwright.config.ts as usual
//
// Differences from the default 'ohos-playwright' fixture:
//   - Each test opens its own ArkWeb context via browser.newContext() (test-scoped).
//     Cookies and localStorage are fully isolated between tests.
//   - Each test gets ctx.newPage() and both page and context are closed after the
//     test. All ArkWeb workarounds (goBack, goForward, popup, hover,
//     evaluate→pageerror) are applied identically to the default fixture.
//   - newContext() in ArkWeb costs ~100 ms; concurrent creation is safe.
//
// Usage:
//   import { test, expect } from 'ohos-playwright/parallel'

export const test = base.extend<
  { context: BrowserContext; page: Page }
>({
  context: async (
    { browser }: { browser: Browser },
    use: (c: BrowserContext) => Promise<void>,
    testInfo: { project: { use: { baseURL?: string } } },
  ) => {
    if (!process.env.PW_CHROMIUM_ATTACH_TO_OTHER) {
      throw new Error(
        '[ohos-playwright/parallel] PW_CHROMIUM_ATTACH_TO_OTHER=\'1\' must be set before ' +
        'importing @playwright/test when using this fixture. ' +
        'See ohos-playwright README "Multi-worker mode".',
      )
    }
    const baseURL = testInfo.project.use.baseURL
    const ctx = await browser.newContext(baseURL ? { baseURL } : {})
    try {
      await use(ctx)
    } finally {
      await ctx.close().catch(() => {})
    }
  },

  page: async (
    { context }: { context: BrowserContext },
    use: (p: Page) => Promise<void>,
  ) => {
    const page = await context.newPage()
    // baseURL is set on the context via newContext({ baseURL }), so Playwright
    // resolves relative URLs natively — pass undefined to skip the goto patch.
    const cleanup = await installPageWrappers(page, context, undefined)
    try {
      await use(page)
    } finally {
      await cleanup()
      await page.close().catch(() => {})
    }
  },
})

export { expect } from '@playwright/test'
