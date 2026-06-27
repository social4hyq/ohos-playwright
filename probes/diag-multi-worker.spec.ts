// 多 worker 诊断探针：验证 opt-in env 下 workers=2 能否真正并行
//
// 跑法：
//   PW_CHROMIUM_ATTACH_TO_OTHER=1 ./dist/cli.mjs test \
//     --config=probes/playwright.config.ts --workers=2 probes/diag-multi-worker.spec.ts
//
// 探针故意用 base.test（不走 fixture 的 page 复用），自己 newContext + newPage。
// 如果 ArkWeb 真支持多 context，两个 worker 应该并行完成且 page url 不同。
import { test as base } from '@playwright/test'
import { chromium } from 'playwright-core'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

base('diag-multi-worker: parallel newContext+newPage isolation', async ({}, testInfo) => {
  const workerIdx = testInfo.workerIndex
  const infoPath = process.env.OHOS_PW_INFO_PATH ?? resolve(tmpdir(), 'ohos-playwright-cdp.json')
  const endpoint = process.env.OHOS_PW_CDP_URL
    ?? JSON.parse(readFileSync(infoPath, 'utf8')).endpoint
  const browser = await chromium.connectOverCDP(endpoint)
  try {
    const start = Date.now()
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const marker = `w${workerIdx}-${Math.random().toString(36).slice(2, 8)}`
    await page.goto(`data:text/html,<div id=m>${marker}</div>`)
    const text = await page.evaluate(() => document.getElementById('m')?.textContent ?? '')
    const elapsed = Date.now() - start
    const isolated = text === marker
    console.log(`[PROBE diag-multi-worker] worker=${workerIdx} marker=${marker} got="${text}" isolated=${isolated} elapsed=${elapsed}ms`)
    await page.close().catch(() => {})
    await ctx.close().catch(() => {})
  } finally {
    browser.close().catch(() => {})
  }
})

// 第二个 test，让 playwright 有机会分配到不同 worker
base('diag-multi-worker: second test for parallel scheduling', async ({}, testInfo) => {
  const workerIdx = testInfo.workerIndex
  const infoPath = process.env.OHOS_PW_INFO_PATH ?? resolve(tmpdir(), 'ohos-playwright-cdp.json')
  const endpoint = process.env.OHOS_PW_CDP_URL
    ?? JSON.parse(readFileSync(infoPath, 'utf8')).endpoint
  const browser = await chromium.connectOverCDP(endpoint)
  try {
    const start = Date.now()
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const marker = `w${workerIdx}-2nd-${Math.random().toString(36).slice(2, 8)}`
    await page.goto(`data:text/html,<div id=m>${marker}</div>`)
    const text = await page.evaluate(() => document.getElementById('m')?.textContent ?? '')
    const elapsed = Date.now() - start
    console.log(`[PROBE diag-multi-worker-2] worker=${workerIdx} marker=${marker} got="${text}" isolated=${text === marker} elapsed=${elapsed}ms`)
    await page.close().catch(() => {})
    await ctx.close().catch(() => {})
  } finally {
    browser.close().catch(() => {})
  }
})
