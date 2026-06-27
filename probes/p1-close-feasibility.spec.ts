// 验证默认 context 中闲置 tab 的关键操作（goto/evaluate/setContent/close）是否工作
// 这是 popup 代理方案的可行性前提
import { test as base } from '@playwright/test'
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

function readEndpoint(): string {
  const url = process.env.OHOS_PW_CDP_URL
  if (url) return url
  const infoPath = process.env.OHOS_PW_INFO_PATH ?? resolve(tmpdir(), 'ohos-playwright-cdp.json')
  return JSON.parse(readFileSync(infoPath, 'utf8')).endpoint
}

base('idle-tab operations feasibility', async ({}) => {
  const browser = await chromium.connectOverCDP(readEndpoint())
  try {
    const ctx = browser.contexts()[0]
    const pages = ctx.pages()
    // 找一个 url=about:blank 的闲置 tab（取第二个 about:blank，保留第一个给 fixture）
    const idle = pages.find((p, i) => i > 0 && p.url() === 'about:blank')
    if (!idle) {
      console.log('[PROBE] no idle about:blank tab available')
      return
    }
    console.log(`[PROBE] found idle tab url=${idle.url()}`)

    // 1. goto
    const t0 = Date.now()
    try {
      await idle.goto('data:text/html,<title>POPUP</title><div id=x>hello</div>')
      console.log(`[PROBE] goto ok url=${idle.url().slice(0, 50)} elapsed=${Date.now() - t0}ms`)
    } catch (e: any) {
      console.log(`[PROBE] goto FAIL: ${e.message.split('\n')[0].slice(0, 100)}`)
    }

    // 2. evaluate
    try {
      const title = await idle.evaluate(() => document.title)
      console.log(`[PROBE] evaluate ok title="${title}"`)
    } catch (e: any) {
      console.log(`[PROBE] evaluate FAIL: ${e.message.split('\n')[0].slice(0, 100)}`)
    }

    // 3. setContent
    try {
      await idle.setContent('<div id=target>setContent works</div>')
      const text = await idle.textContent('#target')
      console.log(`[PROBE] setContent ok text="${text}"`)
    } catch (e: any) {
      console.log(`[PROBE] setContent FAIL: ${e.message.split('\n')[0].slice(0, 100)}`)
    }

    // 4. screenshot（验证默认 context 的 page 截图正常）
    try {
      const buf = await idle.screenshot({ timeout: 4000 })
      console.log(`[PROBE] screenshot ok bytes=${buf.length}`)
    } catch (e: any) {
      console.log(`[PROBE] screenshot FAIL: ${e.message.split('\n')[0].slice(0, 100)}`)
    }

    // 5. close（关键：popup.close() 真关闭能否工作）
    try {
      const t1 = Date.now()
      await idle.close()
      console.log(`[PROBE] close ok elapsed=${Date.now() - t1}ms`)
    } catch (e: any) {
      console.log(`[PROBE] close FAIL: ${e.message.split('\n')[0].slice(0, 100)}`)
    }

    // close 后默认 context 还剩几个 page
    console.log(`[PROBE] after close pages=${ctx.pages().length}`)
  } finally {
    await browser.close().catch(() => {})
  }
})
