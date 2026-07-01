import { readFileSync } from 'node:fs'
import { test as base, chromium } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { INFO_PATH, type CdpInfo } from './info-path.mts'
import { getOhosDevice } from './ohos/device.mts'
import type { OhosDevice } from './ohos/device.mts'
import { applyInputPatches } from './ohos/patches/input-patch.mts'
import {
  installPageWrappers, createPopupPage, createPageViaCDP, closePageViaCDP, type PageCleanup,
} from './ohos/patches/page-patch.mts'
import { applyContextPatches } from './ohos/patches/context-patch.mts'
import type { OhosCapabilities } from './ohos/capabilities.mts'

export type { PageCleanup }
export type { OhosCapabilities }
export { installPageWrappers, createPopupPage, createPageViaCDP, closePageViaCDP }

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
    // Worker-scoped per Playwright's built-in fixture contract. device.browser()
    // returns a stable Proxy that transparently forwards to the current live
    // Browser; OhosDevice handles ArkWeb reconnects under the hood.
    // When OHOS_PW_CDP_URL is set, skip hdc connection entirely — connect
    // directly to the remote Chrome/Edge endpoint for A/B comparison runs.
    async ({}, use: (b: Browser) => Promise<void>) => {
      if (process.env.OHOS_PW_CDP_URL) {
        const raw = await chromium.connectOverCDP(process.env.OHOS_PW_CDP_URL)
        await use(raw)
        return
      }
      await use(await getOhosDevice().browser())
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
    // Force a health-check on the device before reading the context. ArkWeb's
    // disconnect can land between tests; the worker-scoped `browser` proxy will
    // return null __cdpDefaultContext on a stale realBrowser. device.browser()
    // probes the cached endpoint and reconnects if needed, repopulating
    // __cdpDefaultContext on the fresh realBrowser before we read it.
    if (!process.env.OHOS_PW_CDP_URL) await getOhosDevice().browser()
    // __cdpDefaultContext: connectOverCDP 时预存的 ArkWeb 默认 context
    // browser.contexts() 已被 applyBrowserPatches 过滤掉该 context（对齐 launched browser 行为）
    const ctx = (browser as any).__cdpDefaultContext ?? browser.contexts()[0]
    if (!ctx) throw new Error('[ohos-playwright] no browser context — browser may have failed to reconnect')

    // Inject baseURL into the context's private _options so that internal
    // Playwright URL resolution (toHaveURL, waitForURL, locators) works for
    // SPA-navigated pages — page.goto patching alone is not sufficient.
    const baseURL = testInfo.project.use.baseURL
    if (baseURL) {
      ;(ctx as unknown as { _options: Record<string, unknown> })._options.baseURL = baseURL
    }

    if (!process.env.OHOS_PW_CDP_URL) {
      // Apply ArkWeb context patches (idempotent — guarded by __ohosPatch).
      applyContextPatches(ctx)
    }

    // 每次测试前重置共享 context 状态。
    await ctx.clearCookies().catch(() => {})
    const pages = ctx.pages()
    if (pages.length > 0) {
      const cdp = await ctx.newCDPSession(pages[0]).catch(() => null)
      if (cdp) {
        try {
          await (cdp.send as any)('Storage.clearDataForOrigin', {
            origin: '*',
            storageTypes: 'all',
          })
        } catch { /* best-effort */ }

        // Clean up leftover popup / stale tabs. safeClose removes pages from
        // Playwright's list via _onClose but the CDP target still exists.
        // Always query CDP targets and close non-anchor ones — don't rely on
        // pages.length which may be stale after _onClose.
        try {
          const { targetInfos } = await (cdp.send as any)('Target.getTargets') as any
          const pageTargets = (targetInfos ?? []).filter((t: any) => t.type === 'page')
          // Track the anchor targetId on first run. CDP targets can be in
          // any order — don't assume index 0 is the anchor.
          const storedAnchor = (ctx as unknown as Record<string, unknown>)['__ohosAnchorTargetId']
          let anchorId: string | undefined
          if (typeof storedAnchor === 'string') {
            anchorId = storedAnchor
          } else if (pageTargets.length > 0) {
            anchorId = pageTargets[0].targetId
            ;(ctx as unknown as Record<string, unknown>)['__ohosAnchorTargetId'] = anchorId
          }
          for (const t of pageTargets) {
            if (t.targetId !== anchorId) {
              await (cdp.send as any)('Target.closeTarget', { targetId: t.targetId }).catch(() => {})
            }
          }
          // Clean up Playwright-internal page refs for non-anchor pages.
          for (const p of pages.slice(1)) {
            (p as unknown as { _onClose: () => void })._onClose()
          }
        } catch { /* best-effort */ }

        await cdp.detach().catch(() => {})
      }
    }

    await use(ctx)

    // 测试后清理绑定追踪。
    const bindings: Set<string> | undefined = (ctx as any).__ohosBindings
    if (bindings?.size) bindings.clear()
  },

  page: async (
    { context }: { context: BrowserContext },
    use: (p: Page) => Promise<void>,
    testInfo: { project: { use: { baseURL?: string } } },
  ) => {
    if (process.env.OHOS_PW_DEBUG_DISCONNECT) {
      console.error(`[ohos][PAGE_FIXTURE_START] ${new Date().toISOString()}`)
    }
    const pages = context.pages()
    if (pages.length === 0) throw new Error('No pages in ArkWeb CDP context. Open a tab first.')

    // Track the anchor page (first page in the context, launched by the browser
    // at OHOS_PW_LAUNCH_URL). Popups created via Target.createTarget accumulate
    // in context.pages() and can shift pages[0] if the anchor is removed. Always
    // return the anchor page, not whatever happens to be at index 0.
    const anchor = (context as unknown as Record<string,unknown>)['__ohosAnchorPage']
    let page: Page
    if (anchor && pages.includes(anchor as unknown as Page)) {
      page = anchor as unknown as Page
    } else {
      page = pages[0]
      ;(context as unknown as Record<string,unknown>)['__ohosAnchorPage'] = page
    }

    const cleanup = await installPageWrappers(page, context, testInfo.project.use.baseURL, { skipCreateTarget: false })
    applyInputPatches(page)
    try {
      await use(page)
    } finally {
      if (process.env.OHOS_PW_DEBUG_DISCONNECT) {
        console.error(`[ohos][PAGE_CLEANUP_START] ${new Date().toISOString()}`)
      }
      await cleanup()
      // Reset DOM without a navigation. CustomTabAbility (single-page browser)
      // destroys its only tab ~1s after navigating to about:blank, which would
      // make the next test's page fixture see an empty context. setContent
      // rewrites the DOM via CDP and keeps the tab alive.
      try { await page.setContent('<!DOCTYPE html><html><head></head><body></body></html>') } catch {}
      if (process.env.OHOS_PW_DEBUG_DISCONNECT) {
        console.error(`[ohos][PAGE_CLEANUP_DONE] ${new Date().toISOString()}`)
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
