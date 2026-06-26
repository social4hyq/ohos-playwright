// 探针：page.mouse.* 是否触发 DOM 事件 —— 跨引擎 A/B
//
// 目的：夯实 REPORT.md 第 116-120 行的论断——page.mouse.move/down/up/click
// 在 ArkWeb 上命令送达但 DOM 监听器不触发。需在 Edge 上跑同一探针确认
// chrome 不会出现该问题，证明这是 ArkWeb Input domain 根本性缺失，而非
// playwright connectOverCDP 模式的固有行为。
//
// 两条腿：
//   ArkWeb：./dist/cli.mjs test --config=probes/playwright.config.ts probes/ab-mouse.spec.ts
//   Edge：  OHOS_PW_CDP_URL=http://192.168.3.60:9222 ./dist/cli.mjs test \
//          --config=probes/playwright.config.ts probes/ab-mouse.spec.ts
import { test } from '@playwright/test'

test('ab-mouse: page.mouse move/down/up/click DOM delivery', async ({ page }) => {
  await page.goto(`data:text/html,
    <div id=target style="position:absolute;left:0;top:0;width:100px;height:100px"></div>
  `)
  await page.evaluate(() => {
    const t = document.getElementById('target')!
    ;(window as any).__events = []
    for (const type of ['mousemove', 'mousedown', 'mouseup', 'click']) {
      t.addEventListener(type, (e) => {
        ;(window as any).__events.push(type)
      })
    }
  })
  await page.mouse.move(50, 50)
  await page.mouse.down()
  await page.mouse.up()
  await page.mouse.click(50, 50)
  const events = await page.evaluate(() => (window as any).__events as string[])
  const sig = events.join(',')
  const pass = events.length >= 3 && events.includes('click')
  console.log(`[PROBE ab-mouse] events="${sig}"`)
  console.log(`[PROBE ab-mouse] pass=${pass}`)
})
