// 可行性探针：storageState 读写双向
import { test, expect } from '@playwright/test'
import http from 'node:http'

function startServer() {
  return new Promise<{ port: number; close: () => void }>(resolve => {
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end('<html><body><script>document.title="ok"</script></body></html>')
    })
    server.listen(0, '127.0.0.1', () => resolve({
      port: (server.address() as any).port,
      close: () => server.close(),
    }))
  })
}

// 读：手动读 cookie + localStorage（绕过 context.storageState 的 Playwright 内部链）
async function serializeState(page: any, context: any, origin: string) {
  const cookies = await context.cookies()
  const localStorage = await page.evaluate((o) => {
    const items: { name: string; value: string }[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const name = window.localStorage.key(i)!
      items.push({ name, value: window.localStorage.getItem(name)! })
    }
    return items
  }, origin)
  return { cookies, origins: [{ origin, localStorage }] }
}

// 写：手动注入 cookie + localStorage
async function restoreState(page: any, context: any, state: any) {
  if (state.cookies?.length) await context.addCookies(state.cookies)
  if (state.origins?.length) {
    for (const o of state.origins) {
      // localStorage 必须在对应 origin 的页面上下文写
      const cur = page.url()
      if (!cur.startsWith(o.origin)) {
        await page.goto(o.origin + '/')
      }
      await page.evaluate((items) => {
        for (const { name, value } of items) window.localStorage.setItem(name, value)
      }, o.localStorage)
    }
  }
}

test('storageState: 读 → 清空 → 恢复 往返', async ({ page, context }) => {
  const srv = await startServer()
  const origin = `http://127.0.0.1:${srv.port}`
  try {
    // 1. 设初始状态
    await page.goto(`${origin}/`)
    await context.addCookies([{ name: 'session', value: 'abc123', url: origin }])
    await page.evaluate(() => {
      localStorage.setItem('token', 'xyz')
      localStorage.setItem('pref', 'dark')
    })

    // 2. 序列化
    const state = await serializeState(page, context, origin)
    console.log(`[SS-PROBE] serialized: cookies=${state.cookies.length} ls=${state.origins[0].localStorage.length}`)
    expect(state.cookies.some((c: any) => c.name === 'session')).toBe(true)
    expect(state.origins[0].localStorage.some((l: any) => l.name === 'token')).toBe(true)

    // 3. 清空
    await context.clearCookies()
    await page.evaluate(() => localStorage.clear())
    const cookieAfterClear = await context.cookies()
    const lsAfterClear = await page.evaluate(() => localStorage.length)
    console.log(`[SS-PROBE] after-clear: cookies=${cookieAfterClear.length} ls=${lsAfterClear}`)

    // 4. 恢复
    await restoreState(page, context, state)
    const cookieAfterRestore = await context.cookies()
    const lsAfterRestore = await page.evaluate(() => ({
      token: localStorage.getItem('token'),
      pref: localStorage.getItem('pref'),
    }))
    console.log(`[SS-PROBE] after-restore: cookies=${cookieAfterRestore.length} token=${lsAfterRestore.token} pref=${lsAfterRestore.pref}`)
    expect(lsAfterRestore.token).toBe('xyz')
    expect(lsAfterRestore.pref).toBe('dark')
    console.log(`[SS-PROBE] RESULT=roundtrip-ok`)
  } finally {
    srv.close()
  }
})
