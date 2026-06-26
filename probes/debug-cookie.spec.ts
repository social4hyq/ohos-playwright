// 调试：看 addCookies 后 cookie 的实际 domain 字段
import { test } from '@playwright/test'
import http from 'node:http'

test('debug: cookie domain 实际值', async ({ page, context }) => {
  const server = http.createServer((req, res) => res.end('<h1>x</h1>'))
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  const origin = `http://127.0.0.1:${port}`
  try {
    await page.goto(`${origin}/`)
    await context.addCookies([{ name: 'sess', value: 'tok', url: origin }])
    const cookies = await context.cookies()
    for (const c of cookies) {
      if (c.name === 'sess') {
        console.log(`[DBG] sess: domain=${JSON.stringify(c.domain)} path=${c.path} url=${c.url ?? '(none)'}`)
      }
    }
    console.log(`[DBG] origin host = ${new URL(origin).host}`)
  } finally {
    server.close()
  }
})
