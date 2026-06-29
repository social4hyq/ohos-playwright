// src/ohos/patches/page-patch.mts
// ArkWeb per-page CDP 适配层：
//   - beforeunload tracking（防止系统弹窗挂起 WebSocket）
//   - goto/goBack/goForward 覆盖（CDP 路径兼容）
//   - window.open 拦截 + popup poller
//   - evaluate 错误 re-emit
// Note: hover/locator override belongs to input-patch.mts

import type { Page, BrowserContext } from '@playwright/test'

export type PageCleanup = (opts?: { navigateTo?: string }) => Promise<void>

// Init script that patches window.addEventListener to track 'beforeunload' listeners.
// ArkWeb shows a native "Leave page?" dialog when beforeunload fires during CDP navigation;
// that dialog cannot be dismissed via CDP → crashes the WebSocket. By tracking handlers
// we can remove them all before any cleanup navigation.
export const BEFOREUNLOAD_TRACKING_SCRIPT = () => {
  if ((window as any).__ohosBeforeunloadPatched) return
  ;(window as any).__ohosBeforeunloadPatched = true
  const _handlers: EventListenerOrEventListenerObject[] = []
  const _origAdd = window.addEventListener.bind(window)
  const _origRemove = window.removeEventListener.bind(window)
  ;(window as any).addEventListener = (type: string, listener: any, ...rest: any[]) => {
    if (type === 'beforeunload' && listener) _handlers.push(listener)
    return (_origAdd as any)(type, listener, ...rest)
  }
  ;(window as any).removeEventListener = (type: string, listener: any, ...rest: any[]) => {
    if (type === 'beforeunload') {
      const idx = _handlers.indexOf(listener)
      if (idx !== -1) _handlers.splice(idx, 1)
    }
    return (_origRemove as any)(type, listener, ...rest)
  }
  ;(window as any).__ohosRemoveAllBeforeunload = () => {
    ;(window as any).onbeforeunload = null
    for (const h of _handlers) {
      try { _origRemove('beforeunload', h) } catch {}
    }
    _handlers.length = 0
  }
}

// Helper: evaluate that removes all beforeunload handlers (tracked + window.onbeforeunload).
export async function clearBeforeunload(p: Page): Promise<void> {
  try {
    await p.evaluate(() => {
      if ((window as any).__ohosRemoveAllBeforeunload) (window as any).__ohosRemoveAllBeforeunload()
      else { (window as any).onbeforeunload = null }
    })
  } catch {}
}

// CDP Target.createTarget verified stable on ArkWeb (10+ targets, no WS disconnect).
// Target.closeTarget also verified stable. Use these instead of the fragile
// navigate-to-blank + fake-close pattern that was needed before the verification.

const _pageTargetMap = new WeakMap<object, string>()

export function setPageTargetId(page: Page, targetId: string): void {
  _pageTargetMap.set(page, targetId)
}

// Create a new page in the default context via CDP Target.createTarget.
// Returns the new Page on success, null if Playwright never picks up the target.
// Much simpler than createPopupPage — no URL navigation, just blank target creation.
export async function createPageViaCDP(
  context: BrowserContext,
  seedPage?: Page | null,
): Promise<Page | null> {
  const useSeed = seedPage ?? context.pages()[0]
  if (!useSeed) return null
  let session: import('@playwright/test').CDPSession | null = null
  try {
    session = await context.newCDPSession(useSeed)
    const r = await (session.send as any)('Target.createTarget', { url: 'about:blank' }) as { targetId?: string }
    if (!r.targetId) return null

    const pagesBefore = context.pages().length
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      if (context.pages().length > pagesBefore) break
      await new Promise(res => setTimeout(res, 50))
    }
    const allPages = context.pages()
    if (allPages.length <= pagesBefore) {
      // Orphaned target: close it so we don't leak
      await (session.send as any)('Target.closeTarget', { targetId: r.targetId }).catch(() => {})
      return null
    }
    const newPage = allPages.find(p => p !== useSeed) ?? allPages[allPages.length - 1]
    if (newPage) _pageTargetMap.set(newPage, r.targetId)
    return newPage
  } catch {
    return null
  } finally {
    if (session) await session.detach().catch(() => {})
  }
}

