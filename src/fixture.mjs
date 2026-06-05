import { readFileSync } from 'node:fs'
import { test as base, chromium } from '@playwright/test'
import { INFO_PATH } from './info-path.mjs'

function readEndpoint() {
  return JSON.parse(readFileSync(INFO_PATH, 'utf8')).endpoint
}

export const test = base.extend({
  browser: [
    async ({}, use) => {
      const browser = await chromium.connectOverCDP(readEndpoint())
      await use(browser)
      // Do not close — the underlying browser is managed by the OS, not by us.
    },
    { scope: 'worker' },
  ],

  context: async ({ browser }, use, testInfo) => {
    // ArkWeb CDP doesn't implement Target.createBrowserContext, so newContext()
    // would fail. Reuse the default context and force-feed baseURL into the
    // private _options so internal URL resolution (toHaveURL, locators) works.
    const ctx = browser.contexts()[0]
    const baseURL = testInfo.project.use.baseURL
    if (baseURL) ctx._options.baseURL = baseURL
    await use(ctx)
  },

  page: async ({ context }, use, testInfo) => {
    const pages = context.pages()
    if (pages.length === 0) {
      throw new Error('No pages in ArkWeb CDP context. Open a tab in the browser first.')
    }
    const page = pages.find((p) => p.url().startsWith('http://localhost')) ?? pages[0]

    // page.goto resolves URLs against the frame, not _options, so it needs its
    // own baseURL wrapper to make `/foo`-style relative paths work.
    const baseURL = testInfo.project.use.baseURL
    if (baseURL) {
      const root = baseURL.replace(/\/$/, '')
      const origGoto = page.goto.bind(page)
      page.goto = (url, opts) => origGoto(url.startsWith('/') ? root + url : url, opts)
    }

    await use(page)
  },
})

export { expect } from '@playwright/test'
