// 探针：var vs const 对 Input.dispatchMouseEvent DOM 事件触达的影响
//
// 假设：ArkWeb 把所有事件回调（包括 Input.dispatchMouseEvent 触发的 DOM 监听器）
// 路由到隔离的 CDP V8 执行上下文。在该上下文中：
//   - var 声明的变量 → 挂在 window 上 → 可访问 ✅
//   - const/let 声明的变量 → 块作用域，不在 window 上 → 访问时 ReferenceError → 静默失败 ❌
//
// 验证方法：用 page.mouse.move/down/up 触发 DOM 事件，对比 var/const 两种写法的结果。
import { test } from '../dist/fixture.mjs'

// ── 使用 var 的监听器（预期：事件送达）────────────────────────────────────────

test('mouse-var: page.mouse.move/down 用 var 声明，事件应送达', async ({ page }) => {
  await page.goto(`data:text/html,<div id=t style="width:100px;height:100px;background:gray"></div><pre id=o></pre><script>var t=document.getElementById('t'),o=document.getElementById('o');t.addEventListener('mousemove',function(){o.textContent+='mousemove '});t.addEventListener('mousedown',function(){o.textContent+='mousedown '})</script>`)
  const box = await page.locator('#t').boundingBox()
  const cx = box!.x + 50; const cy = box!.y + 50
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(300)
  const out = await page.locator('#o').textContent()
  console.log(`[PROBE var] events="${out?.trim()}" (预期: "mousemove mousedown")`)
})

// ── 使用 const 的监听器（预期：静默失败）─────────────────────────────────────

test('mouse-const: page.mouse.move/down 用 const 声明，预期静默失败', async ({ page }) => {
  // 注意：监听器内引用 const 变量 o，在 ArkWeb 隔离上下文下不可访问
  await page.goto(`data:text/html,<div id=t style="width:100px;height:100px;background:gray"></div><pre id=o></pre><script>const t=document.getElementById('t');const o=document.getElementById('o');t.addEventListener('mousemove',function(){o.textContent+='mousemove '});t.addEventListener('mousedown',function(){o.textContent+='mousedown '})</script>`)
  const box = await page.locator('#t').boundingBox()
  const cx = box!.x + 50; const cy = box!.y + 50
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(300)
  const out = await page.locator('#o').textContent()
  console.log(`[PROBE const] events="${out?.trim()}" (ArkWeb预期: "" 因隔离上下文闭包失败；Chromium预期: "mousemove mousedown")`)
})

// ── 使用 window.xxx 显式赋值（预期：等价 var，事件送达）─────────────────────

test('mouse-window: 显式 window.xxx 赋值，事件应送达', async ({ page }) => {
  await page.goto(`data:text/html,<div id=t style="width:100px;height:100px;background:gray"></div><pre id=o></pre><script>window.tEl=document.getElementById('t');window.oEl=document.getElementById('o');window.tEl.addEventListener('mousemove',function(){window.oEl.textContent+='mousemove '});window.tEl.addEventListener('mousedown',function(){window.oEl.textContent+='mousedown '})</script>`)
  const box = await page.locator('#t').boundingBox()
  const cx = box!.x + 50; const cy = box!.y + 50
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(300)
  const out = await page.locator('#o').textContent()
  console.log(`[PROBE window] events="${out?.trim()}" (预期: "mousemove mousedown")`)
})

// ── 使用 const + 事件参数本身（不引用外部变量）──────────────────────────────

test('mouse-const-no-closure: const 但监听器不引用外部变量，应送达', async ({ page }) => {
  // 监听器只访问 e.type（来自事件对象本身），不引用任何外部 const/let 变量
  // 如果隔离上下文问题只在于"闭包访问 const"，此处应该可以工作
  await page.goto(`data:text/html,<div id=t style="width:100px;height:100px;background:gray"></div><script>const t=document.getElementById('t');t.addEventListener('mousemove',function(e){document.getElementById('o').textContent+=e.type+' '});t.addEventListener('mousedown',function(e){document.getElementById('o').textContent+=e.type+' '})</script><pre id=o></pre>`)
  const box = await page.locator('#t').boundingBox()
  const cx = box!.x + 50; const cy = box!.y + 50
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(300)
  const out = await page.locator('#o').textContent()
  console.log(`[PROBE const-no-closure] events="${out?.trim()}" (预期: "mousemove mousedown" 因无外部闭包依赖)`)
})
