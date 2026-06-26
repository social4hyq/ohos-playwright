// 验证新 fixture：tap
import { test, expect } from '@playwright/test'

test('tap fixture: 触发 touchstart/touchend', async ({ page, tap }) => {
  await page.goto(`data:text/html,
    <div id=t style="width:200px;height:200px;background:cyan">tap</div>
    <pre id=log>idle</pre>
    <script>
      const t = document.getElementById('t');
      let evs = [];
      t.addEventListener('touchstart', e => { evs.push('start:'+e.touches.length); e.preventDefault(); });
      t.addEventListener('touchend', () => { evs.push('end'); document.getElementById('log').textContent = evs.join('|'); });
    </script>`)
  const box = await page.locator('#t').boundingBox()
  await tap(box!.x + 50, box!.y + 50)
  await page.waitForTimeout(200)
  const log = await page.locator('#log').textContent()
  console.log(`[NEW-FIXTURE tap] RESULT log=${log}`)
  expect(log).toContain('start:1')
  expect(log).toContain('end')
})

test('tap fixture: 点击按钮触发 click', async ({ page, tap }) => {
  await page.goto(`data:text/html,
    <button id=b style="width:100px;height:50px">click me</button>
    <span id=o></span>
    <script>
      document.getElementById('b').addEventListener('click', () => {
        document.getElementById('o').textContent = 'clicked';
      });
    </script>`)
  const box = await page.locator('#b').boundingBox()
  await tap(box!.x + 25, box!.y + 25)
  await page.waitForTimeout(300)
  const out = await page.locator('#o').textContent()
  console.log(`[NEW-FIXTURE tap-click] RESULT out=${out}`)
  expect(out).toBe('clicked')
})
