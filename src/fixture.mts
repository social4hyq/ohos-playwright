import { readFileSync } from 'node:fs'
import { test as base, chromium } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { INFO_PATH, type CdpInfo } from './info-path.mts'

export interface DeviceDescriptor {
  viewport: { width: number; height: number }
  deviceScaleFactor?: number
  isMobile?: boolean
  userAgent?: string
}

function readInfo(): CdpInfo {
  return JSON.parse(readFileSync(INFO_PATH, 'utf8')) as CdpInfo
}

function readEndpoint(): string { return readInfo().endpoint }

export interface StorageState {
  cookies: { name: string; value: string; domain?: string; path?: string; url?: string }[]
  origins: { origin: string; localStorage: { name: string; value: string }[] }[]
}

export const test = base.extend<{
  emulateDevice: (descriptor: DeviceDescriptor) => Promise<void>
  // ArkWeb fully implements touch via CDP Input.dispatchTouchEvent, but
  // Playwright's page.touchscreen.tap() refuses to run unless the context was
  // created with hasTouch — impossible in single-context reuse mode. Expose a
  // CDP-backed tap that works regardless. Coordinates are CSS pixels relative
  // to the viewport, matching Playwright's touchscreen.tap semantics.
  tap: (x: number, y: number) => Promise<void>
  // Playwright's context.storageState() / use:{storageState} rely on internal
  // _page fixtures that break in single-context reuse mode. These helpers
  // serialize/restore cookies + localStorage via the working addCookies/
  // cookies/clearCookies + page.evaluate paths. Pass an explicit origin to
  // scope localStorage capture (defaults to the current page's origin).
  saveStorageState: (origin?: string) => Promise<StorageState>
  loadStorageState: (state: StorageState) => Promise<void>
}>({
  browser: [
    async ({}, use: (b: Browser) => Promise<void>) => {
      const browser = await chromium.connectOverCDP(readEndpoint())
      // ArkWeb CDP does not implement Target.createBrowserContext — connectOverCDP
      // reuses the single existing context. browser.newContext() returns without
      // throwing but produces an empty shell (0 pages) that silently fails every
      // subsequent operation. Intercept and throw an explicit, actionable error
      // so users aren't misled by the false-positive success.
      const origNewContext = browser.newContext.bind(browser) as Browser['newContext']
      ;(browser as unknown as { newContext: Browser['newContext'] }).newContext = (() => {
        throw new Error(
          'browser.newContext() is not supported in ArkWeb CDP mode (single context only). ' +
          'Tests share one context and one page — isolate with localStorage.clear() + page.reload(). ' +
          'See ohos-playwright README "Limitations" section.',
        )
      }) as Browser['newContext']
      try {
        await use(browser)
      } finally {
        // Restore in case the browser object is reused across workers.
        ;(browser as unknown as { newContext: Browser['newContext'] }).newContext = origNewContext
      }
    },
    { scope: 'worker' as const },
  ],

  context: async (
    { browser }: { browser: Browser },
    use: (c: BrowserContext) => Promise<void>,
    testInfo: { project: { use: { baseURL?: string } } },
  ) => {
    const ctx = browser.contexts()[0]
    // Inject baseURL into the context's private _options so that internal
    // Playwright URL resolution (toHaveURL, waitForURL, locators) works for
    // SPA-navigated pages — page.goto patching alone is not sufficient.
    const baseURL = testInfo.project.use.baseURL
    if (baseURL) {
      ;(ctx as unknown as { _options: Record<string, unknown> })._options.baseURL = baseURL
    }
    await use(ctx)
  },

  page: async (
    { context }: { context: BrowserContext },
    use: (p: Page) => Promise<void>,
    testInfo: { project: { use: { baseURL?: string } } },
  ) => {
    const pages = context.pages()
    if (pages.length === 0) throw new Error('No pages in ArkWeb CDP context. Open a tab first.')
    const info = readInfo()
    // If globalSetup opened a fresh tab for the test, use it — this avoids
    // disturbing user tabs that were open when the test suite started.
    // The new tab is identified by its launchUrl (default: about:blank); if
    // multiple tabs match, pick the last one (most recently opened).
    const page = info.openedNewTab
      ? ([...pages].reverse().find((p) => p.url() === (info.launchUrl ?? 'about:blank')) ?? pages[pages.length - 1])
      : (pages.find((p) => p.url().startsWith('http://localhost')) ?? pages[0])
    const ctxEmit = (context as unknown as { emit: (e: string, v: unknown) => void }).emit.bind(context)

    // Patch baseURL
    const baseURL = testInfo.project.use.baseURL
    if (baseURL) {
      const root = baseURL.replace(/\/+$/, '')
      const origGoto = page.goto.bind(page)
      page.goto = ((url: string, opts?: Record<string, unknown>) =>
        origGoto((url.startsWith('/') && !url.startsWith('//')) ? root + url : url, opts)
      ) as typeof page.goto
    }

    // connectOverCDP reuses an existing tab — Playwright has no record of its
    // viewport size and viewportSize() returns null. Pre-fetch via CDP.
    const session = await context.newCDPSession(page)
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
    } finally {
      await session.detach()
    }

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
          // context.newPage() calls Target.createTarget which hangs in ArkWeb.
          // Emit a minimal stub — satisfies waitForLoadState / url / close.
          const stub = {
            waitForLoadState: async () => {},
            url: () => url,
            close: async () => {},
          }
          ctxEmit('page', stub as unknown as import('@playwright/test').Page)
        }
      } catch {}
    }, 150)

    // evaluate() exceptions reject the promise but never become pageerror events
    // (CDP catches them before they become uncaught). Intercept and re-emit.
    // Save and restore to prevent wrapper accumulation across tests on the same page object.
    const savedEvaluate = (page as unknown as Record<string, unknown>)['evaluate'] as typeof origEvaluate
    ;(page as unknown as { evaluate: unknown }).evaluate = async (fn: unknown, arg?: unknown) => {
      try {
        return await origEvaluate(fn as Parameters<typeof origEvaluate>[0], arg as Parameters<typeof origEvaluate>[1])
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e))
        ;(page as unknown as { emit: (e: string, v: unknown) => void }).emit('pageerror', err)
      }
    }

    try {
      await use(page)
    } finally {
      clearInterval(popupPoller)
      // Restore evaluate to prevent wrapper accumulation across tests.
      ;(page as unknown as { evaluate: unknown }).evaluate = savedEvaluate
      // Reset the test tab to about:blank so it's clean for the next test.
      // page.close() sends Target.closeTarget which terminates the ArkWeb
      // DevTools socket — use goto instead to keep the connection alive.
      if (info.openedNewTab) {
        try { await page.goto('about:blank') } catch {}
      }
    }
  },

  emulateDevice: async ({ page }, use) => {
    await use(async (descriptor: DeviceDescriptor) => {
      const session = await page.context().newCDPSession(page)
      try {
        // ArkWeb note: with mobile:true, Emulation.setDeviceMetricsOverride enables
        // the mobile layout-viewport path and the passed width/height are ignored
        // (window.innerWidth reads 980 regardless). Use isMobile:false for a
        // precise viewport. See README "emulateDevice fixture" section.
        if (descriptor.isMobile) {
          console.warn(
            '[ohos-playwright] emulateDevice({ isMobile: true }): ArkWeb renders at the 980px ' +
            'default mobile layout viewport; the passed width/height will NOT apply. ' +
            'Use isMobile: false for a precise viewport.',
          )
        }
        // ArkWeb note: setUserAgentOverride is acked but ignored — UA cannot be changed via CDP.
        await session.send('Emulation.setDeviceMetricsOverride', {
          width: descriptor.viewport.width,
          height: descriptor.viewport.height,
          deviceScaleFactor: descriptor.deviceScaleFactor ?? 1,
          mobile: descriptor.isMobile ?? false,
        })
        if (descriptor.userAgent !== undefined) {
          await session.send('Emulation.setUserAgentOverride', {
            userAgent: descriptor.userAgent,
          })
        }
      } finally {
        await session.detach()
      }
    })
  },

  tap: async ({ page }, use) => {
    await use(async (x: number, y: number) => {
      const session = await page.context().newCDPSession(page)
      try {
        // ArkWeb fully implements Input.dispatchTouchEvent (verified: touchstart
        // touches=1 | touchend received). Playwright's touchscreen.tap() requires
        // hasTouch at context creation, which is impossible in single-context reuse
        // mode. This wrapper issues a press+release pair directly.
        // TouchPoint.state isn't in Playwright's TS types but is part of the CDP
        // spec and accepted by ArkWeb; cast to any to bypass the narrowed type.
        await (session.send as any)('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x, y, id: 0, state: 'pressed' }],
          modifiers: 0,
          timeStamp: 0,
        })
        await (session.send as any)('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [{ x, y, id: 0, state: 'released' }],
          modifiers: 0,
          timeStamp: 0,
        })
      } finally {
        await session.detach()
      }
    })
  },

  saveStorageState: async ({ page, context }, use) => {
    await use(async (origin?: string) => {
      const derivedOrigin = origin ?? new URL(page.url()).origin
      // Cookies come from the context (works in reuse mode). Filter to the
      // target origin so we don't serialise unrelated domains that happen to
      // share the single ArkWeb context. Match by hostname (cookies store
      // domain without port; e.g. cookie.domain='127.0.0.1' for host 127.0.0.1:port).
      const hostname = new URL(derivedOrigin).hostname
      const allCookies = await context.cookies()
      const cookies = allCookies
        .filter((c) => {
          if (!origin) return true
          const d = c.domain ?? ''
          // cookie domain may have leading '.' (host-only=false) — strip it.
          const bare = d.startsWith('.') ? d.slice(1) : d
          return bare === hostname || hostname.endsWith(bare)
        })
        .map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path }))
      // localStorage must be read in a same-origin document; navigate if needed.
      const cur = page.url()
      if (!cur.startsWith(derivedOrigin)) await page.goto(derivedOrigin + '/')
      const localStorage = await page.evaluate(() => {
        const items: { name: string; value: string }[] = []
        for (let i = 0; i < window.localStorage.length; i++) {
          const name = window.localStorage.key(i)!
          items.push({ name, value: window.localStorage.getItem(name)! })
        }
        return items
      })
      return { cookies, origins: [{ origin: derivedOrigin, localStorage }] } as StorageState
    })
  },

  loadStorageState: async ({ page, context }, use) => {
    await use(async (state: StorageState) => {
      if (state.cookies?.length) await context.addCookies(state.cookies as Parameters<typeof context.addCookies>[0])
      for (const o of state.origins ?? []) {
        if (!o.localStorage?.length) continue
        // localStorage writes must run in a same-origin document.
        if (!page.url().startsWith(o.origin)) await page.goto(o.origin + '/')
        await page.evaluate((items) => {
          for (const { name, value } of items) window.localStorage.setItem(name, value)
        }, o.localStorage)
      }
    })
  },
})

export { expect } from '@playwright/test'
