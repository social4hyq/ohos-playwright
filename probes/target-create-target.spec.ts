// 验证 Target.createTarget 在 ArkWeb PW_CHROMIUM_ATTACH_TO_OTHER=1 模式下能否创建可用 page
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

base('Target.createTarget feasibility', async ({}) => {
  const browser = await chromium.connectOverCDP(readEndpoint())
  try {
    const ctx = browser.contexts()[0]
    const pages = ctx.pages()
    const seed = pages[0]
    const session = await ctx.newCDPSession(seed)
    // 裸 CDP Target.createTarget
    const t0 = Date.now()
    let newTargetId: string | null = null
    try {
      const r: any = await Promise.race([
        session.send('Target.createTarget' as any, { url: 'about:blank' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT_5s')), 5000)),
      ])
      newTargetId = r.targetId
      console.log(`[PROBE] Target.createTarget ok targetId=${newTargetId} elapsed=${Date.now() - t0}ms`)
    } catch (e: any) {
      console.log(`[PROBE] Target.createTarget FAIL: ${e.message.split('\n')[0].slice(0, 100)}`)
      await session.detach()
      return
    }

    // 等待 Playwright 把新 target 识别为 page
    await new Promise(r => setTimeout(r, 500))
    const pagesAfter = ctx.pages()
    console.log(`[PROBE] pages before=${pages.length} after=${pagesAfter.length}`)

    // 找出新创建的 page
    const newPage = pagesAfter.find(p => !pages.includes(p))
    if (!newPage) {
      console.log(`[PROBE] new target did not appear in ctx.pages() — ATTACH_TO_OTHER not catching it`)
      // 尝试 attach
      try {
        const r2: any = await session.send('Target.attachToTarget' as any, { targetId: newTargetId, flatten: true })
        console.log(`[PROBE] Target.attachToTarget ok sessionId=${r2.sessionId}`)
      } catch (e: any) {
        console.log(`[PROBE] Target.attachToTarget FAIL: ${e.message.split('\n')[0].slice(0, 100)}`)
      }
    } else {
      console.log(`[PROBE] new page recognized by Playwright url=${newPage.url()}`)
      // 验证 evaluate
      try {
        const title = await newPage.evaluate(() => document.title)
        console.log(`[PROBE] newPage.evaluate ok title="${title}"`)
      } catch (e: any) {
        console.log(`[PROBE] newPage.evaluate FAIL: ${e.message.split('\n')[0].slice(0, 100)}`)
      }
      // close
      try {
        await newPage.close()
        console.log(`[PROBE] newPage.close ok`)
      } catch (e: any) {
        console.log(`[PROBE] newPage.close FAIL: ${e.message.split('\n')[0].slice(0, 100)}`)
      }
    }
    await session.detach()
  } finally {
    await browser.close().catch(() => {})
  }
})
