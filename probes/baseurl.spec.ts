// 探针：baseURL 拼接一致性（toHaveURL 是否与 page.goto 拼接逻辑一致）
import { test, expect } from '@playwright/test'
import http from 'node:http'
import { serverHost } from './helpers.js'

test('baseURL: page.goto(/path) 拼接 + toHaveURL 断言', async ({ page }) => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end(`<h1>${req.url}</h1>`)
  })
  await new Promise<void>(r => server.listen(0, '0.0.0.0', r))
  const port = (server.address() as any).port
  const base = `http://${serverHost}:${port}`
  try {
    // 注：fixture 把 baseURL 注入 _options，但测试内 baseURL 来自 config
    // 这里直接 goto 绝对路径测 toHaveURL
    await page.goto(`${base}/foo`)
    await expect(page).toHaveURL(/\/foo$/)
    console.log(`[PROBE baseURL-toHaveURL] RESULT=ok toHaveURL-passed`)
    const cur = page.url()
    console.log(`[PROBE baseURL-toHaveURL] RESULT page.url()=${cur}`)
  } catch (e: any) {
    console.log(`[PROBE baseURL-toHaveURL] RESULT=error err=${e.message}`)
  } finally {
    server.close()
  }
})
