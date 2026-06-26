// 探针：touch 事件（ArkWeb 移动内核核心，完全未探）
import { test, expect } from '@playwright/test'

test('touch: page.tap 触发 touchstart/touchend', async ({ page }) => {
  await page.goto(`data:text/html,
    <div id=t style="width:100px;height:100px;background:red"></div>
    <span id=o></span>
    <script>
      const t = document.getElementById('t');
      let events = [];
      ['touchstart','touchmove','touchend'].forEach(ev =>
        t.addEventListener(ev, e => { events.push(ev); e.preventDefault(); })
      );
      t.addEventListener('touchend', () => {
        document.getElementById('o').textContent = events.join(',');
      });
    </script>`)
  try {
    const box = await page.locator('#t').boundingBox()
    await page.touchscreen!.tap(box!.x + 50, box!.y + 50)
    await page.waitForTimeout(300)
    const out = await page.locator('#o').textContent()
    console.log(`[PROBE2 touch-tap] RESULT events=${out}`)
  } catch (e: any) {
    console.log(`[PROBE2 touch-tap] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('touch: CDP Input.dispatchTouchEvent 直发', async ({ page }) => {
  await page.goto('data:text/html,<span id=o></span>')
  await page.evaluate(() => {
    document.addEventListener('touchstart', (e) => {
      ;(document.getElementById('o') as HTMLElement).textContent = 'got:' + e.touches.length
    })
  })
  try {
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchTouchEvent' as any, {
      type: 'touchStart',
      touchPoints: [{ x: 50, y: 50, id: 0 }],
    })
    await session.send('Input.dispatchTouchEvent' as any, {
      type: 'touchEnd',
      touchPoints: [],
    })
    await session.detach()
    await page.waitForTimeout(200)
    const out = await page.locator('#o').textContent()
    console.log(`[PROBE2 touch-cdp] RESULT out=${out}`)
  } catch (e: any) {
    console.log(`[PROBE2 touch-cdp] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})
