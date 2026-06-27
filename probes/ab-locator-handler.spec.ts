// 探针：page.addLocatorHandler —— 跨引擎 A/B
//
// page.addLocatorHandler(locator, handler) 在 locator 出现时自动调用 handler，
// 用于自动关闭 cookie banner / modal 等干扰元素（since Playwright 1.44）。
//
// 两条腿：
//   ArkWeb：OHOS_PW_HOST=1 ./dist/cli.mjs test --config=probes/playwright.config.ts \
//             probes/ab-locator-handler.spec.ts
//   Edge：  OHOS_PW_CDP_URL=http://172.16.100.2:9222 ./dist/cli.mjs test \
//             --config=probes/playwright.config.ts probes/ab-locator-handler.spec.ts
import { test, expect } from '@playwright/test'

test('ab-locator-handler: auto-dismiss overlay before click', async ({ page }) => {
  await page.goto(`data:text/html,<!DOCTYPE html>
<html><body>
<div id=overlay style="position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:999;
     display:flex;align-items:center;justify-content:center">
  <button id=dismiss onclick="document.getElementById('overlay').remove()">OK</button>
</div>
<button id=target onclick="window.__clicked=true">Click me</button>
</body></html>`)

  let handlerFired = false
  await page.addLocatorHandler(page.locator('#overlay'), async () => {
    handlerFired = true
    await page.locator('#dismiss').click()
  })

  // Clicking #target should trigger the handler first (overlay is in the way)
  await page.locator('#target').click()

  const clicked = await page.evaluate(() => (window as any).__clicked)
  const overlayGone = !(await page.locator('#overlay').isVisible().catch(() => false))
  console.log(`[PROBE ab-locator-handler] handlerFired=${handlerFired} overlayGone=${overlayGone} targetClicked=${clicked}`)
  expect(handlerFired).toBe(true)
  expect(overlayGone).toBe(true)
})

test('ab-locator-handler: handler not called when locator absent', async ({ page }) => {
  await page.goto(`data:text/html,<button id=btn onclick="window.__ok=true">Go</button>`)

  let handlerFired = false
  await page.addLocatorHandler(page.locator('#nonexistent'), async () => {
    handlerFired = true
  })

  await page.locator('#btn').click()
  const clicked = await page.evaluate(() => (window as any).__ok)
  console.log(`[PROBE ab-locator-handler] no-overlay: handlerFired=${handlerFired} clicked=${clicked}`)
  expect(handlerFired).toBe(false)
  expect(clicked).toBe(true)
})
