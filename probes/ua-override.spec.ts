// UA-override 直发 CDP 探针 —— 判定 ArkWeb 对 Emulation / Network domain
// setUserAgentOverride 的真实接受度。
//
// 背景：上一轮已证实 Emulation.setUserAgentOverride 被 ArkWeb ack 但 navigator.userAgent
// 不变（crPage.ts:997 这条路径走 Emulation domain）。本探针绕开 playwright-core，
// 直接通过 newCDPSession 试 Network.setUserAgentOverride —— 如果 ArkWeb 在 Network
// domain 上认这条命令，可解释为：adapter 层 fixture 可以拦截 crPage 的 UA 设置调用，
// 改走 Network domain；否则就是 ArkWeb 根本不接 UA override。
//
// 两条腿：
//   ArkWeb：./dist/cli.mjs test --config=probes/playwright.config.ts probes/ua-override.spec.ts
//   Edge：  OHOS_PW_CDP_URL=http://192.168.3.60:9222 ./dist/cli.mjs test \
//          --config=probes/playwright.config.ts probes/ua-override.spec.ts
import { test } from '@playwright/test'

const FAKE_UA = 'Mozilla/5.0 (OhosPwTestUA) PlaywrightProbe/1.0'

test('ua-override: Emulation.setUserAgentOverride (baseline reproduction)', async ({ page }) => {
  const s = await page.context().newCDPSession(page)
  try {
    await s.send('Emulation.setUserAgentOverride' as any, { userAgent: FAKE_UA })
    await page.goto('about:blank')
    const ua = await page.evaluate(() => navigator.userAgent)
    console.log(`[PROBE ua-override] via=Emulation result.ua="${ua}"`)
    console.log(`[PROBE ua-override] via=Emulation matches=${ua === FAKE_UA}`)
  } finally { await s.detach() }
})

test('ua-override: Network.setUserAgentOverride (the candidate)', async ({ page }) => {
  const s = await page.context().newCDPSession(page)
  try {
    await s.send('Network.enable' as any, {})
    await s.send('Network.setUserAgentOverride' as any, { userAgent: FAKE_UA })
    await page.goto('about:blank')
    const ua = await page.evaluate(() => navigator.userAgent)
    console.log(`[PROBE ua-override] via=Network result.ua="${ua}"`)
    console.log(`[PROBE ua-override] via=Network matches=${ua === FAKE_UA}`)
  } finally { await s.detach() }
})

test('ua-override: HTTP request header (does either route reach the wire?)', async ({ page }) => {
  // 用 page.route 截一个请求，看到达服务器的 UA 是哪个。
  // 即使 navigator.userAgent 不变，HTTP UA header 可能受 Network domain 影响。
  const s = await page.context().newCDPSession(page)
  try {
    await s.send('Network.enable' as any, {})
    await s.send('Network.setUserAgentOverride' as any, { userAgent: FAKE_UA })
    let observedUa = ''
    await page.route('https://www.baidu.com/', (route) => {
      observedUa = route.request().headers()['user-agent'] ?? ''
      route.fulfill({ status: 200, body: 'ok' })
    })
    await page.goto('https://www.baidu.com/', { waitUntil: 'domcontentloaded' }).catch(() => {})
    console.log(`[PROBE ua-override] via=Network http-ua="${observedUa}"`)
    console.log(`[PROBE ua-override] via=Network http-matches=${observedUa === FAKE_UA}`)
  } finally { await s.detach() }
})
