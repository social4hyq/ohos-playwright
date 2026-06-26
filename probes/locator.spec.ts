// 探针：locator 高级 API（ArkWeb 可能差异点）
import { test, expect } from '@playwright/test'

test('locator: waitFor + textContent', async ({ page }) => {
  await page.goto('data:text/html,<div id=d>text</div>')
  await page.locator('#d').waitFor()
  const t = await page.locator('#d').textContent()
  console.log(`[PROBE locator-text] RESULT val=${t}`)
})

test('locator: toHaveText expect', async ({ page }) => {
  await page.goto('data:text/html,<p id=p>expected</p>')
  await expect(page.locator('#p')).toHaveText('expected')
  console.log(`[PROBE locator-toHaveText] RESULT=ok`)
})

test('expect: toHaveCount', async ({ page }) => {
  await page.goto('data:text/html,<li>a</li><li>b</li><li>c</li>')
  await expect(page.locator('li')).toHaveCount(3)
  console.log(`[PROBE expect-toHaveCount] RESULT=ok`)
})

test('expect: toHaveAttribute', async ({ page }) => {
  await page.goto('data:text/html,<a id=a href="/x">l</a>')
  await expect(page.locator('#a')).toHaveAttribute('href', '/x')
  console.log(`[PROBE expect-toHaveAttribute] RESULT=ok`)
})
