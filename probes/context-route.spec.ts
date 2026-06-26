// 探针：context.route vs page.route 优先级与作用域
import { test } from '@playwright/test'
import http from 'node:http'

function startServer(): Promise<{ port: number; close: () => void }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ source: 'real-server', url: req.url }))
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: (server.address() as any).port, close: () => server.close() })
    })
  })
}

test('context.route: 拦截并 fulfill', async ({ page, context }) => {
  const srv = await startServer()
  try {
    await context.route('**/api/**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ source: 'context-mock' }),
    }))
    await page.goto(`data:text/html,<div id=o></div>`)
    const data = await page.evaluate(async (port) => {
      const r = await fetch(`http://127.0.0.1:${port}/api/test`)
      return r.json()
    }, srv.port)
    console.log(`[PROBE context-route] RESULT source=${data.source} (context-mock=ok)`)
    await context.unroute('**/api/**')
  } catch (e: any) {
    console.log(`[PROBE context-route] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    srv.close()
  }
})

test('context.route vs page.route: page 优先级更高', async ({ page, context }) => {
  const srv = await startServer()
  try {
    await context.route('**/priority/**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ handler: 'context' }),
    }))
    await page.route('**/priority/**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ handler: 'page' }),
    }))
    await page.goto('data:text/html,<div id=o></div>')
    const data = await page.evaluate(async (port) => {
      const r = await fetch(`http://127.0.0.1:${port}/priority/test`)
      return r.json()
    }, srv.port)
    console.log(`[PROBE context-route-priority] RESULT handler=${data.handler} (page=ok,context=也记录)`)
    await page.unroute('**/priority/**')
    await context.unroute('**/priority/**')
  } catch (e: any) {
    console.log(`[PROBE context-route-priority] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    srv.close()
  }
})

test('context.route: abort 拦截', async ({ page, context }) => {
  const srv = await startServer()
  try {
    await context.route('**/blocked/**', route => route.abort())
    await page.goto('data:text/html,<div id=o></div>')
    const result = await page.evaluate(async (port) => {
      try {
        await fetch(`http://127.0.0.1:${port}/blocked/res`)
        return 'reachable'
      } catch {
        return 'aborted'
      }
    }, srv.port)
    console.log(`[PROBE context-route-abort] RESULT result=${result} (aborted=ok)`)
    await context.unroute('**/blocked/**')
  } catch (e: any) {
    console.log(`[PROBE context-route-abort] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    srv.close()
  }
})
