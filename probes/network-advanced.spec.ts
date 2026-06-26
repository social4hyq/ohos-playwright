// 探针：extraHTTPHeaders + offline（网络层）
import { test, expect } from '@playwright/test'
import http from 'node:http'

test('setExtraHTTPHeaders: 自定义头到达服务器', async ({ page }) => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/plain')
    res.end(req.headers['x-probe'] || 'none')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  try {
    await page.setExtraHTTPHeaders({ 'X-Probe': 'sent' })
    const body = await page.goto(`http://127.0.0.1:${port}/`).then(r => r!.text())
    console.log(`[PROBE extraHeaders] RESULT body=${body}`)
  } catch (e: any) {
    console.log(`[PROBE extraHeaders] RESULT=error err=${e.message}`)
  } finally {
    server.close()
  }
})

test('offline: context.setOffline(true)', async ({ page, context }) => {
  const server = http.createServer((req, res) => res.end('online'))
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  try {
    await context.setOffline(true)
    const result = await page.goto(`http://127.0.0.1:${port}/`, { timeout: 3000 })
      .then(() => 'reachable')
      .catch((e: any) => `unreachable: ${e.message.split('\n')[0]}`)
    console.log(`[PROBE offline] RESULT when-offline=${result}`)
    await context.setOffline(false)
    const result2 = await page.goto(`http://127.0.0.1:${port}/`, { timeout: 3000 })
      .then(() => 'reachable')
      .catch((e: any) => `unreachable: ${e.message.split('\n')[0]}`)
    console.log(`[PROBE offline] RESULT when-online=${result2}`)
  } catch (e: any) {
    console.log(`[PROBE offline] RESULT=error err=${e.message}`)
  } finally {
    server.close()
  }
})
