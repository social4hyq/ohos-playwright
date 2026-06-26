// 跨引擎 A/B baseline — 对 ArkWeb 和 vanilla Chrome/Edge 两条腿都跑同一组探针，
// 通过对比输出来实证哪些行为是 ArkWeb 根本性缺陷（非 Chromium 通用约束）。
//
// ArkWeb 腿：  ./dist/cli.mjs test --config=probes/playwright.config.ts probes/ab-baseline.spec.ts
// Edge/Chrome 腿（同一宿主，借助 OHOS_PW_CDP_URL）：
//   OHOS_PW_CDP_URL=http://<win-ip>:9222 ./dist/cli.mjs test --config=probes/playwright.config.ts probes/ab-baseline.spec.ts
//
// 注意：mouse DOM 事件测试在 Edge/Chrome 上需要窗口处于前台，否则同样输出 ""。
import { test, expect } from '@playwright/test'

test('ab-baseline: navigator.userAgent', async ({ page }) => {
  await page.goto('about:blank')
  const ua = await page.evaluate(() => navigator.userAgent)
  console.log(`[PROBE ab-baseline] ua="${ua}"`)
  expect(ua.length).toBeGreaterThan(0)
})

test('ab-baseline: navigator.language', async ({ page }) => {
  await page.goto('about:blank')
  const lang = await page.evaluate(() => navigator.language)
  console.log(`[PROBE ab-baseline] language="${lang}"`)
  expect(typeof lang).toBe('string')
})

// serviceWorker：检查 ServiceWorkerContainer 类自身是否存在（不受安全上下文限制），
// 与 'serviceWorker' in navigator 不同——后者在非安全上下文下也返回 false。
// ArkWeb 根本未实现 SW，所以 ServiceWorkerContainer 类不存在；
// Chrome/Edge 即使在 data: 页也有该类（只是实例不可用）。
test('ab-baseline: ServiceWorkerContainer class exists?', async ({ page }) => {
  await page.goto('data:text/html,<script>window.__swc = typeof ServiceWorkerContainer</script>')
  const swc = await page.evaluate(() => typeof ServiceWorkerContainer)
  const inNav = await page.evaluate(() => 'serviceWorker' in navigator)
  const isSecure = await page.evaluate(() => window.isSecureContext)
  console.log(`[PROBE ab-baseline] ServiceWorkerContainer=${swc} inNavigator=${inNav} isSecureContext=${isSecure}`)
  // Chrome/Edge: swc="function", ArkWeb: swc="undefined"
})

// clipboard：区分"API 类不存在"vs"安全上下文门控"。
// Clipboard 类存在 → 引擎实现了 API，只是当前上下文受限；
// Clipboard 类不存在 → 引擎根本没实现（ArkWeb 情形）。
test('ab-baseline: Clipboard API class exists?', async ({ page }) => {
  await page.goto('data:text/html,')
  const clipboardType = await page.evaluate(() => typeof Clipboard)
  const clipboardNavType = await page.evaluate(() => typeof (navigator as any).clipboard)
  const isSecure = await page.evaluate(() => window.isSecureContext)
  console.log(`[PROBE ab-baseline] Clipboard class=${clipboardType} navigator.clipboard=${clipboardNavType} isSecureContext=${isSecure}`)
  // Chrome/Edge: Clipboard="function", nav.clipboard="undefined"（data: 是非安全上下文）
  // ArkWeb: Clipboard="undefined", nav.clipboard="undefined"（根本没实现）
})

// mouse DOM 事件：Input.dispatchMouseEvent 是否送达 DOM 监听器。
// 重要：Edge/Chrome 在 Windows 上需要窗口处于前台（有焦点）才能送达；
// ArkWeb 即使窗口在前台也不送达（内核未接通 Input domain → DOM 管线）。
// 若两边都输出 ""，说明 Edge 窗口未前台，不代表 ArkWeb 行为是正常的。
test('ab-baseline: Input.dispatchMouseEvent reaches DOM listeners?', async ({ page }) => {
  await page.goto(`data:text/html,<div id=t style="width:100px;height:100px;background:gray"></div><pre id=o></pre><script>var t=document.getElementById('t'),o=document.getElementById('o');t.addEventListener('mousemove',function(){o.textContent+='mousemove '});t.addEventListener('mousedown',function(){o.textContent+='mousedown '})</script>`)
  const box = await page.locator('#t').boundingBox()
  const cx = box!.x + 50; const cy = box!.y + 50
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(300)
  const out = await page.locator('#o').textContent()
  console.log(`[PROBE ab-baseline] mouse-dom-events="${out?.trim()}" (edge/chrome需要窗口前台；arkweb即使前台也"")`)
})

// locator.click 是否触发 DOM click 事件（对比 page.mouse.* 的区别）。
// 两边均应工作：locator.click 走不同内部路径（CDP DOM + 元素聚焦），不依赖窗口焦点。
test('ab-baseline: locator.click triggers DOM click listener?', async ({ page }) => {
  await page.goto(`data:text/html,<button id=b>click</button><pre id=o></pre><script>var o=document.getElementById('o');document.getElementById('b').addEventListener('click',function(){o.textContent='clicked'})</script>`)
  await page.locator('#b').click()
  await page.waitForTimeout(200)
  const out = await page.locator('#o').textContent()
  console.log(`[PROBE ab-baseline] locator-click="${out?.trim()}" (两边均应=clicked)`)
  expect(out?.trim()).toBe('clicked')
})
