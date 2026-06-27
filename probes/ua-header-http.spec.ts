// 探针：HTTP User-Agent header 的三条路径对照
//
// 背景：REPORT.md 第 27 行说 setExtraHTTPHeaders 自定义头到达服务器，但
// 第 60 行又说 setUserAgentOverride 不生效。需要验证 HTTP UA header 到底
// 能否通过 context.setExtraHTTPHeaders 改写——如果能，则当前 README
// 「UA 不可改」的描述需要细化。
//
// 三腿对照（每条都用真实本地 echo server）：
//   1. baseline：裸 ArkWeb，不设任何 override
//   2. setExtraHTTPHeaders：playwright API 设 User-Agent header
//   3. CDP Emulation.setUserAgentOverride：已知只改 JS 层 navigator.userAgent
//
// 跨引擎：同一探针在 Edge 上跑作 baseline。
//   ArkWeb：./dist/cli.mjs test --config=probes/playwright.config.ts probes/ua-header-http.spec.ts
//   Edge：  OHOS_PW_CDP_URL=http://192.168.3.60:9222 ./dist/cli.mjs test \
//          --config=probes/playwright.config.ts probes/ua-header-http.spec.ts
import { test } from '@playwright/test'
import http from 'node:http'
import { serverHost } from './helpers.js'

const FAKE_UA = 'OhosPwHeaderProbe/1.0'

function startEchoServer(): Promise<{ port: number; close: () => void }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ua: req.headers['user-agent'] ?? '' }))
    })
    server.listen(0, '0.0.0.0', () => {
      resolve({ port: (server.address() as any).port, close: () => server.close() })
    })
  })
}

async function probeUa(page: import('@playwright/test').Page, port: number): Promise<string> {
  // 直接 page.goto 让浏览器自身发起请求——避免 data: URL 的 CORS preflight 限制。
  // 服务器把收到的 User-Agent header 原样回显在 body 里。
  await page.goto(`http://${serverHost}:${port}/ua`)
  const body = await page.evaluate(() => document.body?.innerText ?? '')
  try {
    const parsed = JSON.parse(body)
    return (parsed.ua as string) ?? ''
  } catch {
    return body
  }
}

test('ua-header-http: baseline (no override)', async ({ page }) => {
  const srv = await startEchoServer()
  try {
    const ua = await probeUa(page, srv.port)
    console.log(`[PROBE ua-header-http] via=baseline result="${ua}"`)
    console.log(`[PROBE ua-header-http] via=baseline matches=${ua === FAKE_UA}`)
  } finally { srv.close() }
})

test('ua-header-http: context.setExtraHTTPHeaders', async ({ page, context }) => {
  const srv = await startEchoServer()
  try {
    await context.setExtraHTTPHeaders({ 'User-Agent': FAKE_UA })
    const ua = await probeUa(page, srv.port)
    console.log(`[PROBE ua-header-http] via=setExtraHTTPHeaders result="${ua}"`)
    console.log(`[PROBE ua-header-http] via=setExtraHTTPHeaders matches=${ua === FAKE_UA}`)
  } finally { srv.close() }
})

test('ua-header-http: CDP Emulation.setUserAgentOverride', async ({ page }) => {
  const srv = await startEchoServer()
  const s = await page.context().newCDPSession(page)
  try {
    await s.send('Emulation.setUserAgentOverride' as any, { userAgent: FAKE_UA })
    const ua = await probeUa(page, srv.port)
    console.log(`[PROBE ua-header-http] via=Emulation result="${ua}"`)
    console.log(`[PROBE ua-header-http] via=Emulation matches=${ua === FAKE_UA}`)
  } finally {
    await s.detach()
    srv.close()
  }
})

test('ua-header-http: JS-layer navigator.userAgent baseline', async ({ page }) => {
  // 对照点：三腿下 navigator.userAgent 的值，区分 JS 层与 HTTP 层。
  // Emulation.setUserAgentOverride 已知会改 navigator.userAgent（下次 goto 后），
  // setExtraHTTPHeaders 不应影响 navigator.userAgent，只改出站头。
  await page.goto('about:blank')
  const jsUa = await page.evaluate(() => navigator.userAgent)
  console.log(`[PROBE ua-header-http] js-navigator-ua="${jsUa}"`)
})
