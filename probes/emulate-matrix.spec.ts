// 精细化：emulateDevice 参数矩阵 —— 哪个参数导致 setDeviceMetricsOverride 不生效
import { test, expect } from '@playwright/test'

async function tryMetrics(page: any, opts: any, label: string) {
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Emulation.setDeviceMetricsOverride' as any, opts)
    await page.waitForTimeout(300)
    const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    console.log(`[METRICS-MATRIX] ${label} RESULT vp=${JSON.stringify(vp)} opts=${JSON.stringify(opts)}`)
  } catch (e: any) {
    console.log(`[METRICS-MATRIX] ${label} RESULT=error err=${e.message}`)
  } finally {
    await session.detach()
  }
}

test('emulateDevice 参数矩阵', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  await tryMetrics(page, { width: 500, height: 400, deviceScaleFactor: 1, mobile: false }, 'A-base')
  await tryMetrics(page, { width: 500, height: 400, deviceScaleFactor: 3, mobile: false }, 'B-dsf3')
  await tryMetrics(page, { width: 500, height: 400, deviceScaleFactor: 1, mobile: true }, 'C-mobile')
  await tryMetrics(page, { width: 500, height: 400, deviceScaleFactor: 3, mobile: true }, 'D-dsf3-mobile')
  // emulateDevice fixture 用的是这个组合
  await tryMetrics(page, { width: 375, height: 812, deviceScaleFactor: 3, mobile: true }, 'E-fixture-like')
})
