// 假设：setTz 需要前置 Playwright locator/交互操作（不是 evaluate）才生效
import { test, expect } from '@playwright/test'

test('A. 前置 locator.textContent（非 evaluate）', async ({ page }) => {
  await page.goto('data:text/html,<h1 id=h>ready</h1>')
  // 用 locator 操作（不是 page.evaluate）
  await expect(page.locator('#h')).toHaveText('ready')
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  await page.waitForTimeout(200)
  await session.detach()
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[TZ-LOC A] after=${after} changed=${after === 'America/New_York'}`)
})

test('B. 前置 click', async ({ page }) => {
  await page.goto('data:text/html,<button id=b>go</button>')
  await page.locator('#b').click()
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  await page.waitForTimeout(200)
  await session.detach()
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[TZ-LOC B] after=${after} changed=${after === 'America/New_York'}`)
})

test('C. 前置 page.goto 两次（URL 变化触发 page 状态）', async ({ page }) => {
  await page.goto('data:text/html,<h1>first</h1>')
  await page.goto('data:text/html,<h1>second</h1>')
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  await page.waitForTimeout(200)
  await session.detach()
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[TZ-LOC C] after=${after} changed=${after === 'America/New_York'}`)
})

test('D. 前置 addInitScript + reload（注入脚本）', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  await page.addInitScript(() => { (window as any).__pwWarmed = true })
  await page.reload()
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  await page.waitForTimeout(200)
  await session.detach()
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[TZ-LOC D] after=${after} changed=${after === 'America/New_York'}`)
})
