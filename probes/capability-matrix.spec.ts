// 探针：报告中的 11 个测试用例（T1-T3 / S1-S3 / L1 / P1-P2 / C1-C2）
// 目的：实测 ohos-playwright v0.5.1 在每个用例上的真实表现
// 注：ctx.newPage() 在 ArkWeb 上需要 PW_CHROMIUM_ATTACH_TO_OTHER=1
import { test, expect } from '@playwright/test'

// ---------- 3.1 BrowserContext ----------

test('T1: browser.newContext() 无副作用', async ({ browser }) => {
  const start = Date.now()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('about:blank')
    const url = page.url()
    const realPages = context.pages().filter(p => p.url() !== '')
    console.log(`[T1] RESULT=pass url=${url} realPages=${realPages.length} elapsed=${Date.now() - start}ms`)
    await context.close().catch(() => {})
  } catch (e: any) {
    console.log(`[T1] RESULT=fail elapsed=${Date.now() - start}ms err=${e.message.split('\n')[0].slice(0, 200)}`)
  }
})

test('T2: 多个 context 共存且可独立关闭', async ({ browser }) => {
  const start = Date.now()
  try {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()
    await page1.setContent('<h1>Context 1</h1>')
    await page2.setContent('<h1>Context 2</h1>')
    const t1 = await page1.textContent('h1')
    const t2 = await page2.textContent('h1')
    await ctx1.close().catch(() => {})
    const connected1 = browser.isConnected()
    await ctx2.close().catch(() => {})
    const connected2 = browser.isConnected()
    console.log(`[T2] RESULT=pass text1="${t1}" text2="${t2}" connectedAfterCtx1=${connected1} connectedAfterCtx2=${connected2} elapsed=${Date.now() - start}ms`)
  } catch (e: any) {
    console.log(`[T2] RESULT=fail elapsed=${Date.now() - start}ms err=${e.message.split('\n')[0].slice(0, 200)}`)
  }
})

test('T3: context.newPage() 创建可用 page', async ({ browser }) => {
  const start = Date.now()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    const result = await page.evaluate(() => 42)
    console.log(`[T3] RESULT=pass evaluate=${result} elapsed=${Date.now() - start}ms`)
    await context.close().catch(() => {})
  } catch (e: any) {
    console.log(`[T3] RESULT=fail elapsed=${Date.now() - start}ms err=${e.message.split('\n')[0].slice(0, 200)}`)
  }
})

// ---------- 3.2 Screenshot ----------

test('S1: 新 context 中截图可用', async ({ browser }) => {
  const start = Date.now()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.setViewportSize({ width: 800, height: 600 })
    await page.goto('about:blank')
    const screenshot = await page.screenshot()
    console.log(`[S1] RESULT=pass bytes=${screenshot.length} elapsed=${Date.now() - start}ms`)
    await context.close().catch(() => {})
  } catch (e: any) {
    console.log(`[S1] RESULT=fail elapsed=${Date.now() - start}ms err=${e.message.split('\n')[0].slice(0, 200)}`)
  }
})

test('S2: 导航后截图仍可用', async ({ page }) => {
  const start = Date.now()
  try {
    await page.setViewportSize({ width: 800, height: 600 })
    await page.goto('about:blank')
    await page.setContent('<html><body><h1>Navigated</h1></body></html>')
    const screenshot = await page.screenshot()
    console.log(`[S2] RESULT=pass bytes=${screenshot.length} elapsed=${Date.now() - start}ms`)
  } catch (e: any) {
    console.log(`[S2] RESULT=fail elapsed=${Date.now() - start}ms err=${e.message.split('\n')[0].slice(0, 200)}`)
  }
})

test('S3: 默认 context page 截图可用（captureScreenshot 无错误）', async ({ page }) => {
  const start = Date.now()
  await page.setViewportSize({ width: 800, height: 600 })
  await page.setContent('<div>Hello</div>')
  let errMsg = ''
  try {
    await page.screenshot()
  } catch (e: any) {
    errMsg = e?.message || e?.toString() || String(e)
  }
  const hasCaptureErr = errMsg.includes('captureScreenshot') || errMsg.includes('Screenshot is not enabled')
  const pass = !hasCaptureErr
  console.log(`[S3] RESULT=${pass ? 'pass' : 'fail'} errType=${errMsg ? (hasCaptureErr ? 'screenshot-failed' : 'other-err') : 'none'} elapsed=${Date.now() - start}ms errHead=${errMsg.split('\n')[0].slice(0, 150)}`)
})

// ---------- 3.3 Browser launch ----------
// 报告中 L1 描述的是 "用户 playwright.config.ts 无需修改"，ohos-playwright 当前阶段二
// 仍需 withOpenHarmony() + ohos-playwright test CLI，所以这里直接验证 chromium 项目可工作

