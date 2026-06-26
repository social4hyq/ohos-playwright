// 二次确认：用真实 HTTP origin（而非 data:）重测 localStorage 和 emulateDevice
import { test, expect } from '@playwright/test'
import type { DeviceDescriptor } from 'ohos-playwright/fixture'
import { writeFileSync } from 'node:fs'

// 起一个最小 HTTP server 在测试内
import http from 'node:http'

test('localStorage: 真实 HTTP origin', async ({ page }) => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end('<html><body><script>localStorage.setItem("k","v-from-http")</script>set</body></html>')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  const url = `http://127.0.0.1:${port}/`
  try {
    await page.goto(url)
    await page.waitForTimeout(300)
    const v = await page.evaluate(() => localStorage.getItem('k'))
    console.log(`[PROBE2 localStorage-http] RESULT val=${v}`)
  } catch (e: any) {
    console.log(`[PROBE2 localStorage-http] RESULT=error err=${e.message}`)
  } finally {
    server.close()
  }
})

test('emulateDevice: 是否真的改变了 viewport', async ({ page, emulateDevice }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  const before = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  await emulateDevice({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 3,
    isMobile: true,
  } as DeviceDescriptor)
  await page.waitForTimeout(500) // 等 emulation 生效
  const after = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  console.log(`[PROBE2 emulateDevice] RESULT before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
})
