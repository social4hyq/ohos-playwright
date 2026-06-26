// 探针：page.mouse.move / down / up（原始鼠标事件）
// CDP Input.dispatchMouseEvent 在 ArkWeb 下不触发 DOM element listeners（confirmed）。
// JS-fallback fixtures（mouseMove / mouseDown / mouseUp）仅对最简单的页面有效：
//   - 监听器不能引用外部变量（闭包）
//   - 元素只能有单个 addEventListener 调用
// 对任何实际应用均不可靠——page.mouse.* 仍为已知限制。
import { test } from '../dist/fixture.mjs'

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

// ── CDP 路径（已知不触发 DOM events） ─────────────────────────────────────────

test('mouse-raw: CDP mouse.move 触发 mousemove（已知限制）', async ({ page }) => {
  await page.goto(PAGE)
  const box = await page.locator('#t').boundingBox()
  const cx = box!.x + 50
  const cy = box!.y + 50
  try {
    await page.mouse.move(cx, cy)
    await page.waitForTimeout(200)
    const out = await page.locator('#o').textContent()
    console.log(`[PROBE mouse-move] RESULT events="${out?.trim()}" (""=DOM事件未触达，已知限制)`)
  } catch (e: any) {
    console.log(`[PROBE mouse-move] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('mouse-raw: CDP mouse.down + up（已知限制）', async ({ page }) => {
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
    console.log(`[PROBE mouse-down-up] RESULT events="${out?.trim()}" (""=DOM事件未触达，已知限制)`)
  } catch (e: any) {
    console.log(`[PROBE mouse-down-up] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

// ── JS-fallback fixtures（ArkWeb CDP 上下文隔离限制，对实际应用无效） ──────────
// 以下测试使用闭包监听器的 PAGE，预期结果均为 ""。
// fixtures 本身可正确 dispatch 事件；限制在于 ArkWeb 将回调路由到 CDP 隔离上下文，
// 导致引用外部变量的监听器（闭包）因 ReferenceError 静默失败。

test('mouse-raw: JS mouseMove fixture 对闭包监听器无效（预期 ""）', async ({ page, mouseMove }) => {
  await page.goto(PAGE)
  const box = await page.locator('#t').boundingBox()
  const cx = box!.x + 50
  const cy = box!.y + 50
  try {
    await mouseMove(cx, cy)
    await page.waitForTimeout(100)
    const out = await page.locator('#o').textContent()
    console.log(`[PROBE mouse-move-js] RESULT events="${out?.trim()}" (""=闭包监听器限制，已知)`)
  } catch (e: any) {
    console.log(`[PROBE mouse-move-js] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('mouse-raw: JS mouseMove steps 连续轨迹（预期 count=0）', async ({ page, mouseMove }) => {
  await page.goto(PAGE)
  const box = await page.locator('#t').boundingBox()
  const cx = box!.x + 50
  const cy = box!.y + 50
  try {
    await mouseMove(cx, cy, { steps: 5 })
    await page.waitForTimeout(100)
    const out = await page.locator('#o').textContent()
    const count = (out?.match(/mousemove/g) ?? []).length
    console.log(`[PROBE mouse-move-js-steps] RESULT mousemoveCount=${count} (0=闭包监听器限制，已知)`)
  } catch (e: any) {
    console.log(`[PROBE mouse-move-js-steps] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('mouse-raw: JS mouseDown + mouseUp fixture（预期 ""）', async ({ page, mouseDown, mouseUp }) => {
  await page.goto(PAGE)
  const box = await page.locator('#t').boundingBox()
  const cx = box!.x + 50
  const cy = box!.y + 50
  try {
    await mouseDown(cx, cy)
    await mouseUp(cx, cy)
    await page.waitForTimeout(100)
    const out = await page.locator('#o').textContent()
    console.log(`[PROBE mouse-down-up-js] RESULT events="${out?.trim()}" (""=闭包监听器限制，已知)`)
  } catch (e: any) {
    console.log(`[PROBE mouse-down-up-js] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})
