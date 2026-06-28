// src/ohos/patches/browser-patch.mts
// applyBrowserPatches — browser 对象级 ArkWeb 补丁：
//   1. 对所有已有 context 调用 applyContextPatches
//   2. 包裹 browser.newContext()：创建真实隔离 context + 自动注入补丁
//   3. 新增 browser.newPage()：委托给 patched newContext + ctx.newPage()

import type { Browser, BrowserContextOptions } from '@playwright/test'
import { applyContextPatches } from './context-patch.mts'
import type { OhosDeviceConnection } from '../connection.mts'

export function applyBrowserPatches(
  browser: Browser,
  conn: OhosDeviceConnection,
): void {
  // 1. CDP 预存 context（connectOverCDP 时已存在）
  // 存为 __cdpDefaultContext 供 fixture 直接引用，从 browser.contexts() 中隐藏，
  // 使 browser.contexts() 行为与 launched browser 一致（从 0 开始计数）。
  // 只有默认 context 需要 ArkWeb 补丁；新建 context 走标准 CDP，无需补丁。
  const cdpContexts = new Set(browser.contexts())
  ;(browser as any).__cdpDefaultContext = [...cdpContexts][0] ?? null
  for (const ctx of cdpContexts) {
    applyContextPatches(ctx)
  }

  const realContexts = (browser.contexts as Function).bind(browser)
  ;(browser as any).contexts = () =>
    (realContexts() as ReturnType<Browser['contexts']>).filter(ctx => !cdpContexts.has(ctx))

  // 2. browser.newContext()：创建真实隔离 context（不注入 ArkWeb 补丁，CDP 正常）
  const realNewContext = browser.newContext.bind(browser)
  ;(browser as any).newContext = (opts?: BrowserContextOptions) => realNewContext(opts ?? {})

  // 3. browser.newPage()：创建新 context + 新 page；page close 时自动关闭 context
  //    对齐标准 Playwright browser.newPage() 行为（page-owned context lifecycle）。
  ;(browser as any).newPage = async (opts?: BrowserContextOptions) => {
    const ctx = await realNewContext(opts ?? {})
    const page = await ctx.newPage()
    page.once('close', () => { ctx.close().catch(() => {}) })
    return page
  }

  // 4. 断线自动重连
  browser.on('disconnected', () => { void conn.reconnect() })
}
