import { test, expect } from '@playwright/test'

test('baseline: goto data url + evaluate', async ({ page }) => {
  await page.goto('data:text/html,<h1>ok</h1>')
  expect(await page.evaluate(() => document.querySelector('h1')!.textContent)).toBe('ok')
})

test('baseline: viewportSize non-null', async ({ page }) => {
  expect(page.viewportSize()).not.toBeNull()
})
