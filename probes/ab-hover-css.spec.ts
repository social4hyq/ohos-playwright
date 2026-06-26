// 探针：locator.hover() 是否激活 CSS :hover —— 跨引擎 A/B
//
// 目的：夯实 REPORT.md 第 108-114 行论断——fixture 层 JS dispatch 已让
// mouseover/mouseenter 触发，但 CSS :hover 伪类因合成事件无真实指针位置
// 而不激活。需在 Edge 上跑同一探针确认 chrome 上 :hover 正常激活。
//
// 两条腿：
//   ArkWeb：./dist/cli.mjs test --config=probes/playwright.config.ts probes/ab-hover-css.spec.ts
//   Edge：  OHOS_PW_CDP_URL=http://192.168.3.60:9222 ./dist/cli.mjs test \
//          --config=probes/playwright.config.ts probes/ab-hover-css.spec.ts
import { test } from '@playwright/test'

test('ab-hover-css: locator().hover() :hover pseudo-class activation', async ({ page }) => {
  await page.goto(`data:text/html,
    <style>div:hover { color: rgb(255, 0, 0); }</style>
    <div id=target style="width:100px;height:100px">hi</div>
  `)
  const before = await page.locator('#target').evaluate((el) => getComputedStyle(el).color)
  await page.locator('#target').hover()
  const after = await page.locator('#target').evaluate((el) => getComputedStyle(el).color)
  const activated = after === 'rgb(255, 0, 0)'
  console.log(`[PROBE ab-hover-css] via=fixture-hover before=${before} after=${after}`)
  console.log(`[PROBE ab-hover-css] via=fixture-hover activated=${activated}`)
})

test('ab-hover-css: raw page.mouse move+down+up :hover activation', async ({ page }) => {
  // 试探：既然 ab-mouse 实测 Input.dispatchMouseEvent 正常触发 DOM 事件，
  // 直接用 page.mouse.* 走原生 CDP 路径（绕开 fixture 的 JS dispatch hack）。
  // 期望：真实指针位置被设置，:hover 伪类激活。
  await page.goto(`data:text/html,
    <style>div:hover { color: rgb(255, 0, 0); }</style>
    <div id=target style="position:absolute;left:0;top:0;width:100px;height:100px">hi</div>
  `)
  const before = await page.locator('#target').evaluate((el) => getComputedStyle(el).color)
  const box = await page.locator('#target').evaluate((el) => {
    const r = (el as HTMLElement).getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await page.mouse.move(box.x, box.y)
  await page.mouse.down()
  await page.mouse.up()
  const after = await page.locator('#target').evaluate((el) => getComputedStyle(el).color)
  const activated = after === 'rgb(255, 0, 0)'
  console.log(`[PROBE ab-hover-css] via=raw-mouse before=${before} after=${after}`)
  console.log(`[PROBE ab-hover-css] via=raw-mouse activated=${activated}`)
})