// Close a page via CDP Page.close. Target.closeTarget removes the CDP target
// but does NOT visually close the browser tab. Page.close (sent through an
// attached CDP session) actually closes the tab on ArkWeb. Verified: both
// about:blank tabs closed, CDP reports 0 targets after.
export async function closePageViaCDP(context: BrowserContext, page: Page): Promise<void> {
  if (process.env.OHOS_PW_DEBUG_DISCONNECT) {
    console.error(`[ohos][PAGE_CLOSE_CDP] ${new Date().toISOString()} url=${page.url()}`)
  }
  await clearBeforeunload(page)
  _pageTargetMap.delete(page)

  // Try Page.close via CDP session attached to this page's target
  try {
    const session = await context.newCDPSession(page)
    try {
      await (session.send as any)('Page.close')
      return // Success — tab closed
    } finally {
      await session.detach().catch(() => {})
    }
  } catch { /* CDP close failed — fall back */ }

  // Fallback: navigate away + emit close
  const dismissDlg = (d: import('playwright-core').Dialog) => d.dismiss().catch(() => {})
  page.on('dialog', dismissDlg)
  try { await page.goto('about:blank') } catch {}
  page.off('dialog', dismissDlg)
  ;(page as unknown as { emit: (e: string) => void }).emit('close')
}

// Build a safe page.close() wrapper — uses CDP Target.closeTarget when a context
// is available, falls back to navigate-to-blank otherwise.
export function makeSafePageClose(p: Page, context?: BrowserContext): (_opts?: { runBeforeUnload?: boolean }) => Promise<void> {
  return async (_opts?: { runBeforeUnload?: boolean }) => {
    if (process.env.OHOS_PW_DEBUG_DISCONNECT) {
      console.error(`[ohos][PAGE_CLOSE] ${new Date().toISOString()} url=${p.url()}`)
    }
    await clearBeforeunload(p)

    // Try CDP close if we have context access
    if (context) {
      try { await closePageViaCDP(context, p); return } catch {}
    }

    // Fallback: navigate away + emit close
    const dismissDlg = (d: import('playwright-core').Dialog) => d.dismiss().catch(() => {})
    p.on('dialog', dismissDlg)
    try { await p.goto('about:blank') } catch {}
    p.off('dialog', dismissDlg)
    ;(p as unknown as { emit: (e: string) => void }).emit('close')
    if (process.env.OHOS_PW_DEBUG_DISCONNECT) {
      console.error(`[ohos][PAGE_CLOSE_DONE] ${new Date().toISOString()}`)
    }
  }
}

// Create a real Page in the default context via Target.createTarget.
// Returns the new page (already navigated to popupUrl) on success, or null
// to let the caller fall back to idle-tab proxy or stub.
//
// Precondition: PW_CHROMIUM_ATTACH_TO_OTHER=1 must be set, otherwise the new
// target created by ArkWeb will be type:'other' and Playwright won't pick
// it up into ctx.pages().
export async function createPopupPage(
  context: BrowserContext,
  seedPage: Page,
  popupUrl: string,
): Promise<Page | null> {
  let session: import('@playwright/test').CDPSession | null = null
  try {
    session = await context.newCDPSession(seedPage)
    const r = await Promise.race([
      (session as unknown as { send: (cmd: string, args?: unknown) => Promise<unknown> })
        .send('Target.createTarget', { url: 'about:blank' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('createTarget timeout')), 3000)),
    ]) as { targetId?: string }
    if (!r.targetId) return null

    // Poll ctx.pages() until Playwright picks up the new target (max 2s).
    const pagesBefore = context.pages().length
    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      if (context.pages().length > pagesBefore) break
      await new Promise((r) => setTimeout(r, 50))
    }
    const allPages = context.pages()
    if (allPages.length <= pagesBefore) {
      // Target was created but Playwright never picked it up (orphaned target).
      // Close it explicitly so ArkWeb doesn't crash CDP when the context is closed.
      await (session as unknown as { send: (cmd: string, args: unknown) => Promise<unknown> })
        .send('Target.closeTarget', { targetId: r.targetId }).catch(() => {})
      return null
    }

    // Pick the newly-added page (any page not equal to seedPage, preferring
    // about:blank which is the createTarget's initial URL).
    const newPage =
      allPages.find((p) => p !== seedPage && p.url() === 'about:blank') ??
      allPages.find((p) => p !== seedPage)
    if (!newPage) return null

    // Navigate to the popup URL (skip for about:blank which is already loaded).
    // On navigation failure, close the tab and return null — otherwise a
    // half-loaded popup tab (url stuck at about:blank) gets mistaken for the
    // launchUrl tab by the next test's fixture-page selector.
    if (popupUrl && popupUrl !== 'about:blank') {
      try {
        await newPage.goto(popupUrl, { timeout: 5000 })
      } catch {
        // Do NOT close the page here. Calling page.close() or Target.closeTarget
        // on a tab with a still-pending navigation crashes the ArkWeb CDP WebSocket.
        // Leave the tab in ctx.pages() so the caller's context teardown can close
        // it after the navigation timeout has fully settled in ArkWeb.
        return null
      }
    }
    return newPage
  } catch {
    return null
  } finally {
    if (session) await session.detach().catch(() => {})
  }
}

