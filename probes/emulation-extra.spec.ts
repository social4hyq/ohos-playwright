// 探针：locale / timezone / reducedMotion emulation
import { test, expect } from '@playwright/test'

test('locale: CDP Emulation.setLocaleOverride', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  try {
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setLocaleOverride' as any, { locale: 'ja-JP' })
    await session.detach()
    const locale = await page.evaluate(() => navigator.language)
    const date = await page.evaluate(() => new Date(2020, 0, 15).toLocaleDateString())
    console.log(`[PROBE2 locale] RESULT navigator.language=${locale} date=${date}`)
  } catch (e: any) {
    console.log(`[PROBE2 locale] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('timezone: CDP Emulation.setTimezoneOverride', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  try {
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setTimezoneOverride' as any, { timezoneId: 'Asia/Tokyo' })
    await session.detach()
    const tz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
    const offset = await page.evaluate(() => new Date().getTimezoneOffset())
    console.log(`[PROBE2 timezone] RESULT tz=${tz} offset=${offset} (Tokyo=-540)`)
  } catch (e: any) {
    console.log(`[PROBE2 timezone] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})

test('reducedMotion: page.emulateMedia', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const reduce = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
    console.log(`[PROBE2 reducedMotion] RESULT reduce-matches=${reduce}`)
  } catch (e: any) {
    console.log(`[PROBE2 reducedMotion] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})
