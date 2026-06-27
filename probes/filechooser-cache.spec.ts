// 探针：fileChooser / cacheDisabled
import { test, expect } from '@playwright/test'
import http from 'node:http'
import { serverHost } from './helpers.js'

test('fileChooser: page.waitForEvent(filechooser)', async ({ page }) => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end('<input id=f type=file>')
  })
  await new Promise<void>(r => server.listen(0, '0.0.0.0', r))
  const port = (server.address() as any).port
  try {
    await page.goto(`http://${serverHost}:${port}/`)
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null)
    await page.locator('#f').click()
    const chooser = await chooserPromise
    console.log(`[PROBE2 filechooser] RESULT got=${chooser ? 'yes' : 'timeout'}`)
  } catch (e: any) {
    console.log(`[PROBE2 filechooser] RESULT=error err=${e.message.split('\n')[0]}`)
  } finally {
    server.close()
  }
})

test('cacheDisabled: Network.setCacheDisabled', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  try {
    const session = await page.context().newCDPSession(page)
    await session.send('Network.setCacheDisabled' as any, { cacheDisabled: true })
    console.log(`[PROBE2 cacheDisabled] RESULT command=ok`)
    await session.detach()
  } catch (e: any) {
    console.log(`[PROBE2 cacheDisabled] RESULT=error err=${e.message.split('\n')[0]}`)
  }
})
