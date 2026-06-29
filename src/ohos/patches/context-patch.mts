// src/ohos/patches/context-patch.mts
// applyContextPatches — 对每个 BrowserContext 对象注入 ArkWeb 兼容补丁。
// 幂等（__ohosPatch 标志防止重复调用）。

import type { BrowserContext, Page } from '@playwright/test'
import { clearBeforeunload, makeSafePageClose, createPopupPage, createPageViaCDP, BEFOREUNLOAD_TRACKING_SCRIPT } from './page-patch.mts'

// Bridge page-level events to context level. ArkWeb does not emit console,
// dialog, or pageerror events at the browser context level (verified with CDP
// monitoring), but page-level events work correctly. This bridge subscribes
// to each page's events and re-emits them on the context, enabling
// context.waitForEvent('console') / context.waitForEvent('dialog') /
// context.waitForEvent('weberror') patterns.
function installEventBridge(ctx: BrowserContext, page: Page): void {
  const key = '__ohosEventBridgeInstalled' as any
  if ((page as any)[key]) return
  ;(page as any)[key] = true

  const ctxEmit = (ctx as unknown as { emit: (e: string, v: unknown) => void }).emit.bind(ctx)

  page.on('console', (msg: unknown) => { ctxEmit('console', msg) })
  page.on('dialog', (dlg: unknown) => { ctxEmit('dialog', dlg) })
  page.on('pageerror', (err: unknown) => { ctxEmit('weberror', err) })
}

