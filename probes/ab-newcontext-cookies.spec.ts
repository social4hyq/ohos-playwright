// 探针：browser.newContext() + cookie/storageState 操作（不带 PW_CHROMIUM_ATTACH_TO_OTHER）
//
// 目的：验证在不设置 PW_CHROMIUM_ATTACH_TO_OTHER 的情况下，
// newContext({ storageState }) + addCookies + storageState() 是否可用。
// 通过 → 可删除 fixture.mts 中的 newContext 友好错误拦截（L227-243）。
//
// 注：用 base.test + 原始 connectOverCDP 绕开 fixture 的拦截，以观察真实行为。
//
// 两条腿：
//   ArkWeb：OHOS_PW_HOST=1 ./dist/cli.mjs test \
//     --config=probes/playwright.config.ts probes/ab-newcontext-cookies.spec.ts
//   Edge：  OHOS_PW_CDP_URL=http://172.16.100.2:9222 ./dist/cli.mjs test \
//     --config=probes/playwright.config.ts probes/ab-newcontext-cookies.spec.ts
import { test as base } from '@playwright/test'
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

function getEndpoint(): string {
  if (process.env.OHOS_PW_CDP_URL) return process.env.OHOS_PW_CDP_URL
  const infoPath = process.env.OHOS_PW_INFO_PATH ?? resolve(tmpdir(), 'ohos-playwright-cdp.json')
  return JSON.parse(readFileSync(infoPath, 'utf8')).endpoint
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | void> =>
  Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))])

base('ab-newcontext-cookies: addCookies + storageState without PW_CHROMIUM_ATTACH_TO_OTHER', async () => {
  const savedEnv = process.env.PW_CHROMIUM_ATTACH_TO_OTHER
  delete process.env.PW_CHROMIUM_ATTACH_TO_OTHER

  const browser = await chromium.connectOverCDP(getEndpoint())
  try {
    let newContextOutcome = ''
    let cookiesOutcome = ''
    let storageOutcome = ''
    let newPageOutcome = ''

    try {
      const ctx = await browser.newContext()

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

      // Test 3: newPage — document natural error (may throw _page undefined)
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
    if (savedEnv !== undefined) process.env.PW_CHROMIUM_ATTACH_TO_OTHER = savedEnv
    withTimeout(browser.close(), 3000).catch(() => {})
  }
})
