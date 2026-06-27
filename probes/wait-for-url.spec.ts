// 探针：page.waitForURL
import { test } from '@playwright/test'
import http from 'node:http'
import { serverHost } from './helpers.js'

function startServer(routes: Record<string, string>): Promise<{ port: number; close: () => void }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end(routes[req.url!] ?? '<h1>404</h1>')
    })
    server.listen(0, '0.0.0.0', () => {
      resolve({ port: (server.address() as any).port, close: () => server.close() })
    })
  })
}

test('waitForURL: string 精确匹配', async ({ page }) => {
  const srv = await startServer({ '/target': '<h1>target</h1>' })
  try {
    const url = `http://${serverHost}:${srv.port}/target`
    const result = await Promise.race([
      Promise.all([page.waitForURL(url), page.goto(url)]).then(() => 'ok'),
      new Promise<string>(r => setTimeout(() => r('HANG_6s'), 6000)),
    ])
    console.log(`[PROBE waitForURL-string] RESULT result=${result}`)
  } catch (e: any) {
    console.log(`[PROBE waitForURL-string] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    srv.close()
  }
})

test('waitForURL: glob 模式', async ({ page }) => {
  const srv = await startServer({ '/page/42': '<h1>42</h1>' })
  try {
    const targetUrl = `http://${serverHost}:${srv.port}/page/42`
    const result = await Promise.race([
      Promise.all([
        page.waitForURL(`http://${serverHost}:${srv.port}/page/**`),
        page.goto(targetUrl),
      ]).then(() => 'ok'),
      new Promise<string>(r => setTimeout(() => r('HANG_6s'), 6000)),
    ])
    console.log(`[PROBE waitForURL-glob] RESULT result=${result}`)
  } catch (e: any) {
    console.log(`[PROBE waitForURL-glob] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    srv.close()
  }
})

test('waitForURL: RegExp 模式', async ({ page }) => {
  const srv = await startServer({ '/rx/test': '<h1>rx</h1>' })
  try {
    const targetUrl = `http://${serverHost}:${srv.port}/rx/test`
    const result = await Promise.race([
      Promise.all([
        page.waitForURL(/\/rx\//),
        page.goto(targetUrl),
      ]).then(() => 'ok'),
      new Promise<string>(r => setTimeout(() => r('HANG_6s'), 6000)),
    ])
    console.log(`[PROBE waitForURL-regex] RESULT result=${result}`)
  } catch (e: any) {
    console.log(`[PROBE waitForURL-regex] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    srv.close()
  }
})

test('waitForURL: JS 客户端导航（history.pushState）', async ({ page }) => {
  const srv = await startServer({ '/spa': '<h1>SPA</h1>' })
  try {
    await page.goto(`http://${serverHost}:${srv.port}/spa`)
    const result = await Promise.race([
      Promise.all([
        page.waitForURL(`http://${serverHost}:${srv.port}/spa/detail`),
        page.evaluate(() => history.pushState({}, '', '/spa/detail')),
      ]).then(() => 'ok'),
      new Promise<string>(r => setTimeout(() => r('HANG_4s'), 4000)),
    ])
    console.log(`[PROBE waitForURL-pushstate] RESULT result=${result} url=${page.url().split('/').pop()}`)
  } catch (e: any) {
    console.log(`[PROBE waitForURL-pushstate] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    srv.close()
  }
})
