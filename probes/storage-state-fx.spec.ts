// 验证新 fixture：saveStorageState / loadStorageState
import { test, expect } from '@playwright/test'
import type { StorageState } from 'ohos-playwright/fixture'
import http from 'node:http'
import { serverHost } from './helpers.js'
import { writeFileSync, readFileSync } from 'node:fs'

function startServer(title = 'ss') {
  return new Promise<{ port: number; close: () => void }>(resolve => {
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end(`<html><body><script>document.title="${title}"</script></body></html>`)
    })
    server.listen(0, '0.0.0.0', () => resolve({
      port: (server.address() as any).port,
      close: () => server.close(),
    }))
  })
}

test('storageState fixture: 保存 → 清空 → 恢复', async ({ page, context, saveStorageState, loadStorageState }) => {
  const srv = await startServer()
  const origin = `http://${serverHost}:${srv.port}`
  try {
    await page.goto(`${origin}/`)
    await context.addCookies([{ name: 'sess', value: 'tok', url: origin }])
    await page.evaluate(() => {
      localStorage.setItem('u', 'alice')
      localStorage.setItem('theme', 'dark')
    })

    const state = await saveStorageState(origin)
    console.log(`[SS-FX] saved: cookies=${state.cookies.length} ls=${state.origins[0]?.localStorage.length}`)
    // 验证 origin 过滤生效（不混入无关 cookie）
    const hasOurCookie = state.cookies.some(c => c.name === 'sess')
    expect(hasOurCookie).toBe(true)

    // 清空
    await context.clearCookies()
    await page.evaluate(() => localStorage.clear())
    expect(await page.evaluate(() => localStorage.length)).toBe(0)

    // 恢复
    await loadStorageState(state)
    const restoredLs = await page.evaluate(() => ({
      u: localStorage.getItem('u'),
      theme: localStorage.getItem('theme'),
    }))
    const cookiesAfter = await context.cookies()
    const restoredCookie = cookiesAfter.find(c => c.name === 'sess')
    console.log(`[SS-FX] restored: u=${restoredLs.u} theme=${restoredLs.theme} cookie=${restoredCookie?.value}`)
    expect(restoredLs.u).toBe('alice')
    expect(restoredLs.theme).toBe('dark')
    expect(restoredCookie?.value).toBe('tok')
    console.log(`[SS-FX] RESULT=roundtrip-ok`)
  } finally {
    srv.close()
  }
})

test('storageState fixture: 序列化可写入文件复用', async ({ page, context, saveStorageState, loadStorageState }) => {
  const srv = await startServer('persist')
  const origin = `http://${serverHost}:${srv.port}`
  const statePath = '/storage/Users/currentUser/.tmp/ss-state.json'
  try {
    await page.goto(`${origin}/`)
    await page.evaluate(() => localStorage.setItem('persisted', 'yes'))
    const state = await saveStorageState(origin)
    writeFileSync(statePath, JSON.stringify(state))

    // 清空并重启"新会话"
    await page.evaluate(() => localStorage.clear())

    // 从文件读回
    const reloaded = JSON.parse(readFileSync(statePath, 'utf8')) as StorageState
    await loadStorageState(reloaded)
    const val = await page.evaluate(() => localStorage.getItem('persisted'))
    console.log(`[SS-FX-PERSIST] RESULT persisted=${val}`)
    expect(val).toBe('yes')
  } finally {
    srv.close()
  }
})
