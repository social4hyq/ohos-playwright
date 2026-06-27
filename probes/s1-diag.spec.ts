// S1 根因诊断：识别新 context 中 navigation 失效的触发条件
// 通过逐层对照（A/B/C/D/E）找出引入问题的关键步骤
import { test } from '@playwright/test'

test('S1-A: newContext+newPage+goto+screenshot（T1 + 截图）', async ({ browser }) => {
  const t0 = Date.now()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    console.log(`[A] step1 after newPage url=${page.url()} elapsed=${Date.now() - t0}ms`)
    await page.goto('about:blank')
    console.log(`[A] step2 after goto url=${page.url()} elapsed=${Date.now() - t0}ms`)
    const buf = await page.screenshot({ timeout: 5000 })
    console.log(`[A] RESULT=pass bytes=${buf.length} elapsed=${Date.now() - t0}ms`)
    await context.close().catch(() => {})
  } catch (e: any) {
    console.log(`[A] RESULT=fail elapsed=${Date.now() - t0}ms err=${e.message.split('\n')[0].slice(0, 200)}`)
  }
})

test('S1-B: A + setViewportSize（完整 S1 流程）', async ({ browser }) => {
  const t0 = Date.now()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.setViewportSize({ width: 800, height: 600 })
    console.log(`[B] step1 after setViewport url=${page.url()} elapsed=${Date.now() - t0}ms`)
    await page.goto('about:blank')
    console.log(`[B] step2 after goto url=${page.url()} elapsed=${Date.now() - t0}ms`)
    const buf = await page.screenshot({ timeout: 5000 })
    console.log(`[B] RESULT=pass bytes=${buf.length} elapsed=${Date.now() - t0}ms`)
    await context.close().catch(() => {})
  } catch (e: any) {
    console.log(`[B] RESULT=fail elapsed=${Date.now() - t0}ms err=${e.message.split('\n')[0].slice(0, 200)}`)
  }
})

test('S1-C: 用 data: URL 替代 about:blank', async ({ browser }) => {
  const t0 = Date.now()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.setViewportSize({ width: 800, height: 600 })
    await page.goto('data:text/html,<h1>hello</h1>')
    console.log(`[C] step1 after goto data url=${page.url().slice(0, 50)} elapsed=${Date.now() - t0}ms`)
    const buf = await page.screenshot({ timeout: 5000 })
    console.log(`[C] RESULT=pass bytes=${buf.length} elapsed=${Date.now() - t0}ms`)
    await context.close().catch(() => {})
  } catch (e: any) {
    console.log(`[C] RESULT=fail elapsed=${Date.now() - t0}ms err=${e.message.split('\n')[0].slice(0, 200)}`)
  }
})

test('S1-D: 用 setContent 替代 goto（绕过导航）', async ({ browser }) => {
  const t0 = Date.now()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.setViewportSize({ width: 800, height: 600 })
    await page.setContent('<html><body><h1>setContent</h1></body></html>')
    console.log(`[D] step1 after setContent url=${page.url().slice(0, 50)} elapsed=${Date.now() - t0}ms`)
    const buf = await page.screenshot({ timeout: 5000 })
    console.log(`[D] RESULT=pass bytes=${buf.length} elapsed=${Date.now() - t0}ms`)
    await context.close().catch(() => {})
  } catch (e: any) {
    console.log(`[D] RESULT=fail elapsed=${Date.now() - t0}ms err=${e.message.split('\n')[0].slice(0, 200)}`)
  }
})

test('S1-E: 不 setViewportSize，直接 goto+screenshot', async ({ browser }) => {
  const t0 = Date.now()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    console.log(`[E] step1 after newPage url=${page.url()} elapsed=${Date.now() - t0}ms`)
    // 列出所有 target 看 type
    const session = await context.newCDPSession(page)
    const targets: any = await session.send('Target.getTargets' as any).catch((e: any) => ({ error: e.message }))
    if (targets.targetInfos) {
      const summary = targets.targetInfos.map((t: any) => `${t.type}:${(t.url || '').slice(0, 40)}`)
      console.log(`[E] CDP Target.getTargets => ${JSON.stringify(summary)}`)
    } else {
      console.log(`[E] CDP Target.getTargets err=${targets.error}`)
    }
    await page.goto('about:blank').catch((e: any) => console.log(`[E] goto threw: ${e.message.split('\n')[0].slice(0, 100)}`))
    console.log(`[E] step2 after goto url=${page.url()} elapsed=${Date.now() - t0}ms`)
    await context.close().catch(() => {})
    console.log(`[E] RESULT=pass elapsed=${Date.now() - t0}ms`)
  } catch (e: any) {
    console.log(`[E] RESULT=fail elapsed=${Date.now() - t0}ms err=${e.message.split('\n')[0].slice(0, 200)}`)
  }
})
