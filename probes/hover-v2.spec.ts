// 探针 v2：hover 带超时兜底（v1 hang）
import { test, expect } from '@playwright/test'

test('hover-v2: locator.hover 带超时', async ({ page }) => {
  await page.goto(`data:text/html,
    <style>#t:hover { background: green; }</style>
    <div id=t style="width:50px;height:50px;background:gray">h</div>`)
  const start = Date.now()
  const r = await Promise.race([
    page.locator('#t').hover({ timeout: 5000 }).then(() => 'ok').catch((e: any) => `err:${e.message.split('\n')[0]}`),
    new Promise<string>(res => setTimeout(() => res('HANG_8s'), 8000)),
  ])
  console.log(`[PROBE hover-v2] RESULT hoverResult=${r} elapsed=${Date.now()-start}ms`)
  if (r === 'ok') {
    const bg = await page.evaluate(() => getComputedStyle(document.getElementById('t')!).backgroundColor)
    console.log(`[PROBE hover-v2] RESULT bg=${bg}`)
  }
})
