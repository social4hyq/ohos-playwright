// 跨引擎 A/B baseline — 对 ArkWeb 和 vanilla Chrome 两条腿都跑同一组探针，
// 通过对比输出来实证哪些行为是 ArkWeb 根本性缺陷（非 Chromium 通用约束）。
//
// ArkWeb 腿：  ./dist/cli.mjs test --config=probes/playwright.config.ts probes/ab-baseline.spec.ts
// Chrome 腿：  OHOS_PW_CDP_URL=http://<win-ip>:9222 npx playwright test probes/ab-baseline.spec.ts
//             （必须在非 OpenHarmony 宿主执行，loader 才不会把 @playwright/test 重定向到 fixture.mts）
import { test, expect } from '@playwright/test'

test('ab-baseline: navigator.userAgent reachable', async ({ page }) => {
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

test('ab-baseline: serviceWorker present?', async ({ page }) => {
  await page.goto('about:blank')
  const hasSw = await page.evaluate(() => 'serviceWorker' in navigator)
  console.log(`[PROBE ab-baseline] serviceWorker=${hasSw}`)
})

test('ab-baseline: clipboard.readText returns string?', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
  await page.goto('about:blank')
  const result = await page.evaluate(async () => {
    try {
      return typeof await navigator.clipboard.readText()
    } catch (e: any) {
      return 'throw:' + e.message
    }
  })
  console.log(`[PROBE ab-baseline] clipboard.readText typeof=${result}`)
})

test('ab-baseline: Input.dispatchMouseEvent reaches DOM listeners?', async ({ page }) => {
  await page.goto(`data:text/html,
    <div id=t style="width:100px;height:100px"></div><pre id=o></pre>
    <script>
      const t = document.getElementById('t')
      const o = document.getElementById('o')
      t.addEventListener('mousemove', () => { o.textContent += 'mousemove ' })
      t.addEventListener('mousedown', () => { o.textContent += 'mousedown ' })
    </script>`)
  const box = await page.locator('#t').boundingBox()
  const cx = box!.x + 50; const cy = box!.y + 50
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(200)
  const out = await page.locator('#o').textContent()
  console.log(`[PROBE ab-baseline] mouse-dom-events="${out?.trim()}" (ArkWeb expects "")`)
})
