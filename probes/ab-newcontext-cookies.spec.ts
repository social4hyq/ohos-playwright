// 探针：browser.newContext() + cookie/storageState 操作（不带 PW_CHROMIUM_ATTACH_TO_OTHER）
//
// 目的：验证在不设置 PW_CHROMIUM_ATTACH_TO_OTHER 的情况下，
// newContext + addCookies + storageState() 是否可用。
// 通过 → 可删除 fixture.mts 中的 newContext 友好错误拦截。
//
// 注：使用 fixture 的 browser 对象（避免二次 CDP 连接），
// 临时删除 fixture 注入的 newContext 实例属性以绕开拦截，
// 观察原生 Playwright connectOverCDP 行为。
//
// 两条腿：
//   ArkWeb：OHOS_PW_HOST=1 ./dist/cli.mjs test \
//     --config=probes/playwright.config.ts probes/ab-newcontext-cookies.spec.ts
//   Edge：  OHOS_PW_CDP_URL=http://172.16.100.2:9222 ./dist/cli.mjs test \
//     --config=probes/playwright.config.ts probes/ab-newcontext-cookies.spec.ts
import { test } from '@playwright/test'
import type { Browser } from '@playwright/test'

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | void> =>
  Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))])

test('ab-newcontext-cookies: addCookies + storageState without PW_CHROMIUM_ATTACH_TO_OTHER', async ({ browser }) => {
  // The fixture overrides browser.newContext as an own-property to throw a friendly error.
  // Delete the instance property to restore prototype access (real Playwright newContext).
  const intercepted = Object.getOwnPropertyDescriptor(browser, 'newContext')
  if (intercepted) {
    delete (browser as unknown as Record<string, unknown>).newContext
  }

  let newContextOutcome = ''
  let cookiesOutcome = ''
  let storageOutcome = ''
  let newPageOutcome = ''

  try {
    try {
      const ctx = await (browser as Browser).newContext()

      // Test 1: addCookies (no newPage needed)
      try {
        await ctx.addCookies([
          { name: 'ab-test', value: 'cookie-value', domain: 'example.com', path: '/' },
        ])
        const cookies = await ctx.cookies('https://example.com')
        const found = cookies.find((c) => c.name === 'ab-test')
        cookiesOutcome = found ? `ok(value=${found.value})` : 'missing'
      } catch (e: unknown) {
        cookiesOutcome = `throw:${(e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 80)}`
      }

      // Test 2: storageState() with cookies
      try {
        const state = await ctx.storageState()
        storageOutcome = `ok(cookies=${state.cookies?.length ?? 0})`
      } catch (e: unknown) {
        storageOutcome = `throw:${(e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 80)}`
      }

      // Test 3: newPage — document natural error (may throw _page undefined without PW_CHROMIUM_ATTACH_TO_OTHER)
      try {
        const page = await ctx.newPage()
        await page.goto('data:text/html,<div>ok</div>')
        const text = await page.evaluate(() => document.body.innerText)
        newPageOutcome = `ok(text="${text}")`
        await withTimeout(page.close(), 3000).catch(() => {})
      } catch (e: unknown) {
        newPageOutcome = `throw:${(e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 100)}`
      }

      newContextOutcome = 'ok'
      await withTimeout(ctx.close(), 3000).catch(() => {})
    } catch (e: unknown) {
      newContextOutcome = `throw:${(e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 120)}`
    }

    console.log(
      `[PROBE ab-newcontext-cookies] newContext=${newContextOutcome}` +
      ` cookies=${cookiesOutcome} storage=${storageOutcome} newPage=${newPageOutcome}`,
    )
  } finally {
    // Restore fixture's interception so fixture cleanup works correctly
    if (intercepted) {
      Object.defineProperty(browser, 'newContext', intercepted)
    }
  }
})
