// 探针：waitForRequest / waitForResponse
import { test } from '@playwright/test'
import http from 'node:http'
import { serverHost } from './helpers.js'

function startServer(): Promise<{ port: number; close: () => void }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end('<h1>ok</h1>')
    })
    server.listen(0, '0.0.0.0', () => {
      resolve({ port: (server.address() as any).port, close: () => server.close() })
    })
  })
}

test('waitForRequest: 捕获 goto 触发的请求', async ({ page }) => {
  const srv = await startServer()
  try {
    const url = `http://${serverHost}:${srv.port}/probe`
    const result = await Promise.race([
      Promise.all([
        page.waitForRequest(url),
        page.goto(url),
      ]).then(([req]) => `ok:${req.url()}`),
      new Promise<string>(r => setTimeout(() => r('HANG_6s'), 6000)),
    ])
    console.log(`[PROBE waitForRequest] RESULT result=${result}`)
  } catch (e: any) {
    console.log(`[PROBE waitForRequest] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    srv.close()
  }
})

test('waitForResponse: 捕获 goto 响应', async ({ page }) => {
  const srv = await startServer()
  try {
    const url = `http://${serverHost}:${srv.port}/probe2`
    const result = await Promise.race([
      Promise.all([
        page.waitForResponse(url),
        page.goto(url),
      ]).then(([res]) => `ok:${res.status()}`),
      new Promise<string>(r => setTimeout(() => r('HANG_6s'), 6000)),
    ])
    console.log(`[PROBE waitForResponse] RESULT result=${result}`)
  } catch (e: any) {
    console.log(`[PROBE waitForResponse] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    srv.close()
  }
})

test('waitForRequest: predicate 函数过滤', async ({ page }) => {
  const srv = await startServer()
  try {
    const url = `http://${serverHost}:${srv.port}/filtered`
    const result = await Promise.race([
      Promise.all([
        page.waitForRequest(req => req.url().includes('/filtered')),
        page.goto(url),
      ]).then(([req]) => `ok:${req.method()}`),
      new Promise<string>(r => setTimeout(() => r('HANG_6s'), 6000)),
    ])
    console.log(`[PROBE waitForRequest-predicate] RESULT result=${result}`)
  } catch (e: any) {
    console.log(`[PROBE waitForRequest-predicate] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    srv.close()
  }
})
