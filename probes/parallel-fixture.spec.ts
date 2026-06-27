// 验证 ohos-playwright/parallel fixture 在 workers=2 下的隔离性与 ArkWeb workaround。
//
// 跑法（需要 hdc fport 已建立且 PW_CHROMIUM_ATTACH_TO_OTHER=1）：
//   OHOS_PW_HOST=1 PW_CHROMIUM_ATTACH_TO_OTHER=1 node dist/cli.mjs test \
//     --config=probes/playwright.config.ts --workers=2 --fully-parallel \
//     probes/parallel-fixture.spec.ts
import { test, expect } from 'ohos-playwright/parallel'

// 两个 test 由 --fully-parallel + workers=2 分配到不同 worker。
// 每个 test 有自己的 newPage()；写入 data URL 并读回，验证不跨 worker 串扰。
test('parallel-fixture: page isolation — first test', async ({ page }, testInfo) => {
  const marker = `w${testInfo.workerIndex}-a-${Math.random().toString(36).slice(2, 8)}`
  await page.goto(`data:text/html,<div id=m>${marker}</div>`)
  const text = await page.evaluate(() => document.getElementById('m')?.textContent ?? '')
  console.log(`[PROBE parallel-fixture] worker=${testInfo.workerIndex} marker=${marker} got="${text}" isolated=${text === marker}`)
  expect(text).toBe(marker)
})

test('parallel-fixture: page isolation — second test', async ({ page }, testInfo) => {
  const marker = `w${testInfo.workerIndex}-b-${Math.random().toString(36).slice(2, 8)}`
  await page.goto(`data:text/html,<div id=m>${marker}</div>`)
  const text = await page.evaluate(() => document.getElementById('m')?.textContent ?? '')
  console.log(`[PROBE parallel-fixture] worker=${testInfo.workerIndex} marker=${marker} got="${text}" isolated=${text === marker}`)
  expect(text).toBe(marker)
})

// goBack workaround 验证（ArkWeb 独有的 CDP polling 实现）
test('parallel-fixture: goBack workaround', async ({ page }) => {
  await page.goto('data:text/html,<div id=p>page1</div>')
  await page.goto('data:text/html,<div id=p>page2</div>')
  await page.goBack({ timeout: 10000 })
  const text = await page.evaluate(() => document.getElementById('p')?.textContent ?? '')
  expect(text).toBe('page1')
})
