// 探针：输入
import { test, expect } from '@playwright/test'

test('input: locator.fill', async ({ page }) => {
  await page.goto('data:text/html,<input id=i>')
  await page.locator('#i').fill('hello')
  const v = await page.inputValue('#i')
  console.log(`[PROBE fill] RESULT val=${v}`)
})

test('input: locator.type', async ({ page }) => {
  await page.goto('data:text/html,<input id=i>')
  await page.locator('#i').type('abc')
  const v = await page.inputValue('#i')
  console.log(`[PROBE type] RESULT val=${v}`)
})

test('input: keyboard.press', async ({ page }) => {
  await page.goto('data:text/html,<input id=i><span id=o></span>')
  await page.focus('#i')
  await page.keyboard.press('Shift+KeyA')
  await page.keyboard.type('x')
  const v = await page.inputValue('#i')
  console.log(`[PROBE keyboard] RESULT val=${v}`)
})

test('input: select option', async ({ page }) => {
  await page.goto('data:text/html,<select id=s><option>a</option><option>b</option></select>')
  await page.selectOption('#s', 'b')
  const v = await page.inputValue('#s')
  console.log(`[PROBE select] RESULT val=${v}`)
})
