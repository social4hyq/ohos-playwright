// 验证假设：setTimezoneOverride 后需要 waitForTimeout 才生效
import { test, expect } from '@playwright/test'

test('A. setTz 后立即读（不等待）', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  await session.detach()
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[TZ-WAIT A no-wait] RESULT tz=${after} changed=${after === 'America/New_York'}`)
})

test('B. setTz 后 waitForTimeout(100)', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  await page.waitForTimeout(100)
  await session.detach()
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[TZ-WAIT B 100ms] RESULT tz=${after} changed=${after === 'America/New_York'}`)
})

test('C. setTz 后 waitForTimeout(500)', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  await page.waitForTimeout(500)
  await session.detach()
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[TZ-WAIT C 500ms] RESULT tz=${after} changed=${after === 'America/New_York'}`)
})

test('D. setTz 后 reload（强制刷新 ICU）', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  await session.detach()
  await page.reload()
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[TZ-WAIT D reload] RESULT tz=${after} changed=${after === 'America/New_York'}`)
})
