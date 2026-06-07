import { readFileSync } from 'node:fs'
import { test as base, chromium } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { INFO_PATH, type CdpInfo } from './info-path.mts'

function readEndpoint(): string {
  return (JSON.parse(readFileSync(INFO_PATH, 'utf8')) as CdpInfo).endpoint
}

export const test = base.extend({
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
    const baseURL = testInfo.project.use.baseURL
    if (baseURL) {
      try {
        const opts = (ctx as unknown as Record<string, unknown>)._options as Record<string, unknown> | undefined
        if (opts && typeof opts === 'object') opts.baseURL = baseURL
      } catch (e: unknown) {
        console.warn(`[ohos-playwright] Failed to inject baseURL: ${e instanceof Error ? e.message : e}`)
      }
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

    const baseURL = testInfo.project.use.baseURL
    if (baseURL) {
      const root = baseURL.replace(/\/+$/, '')
      const origGoto = page.goto.bind(page)
      page.goto = ((url: string, opts?: Record<string, unknown>) =>
        origGoto((url.startsWith('/') && !url.startsWith('//')) ? root + url : url, opts)
      ) as typeof page.goto
    }

    await use(page)
  },
})

export { expect } from '@playwright/test'
