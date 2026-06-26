// 探针：goForward 带超时兜底（预期与 goBack 同样 hang）
import { test } from '@playwright/test'
import http from 'node:http'

function startServer(routes: Record<string, string>): Promise<{ port: number; close: () => void }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end(routes[req.url!] ?? '<h1>404</h1>')
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: (server.address() as any).port, close: () => server.close() })
    })
  })
}

test('goForward: 带超时兜底', async ({ page }) => {
  const srv = await startServer({ '/a': '<h1 id=p>A</h1>', '/b': '<h1 id=p>B</h1>' })
  try {
    await page.goto(`http://127.0.0.1:${srv.port}/a`)
    await page.goto(`http://127.0.0.1:${srv.port}/b`)
    await page.goBack({ timeout: 3000 }).catch(() => {})
    const start = Date.now()
    const result = await Promise.race([
      page.goForward({ timeout: 5000 }).then(() => 'ok').catch((e: any) => `err:${e.message.split('\n')[0]}`),
      new Promise<string>(r => setTimeout(() => r('HANG_8s'), 8000)),
    ])
    console.log(`[PROBE goForward] RESULT result=${result} elapsed=${Date.now() - start}ms`)
    if (result === 'ok') {
      const t = await page.locator('#p').textContent().catch(() => 'eval-fail')
      console.log(`[PROBE goForward] RESULT after-forward-text=${t}`)
    }
  } finally {
    srv.close()
  }
})
