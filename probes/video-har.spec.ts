// 探针：video / HAR recording
import { test, expect } from '@playwright/test'

test('video: context 视频录制（connectOverCDP 下）', async ({ page }) => {
  // connectOverCDP 模式下 video 依赖 screencast，单 page 复用
  await page.goto('data:text/html,<h1 style="font-size:80px">video-test</h1>')
  try {
    // Video 在 connectOverCDP 下通常通过 tracing 的 screencast 间接拿，这里直接测 CDP screencast
    const session = await page.context().newCDPSession(page)
    let frames = 0
    session.on('Page.screencastFrame' as any, () => frames++)
    await session.send('Page.startScreencast' as any, { format: 'jpeg', quality: 80 })
    await page.waitForTimeout(1000)
    await session.send('Page.stopScreencast' as any)
    await session.detach()
    console.log(`[PROBE2 video-screencast] RESULT frames=${frames} (>0 表示可录视频)`)
  } catch (e: any) {
    console.log(`[PROBE2 video-screencast] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('har: context.recordHar（route 层抓包）', async ({ browserName, page }) => {
  await page.goto('data:text/html,<h1>har</h1>')
  try {
    // ArkWeb 单 context，没法临时起 recordHar context；测 Page.reload 是否能被现有 route 抓到
    const harPath = '/storage/Users/currentUser/.tmp/probe.har'
    await page.route('**/*', route => route.continue())
    await page.goto('data:text/html,<h1>x</h1>')
    await page.unroute('**/*')
    console.log(`[PROBE2 har-route] RESULT route-continue=ok (recordHar 需多 context，ohos-playwright 不支持)`)
  } catch (e: any) {
    console.log(`[PROBE2 har-route] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})
