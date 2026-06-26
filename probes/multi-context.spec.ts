// 探针：多 context / 多 page（ohos-playwright README 明确说不支持）
// 目标：实测 newContext / newPage 到底是优雅报错还是 hang
import { test, expect } from '@playwright/test'

test('newPage: context.newPage() 行为', async ({ page, context }) => {
  const start = Date.now()
  try {
    const newPage = await Promise.race([
      context.newPage(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT_5s')), 5000)),
    ])
    console.log(`[PROBE newPage] RESULT=ok url=${newPage.url()} elapsed=${Date.now()-start}ms`)
  } catch (e: any) {
    console.log(`[PROBE newPage] RESULT=error elapsed=${Date.now()-start}ms err=${e.message}`)
  }
})

test('newContext: browser.newContext() 行为', async ({ browser }) => {
  const start = Date.now()
  try {
    const ctx = await Promise.race([
      browser.newContext(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT_5s')), 5000)),
    ])
    console.log(`[PROBE newContext] RESULT=ok pages=${ctx.pages().length} elapsed=${Date.now()-start}ms`)
  } catch (e: any) {
    console.log(`[PROBE newContext] RESULT=error elapsed=${Date.now()-start}ms err=${e.message}`)
  }
})
