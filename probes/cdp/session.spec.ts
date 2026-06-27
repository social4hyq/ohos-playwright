// Ported from playwright-official/tests/library/chromium/session.spec.ts
// Tests newCDPSession against ArkWeb via ohos-playwright attach mode.
// Upstream fixture dependencies (server, browserTest, kTargetClosedErrorMessage)
// are inlined or replaced with data URLs — see header notes per test.

import { test, expect } from '@playwright/test'

test('smoke: probes/cdp/ discovered', async ({ page }) => {
  await page.goto('data:text/html,<h1>ok</h1>')
  expect(await page.evaluate(() => document.querySelector('h1')!.textContent)).toBe('ok')
})
