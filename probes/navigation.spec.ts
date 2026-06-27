// 探针：navigation（goBack / goForward / reload）— 历史栈在单 tab 复用下
import { test, expect } from '@playwright/test'
import http from 'node:http'
import { serverHost } from './helpers.js'

function startServer(routes: Record<string, string>): Promise<{ port: number; close: () => void }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end(routes[req.url!] ?? '<h1>404</h1>')
    })
    server.listen(0, '0.0.0.0', () => {
      const port = (server.address() as any).port
      resolve({ port, close: () => server.close() })
    })
  })
}

test('navigation: goBack/goForward 历史栈', async ({ page }) => {
  const srv = await startServer({
    '/a': '<h1 id=p>A</h1>',
    '/b': '<h1 id=p>B</h1>',
  })
  try {
    await page.goto(`http://${serverHost}:${srv.port}/a`)
    const t1 = await page.locator('#p').textContent()
    await page.goto(`http://${serverHost}:${srv.port}/b`)
    const t2 = await page.locator('#p').textContent()
    await page.goBack()
    const tBack = await page.locator('#p').textContent()
    await page.goForward()
    const tFwd = await page.locator('#p').textContent()
    console.log(`[PROBE nav-history] RESULT t1=${t1} t2=${t2} back=${tBack} fwd=${tFwd}`)
  } catch (e: any) {
    console.log(`[PROBE nav-history] RESULT=error err=${e.message}`)
  } finally {
    srv.close()
  }
})

test('navigation: reload 保持状态丢失', async ({ page }) => {
  const srv = await startServer({ '/': '<input id=i>' })
  try {
    await page.goto(`http://${serverHost}:${srv.port}/`)
    await page.locator('#i').fill('before-reload')
    await page.reload()
    const v = await page.inputValue('#i')
    console.log(`[PROBE nav-reload] RESULT after-reload-input=${v} (预期空=状态丢失)`)
  } finally {
    srv.close()
  }
})
