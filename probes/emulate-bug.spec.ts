// 精细化 emulateDevice bug 复测：逐步隔离哪个 CDP 命令触发 page 关闭
import { test, expect } from '@playwright/test'

test('emulateDevice 精细化：仅 newCDPSession（不发送任何命令）', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  try {
    const session = await page.context().newCDPSession(page)
    console.log(`[EMULATE-STEP1] RESULT newCDPSession=ok`)
    await session.detach()
    const alive = await page.evaluate(() => document.title)
    console.log(`[EMULATE-STEP1] RESULT after-detach page-alive title=${alive}`)
  } catch (e: any) {
    console.log(`[EMULATE-STEP1] RESULT=error err=${e.message}`)
  }
})

test('emulateDevice 精细化：setDeviceMetricsOverride width/height', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  try {
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setDeviceMetricsOverride' as any, {
      width: 375, height: 812, deviceScaleFactor: 1, mobile: false,
    })
    console.log(`[EMULATE-STEP2] RESULT setMetrics=ok`)
    await session.detach()
    const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    console.log(`[EMULATE-STEP2] RESULT after-set viewport=${JSON.stringify(vp)}`)
  } catch (e: any) {
    console.log(`[EMULATE-STEP2] RESULT=error err=${e.message}`)
  }
})

test('emulateDevice 精细化：setDeviceMetricsOverride + mobile:true', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  try {
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setDeviceMetricsOverride' as any, {
      width: 375, height: 812, deviceScaleFactor: 3, mobile: true,
    })
    console.log(`[EMULATE-STEP3] RESULT setMetrics-mobile=ok`)
    await session.detach()
  } catch (e: any) {
    console.log(`[EMULATE-STEP3] RESULT=error err=${e.message}`)
  }
})

test('emulateDevice 精细化：setUserAgentOverride', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  try {
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setUserAgentOverride' as any, {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
    })
    console.log(`[EMULATE-STEP4] RESULT setUA=ok`)
    await session.detach()
    const ua = await page.evaluate(() => navigator.userAgent)
    console.log(`[EMULATE-STEP4] RESULT after-set ua=${ua.slice(0,40)}`)
  } catch (e: any) {
    console.log(`[EMULATE-STEP4] RESULT=error err=${e.message}`)
  }
})

test('emulateDevice 精细化：metrics 后 page.reload', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  try {
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setDeviceMetricsOverride' as any, {
      width: 375, height: 812, deviceScaleFactor: 1, mobile: false,
    })
    await session.detach()
    console.log(`[EMULATE-STEP5] RESULT before-reload page-alive`)
    await page.reload()
    console.log(`[EMULATE-STEP5] RESULT after-reload ok`)
  } catch (e: any) {
    console.log(`[EMULATE-STEP5] RESULT=error err=${e.message}`)
  }
})
