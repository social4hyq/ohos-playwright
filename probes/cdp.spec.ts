// 探针：CDP session + emulation
import { test, expect } from '@playwright/test'
import type { DeviceDescriptor } from 'ohos-playwright/fixture'

test('cdp: newCDPSession + Page.getLayoutMetrics', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const session = await page.context().newCDPSession(page)
  try {
    const { cssLayoutViewport } = await session.send('Page.getLayoutMetrics' as any)
    console.log(`[PROBE cdp-session] RESULT w=${cssLayoutViewport.clientWidth} h=${cssLayoutViewport.clientHeight}`)
  } catch (e: any) {
    console.log(`[PROBE cdp-session] RESULT=error err=${e.message}`)
  } finally {
    await session.detach().catch(()=>{})
  }
})

test('emulateDevice: mobile viewport', async ({ page, emulateDevice }) => {
  await emulateDevice({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 3,
    isMobile: true,
  } as DeviceDescriptor)
  const w = await page.evaluate(() => window.innerWidth)
  console.log(`[PROBE emulateDevice] RESULT innerWidth=${w}`)
})

test('emulateMedia: dark colorScheme', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  await page.emulateMedia({ colorScheme: 'dark' })
  const scheme = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)
  console.log(`[PROBE emulateMedia] RESULT dark-matches=${scheme}`)
})
