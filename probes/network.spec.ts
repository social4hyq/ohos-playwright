// 探针：network interception（route）
import { test, expect } from '@playwright/test'

test('route: fulfill a fake response', async ({ page }) => {
  await page.route('**/fake.json', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true }),
  }))
  const res = await page.goto('data:application/json,{"a":1}') // data url 不走路由，先测路由注册是否报错
  console.log(`[PROBE route-register] RESULT=ok route-registered`)
  await page.unroute('**/fake.json').catch(()=>{})
})

test('route: abort', async ({ page }) => {
  let aborted = false
  await page.route('**/*.png', route => { aborted = true; route.abort().catch(()=>{}) })
  console.log(`[PROBE route-abort] RESULT=ok route-registered`)
  await page.unroute('**/*.png').catch(()=>{})
})
