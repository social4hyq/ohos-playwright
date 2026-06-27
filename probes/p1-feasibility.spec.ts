// 探测默认 context 中可用的 page 数量、以及 fixture page 之外是否有闲置 tab
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

base('default-context page inventory', async ({}) => {
  const browser = await chromium.connectOverCDP(readEndpoint())
  try {
    const ctx = browser.contexts()[0]
    const pages = ctx.pages()
    console.log(`[PROBE] contexts[0].pages() count=${pages.length}`)
    for (let i = 0; i < pages.length; i++) {
      console.log(`[PROBE] page[${i}] url=${pages[i].url()}`)
    }
    // 列出所有裸 CDP target
    if (pages.length > 0) {
      const session = await ctx.newCDPSession(pages[0])
      const r: any = await session.send('Target.getTargets' as any)
      const pageTargets = r.targetInfos.filter((t: any) => t.type === 'page')
      console.log(`[PROBE] CDP Target.getTargets page count=${pageTargets.length}`)
      pageTargets.forEach((t: any, i: number) => {
        console.log(`[PROBE] target[${i}] url=${(t.url || '').slice(0, 60)} attached=${t.attached}`)
      })
      await session.detach()
    }
  } finally {
    await browser.close().catch(() => {})
  }
})
