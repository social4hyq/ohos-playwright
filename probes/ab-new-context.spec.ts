// 探针：connectOverCDP 模式下 browser.newContext() 行为 —— 跨引擎 A/B
//
// 目的：确认 connectOverCDP 模式下 browser.newContext() 在 chrome 上是否
// 同样受限。如果 Edge 也抛错，证明这是 connectOverCDP 模式本身的限制
// （不只是 ArkWeb 缺 Target.createBrowserContext），从而把 L1 的根因
// 从「ArkWeb 根本性」精确化为「connectOverCDP + ArkWeb 双重」。
//
// 两条腿：
//   ArkWeb：./dist/cli.mjs test --config=probes/playwright.config.ts probes/ab-new-context.spec.ts
//   Edge：  OHOS_PW_CDP_URL=http://192.168.3.60:9222 ./dist/cli.mjs test \
//          --config=probes/playwright.config.ts probes/ab-new-context.spec.ts
//
// 注：fixture.mts:71 在 ArkWeb 上拦截了 browser.newContext 抛友好错误。
//     本探针绕开 fixture（直用 base.test）以观察 raw 行为。
import { test as base } from '@playwright/test'
import { chromium } from 'playwright-core'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

base('ab-new-context: raw browser.newContext() after connectOverCDP', async () => {
  // 直取 endpoint（fixture 拦截只在 fixture test 里生效；base.test 不走 fixture）。
  // 与 src/info-path.mts 同款默认路径，但允许 OHOS_PW_CDP_URL 覆盖。
  const infoPath = process.env.OHOS_PW_INFO_PATH ?? resolve(tmpdir(), 'ohos-playwright-cdp.json')
  const endpoint = process.env.OHOS_PW_CDP_URL
    ?? JSON.parse(readFileSync(infoPath, 'utf8')).endpoint
  const browser = await chromium.connectOverCDP(endpoint)
  try {
    let outcome = ''
    try {
      const ctx = await browser.newContext()
      const pages = ctx.pages()
      // 深度验证：newContext 是否真能用？尝试 newPage + goto + evaluate
      let pageOutcome = ''
      try {
        const page = await ctx.newPage()
        await page.goto('data:text/html,<div id=o>hello-ohos</div>')
        const text = await page.evaluate(() => document.getElementById('o')?.textContent ?? '')
        pageOutcome = `newPage=ok(text="${text}")`
        await page.close().catch(() => {})
      } catch (e: any) {
        pageOutcome = `newPage=throw:${e.message.split('\n')[0].slice(0, 100)}`
      }
      outcome = `newContext=ok(pages=${pages.length}) ${pageOutcome}`
      await ctx.close().catch(() => {})
    } catch (e: any) {
      outcome = `newContext=throw:${e.message.split('\n')[0].slice(0, 120)}`
    }
    console.log(`[PROBE ab-new-context] result=${outcome}`)
    // 期望：raw API 行为可能与 fixture 拦截描述不同——需观察实际是 throw 还是 ok。
  } finally {
    browser.close().catch(() => {})
  }
})
