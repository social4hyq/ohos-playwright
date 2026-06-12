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

function readEndpoint(): string {
  return (JSON.parse(readFileSync(INFO_PATH, 'utf8')) as CdpInfo).endpoint
}

export const test = base.extend<{
  emulateDevice: (descriptor: DeviceDescriptor) => Promise<void>
}>({
  browser: [
    async ({}, use: (b: Browser) => Promise<void>) => {
      const browser = await chromium.connectOverCDP(readEndpoint())
      await use(browser)
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
    const page = pages.find((p) => p.url().startsWith('http://localhost')) ?? pages[0]
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
    }
  },

  emulateDevice: async ({ page }, use) => {
    await use(async (descriptor: DeviceDescriptor) => {
      const session = await page.context().newCDPSession(page)
      try {
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
})

export { expect } from '@playwright/test'
