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
    applyContextPatches(ctx, { isDefault: true })
  }

  const realContexts = (browser.contexts as Function).bind(browser)
  ;(browser as any).contexts = () =>
    (realContexts() as ReturnType<Browser['contexts']>).filter(ctx => !cdpContexts.has(ctx))

  // 2. browser.newContext()：创建真实隔离 context + 注入补丁。
  //    ArkWeb 在 Target.disposeBrowserContext 上不稳定（会断 WebSocket），所以
  //    新建 context 的 close 也必须走 emit('close') 路径而不是真实 dispose。
  const realNewContext = browser.newContext.bind(browser)
  ;(browser as any).newContext = async (opts?: BrowserContextOptions) => {
    if (process.env.OHOS_PW_DEBUG_DISCONNECT) {
      console.error(`[ohos][NEW_CONTEXT] ${new Date().toISOString()}`)
    }
    const ctx = await realNewContext(opts ?? {})
    if (process.env.OHOS_PW_DEBUG_DISCONNECT) {
      console.error(`[ohos][NEW_CONTEXT_DONE] ${new Date().toISOString()}`)
    }
    applyContextPatches(ctx, { isDefault: false })
    return ctx
  }

  // 3. browser.newPage()：创建新 context + 新 page；page.close() 同步关闭 context
  //    对齐标准 Playwright browser.newPage() 行为（page-owned context lifecycle）。
  //    page.once('close', ...) 是 fire-and-forget，await page.close() 返回时 ctx 未关闭，
  //    导致 browser.contexts() 在 page.close() 之后仍能看到该 context。包装 page.close()
  //    在真实关闭后同步 await ctx.close()，确保 contexts() 数量立刻同步。
  ;(browser as any).newPage = async (opts?: BrowserContextOptions) => {
    const ctx = await realNewContext(opts ?? {})
    const page = await ctx.newPage()
    // page-owned context：第二次 ctx.newPage() 必须抛错（对齐 Playwright 上游语义）。
    ;(ctx as any).newPage = async () => {
      throw new Error(
        'Please use browser.newContext() for multi-page scripts that share the context.',
      )
    }
    const realClose = page.close.bind(page)
    ;(page as any).close = async (closeOpts?: Parameters<typeof page.close>[0]) => {
      await realClose(closeOpts)
      await ctx.close().catch(() => {})
    }
    return page
  }

  // 4. Disconnect 仅记录日志，恢复由 OhosDevice.browser() 在下次调用时按需重连：
  //    - fire-and-forget reconnect 旧实现会留下 dead Browser，下次 fixture 仍拿到陈旧引用
  //    - 现在改为：device 监听同一 disconnect 事件 → 清空 _browser 缓存
  //    - 下一个测试 fixture 调 device.browser() 时，probe endpoint → 必要时 connect()
  browser.on('disconnected', () => {
    if (process.env.OHOS_PW_DEBUG_DISCONNECT) {
      const ts = new Date().toISOString()
      console.error(`\n[ohos][DISCONNECT] ${ts} browser disconnected`)
      console.error(new Error('disconnect stack trace').stack)
    }
  })
  void conn  // intentionally referenced; reconnect now owned by OhosDevice
}
