// 探针：locator.check / uncheck（checkbox 交互）
import { test } from '@playwright/test'

const PAGE = `data:text/html,
  <input type=checkbox id=c1>
  <input type=checkbox id=c2 checked>
  <input type=checkbox id=c3 disabled>`

test('locator.check: 未选中 → 选中', async ({ page }) => {
  await page.goto(PAGE)
  try {
    await page.locator('#c1').check()
    const checked = await page.locator('#c1').isChecked()
    console.log(`[PROBE check] RESULT checked=${checked} (true=ok)`)
  } catch (e: any) {
    console.log(`[PROBE check] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('locator.uncheck: 已选中 → 未选中', async ({ page }) => {
  await page.goto(PAGE)
  try {
    await page.locator('#c2').uncheck()
    const checked = await page.locator('#c2').isChecked()
    console.log(`[PROBE uncheck] RESULT checked=${checked} (false=ok)`)
  } catch (e: any) {
    console.log(`[PROBE uncheck] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('locator.check: 已选中时重复 check（幂等）', async ({ page }) => {
  await page.goto(PAGE)
  try {
    await page.locator('#c2').check()
    const checked = await page.locator('#c2').isChecked()
    console.log(`[PROBE check-idempotent] RESULT checked=${checked} (true=ok)`)
  } catch (e: any) {
    console.log(`[PROBE check-idempotent] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('locator.check: disabled checkbox', async ({ page }) => {
  await page.goto(PAGE)
  try {
    await page.locator('#c3').check({ timeout: 3000 })
    console.log(`[PROBE check-disabled] RESULT=ok (unexpected)`)
  } catch (e: any) {
    console.log(`[PROBE check-disabled] RESULT=error err=${e.message.split('\n')[0]} (error=expected)`)
  }
})

test('locator.setChecked: 统一 API', async ({ page }) => {
  await page.goto(PAGE)
  try {
    await page.locator('#c1').setChecked(true)
    const v1 = await page.locator('#c1').isChecked()
    await page.locator('#c1').setChecked(false)
    const v2 = await page.locator('#c1').isChecked()
    console.log(`[PROBE setChecked] RESULT v1=${v1} v2=${v2} (true,false=ok)`)
  } catch (e: any) {
    console.log(`[PROBE setChecked] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})
