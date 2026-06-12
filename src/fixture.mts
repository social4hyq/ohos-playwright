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
  ) => {
    // baseURL 通过 page fixture 重写 page.goto 实现；不再触碰 BrowserContext 私有字段 _options。
    await use(browser.contexts()[0])
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
