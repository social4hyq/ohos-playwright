// 探针：page.mouse.move / down / up（原始鼠标事件，独立于 hover）
import { test } from '@playwright/test'

const PAGE = `data:text/html,
  <div id=t style="width:100px;height:100px;background:gray;user-select:none"></div>
  <pre id=o></pre>
  <script>
    const t = document.getElementById('t')
    const o = document.getElementById('o')
    const log = (e) => { o.textContent += e.type + ':' + e.buttons + ' '; }
    t.addEventListener('mousemove', log)
    t.addEventListener('mousedown', log)
    t.addEventListener('mouseup', log)
    t.addEventListener('click', log)
  </script>`

test('mouse-raw: mouse.move 触发 mousemove 事件', async ({ page }) => {
  await page.goto(PAGE)
  const box = await page.locator('#t').boundingBox()
  const cx = box!.x + 50
  const cy = box!.y + 50
  try {
    await page.mouse.move(cx, cy)
    await page.waitForTimeout(200)
    const out = await page.locator('#o').textContent()
    console.log(`[PROBE mouse-move] RESULT events="${out?.trim()}"`)
  } catch (e: any) {
    console.log(`[PROBE mouse-move] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('mouse-raw: mouse.down + up 触发 click', async ({ page }) => {
  await page.goto(PAGE)
  const box = await page.locator('#t').boundingBox()
  const cx = box!.x + 50
  const cy = box!.y + 50
  try {
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(200)
    const out = await page.locator('#o').textContent()
    console.log(`[PROBE mouse-down-up] RESULT events="${out?.trim()}"`)
  } catch (e: any) {
    console.log(`[PROBE mouse-down-up] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('mouse-raw: mouse.move 连续轨迹（steps）', async ({ page }) => {
  await page.goto(PAGE)
  const box = await page.locator('#t').boundingBox()
  const startX = box!.x + 10
  const startY = box!.y + 50
  const endX = box!.x + 90
  try {
    await page.mouse.move(startX, startY)
    await page.mouse.move(endX, startY, { steps: 5 })
    await page.waitForTimeout(200)
    const out = await page.locator('#o').textContent()
    const moveCount = (out?.match(/mousemove/g) ?? []).length
    console.log(`[PROBE mouse-move-steps] RESULT mousemoveCount=${moveCount} (>=5=ok)`)
  } catch (e: any) {
    console.log(`[PROBE mouse-move-steps] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('mouse-raw: mouse.click（高层 API 完整路径）', async ({ page }) => {
  await page.goto(PAGE)
  const box = await page.locator('#t').boundingBox()
  try {
    await page.mouse.click(box!.x + 50, box!.y + 50)
    await page.waitForTimeout(200)
    const out = await page.locator('#o').textContent()
    console.log(`[PROBE mouse-click] RESULT events="${out?.trim()}"`)
  } catch (e: any) {
    console.log(`[PROBE mouse-click] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})