export async function installPageWrappers(
  page: Page,
  context: BrowserContext,
  baseURL: string | undefined,
  options?: { skipCreateTarget?: boolean },
): Promise<PageCleanup> {
  const ctxEmit = (context as unknown as { emit: (e: string, v: unknown) => void }).emit.bind(context)

  // connectOverCDP reuses an existing tab — Playwright has no record of its
  // viewport size and viewportSize() returns null. Pre-fetch via CDP.
  const session = await context.newCDPSession(page)
  try {
    try {
      const { cssVisualViewport } = await session.send('Page.getLayoutMetrics' as 'Page.getLayoutMetrics')
      const cached = {
        width: Math.round((cssVisualViewport as { clientWidth: number }).clientWidth),
        height: Math.round((cssVisualViewport as { clientHeight: number }).clientHeight),
      }
      const origViewportSize = page.viewportSize.bind(page)
      page.viewportSize = () => origViewportSize() ?? cached
    } catch {
      // Non-critical — viewportSize() will still return null if CDP call fails.
    }
  } finally {
    await session.detach()
  }

  // Register init script that tracks all addEventListener('beforeunload', ...) handlers.
  // Applied once per page object; runs on every navigation in that page.
  if (!(page as any).__ohosBeforeunloadPatched) {
    ;(page as any).__ohosBeforeunloadPatched = true
    await page.addInitScript(BEFOREUNLOAD_TRACKING_SCRIPT)
  }

  // Override page.close(): Target.closeTarget crashes ArkWeb CDP WebSocket.
  // Navigate to about:blank + emit 'close' event instead, so tests that call
  // page.close() don't kill the CDP session for all subsequent tests.
  const savedClose = (page as unknown as Record<string, unknown>)['close'] as typeof page.close
  ;(page as any).close = makeSafePageClose(page, context)

  // Override goto: connectOverCDP creates the server-side context with no baseURL in
  // its _options, so Playwright's internal Frame.goto cannot resolve relative paths —
  // CDP rejects them as invalid. fixture.mts sets ctx._options.baseURL, which Playwright
  // uses internally (constructURLBasedOnBaseURL). Wrapper is a no-op now — kept for
  // historical reasons; safe to remove if baseURL resolution is verified working.

  // Override goBack: Page.navigateToHistoryEntry hangs in ArkWeb (never resolves).
  // ArkWeb also does not emit Page.frameNavigated for history navigation, so waitForURL
  // never fires. Poll Page.getNavigationHistory.currentIndex instead.
  ;(page as any).goBack = async (options?: Parameters<typeof page.goBack>[0]) => {
    const timeout = options?.timeout ?? 30000
    const s = await page.context().newCDPSession(page)
    try {
      const nav = await (s as any).send('Page.getNavigationHistory')
      const prevIndex = nav.currentIndex as number
      if (prevIndex <= 0) return null
      await page.evaluate(() => history.back())
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const nav2 = await (s as any).send('Page.getNavigationHistory')
        if ((nav2.currentIndex as number) < prevIndex) break
        await new Promise(r => setTimeout(r, 80))
      }
      if (Date.now() >= deadline) throw new Error(`page.goBack: Timeout ${timeout}ms exceeded`)
    } finally {
      await s.detach()
    }
    return null
  }

  // Override goForward: same root cause as goBack.
  ;(page as any).goForward = async (options?: Parameters<typeof page.goForward>[0]) => {
    const timeout = options?.timeout ?? 30000
    const s = await page.context().newCDPSession(page)
    try {
      const nav = await (s as any).send('Page.getNavigationHistory')
      const prevIndex = nav.currentIndex as number
      if (prevIndex >= (nav.entries as any[]).length - 1) return null
      await page.evaluate(() => history.forward())
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const nav2 = await (s as any).send('Page.getNavigationHistory')
        if ((nav2.currentIndex as number) > prevIndex) break
        await new Promise(r => setTimeout(r, 80))
      }
      if (Date.now() >= deadline) throw new Error(`page.goForward: Timeout ${timeout}ms exceeded`)
    } finally {
      await s.detach()
    }
    return null
  }

  // hover/locator override is intentionally omitted here.
  // It belongs to input-patch.mts (applyInputPatches), called separately in the page fixture.

  // ArkWeb's new tab from window.open() is invisible to CDP (Target.createTarget hangs,
  // Target.targetCreated never fires). Intercept via an init script:
  //   - queue the URL for our poller
  //   - return null (Window object hangs CDP serialization if returned)
  // Guard against multiple addInitScript calls across tests accumulating overrides.
  const origEvaluate = page.evaluate.bind(page)
  const alreadyPatched = (page as unknown as Record<string, unknown>)['__ohosPopupPatched']
  if (!alreadyPatched) {
    ;(page as unknown as Record<string, unknown>)['__ohosPopupPatched'] = true
    await page.addInitScript(() => {
      if ((window as unknown as Record<string, unknown>)['__ohosPopupPatched']) return
      ;(window as unknown as Record<string, unknown>)['__ohosPopupPatched'] = true
      ;(window as unknown as Record<string, unknown>)['__ohosPopupQueue'] = [] as Array<{ url: string }>
      window.open = (url?: string | URL) => {
        ;(
          (window as unknown as Record<string, unknown>)['__ohosPopupQueue'] as Array<{ url: string }>
        ).push({ url: String(url ?? '') })
        return null  // Window object hangs CDP serialization — return null instead
      }
    })
  }
  const popupPoller = setInterval(async () => {
    try {
      const pending = await origEvaluate(() => {
        const q = (window as unknown as Record<string, unknown>)['__ohosPopupQueue'] as Array<{ url: string }>
        ;(window as unknown as Record<string, unknown>)['__ohosPopupQueue'] = []
        return q
      })
      for (const { url } of pending ?? []) {
        // 1) Target.createTarget（首选，parallel context 下跳过以免 CDP 崩溃）
        let emitted: Page | null = null
        if (!options?.skipCreateTarget) {
          try {
            emitted = await createPopupPage(context, page, url || 'about:blank')
          } catch {}
        }
        // 2) Fallback A：默认 context 闲置 about:blank tab
        if (!emitted) {
          const idle = context
            .pages()
            .find((p) => p !== page && p.url() === 'about:blank')
          if (idle) {
            try {
              if (url && url !== 'about:blank') {
                await idle.goto(url, { timeout: 5000 })
              }
              // Patch idle tab's close() so specs calling page.close() on a popup
              // don't trigger Target.closeTarget → CDP WebSocket crash.
              if (!(idle as any).__ohosPageClosePatch) {
                ;(idle as any).__ohosPageClosePatch = true
                ;(idle as any).close = makeSafePageClose(idle, context)
              }
              emitted = idle
            } catch {}
          }
        }
        // 3) Fallback B：退回原 stub（保持兼容）
        if (!emitted) {
          const stub = {
            waitForLoadState: async () => {},
            url: () => url,
            close: async () => {},
          }
          ctxEmit('page', stub as unknown as Page)
        } else {
          ctxEmit('page', emitted)
        }
      }
    } catch {}
  }, 150)

  // evaluate() exceptions reject the promise but never become pageerror events
  // (CDP catches them before they become uncaught). Intercept and re-emit.
  // 透传所有参数让 Playwright 内置的 "Too many arguments" 校验生效。
  // Save and restore to prevent wrapper accumulation across tests on the same page object.
  const savedEvaluate = (page as unknown as Record<string, unknown>)['evaluate'] as typeof origEvaluate
  ;(page as unknown as { evaluate: unknown }).evaluate = async (...args: unknown[]) => {
    try {
      return await (origEvaluate as (...a: unknown[]) => Promise<unknown>)(...args)
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e))
      ;(page as unknown as { emit: (e: string, v: unknown) => void }).emit('pageerror', err)
      throw err
    }
  }

  return async (opts?: { navigateTo?: string }) => {
    clearInterval(popupPoller)
    ;(page as unknown as { evaluate: unknown }).evaluate = savedEvaluate
    ;(page as unknown as { close: unknown }).close = savedClose
    if (opts?.navigateTo) {
      // Clear all beforeunload handlers before navigating — ArkWeb shows a native
      // system-level "Leave page?" dialog that CDP cannot auto-dismiss.
      await clearBeforeunload(page)
      // Auto-dismiss any dialog that fires during the cleanup navigation
      // (alert/confirm/prompt left over from a test body).
      const dismissDialog = (d: import('playwright-core').Dialog) => d.dismiss().catch(() => {})
      page.on('dialog', dismissDialog)
      try { await page.goto(opts.navigateTo) } catch {}
      page.off('dialog', dismissDialog)
    }
  }
}
