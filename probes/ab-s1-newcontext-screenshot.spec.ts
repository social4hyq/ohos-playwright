// A/B 探针：S1 (newContext + newPage + screenshot) 跨引擎对照
//
// 目的：确认 S1 中观察到的 ArkWeb 新 context screenshot timeout
// 是 ArkWeb 特有问题，还是 connectOverCDP + newContext 通病。
//
// 关键对照：
//   - 默认 context 的 page.screenshot()
//   - 新 context 的 page.screenshot()
//   - 新 context 的裸 CDP Page.captureScreenshot
//
// ArkWeb 腿：
//   OHOS_PW_HOST=1 PW_CHROMIUM_ATTACH_TO_OTHER=1 ./dist/cli.mjs test \
//     --config=probes/playwright.config.ts probes/ab-s1-newcontext-screenshot.spec.ts
//
// Edge 腿：
//   OHOS_PW_CDP_URL=http://172.16.100.2:9222 PW_CHROMIUM_ATTACH_TO_OTHER=1 \
//     ./dist/cli.mjs test --config=probes/playwright.config.ts \
//     probes/ab-s1-newcontext-screenshot.spec.ts
import { test as base } from '@playwright/test'
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

function readEndpoint(): string {
  const url = process.env.OHOS_PW_CDP_URL
  if (url) return url
  const infoPath = process.env.OHOS_PW_INFO_PATH ?? resolve(tmpdir(), 'ohos-playwright-cdp.json')
  return JSON.parse(readFileSync(infoPath, 'utf8')).endpoint
}

base('ab-s1: default-context vs new-context screenshot', async ({}) => {
  const browser = await chromium.connectOverCDP(readEndpoint())
  try {
    // 1. 默认 context 的 page：screenshot 是否能工作
    const defaultCtx = browser.contexts()[0]
    const defaultPage = defaultCtx.pages()[0]
    let defaultShot = 'n/a'
    try {
      const buf = await Promise.race([
        defaultPage.screenshot(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT_5s')), 5000)),
      ]) as Buffer
      defaultShot = `bytes=${buf.length}`
    } catch (e: any) {
      defaultShot = `ERR:${e.message.split('\n')[0].slice(0, 80)}`
    }

    // 2. 新 context 的 page：screenshot 是否能工作
    let newShot = 'n/a'
    let newEval = 'n/a'
    try {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      try {
        const r = await page.evaluate(() => 1 + 1)
        newEval = `evaluate=${r}`
      } catch (e: any) {
        newEval = `ERR:${e.message.split('\n')[0].slice(0, 80)}`
      }
      try {
        const buf = await Promise.race([
          page.screenshot(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT_5s')), 5000)),
        ]) as Buffer
        newShot = `bytes=${buf.length}`
      } catch (e: any) {
        newShot = `ERR:${e.message.split('\n')[0].slice(0, 80)}`
      }
      await ctx.close().catch(() => {})
    } catch (e: any) {
      newShot = `CTX_ERR:${e.message.split('\n')[0].slice(0, 80)}`
    }

    // 3. 裸 CDP Page.captureScreenshot 在新 context 的 page 上
    let cdpShot = 'n/a'
    try {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      const session = await ctx.newCDPSession(page)
      try {
        const r: any = await Promise.race([
          session.send('Page.captureScreenshot' as any, { format: 'png' }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('CDP_TIMEOUT_5s')), 5000)),
        ])
        cdpShot = `dataLen=${r.data?.length ?? 0}`
      } catch (e: any) {
        cdpShot = `ERR:${e.message.split('\n')[0].slice(0, 80)}`
      }
      await ctx.close().catch(() => {})
    } catch (e: any) {
      cdpShot = `CTX_ERR:${e.message.split('\n')[0].slice(0, 80)}`
    }

    console.log(`[PROBE ab-s1] default=${defaultShot} | newCtxEval=${newEval} | newCtxShot=${newShot} | newCtxCDPShot=${cdpShot}`)
  } finally {
    await browser.close().catch(() => {})
  }
})
