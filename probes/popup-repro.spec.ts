// 精确复现原 popup 探针失败，加日志定位
import { test, expect } from '@playwright/test'

test('popup 原探针复现 + 详细日志', async ({ page, context }) => {
  const events: string[] = []
  context.on('page', (p) => events.push('got:' + p.url()))

  await page.goto('data:text/html,<button id=b>open</button>')
  await page.evaluate(() => {
    (document.getElementById('b')!).addEventListener('click', () => {
      ;(window as any).open('https://example.com')
      console.log('onclick-fired')
    })
  })
  console.log('[POPUP-REPRO] before-click')
  await page.click('#b')
  console.log('[POPUP-REPRO] after-click, wait poller')
  await page.waitForTimeout(600)
  console.log(`[POPUP-REPRO] events=${events.length} details=${JSON.stringify(events)}`)

  // 也直接测 waitForEvent
  const wp = context.waitForEvent('page', { timeout: 2000 }).catch(() => null)
  await page.evaluate(() => (window as any).open('https://second.com'))
  const p2 = await wp
  console.log(`[POPUP-REPRO] waitForEvent-2nd=${p2 ? p2.url() : 'null'}`)
})
