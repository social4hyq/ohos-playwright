// 探针：APIRequestContext (playwright.request / request fixture) —— 跨引擎 A/B
//
// playwright.request.newContext() 与 request fixture 是纯 Node.js HTTP 客户端，
// 与浏览器 CDP 无关，理论上在所有 connectOverCDP 模式下均可用。
//
// 两条腿：
//   ArkWeb：OHOS_PW_HOST=1 ./dist/cli.mjs test --config=probes/playwright.config.ts \
//             probes/ab-api-request.spec.ts
//   Edge：  OHOS_PW_CDP_URL=http://172.16.100.2:9222 ./dist/cli.mjs test \
//             --config=probes/playwright.config.ts probes/ab-api-request.spec.ts
import { test, expect } from '@playwright/test'
import http from 'node:http'

function startServer(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((res, rej) => {
    const srv = http.createServer((req, resp) => {
      const auth = req.headers['authorization'] ?? ''
      resp.setHeader('Content-Type', 'application/json')
      resp.end(JSON.stringify({ url: req.url, method: req.method, auth }))
    })
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      res({ port, close: () => new Promise((r) => srv.close(() => r())) })
    })
    srv.on('error', rej)
  })
}

test('ab-api-request: built-in request fixture GET', async ({ request }) => {
  const srv = await startServer()
  try {
    const resp = await request.get(`http://127.0.0.1:${srv.port}/hello`)
    const status = resp.status()
    const body = await resp.json() as { url: string; method: string }
    console.log(`[PROBE ab-api-request] request-fixture status=${status} url=${body.url} method=${body.method}`)
    expect(status).toBe(200)
    expect(body.method).toBe('GET')
  } finally {
    await srv.close()
  }
})

test('ab-api-request: request fixture POST with JSON body', async ({ request }) => {
  const srv = await startServer()
  try {
    const resp = await request.post(`http://127.0.0.1:${srv.port}/data`, {
      data: { key: 'value' },
    })
    const status = resp.status()
    const body = await resp.json() as { method: string }
    console.log(`[PROBE ab-api-request] request-fixture-post status=${status} method=${body.method}`)
    expect(status).toBe(200)
    expect(body.method).toBe('POST')
  } finally {
    await srv.close()
  }
})

test('ab-api-request: playwright.request.newContext() independent of browser', async ({ playwright }) => {
  const srv = await startServer()
  const api = await playwright.request.newContext({
    baseURL: `http://127.0.0.1:${srv.port}`,
    extraHTTPHeaders: { 'x-probe': 'ohos-playwright' },
  })
  try {
    const resp = await api.get('/check')
    const ok = resp.ok()
    const body = await resp.json() as { url: string }
    console.log(`[PROBE ab-api-request] newContext ok=${ok} url=${body.url}`)
    expect(ok).toBe(true)
    expect(body.url).toBe('/check')
  } finally {
    await api.dispose()
    await srv.close()
  }
})