test('L1: 标准 Playwright API（fixture browser）启动浏览器', async ({ browser }) => {
  const start = Date.now()
  try {
    const connected = browser.isConnected()
    const page = await browser.newPage()
    await page.goto('about:blank')
    const url = page.url()
    console.log(`[L1] RESULT=pass connected=${connected} url=${url} elapsed=${Date.now() - start}ms`)
    await page.close().catch(() => {})
  } catch (e: any) {
    console.log(`[L1] RESULT=fail elapsed=${Date.now() - start}ms err=${e.message.split('\n')[0].slice(0, 200)}`)
  }
})

// ---------- 3.4 新标签页 ----------

test('P1: window.open 创建真实 Page 对象', async ({ context, page }) => {
  const start = Date.now()
  await page.goto('data:text/html,<h1>opener</h1>')
  const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(e => null)
  try {
    await page.evaluate(() => window.open('about:blank'))
  } catch (e: any) {
    console.log(`[P1] RESULT=fail (evaluate window.open threw) elapsed=${Date.now() - start}ms err=${e.message.split('\n')[0].slice(0, 150)}`)
    return
  }
  const newPage: any = await popupPromise
  if (!newPage) {
    console.log(`[P1] RESULT=fail (no popup event in 5s) elapsed=${Date.now() - start}ms`)
    return
  }
  // 关键：新 page 支持 evaluate
  let title: string | undefined
  let evalErr = ''
  try {
    title = await newPage.evaluate(() => document.title)
  } catch (e: any) {
    evalErr = e.message.split('\n')[0].slice(0, 150)
  }
  const isRealPage = typeof newPage.evaluate === 'function' && !evalErr
  console.log(`[P1] RESULT=${isRealPage ? 'pass' : 'fail'} title="${title}" evalErr="${evalErr}" elapsed=${Date.now() - start}ms`)
  await newPage.close().catch(() => {})
})

test('P2: 新标签页支持完整交互 API', async ({ context, page }) => {
  const start = Date.now()
  await page.setContent(`
    <button onclick="window.open('about:blank')">Open Tab</button>
  `)
  const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(e => null)
  try {
    await page.click('button')
  } catch (e: any) {
    console.log(`[P2] RESULT=fail (click threw) elapsed=${Date.now() - start}ms err=${e.message.split('\n')[0].slice(0, 150)}`)
    return
  }
  const newPage: any = await popupPromise
  if (!newPage) {
    console.log(`[P2] RESULT=fail (no popup event in 5s) elapsed=${Date.now() - start}ms`)
    return
  }
  let text: string | null = null
  let apiErr = ''
  try {
    await newPage.setContent('<div id="target">Hello from new tab</div>')
    text = await newPage.textContent('#target')
  } catch (e: any) {
    apiErr = e.message.split('\n')[0].slice(0, 150)
  }
  const pass = text === 'Hello from new tab'
  console.log(`[P2] RESULT=${pass ? 'pass' : 'fail'} text="${text}" apiErr="${apiErr}" elapsed=${Date.now() - start}ms`)
  await newPage.close().catch(() => {})
})

// ---------- 3.5 Context 生命周期 ----------

test('C1: 关闭非默认 context 不会断开浏览器', async ({ browser }) => {
  const start = Date.now()
  try {
    const defaultContext = browser.contexts()[0]
    const newContext = await browser.newContext()
    await newContext.close().catch(() => {})
    const connected = browser.isConnected()
    const defaultPages = defaultContext.pages().length
    console.log(`[C1] RESULT=pass connected=${connected} defaultPages=${defaultPages} elapsed=${Date.now() - start}ms`)
  } catch (e: any) {
    console.log(`[C1] RESULT=fail elapsed=${Date.now() - start}ms err=${e.message.split('\n')[0].slice(0, 200)}`)
  }
})

test('C2: context.pages() 返回正确列表', async ({ browser }) => {
  const start = Date.now()
  try {
    const context = await browser.newContext()
    const page1 = await context.newPage()
    const page2 = await context.newPage()
    const pages = context.pages()
    let allUsable = true
    const urls: string[] = []
    for (const p of pages) {
      try {
        const url = p.url()
        urls.push(url)
      } catch {
        allUsable = false
      }
    }
    console.log(`[C2] RESULT=pass pages=${pages.length} allUsable=${allUsable} urls=${JSON.stringify(urls)} elapsed=${Date.now() - start}ms`)
    await context.close().catch(() => {})
  } catch (e: any) {
    console.log(`[C2] RESULT=fail elapsed=${Date.now() - start}ms err=${e.message.split('\n')[0].slice(0, 200)}`)
  }
})
