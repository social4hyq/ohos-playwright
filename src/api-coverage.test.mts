// 真机端到端测试 — 需要 CDP 端点（~/.tmp/ohos-playwright-cdp.json）
// 运行方式：ohos-playwright test src/api-coverage.test.mts
import { test, expect } from '@playwright/test'
import type { DeviceDescriptor } from './fixture.mts'

// ─── network-interception ─────────────────────────────────────────────────────

test('network-interception: route.fulfill returns mock response', async ({ page }) => {
  await page.route('**/api/mock-json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
  )
  const response = await page.evaluate(async () => {
    const res = await fetch('/api/mock-json')
    return res.json()
  })
  expect(response).toEqual({ ok: true })
  await page.unroute('**/api/mock-json')
})

test('network-interception: route.abort causes fetch rejection', async ({ page }) => {
  await page.route('**/api/will-abort', (route) => route.abort())
  const error = await page.evaluate(async () => {
    try {
      await fetch('/api/will-abort')
      return null
    } catch (e) {
      return (e as Error).message
    }
  })
  expect(typeof error).toBe('string')
  expect(error!.length).toBeGreaterThan(0)
  await page.unroute('**/api/will-abort')
})

// ─── screenshot ───────────────────────────────────────────────────────────────

test('screenshot: page.screenshot returns JPEG magic bytes', async ({ page }) => {
  const buf = await page.screenshot({ type: 'jpeg' })
  // JPEG magic bytes: FF D8 FF
  expect(buf[0]).toBe(0xff)
  expect(buf[1]).toBe(0xd8)
  expect(buf[2]).toBe(0xff)
})

test('screenshot: locator.screenshot captures element', async ({ page }) => {
  await page.goto('about:blank')
  await page.setContent('<div id="box" style="width:100px;height:100px;background:red"></div>')
  const buf = await page.locator('#box').screenshot()
  expect(buf.byteLength).toBeGreaterThan(100)
})

// ─── geolocation-emulation ────────────────────────────────────────────────────

test('geolocation-emulation: setGeolocation + getCurrentPosition', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 37.7749, longitude: -122.4194 })

  const coords = await page.evaluate(
    () =>
      new Promise<{ lat: number; lon: number }>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
          (err) => reject(new Error(err.message)),
        )
      }),
  )

  expect(coords.lat).toBeCloseTo(37.7749, 3)
  expect(coords.lon).toBeCloseTo(-122.4194, 3)

  // 恢复
  await context.setGeolocation({ latitude: 0, longitude: 0 })
})

// ─── device-emulation ─────────────────────────────────────────────────────────

test('device-emulation: emulateDevice sets viewport size', async ({ page, emulateDevice }) => {
  const descriptor: DeviceDescriptor = {
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 3,
    isMobile: true,
  }
  await emulateDevice(descriptor)

  const size = await page.evaluate(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }))
  expect(size.w).toBe(375)
  expect(size.h).toBe(812)

  // 恢复默认
  await emulateDevice({ viewport: { width: 1280, height: 720 }, isMobile: false })
})

test('device-emulation: emulateDevice sets user-agent', async ({ page, emulateDevice }) => {
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
  await emulateDevice({ viewport: { width: 375, height: 812 }, userAgent: ua })

  const reportedUA = await page.evaluate(() => navigator.userAgent)
  expect(reportedUA).toBe(ua)

  // 恢复
  await emulateDevice({ viewport: { width: 1280, height: 720 } })
})

// ─── input-api ────────────────────────────────────────────────────────────────

test('input-api: locator.fill + keyboard.press submits form', async ({ page }) => {
  await page.goto('about:blank')
  await page.setContent(`
    <form id="f" onsubmit="window._submitted=document.querySelector('input').value;return false">
      <input id="q" type="text"/>
      <button type="submit">Go</button>
    </form>
  `)

  await page.locator('#q').fill('hello ohos')
  await page.keyboard.press('Enter')

  const submitted = await page.evaluate(() => (window as unknown as { _submitted: string })._submitted)
  expect(submitted).toBe('hello ohos')
})

test('input-api: locator.type sends individual keystrokes', async ({ page }) => {
  await page.goto('about:blank')
  await page.setContent('<input id="t" type="text"/>')

  await page.locator('#t').type('abc')
  const val = await page.locator('#t').inputValue()
  expect(val).toBe('abc')
})

// ─── cookie-api ───────────────────────────────────────────────────────────────

test('cookie-api: addCookies / cookies / clearCookies roundtrip', async ({ page, context }) => {
  const url = page.url()
  const domain = (url && url !== 'about:blank') ? new URL(url).hostname : 'localhost'

  await context.addCookies([
    { name: 'ohos_test', value: 'playwright_coverage', domain, path: '/' },
  ])

  const cookies = await context.cookies()
  const found = cookies.find((c) => c.name === 'ohos_test')
  expect(found).toBeDefined()
  expect(found!.value).toBe('playwright_coverage')

  await context.clearCookies()
  const afterClear = await context.cookies()
  expect(afterClear.find((c) => c.name === 'ohos_test')).toBeUndefined()
})
