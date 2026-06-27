// 探针：context.recordVideo / page.video() —— 跨引擎 A/B
//
// Playwright 视频录制底层走 Chrome Page.startScreencast CDP 命令。
// 本探针验证 connectOverCDP 模式下能否 (a) 启动 recordVideo 并取到路径，
// (b) 最终文件实际写出。
//
// 需要 PW_CHROMIUM_ATTACH_TO_OTHER=1（newContext 创建）。
//
// 两条腿：
//   ArkWeb：OHOS_PW_HOST=1 PW_CHROMIUM_ATTACH_TO_OTHER=1 ./dist/cli.mjs test \
//             --config=probes/playwright.config.ts probes/ab-video-context.spec.ts
//   Edge：  OHOS_PW_CDP_URL=http://172.16.100.2:9222 PW_CHROMIUM_ATTACH_TO_OTHER=1 \
//             ./dist/cli.mjs test --config=probes/playwright.config.ts \
//             probes/ab-video-context.spec.ts
import { test as base } from '@playwright/test'
import { chromium } from 'playwright-core'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

function readEndpoint(): string {
  const url = process.env.OHOS_PW_CDP_URL
  if (url) return url
  const infoPath = process.env.OHOS_PW_INFO_PATH ?? resolve(tmpdir(), 'ohos-playwright-cdp.json')
  return JSON.parse(readFileSync(infoPath, 'utf8')).endpoint
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | void> =>
  Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))])

base('ab-video-context: recordVideo dir + page.video().path()', async ({}) => {
  const videoDir = resolve(tmpdir(), `ohos-pw-video-${Date.now()}`)
  mkdirSync(videoDir, { recursive: true })

  const browser = await chromium.connectOverCDP(readEndpoint())
  let videoPath: string | undefined
  let errorMsg: string | undefined
  let ctx: import('playwright-core').BrowserContext | undefined
  try {
    try {
      ctx = await browser.newContext({ recordVideo: { dir: videoDir } })
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e)
      console.log(`[PROBE ab-video-context] newContext-recordVideo FAILED: "${errorMsg}"`)
      return
    }
    const page = await ctx.newPage()
    await page.goto('about:blank')
    await page.evaluate(() => document.body.style.background = 'navy')
    await page.waitForTimeout(300)

    // video() returns a Video object once page is opened with recordVideo
    const vid = page.video()
    videoPath = await vid?.path().catch((e: unknown) => {
      errorMsg = e instanceof Error ? e.message : String(e)
      return undefined
    })

    await withTimeout(page.close(), 5000).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('EACCES') || msg.includes('ffmpeg')) {
        errorMsg = `ffmpeg NOT_SUPPORTED on HarmonyOS (needs signing): ${msg.split('\n')[0]}`
      } else {
        errorMsg = msg
      }
    })
    // path() is finalised after page.close()
    const finalPath = await vid?.path().catch(() => undefined)
    const fileExists = finalPath ? existsSync(finalPath) : false

    console.log(`[PROBE ab-video-context] videoObj=${vid != null} pathBeforeClose=${videoPath ?? 'null'} pathAfterClose=${finalPath ?? 'null'} fileExists=${fileExists}`)
    if (errorMsg) console.log(`[PROBE ab-video-context] error="${errorMsg}"`)

    await withTimeout(ctx.close(), 4000).catch(() => {})
  } finally {
    await withTimeout(browser.close(), 3000).catch(() => {})
  }
})

base('ab-video-context: page.video() is null without recordVideo', async ({}) => {
  const browser = await chromium.connectOverCDP(readEndpoint())
  try {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto('about:blank')
    const vid = page.video()
    console.log(`[PROBE ab-video-context] no-recordVideo video=${vid}`)
    await withTimeout(ctx.close(), 4000).catch(() => {})
  } finally {
    await withTimeout(browser.close(), 3000).catch(() => {})
  }
})
