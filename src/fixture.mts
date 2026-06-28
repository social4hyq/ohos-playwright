import { readFileSync } from 'node:fs'
import { test as base } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { INFO_PATH, type CdpInfo } from './info-path.mts'
import { getOhosDevice } from './ohos/device.mts'
import type { OhosDevice } from './ohos/device.mts'
import { applyInputPatches } from './ohos/patches/input-patch.mts'
import {
  installPageWrappers, createPopupPage, clearBeforeunload, makeSafePageClose,
  BEFOREUNLOAD_TRACKING_SCRIPT, type PageCleanup,
} from './ohos/patches/page-patch.mts'
import type { OhosCapabilities } from './ohos/capabilities.mts'

export type { PageCleanup }
export { installPageWrappers, createPopupPage }

export interface DeviceDescriptor {
  viewport: { width: number; height: number }
  deviceScaleFactor?: number
  isMobile?: boolean
  userAgent?: string
}

function readInfo(): CdpInfo {
  const cdpUrl = process.env.OHOS_PW_CDP_URL
  if (cdpUrl) {
    return {
      port: 0,
      pid: 0,
      socket: '',
      endpoint: cdpUrl,
      openedNewTab: false,
      launchUrl: process.env.OHOS_PW_LAUNCH_URL ?? 'about:blank',
    }
  }
  return JSON.parse(readFileSync(INFO_PATH, 'utf8')) as CdpInfo
}

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
  // Emulation.setLocaleOverride is acked but ignored by ArkWeb. This fixture
  // rewrites navigator.language and navigator.languages via addInitScript (which
  // runs before any page script). It covers JS-layer locale reads; HTTP
  // Accept-Language and browser UI locale are unaffected.
  emulateLocale: (locale: string) => Promise<void>
}, {
  device: OhosDevice
  capabilities: OhosCapabilities
}>({
  browser: [
    async ({}, use: (b: Browser) => Promise<void>) => {
      const device = getOhosDevice()
      const b = await device.browser()
      await use(b)
    },
    { scope: 'worker' as const },
  ],

  device: [
    async ({}, use) => {
      await use(getOhosDevice())
    },
    { scope: 'worker' as const },
  ],

  capabilities: [
    async ({}, use) => {
      await use(await getOhosDevice().capabilities())
    },
    { scope: 'worker' as const },
  ],

  context: async (
    { browser }: { browser: Browser },
    use: (c: BrowserContext) => Promise<void>,
    testInfo: { project: { use: { baseURL?: string } } },
  ) => {
    const ctx = browser.contexts()[0]
    if (!ctx) throw new Error('[ohos-playwright] no browser context — browser may have failed to reconnect')

    // Inject baseURL into the context's private _options so that internal
    // Playwright URL resolution (toHaveURL, waitForURL, locators) works for
    // SPA-navigated pages — page.goto patching alone is not sufficient.
    const baseURL = testInfo.project.use.baseURL
    if (baseURL) {
      ;(ctx as unknown as { _options: Record<string, unknown> })._options.baseURL = baseURL
    }

    // Override context.close(): Target.disposeBrowserContext crashes ArkWeb.
    // Navigate all pages to about:blank and emit 'close' instead.
    if (!(ctx as any).__ohosClosePatch) {
      ;(ctx as any).__ohosClosePatch = true
      ;(ctx as any).close = async () => {
        for (const p of ctx.pages()) {
          await clearBeforeunload(p)
          try { await p.goto('about:blank') } catch {}
        }
        ;(ctx as unknown as { emit: (e: string) => void }).emit('close')
      }
      // Override context.newPage(): Target.createTarget crashes ArkWeb.
      // Try via createPopupPage (safe — uses timeout + catch). If it succeeds,
      // patch the returned page with a safe close() to prevent Target.closeTarget crash.
      // If createPopupPage fails, throw a descriptive error.
      ;(ctx as any).newPage = async () => {
        const seedPage = ctx.pages()[0]
        if (!seedPage) throw new Error('[ohos-playwright] context.newPage(): no pages in context')
        // 1) Try real new tab (works when PW_CHROMIUM_ATTACH_TO_OTHER=1).
        const newP = await createPopupPage(ctx, seedPage, 'about:blank')
        if (newP) {
          if (!(newP as any).__ohosPageClosePatch) {
            ;(newP as any).__ohosPageClosePatch = true
            if (!(newP as any).__ohosBeforeunloadPatched) {
              ;(newP as any).__ohosBeforeunloadPatched = true
              await newP.addInitScript(BEFOREUNLOAD_TRACKING_SCRIPT)
            }
            ;(newP as any).close = makeSafePageClose(newP)
          }
          return newP
        }
        // 2) Fallback: reset and reuse the seed page (mirrors browser.newContext policy).
        // This gives tests a "clean" page without creating a new CDP target.
        await clearBeforeunload(seedPage)
        const dismissDlg = (d: import('playwright-core').Dialog) => d.dismiss().catch(() => {})
        seedPage.on('dialog', dismissDlg)
        try { await seedPage.goto('about:blank') } catch {}
        seedPage.off('dialog', dismissDlg)
        return seedPage
      }
    }

    // Patch close() on ALL existing pages in the context — prevents Target.closeTarget
    // crash if a spec calls context.pages()[N].close() on a page that was not the
    // primary fixture page (e.g. popup/idle tabs opened by prior tests).
    for (const p of ctx.pages()) {
      if (!(p as any).__ohosPageClosePatch) {
        ;(p as any).__ohosPageClosePatch = true
        ;(p as any).close = makeSafePageClose(p)
        if (!(p as any).__ohosBeforeunloadPatched) {
          ;(p as any).__ohosBeforeunloadPatched = true
          await p.addInitScript(BEFOREUNLOAD_TRACKING_SCRIPT).catch(() => {})
        }
      }
    }

    // 每次测试前清空 cookie（共享 context 的兜底，真实 context 不需要此步）
    await ctx.clearCookies().catch(() => {})

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

    // skipCreateTarget: Target.createTarget on ArkWeb disconnects the CDP WebSocket.
    // Use fallback popup detection (idle about:blank tab) instead.
    const cleanup = await installPageWrappers(page, context, testInfo.project.use.baseURL, { skipCreateTarget: true })
    applyInputPatches(page)
    try {
      await use(page)
    } finally {
      await cleanup({ navigateTo: info.openedNewTab ? 'about:blank' : undefined })
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
        // ArkWeb note: setUserAgentOverride takes effect after the next page.goto() — the override
        // applies to the destination page's navigator.userAgent but not the currently-loaded page.
        // The HTTP User-Agent header is also not changed by ArkWeb's UA override.
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

  emulateLocale: async ({ page }, use) => {
    await use(async (locale: string) => {
      await page.addInitScript((loc: string) => {
        try { Object.defineProperty(navigator, 'language', { get: () => loc, configurable: true }) } catch {}
        try { Object.defineProperty(navigator, 'languages', { get: () => [loc], configurable: true }) } catch {}
      }, locale)
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
