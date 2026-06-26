// 深度调试 timezone：找为什么 refine-extra 生效、debug-tz 不生效
import { test, expect } from '@playwright/test'

test('A. 单独 timezone（无前置）', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const before = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  await session.detach()
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[TZ-DEBUG A] before=${before} after=${after} changed=${before !== after}`)
})

test('B. 先 locale 再 timezone（模拟 refine-extra 顺序）', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setLocaleOverride' as any, { locale: 'ja-JP' })
  await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  await session.detach()
  const tz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[TZ-DEBUG B] tz=${tz}`)
})

test('C. timezone 后 reload 再读', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  await session.detach()
  await page.reload()
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[TZ-DEBUG C] after-reload=${after}`)
})

test('D. timezone 后 waitForTimeout 长一点', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  await session.detach()
  await page.waitForTimeout(500)
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[TZ-DEBUG D] after-wait=${after}`)
})
