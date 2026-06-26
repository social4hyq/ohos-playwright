// 调试 emulateTimezone：对照精细化探针的姿势
import { test, expect } from '@playwright/test'

test('调试: 直接 CDP settimezone（不通过 fixture）', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const before = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  await session.detach()
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[DEBUG tz-direct] RESULT before=${before} after=${after}`)
})

test('调试: fixture emulateTimezone 加详细日志', async ({ page, emulateTimezone }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const before = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[DEBUG tz-fixture] before=${before}, calling emulateTimezone...`)
  await emulateTimezone('America/New_York')
  console.log(`[DEBUG tz-fixture] emulateTimezone returned, evaluating...`)
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[DEBUG tz-fixture] RESULT before=${before} after=${after}`)
  // 时区切换后 Intl 可能需要新实例，试 new DateTimeFormat
  const fmt = await page.evaluate(() => new Intl.DateTimeFormat('en-US', { timeZoneName: 'long' }).resolvedOptions().timeZone)
  console.log(`[DEBUG tz-fixture] new-fmt=${fmt}`)
})
