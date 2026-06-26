import { test, expect } from '@playwright/test'

test('timezone 精细化：原始值 vs 设置后', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const before = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
    await page.waitForTimeout(200)
    const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
    console.log(`[TZ-ISOLATED] RESULT before=${before} after=${after} changed=${before !== after}`)
  } catch (e: any) {
    console.log(`[TZ-ISOLATED] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    await session.detach()
  }
})
