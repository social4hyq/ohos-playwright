// 探针：toHaveScreenshot / locator.toHaveScreenshot 视觉对比 —— 跨引擎 A/B
//
// 注意：ohos-playwright 的 register.mts 将 process.platform shim 为 'linux'，
// 导致 Playwright 对 ArkWeb 和 Edge 两条腿都用相同的快照文件名（*-linux.png）。
// 跨引擎运行时必须用 SNAPSHOT_ENGINE 区分快照目录，否则会互相覆写基线。
//
// ArkWeb 首跑（生成基线）：
//   SNAPSHOT_ENGINE=arkweb OHOS_PW_HOST=1 ./dist/cli.mjs test \
//     --config=probes/playwright.config.ts probes/ab-visual-screenshot.spec.ts \
//     --update-snapshots
//
// ArkWeb 对比跑：
//   SNAPSHOT_ENGINE=arkweb OHOS_PW_HOST=1 ./dist/cli.mjs test \
//     --config=probes/playwright.config.ts probes/ab-visual-screenshot.spec.ts
//
// Edge 首跑（生成基线）：
//   SNAPSHOT_ENGINE=edge OHOS_PW_CDP_URL=http://172.16.100.2:9222 ./dist/cli.mjs test \
//     --config=probes/playwright.config.ts probes/ab-visual-screenshot.spec.ts \
//     --update-snapshots
import { test, expect } from '@playwright/test'

test('ab-visual-screenshot: full page toHaveScreenshot', async ({ page }) => {
  await page.goto(`data:text/html,<!DOCTYPE html>
<html><body style="margin:0;padding:0">
<div style="width:200px;height:100px;background:royalblue;color:white;
            display:flex;align-items:center;justify-content:center;
            font-family:monospace;font-size:14px">ohos-playwright</div>
</body></html>`)
  await expect(page).toHaveScreenshot('visual-full.png', { maxDiffPixelRatio: 0.05 })
  console.log('[PROBE ab-visual-screenshot] page.toHaveScreenshot=pass')
})

test('ab-visual-screenshot: element toHaveScreenshot', async ({ page }) => {
  await page.goto(`data:text/html,<!DOCTYPE html>
<html><body style="margin:0;padding:0">
<div id=box style="width:100px;height:100px;background:crimson"></div>
</body></html>`)
  await expect(page.locator('#box')).toHaveScreenshot('visual-element.png', {
    maxDiffPixelRatio: 0.05,
  })
  console.log('[PROBE ab-visual-screenshot] locator.toHaveScreenshot=pass')
})

test('ab-visual-screenshot: page.screenshot buffer non-empty', async ({ page }) => {
  await page.goto(`data:text/html,<body style="background:limegreen">`)
  const buf = await page.screenshot({ type: 'png' })
  const nonEmpty = buf.length > 1000
  console.log(`[PROBE ab-visual-screenshot] screenshot bytes=${buf.length} nonEmpty=${nonEmpty}`)
  expect(nonEmpty).toBe(true)
})
