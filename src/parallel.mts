import type { Browser, BrowserContext, Page } from '@playwright/test'
import { test as base, installPageWrappers } from './fixture.mts'
import { safeResetPage } from './ohos/patches/page-patch.mts'

// Parallel-safe test fixture for ohos-playwright.
//
// Requirements:
//   - PW_CHROMIUM_ATTACH_TO_OTHER=1 must be set before importing @playwright/test
//   - Use withOpenHarmony() in your playwright.config.ts as usual
//
// Differences from the default 'ohos-playwright' fixture:
//   - Each test gets its own page via context.newPage() in the DEFAULT ArkWeb
//     context (browser.contexts()[0]).
//   - Cookies and localStorage are not automatically isolated between tests.
//     Tests that need storage isolation should clear it manually.
//   - After each test the page is navigated to about:blank (not closed) —
//     page.close() and ctx.close() on ArkWeb CDP both trigger an async
//     WebSocket disconnect that kills subsequent tests.
//   - All ArkWeb workarounds (goBack, goForward, popup, hover,
//     evaluate→pageerror) are applied identically to the default fixture.
//
// ArkWeb CDP note: Target.closeTarget and Target.disposeBrowserContext sent
// for non-default contexts disconnect the ArkWeb WebSocket — even if called
// after all pages are closed. page.goto('about:blank') in the DEFAULT context
// is safe. Creating and using non-default contexts in test bodies (e.g., via
// browser.newContext()) works but those contexts cannot be safely torn down;
// their pages will accumulate as about:blank tabs.
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
    // Use the default ArkWeb context. Non-default contexts created via
    // browser.newContext() cannot be torn down without disconnecting CDP
    // (Target.disposeBrowserContext closes the WebSocket). The default context
    // is always open and safe to reuse across tests.
    const ctx = browser.contexts()[0]
    if (!ctx) throw new Error('[ohos-playwright/parallel] No default context in CDP session. Is PW_CHROMIUM_ATTACH_TO_OTHER=1 set?')
    const baseURL = testInfo.project.use.baseURL
    if (baseURL) {
      ;(ctx as unknown as { _options: Record<string, unknown> })._options.baseURL = baseURL
    }
    await use(ctx)
    // ctx.close() intentionally omitted — this IS the ArkWeb default context.
  },

  page: async (
    { context }: { context: BrowserContext },
    use: (p: Page) => Promise<void>,
    testInfo: { project: { use: { baseURL?: string } } },
  ) => {
    // Create a fresh page in the default context. Each test gets an isolated
    // tab. skipCreateTarget: popup poller skips Target.createTarget even in
    // the default context — window.open emits a stub so the test can observe
    // the popup event without triggering a second navigation that may crash.
    const page = await context.newPage()
    const cleanup = await installPageWrappers(page, context, testInfo.project.use.baseURL, { skipCreateTarget: true })
    try {
      await use(page)
    } finally {
      await cleanup()
      // Reset DOM without a navigation. about:blank destroys CustomTabAbility's
      // only tab ~1s later; setContent keeps it alive.
      await safeResetPage(page)
    }
  },
})

export { expect } from '@playwright/test'
