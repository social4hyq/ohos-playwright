// 探针：httpCredentials (Basic Auth 自动注入) —— 跨引擎 A/B
//
// context.httpCredentials 在 connectOverCDP 模式下需要 newContext({ httpCredentials })，
// 因此要求 PW_CHROMIUM_ATTACH_TO_OTHER=1。
//
// 两条腿：
//   ArkWeb：OHOS_PW_HOST=1 PW_CHROMIUM_ATTACH_TO_OTHER=1 ./dist/cli.mjs test \
//             --config=probes/playwright.config.ts probes/ab-http-credentials.spec.ts
//   Edge：  OHOS_PW_CDP_URL=http://172.16.100.2:9222 PW_CHROMIUM_ATTACH_TO_OTHER=1 \
//             ./dist/cli.mjs test --config=probes/playwright.config.ts \
//             probes/ab-http-credentials.spec.ts
import { test as base } from '@playwright/test'
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
function readEndpoint(): string {
  const url = process.env.OHOS_PW_CDP_URL
  if (url) return url
  const infoPath = process.env.OHOS_PW_INFO_PATH ?? resolve(tmpdir(), 'ohos-playwright-cdp.json')
  return JSON.parse(readFileSync(infoPath, 'utf8')).endpoint
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | void> =>
  Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))])

// httpCredentials requires a real HTTP server (not page.route()) because
// Playwright's credentials injection and route interception both use Fetch.enable —
// they conflict and credentials are not injected when route is active.
//
// Cross-machine strategy: server listens on 0.0.0.0, browser uses the
// reachable host IP (127.0.0.1 for ArkWeb on same machine, 172.16.100.1
// for Edge on Windows — same /24 subnet as HarmonyOS host).
import http from 'node:http'

function startAuthServer(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((res, rej) => {
    const srv = http.createServer((req, resp) => {
      const auth = req.headers['authorization'] ?? ''
      if (!auth.startsWith('Basic ')) {
        resp.writeHead(401, { 'WWW-Authenticate': 'Basic realm="probe"', 'Content-Type': 'text/plain' })
        resp.end('Unauthorized')
        return
      }
      const decoded = Buffer.from(auth.slice(6), 'base64').toString()
      resp.writeHead(200, { 'Content-Type': 'text/plain' })
      resp.end(`OK:${decoded}`)
    })
    // 0.0.0.0 so both same-host (ArkWeb) and remote (Edge) browsers can reach it
    srv.listen(0, '0.0.0.0', () => {
      const port = (srv.address() as { port: number }).port
      res({ port, close: () => new Promise((r) => srv.close(() => r())) })
    })
    srv.on('error', rej)
  })
}

// When browser is remote (Edge on Windows), use the HarmonyOS host's LAN IP.
// When browser is local (ArkWeb), use 127.0.0.1.
const serverHost = process.env.OHOS_PW_CDP_URL ? '172.16.100.1' : '127.0.0.1'

base('ab-http-credentials: Basic Auth auto-inject via newContext', async ({}) => {
  const srv = await startAuthServer()
  const browser = await chromium.connectOverCDP(readEndpoint())
  try {
    const ctx = await browser.newContext({
      httpCredentials: { username: 'probe', password: 's3cr3t' },
    })
    const page = await ctx.newPage()
    let status = 0
    let body = '(not reached)'
    let authed = false
    try {
      const resp = await page.goto(`http://${serverHost}:${srv.port}/protected`, { timeout: 8000 })
      status = resp?.status() ?? 0
      body = await page.locator('body').innerText().catch(() => '(error)')
      authed = status === 200 && body.startsWith('OK:')
    } catch (e) {
      body = `UNREACHABLE (cross-machine: ${e instanceof Error ? e.message.split('\n')[0] : e})`
    }
    console.log(`[PROBE ab-http-credentials] status=${status} body="${body}" authed=${authed}`)
    await withTimeout(ctx.close(), 4000).catch(() => {})
  } finally {
    await withTimeout(browser.close(), 3000).catch(() => {})
    await srv.close()
  }
})

base('ab-http-credentials: no credentials → 401', async ({}) => {
  const srv = await startAuthServer()
  const browser = await chromium.connectOverCDP(readEndpoint())
  try {
    const ctx = await browser.newContext()  // no httpCredentials
    const page = await ctx.newPage()
    let status = 0
    let finding = ''
    try {
      const resp = await page.goto(`http://${serverHost}:${srv.port}/protected`, { timeout: 8000 })
      status = resp?.status() ?? 0
      finding = `status=${status} expected=401`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('ERR_INVALID_AUTH_CREDENTIALS')) {
        // Edge: browser shows auth dialog → PW throws instead of returning 401 response
        finding = 'status=ERR_INVALID_AUTH_CREDENTIALS (auth-required, equivalent to 401)'
      } else {
        finding = `UNREACHABLE: ${msg.split('\n')[0]}`
      }
    }
    console.log(`[PROBE ab-http-credentials] no-creds ${finding}`)
    await withTimeout(ctx.close(), 4000).catch(() => {})
  } finally {
    await withTimeout(browser.close(), 3000).catch(() => {})
    await srv.close()
  }
})
