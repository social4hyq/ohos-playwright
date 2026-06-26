// 验证假设：send 前先 evaluate（预热 Page agent）才能让 setTz 生效
import { test, expect } from '@playwright/test'

test('A. 先 evaluate 预热，再 setTz，再 waitForTimeout', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const before = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)  // 预热
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  await page.waitForTimeout(200)
  await session.detach()
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[TZ-WARM A] before=${before} after=${after} changed=${before !== after}`)
})

test('B. 先 evaluate 预热（读别的），再 setTz', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  await page.evaluate(() => 1 + 1)  // 预热但不读 tz
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  await page.waitForTimeout(200)
  await session.detach()
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[TZ-WARM B] after=${after} changed=${after === 'America/New_York'}`)
})

test('C. 不预热，setTz 后 evaluate 触发', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  await session.detach()
  // 第一次 evaluate（触发），第二次读
  await page.evaluate(() => void Intl.DateTimeFormat())
  await page.waitForTimeout(200)
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[TZ-WARM C] after=${after} changed=${after === 'America/New_York'}`)
})
