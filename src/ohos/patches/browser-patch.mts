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
  const cdpContexts = new Set(browser.contexts())
  ;(browser as any).__cdpDefaultContext = [...cdpContexts][0] ?? null
  for (const ctx of cdpContexts) {
    applyContextPatches(ctx)
  }

  const realContexts = (browser.contexts as Function).bind(browser)
  ;(browser as any).contexts = () =>
    (realContexts() as typeof browser.contexts extends () => infer R ? R : never)
      .filter((ctx: (typeof browser.contexts extends () => (infer C)[] ? C : never)) => !cdpContexts.has(ctx))

  // 2. 包裹 newContext：创建真实隔离 context + 立即注入补丁
  const realNewContext = browser.newContext.bind(browser)
  ;(browser as any).newContext = async (opts?: BrowserContextOptions) => {
    const ctx = await realNewContext(opts ?? {})
    applyContextPatches(ctx)
    return ctx
  }

  // 3. 新增 newPage：委托给 patched newContext + ctx.newPage()
  ;(browser as any).newPage = async (opts?: BrowserContextOptions) => {
    const ctx = await (browser as any).newContext(opts)
    return ctx.newPage()
  }

  // 4. 断线自动重连
  browser.on('disconnected', () => { void conn.reconnect() })
}
