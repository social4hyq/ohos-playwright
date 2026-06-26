// 精细化 popup bug 复测：验证 init script 注入 + poller 触发
import { test, expect } from '@playwright/test'

test('popup 精细化：window.open 是否被替换', async ({ page }) => {
  // fixture 在 page setup 时已 addInitScript，但当前 page 可能是 init script 注入前就存在的 tab
  // 重新 goto 触发新文档加载，init script 应该生效
  await page.goto('data:text/html,<h1>x</h1>')
  const isOpenPatched = await page.evaluate(() => {
    return (window as any)['__ohosPopupPatched'] === true
  })
  console.log(`[POPUP-STEP1] RESULT __ohosPopupPatched=${isOpenPatched}`)

  const openStr = await page.evaluate(() => window.open.toString().slice(0, 80))
  console.log(`[POPUP-STEP1] RESULT window.open=${openStr}`)
})

test('popup 精细化：手动调 window.open 看 queue', async ({ page }) => {
  await page.goto('data:text/html,<h1>x</h1>')
  await page.evaluate(() => (window as any).open('https://example.com'))
  await page.waitForTimeout(300) // 等 poller
  const queueLen = await page.evaluate(() => {
    const q = (window as any)['__ohosPopupQueue'] as any[]
    return q ? q.length : 'no-queue'
  })
  console.log(`[POPUP-STEP2] RESULT queue-after-open=${queueLen} (poller 应该已清空=0)`)
})

test('popup 精细化：监听 context page 事件', async ({ page, context }) => {
  const received: any[] = []
  context.on('page', (p: any) => received.push({ url: p.url(), methods: Object.keys(p) }))
  await page.goto('data:text/html,<h1>x</h1>')
  await page.evaluate(() => (window as any).open('https://test-popup.com'))
  await page.waitForTimeout(500) // 等 poller（150ms 间隔）
  console.log(`[POPUP-STEP3] RESULT context-page-events=${received.length}`)
  if (received.length) console.log(`  first: ${JSON.stringify(received[0])}`)
})

test('popup 精细化：page.goto 后立即 open（测 init script 时机）', async ({ page, context }) => {
  const received: any[] = []
  context.on('page', (p: any) => received.push(p.url()))
  // 一个会触发 window.open 的 data url 文档
  await page.goto('data:text/html,<script>window.open("https://immediate.com")</script>')
  await page.waitForTimeout(600)
  console.log(`[POPUP-STEP4] RESULT events=${received.length} urls=${JSON.stringify(received)}`)
})
