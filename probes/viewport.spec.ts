// 探针：setViewportSize（page 级 viewport 改变，对比 emulateDevice）
import { test, expect } from '@playwright/test'

test('setViewportSize: page.setViewportSize 改变 viewport', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const before = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  try {
    await page.setViewportSize({ width: 500, height: 400 })
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    console.log(`[PROBE setViewportSize] RESULT before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
  } catch (e: any) {
    console.log(`[PROBE setViewportSize] RESULT=error err=${e.message}`)
  }
})

test('CDP Emulation.setDeviceMetricsOverride 对比', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Emulation.setDeviceMetricsOverride' as any, {
      width: 500, height: 400, deviceScaleFactor: 1, mobile: false,
    })
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    console.log(`[PROBE cdp-viewport] RESULT after-cdp=${JSON.stringify(after)}`)
  } catch (e: any) {
    console.log(`[PROBE cdp-viewport] RESULT=error err=${e.message}`)
  } finally {
    await session.detach()
  }
})
