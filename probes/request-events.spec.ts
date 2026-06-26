// 探针：page.on('request' / 'response' / 'requestfailed' / 'requestfinished')
import { test } from '@playwright/test'
import http from 'node:http'

function startServer(): Promise<{ port: number; close: () => void }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url === '/fail') { res.destroy(); return }
      res.setHeader('content-type', 'text/html')
      res.end('<h1>ok</h1>')
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: (server.address() as any).port, close: () => server.close() })
    })
  })
}

test('request-events: on(request) 捕获 URL', async ({ page }) => {
  const srv = await startServer()
  const urls: string[] = []
  page.on('request', req => urls.push(req.url()))
  try {
    await page.goto(`http://127.0.0.1:${srv.port}/`)
    await page.waitForTimeout(200)
    console.log(`[PROBE on-request] RESULT count=${urls.length} first=${urls[0]?.split('/').pop()}`)
  } finally {
    srv.close()
  }
})

test('request-events: on(response) 捕获状态码', async ({ page }) => {
  const srv = await startServer()
  const statuses: number[] = []
  page.on('response', res => statuses.push(res.status()))
  try {
    await page.goto(`http://127.0.0.1:${srv.port}/`)
    await page.waitForTimeout(200)
    console.log(`[PROBE on-response] RESULT statuses=${JSON.stringify(statuses)}`)
  } finally {
    srv.close()
  }
})

test('request-events: on(requestfinished) 请求完成事件', async ({ page }) => {
  const srv = await startServer()
  const finished: string[] = []
  page.on('requestfinished', req => finished.push(req.url()))
  try {
    await page.goto(`http://127.0.0.1:${srv.port}/`)
    await page.waitForTimeout(300)
    console.log(`[PROBE on-requestfinished] RESULT count=${finished.length}`)
  } finally {
    srv.close()
  }
})

test('request-events: on(requestfailed) 连接拒绝', async ({ page }) => {
  const srv = await startServer()
  const failed: string[] = []
  page.on('requestfailed', req => failed.push(req.failure()?.errorText ?? 'unknown'))
  try {
    // 访问一个不存在的端口触发失败
    await page.goto('http://127.0.0.1:1/', { timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(300)
    console.log(`[PROBE on-requestfailed] RESULT count=${failed.length} first=${failed[0] ?? 'none'}`)
  } finally {
    srv.close()
  }
})
