// S1 Phase 2/3：定位 screenshot timeout 的精确层级
// 用裸 CDP 调用各个命令，识别是 captureScreenshot 命令本身 hang 还是上游问题
import { test } from '@playwright/test'

test('S1-CDP: 用裸 CDP 走一遍 captureScreenshot', async ({ browser }) => {
  const t0 = Date.now()
  const context = await browser.newContext()
  const page = await context.newPage()
  console.log(`[CDP] page.url=${page.url()} elapsed=${Date.now() - t0}ms`)

  const session = await context.newCDPSession(page)
  console.log(`[CDP] session created elapsed=${Date.now() - t0}ms`)

  // 1. Runtime.evaluate 能不能跑（验证 session 通）
  try {
    const r: any = await session.send('Runtime.evaluate' as any, { expression: '1+1' })
    console.log(`[CDP] Runtime.evaluate => ${JSON.stringify(r.result?.value)} elapsed=${Date.now() - t0}ms`)
  } catch (e: any) {
    console.log(`[CDP] Runtime.evaluate threw: ${e.message.split('\n')[0].slice(0, 150)}`)
  }

  // 2. Page.captureScreenshot 裸 CDP 调用
  try {
    const r: any = await Promise.race([
      session.send('Page.captureScreenshot' as any, { format: 'png' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('CDP_TIMEOUT_5s')), 5000)),
    ])
    console.log(`[CDP] Page.captureScreenshot => dataLen=${r.data?.length ?? 0} elapsed=${Date.now() - t0}ms`)
  } catch (e: any) {
    console.log(`[CDP] Page.captureScreenshot threw: ${e.message.split('\n')[0].slice(0, 150)} elapsed=${Date.now() - t0}ms`)
  }

  // 3. 同样的截图，对默认 context（contexts()[0]）的第一个 page 试一次
  const defaultCtx = browser.contexts()[0]
  if (defaultCtx && defaultCtx !== context) {
    const defaultPage = defaultCtx.pages()[0]
    if (defaultPage) {
      try {
        const buf = await Promise.race([
          defaultPage.screenshot(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('DEFAULT_TIMEOUT_5s')), 5000)),
        ])
        console.log(`[CDP] default-page screenshot bytes=${(buf as Buffer).length} elapsed=${Date.now() - t0}ms`)
      } catch (e: any) {
        console.log(`[CDP] default-page screenshot threw: ${e.message.split('\n')[0].slice(0, 150)}`)
      }
    }
  }

  await context.close().catch(() => {})
  console.log(`[CDP] RESULT=done elapsed=${Date.now() - t0}ms`)
})