export function applyContextPatches(ctx: BrowserContext, opts?: { isDefault?: boolean }): void {
  if ((ctx as any).__ohosPatch) return
  ;(ctx as any).__ohosPatch = true
  const isDefault = !!opts?.isDefault

  // Track exposed bindings/functions so the fixture can clear names between
  // tests. ArkWeb doesn't support Target.disposeBrowserContext, so context-level
  // bindings accumulate. Names are tracked for conflict detection; the actual
  // bindings live until worker recycle.
  if (!(ctx as any).__ohosBindings) {
    ;(ctx as any).__ohosBindings = new Set<string>()
  }
  const bindings: Set<string> = (ctx as any).__ohosBindings

  // Intercept exposeBinding to track names
  const origExposeBinding = (ctx.exposeBinding as Function).bind(ctx)
  ;(ctx as any).exposeBinding = async (name: string, ...args: any[]) => {
    bindings.add(name)
    return origExposeBinding(name, ...args)
  }

  // Intercept exposeFunction to track names
  const origExposeFunction = (ctx.exposeFunction as Function).bind(ctx)
  ;(ctx as any).exposeFunction = async (name: string, ...args: any[]) => {
    bindings.add(name)
    return origExposeFunction(name, ...args)
  }

  // ctx.browser() returns the realBrowser by default; rewrite to return the
  // OhosDevice proxy so identity checks like expect(browser).toBe(context.browser())
  // pass (fixture's `browser` is the same proxy). __ohosProxy is set by
  // OhosDevice._ensureBrowser before applyBrowserPatches → applyContextPatches.
  const realBrowser = ctx.browser()
  const proxy = (realBrowser as unknown as { __ohosProxy?: unknown })?.__ohosProxy
  if (proxy) {
    ;(ctx as any).browser = () => proxy
  }

  // close 行为分两路：
  //   默认 context：不能真实 dispose（会关掉整个浏览器）。导航到 about:blank +
  //     emit close — 让 Playwright 内部清理但不动 CDP 端 Context。
  //   非默认 context（browser.newContext()）：不能在已 navigate 过的 page 上做
  //     goto('about:blank')（ArkWeb 会断开 WS），也不能真实 disposeBrowserContext
  //     （会断 WS）。直接 emit('close') — 让 Playwright 客户端释放引用，CDP 端
  //     的 context/pages 留作泄漏，下次 worker 重启时由 ArkWeb 自己清理。
  ;(ctx as any).close = async () => {
    if (process.env.OHOS_PW_DEBUG_DISCONNECT) {
      console.error(`[ohos][CTX_CLOSE] ${new Date().toISOString()} default=${isDefault} pages=${ctx.pages().length}`)
    }
    if (isDefault) {
      for (const p of ctx.pages()) {
        await clearBeforeunload(p)
        try { await p.goto('about:blank') } catch {}
      }
    } else {
      // For non-default contexts, mirror Playwright's real close sequence: tear
      // down each page client-side so ctx.pages() returns [] after close.
      // (We can't dispose the underlying CDP target — ArkWeb drops the WS — so
      // pages leak server-side until the worker recycles.)
      for (const p of ctx.pages()) {
        ;(p as unknown as { _onClose: () => void })._onClose()
      }
    }
    // _onClose() is the client-side close handler that Playwright wires to the
    // channel 'close' event. It removes ctx from browser._contexts (so
    // browser.contexts() returns the updated set) AND emits Events.BrowserContext.Close.
    // Plain ctx.emit('close') skips the _contexts cleanup, leaving stale entries.
    ;(ctx as unknown as { _onClose: () => void })._onClose()
    if (process.env.OHOS_PW_DEBUG_DISCONNECT) {
      console.error(`[ohos][CTX_CLOSE_DONE] ${new Date().toISOString()}`)
    }
  }

  // newPage：
  //   - 非默认 ctx（browser.newContext()）→ 总是 realNewPage()
  //   - 默认 ctx 空 → realNewPage()（兼容 browser.newPage 路径）
  //   - 默认 ctx 已有页面 → createPageViaCDP（Target.createTarget via CDP；已验证稳定）
  //   - createPageViaCDP 失败 → reset seedPage to about:blank
  const realNewPage = (ctx.newPage as Function).bind(ctx)
  const wrapPage = async (p: import('@playwright/test').Page) => {
    if (!(p as any).__ohosPageClosePatch) {
      ;(p as any).__ohosPageClosePatch = true
      if (!(p as any).__ohosBeforeunloadPatched) {
        ;(p as any).__ohosBeforeunloadPatched = true
        await p.addInitScript(BEFOREUNLOAD_TRACKING_SCRIPT)
      }
      ;(p as any).close = makeSafePageClose(p, ctx)
    }
    installEventBridge(ctx, p)
    return p
  }
  ;(ctx as any).newPage = async () => {
    const seedPage = ctx.pages()[0]

    if (!isDefault || !seedPage) {
      const p = await realNewPage()
      return await wrapPage(p)
    }

    const newP = await createPageViaCDP(ctx, seedPage)
    if (newP) {
      if (!(newP as any).__ohosPageClosePatch) {
        ;(newP as any).__ohosPageClosePatch = true
        if (!(newP as any).__ohosBeforeunloadPatched) {
          ;(newP as any).__ohosBeforeunloadPatched = true
          await newP.addInitScript(BEFOREUNLOAD_TRACKING_SCRIPT)
        }
        ;(newP as any).close = makeSafePageClose(newP, ctx)
      }
      installEventBridge(ctx, newP)
      return newP
    }

    // Fallback：reset seedPage to about:blank
    await clearBeforeunload(seedPage)
    const dismissDlg = (d: import('playwright-core').Dialog) => d.dismiss().catch(() => {})
    seedPage.on('dialog', dismissDlg)
    try { await seedPage.goto('about:blank') } catch {}
    seedPage.off('dialog', dismissDlg)
    return seedPage
  }

  // 对 context 内所有已有 page 补 close patch + event bridge
  for (const p of ctx.pages()) {
    if (!(p as any).__ohosPageClosePatch) {
      ;(p as any).__ohosPageClosePatch = true
      ;(p as any).close = makeSafePageClose(p, ctx)
    }
    installEventBridge(ctx, p)
  }
}
