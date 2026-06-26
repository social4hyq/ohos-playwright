// 验证假设：setLocaleOverride（失败）是否"激活"了 Emulation 域，让 setTimezoneOverride 生效
import { test, expect } from '@playwright/test'

async function probeTz(page: any, label: string) {
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  } catch (e: any) {
    console.log(`[${label}] setTz-error=${e.message.split('\n')[0]}`)
  }
  await session.detach()
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[${label}] RESULT tz=${after} changed=${after === 'America/New_York'}`)
}

test('A. 仅 setTz（前置：无）', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  await probeTz(page, 'TZ-EXPERIMENT A')
})

test('B. 先 setLocale 再 setTz（前置：locale）', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Emulation.setLocaleOverride' as any, { locale: 'ja-JP' })
  } catch (e: any) {
    console.log(`[TZ-EXPERIMENT B] setLocale-error=${e.message.split('\n')[0]}`)
  }
  // 不 detach，复用同一 session
  try {
    await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  } catch (e: any) {
    console.log(`[TZ-EXPERIMENT B] setTz-error=${e.message.split('\n')[0]}`)
  }
  await session.detach()
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[TZ-EXPERIMENT B] RESULT tz=${after} changed=${after === 'America/New_York'}`)
})

test('C. setLocale + detach，再新 session setTz', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  let session = await page.context().newCDPSession(page)
  try {
    await session.send('Emulation.setLocaleOverride' as any, { locale: 'ja-JP' })
  } catch (e: any) {}
  await session.detach()
  // 新 session
  await probeTz(page, 'TZ-EXPERIMENT C')
})

test('D. 先 setDeviceMetricsOverride 再 setTz（前置：device metrics）', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Emulation.setDeviceMetricsOverride' as any, {
      width: 500, height: 400, deviceScaleFactor: 1, mobile: false,
    })
    await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'America/New_York' })
  } catch (e: any) {}
  await session.detach()
  const after = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  console.log(`[TZ-EXPERIMENT D] RESULT tz=${after} changed=${after === 'America/New_York'}`)
})
