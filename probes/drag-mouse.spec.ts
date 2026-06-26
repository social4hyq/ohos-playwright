// 探针：drag & drop + wheel/hover（合成事件）
import { test, expect } from '@playwright/test'

test('drag: locator.dragTo', async ({ page }) => {
  await page.goto(`data:text/html,
    <div id=src draggable=true style="width:50px;height:50px;background:red">src</div>
    <div id=dst style="width:50px;height:50px;background:blue;margin-top:20px">dst</div>
    <span id=o></span>
    <script>
      document.getElementById('dst').addEventListener('dragover', e=>e.preventDefault());
      document.getElementById('dst').addEventListener('drop', e=>{
        e.preventDefault();
        document.getElementById('o').textContent = 'dropped';
      });
    </script>`)
  try {
    await page.locator('#src').dragTo(page.locator('#dst'), { timeout: 5000 })
    const out = await page.locator('#o').textContent()
    console.log(`[PROBE drag] RESULT out=${out}`)
  } catch (e: any) {
    console.log(`[PROBE drag] RESULT=error err=${e.message}`)
  }
})

test('mouse: hover 触发 :hover', async ({ page }) => {
  await page.goto(`data:text/html,
    <style>#t:hover { background: green; }</style>
    <div id=t style="width:50px;height:50px;background:gray">h</div>
    <span id=o></span>
    <script>
      new MutationObserver(()=>{ document.getElementById('o').textContent = getComputedStyle(document.getElementById('t')).backgroundColor; })
        .observe(document.getElementById('t'), { attributes: true, attributeFilter: ['style'] });
    </script>`)
  try {
    await page.locator('#t').hover()
    await page.waitForTimeout(300)
    const bg = await page.evaluate(() => getComputedStyle(document.getElementById('t')!).backgroundColor)
    console.log(`[PROBE hover] RESULT bg=${bg} (green=rgb(0,128,0) 表示 hover 生效)`)
  } catch (e: any) {
    console.log(`[PROBE hover] RESULT=error err=${e.message}`)
  }
})

test('mouse: wheel 滚动', async ({ page }) => {
  await page.goto(`data:text/html,
    <div id=c style="height:200px;overflow:auto">
      <div style="height:1000px;background:linear-gradient(red,blue)">long</div>
    </div>`)
  try {
    await page.mouse.wheel(0, 500)
    await page.waitForTimeout(300)
    const scrollTop = await page.evaluate(() => (document.getElementById('c') as HTMLElement).scrollTop)
    console.log(`[PROBE wheel] RESULT scrollTop=${scrollTop} (>0 表示滚动生效)`)
  } catch (e: any) {
    console.log(`[PROBE wheel] RESULT=error err=${e.message}`)
  }
})
