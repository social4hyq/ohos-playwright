// 探针 v2：navigation 带超时兜底（goBack 在 ArkWeb 单 tab 复用下可能 hang）
import { test, expect } from '@playwright/test'
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

test('navigation-v2: goBack 带超时兜底', async ({ page }) => {
  const srv = await startServer({ '/a': '<h1 id=p>A</h1>', '/b': '<h1 id=p>B</h1>' })
  try {
    await page.goto(`http://127.0.0.1:${srv.port}/a`)
    await page.goto(`http://127.0.0.1:${srv.port}/b`)
    const start = Date.now()
    const backResult = await Promise.race([
      page.goBack({ timeout: 5000 }).then(() => 'ok').catch((e: any) => `err:${e.message.split('\n')[0]}`),
      new Promise<string>(r => setTimeout(() => r('HANG_8s'), 8000)),
    ])
    console.log(`[PROBE nav-goback] RESULT backResult=${backResult} elapsed=${Date.now()-start}ms`)
    if (backResult === 'ok') {
      const t = await page.locator('#p').textContent().catch(() => 'eval-fail')
      console.log(`[PROBE nav-goback] RESULT after-back-text=${t}`)
    }
  } finally {
    srv.close()
  }
})

test('navigation-v2: reload', async ({ page }) => {
  const srv = await startServer({ '/': '<input id=i>' })
  try {
    await page.goto(`http://127.0.0.1:${srv.port}/`)
    await page.locator('#i').fill('before')
    await page.reload()
    const v = await page.inputValue('#i')
    console.log(`[PROBE nav-reload-v2] RESULT after-reload=${v} (空=状态丢失)`)
  } finally {
    srv.close()
  }
})
