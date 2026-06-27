// 测量 connectOverCDP 下 newContext() + newPage() 的串行/并发耗时。
// 用于对比 ArkWeb 与标准 Chrome/Edge 的 context 创建成本。
//
// ArkWeb 跑法：
//   OHOS_PW_HOST=1 PW_CHROMIUM_ATTACH_TO_OTHER=1 node dist/cli.mjs test \
//     --config=probes/playwright.config.ts probes/ab-context-cost.spec.ts
//
// Chrome 对比跑法（非 OHOS 主机）：
//   OHOS_PW_CDP_URL=http://<ip>:9222 PW_CHROMIUM_ATTACH_TO_OTHER=1 \
//     npx playwright test probes/ab-context-cost.spec.ts
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

base('ab-context-cost: serial newContext x5', async ({}) => {
  const browser = await chromium.connectOverCDP(readEndpoint())
  const samples: number[] = []
  try {
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now()
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      await page.goto('about:blank')
      samples.push(Date.now() - t0)
      await ctx.close()
    }
  } finally {
    await browser.close().catch(() => {})
  }
  const avg = Math.round(samples.reduce((a, b) => a + b) / samples.length)
  console.log(`[PROBE ab-context-cost] serial samples(ms): ${samples.join(' ')}  avg=${avg}ms`)
})

base('ab-context-cost: concurrent newContext x3', async ({}) => {
  const browser = await chromium.connectOverCDP(readEndpoint())
  try {
    const t0 = Date.now()
    const ctxs = await Promise.all([0, 1, 2].map(() => browser.newContext()))
    const elapsed = Date.now() - t0
    const pages = await Promise.all(ctxs.map(c => c.newPage()))
    const withPages = Date.now() - t0
    await Promise.all(pages.map(p => p.goto('about:blank').catch(() => {})))
    const withNav = Date.now() - t0
    await Promise.all(ctxs.map(c => c.close()))
    console.log(`[PROBE ab-context-cost] concurrent-3: contexts=${elapsed}ms pages=${withPages}ms nav=${withNav}ms`)
  } finally {
    await browser.close().catch(() => {})
  }
})
