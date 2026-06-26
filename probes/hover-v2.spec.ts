// 探针 v2：hover 带超时兜底（v1 hang）
// fix 后：JS dispatchEvent 路径，验证 mouseover 事件触发而非 CSS :hover（JS events 不设实际指针位置）
import { test } from '@playwright/test'

test('hover-v2: locator.hover 带超时', async ({ page }) => {
  await page.goto(`data:text/html,
    <div id=t style="width:50px;height:50px;background:gray">h</div>
    <script>document.getElementById('t').addEventListener('mouseover', () => { window.__hovered = true })</script>`)
  const start = Date.now()
  const r = await Promise.race([
    page.locator('#t').hover().then(() => 'ok').catch((e: any) => `err:${e.message.split('\n')[0]}`),
    new Promise<string>(res => setTimeout(() => res('HANG_8s'), 8000)),
  ])
  const elapsed = Date.now() - start
  const fired = r === 'ok' ? await page.evaluate(() => !!(window as any).__hovered) : false
  console.log(`[PROBE hover-v2] RESULT hoverResult=${r} fired=${fired} elapsed=${elapsed}ms`)
})
