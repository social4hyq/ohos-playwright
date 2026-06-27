// 探针：storageState（单 context 模式下能否序列化/应用）
import { test, expect } from '@playwright/test'
import http from 'node:http'
import { serverHost } from './helpers.js'

test('storageState: context.storageState() 序列化', async ({ page, context }) => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end('<h1>x</h1>')
  })
  await new Promise<void>(r => server.listen(0, '0.0.0.0', r))
  const port = (server.address() as any).port
  try {
    await page.goto(`http://${serverHost}:${port}/`)
    await context.addCookies([{ name: 'ss', value: '1', url: `http://${serverHost}:${port}` }])
    await page.evaluate(() => localStorage.setItem('ls', 'val'))
    const state = await context.storageState()
    console.log(`[PROBE2 storageState] RESULT cookies=${state.cookies.length} origins=${state.origins.length}`)
    const lsOrigin = state.origins.find(o => o.localStorage.some(e => e.name === 'ls'))
    console.log(`[PROBE2 storageState] RESULT ls-captured=${lsOrigin ? 'yes' : 'no'}`)
  } catch (e: any) {
    console.log(`[PROBE2 storageState] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    server.close()
  }
})
