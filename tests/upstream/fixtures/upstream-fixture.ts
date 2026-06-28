// Main fixture for upstream Playwright specs ported to ohos-playwright.
//
// Merges the ohos-playwright adapter fixture (browser/context/page via
// connectOverCDP) with platform + server fixtures, and shims out the
// browserTest fixture surface (browserName, browserVersion, contextFactory,
// etc.) so upstream specs can import from this file with minimal change.

import { test as base, mergeTests, chromium, expect as baseExpect } from '@playwright/test';
import type { BrowserContext, BrowserContextOptions, TestInfo } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { platformTest } from './platform-fixtures.js';
import { serverFixtures } from './server-fixtures.js';
import type { ServerFixtures, ServerWorkerOptions } from './server-fixtures.js';
import type { PlatformWorkerFixtures } from './platform-fixtures.js';
import { OHOS_FILE_FIXME } from './ohos-skip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── ohos browser / context / page fixture ────────────────────────────────────
// Import from the package's own built fixture. Requires `npm run build` once.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — resolved via package exports: ./dist/fixture.mjs
import { test as ohosBase } from 'ohos-playwright/fixture';

// ── Shim types that mirror playwright-official/tests/config/browserTest.ts ───

type BrowserTestWorkerFixtures = {
  browserVersion: string;
  defaultSameSiteCookieValue: string;
  allowsThirdParty: boolean;
  browserMajorVersion: number;
  browserType: typeof chromium;
  isAndroid: boolean;
  isElectron: boolean;
  isHeadlessShell: boolean;
  isFrozenWebkit: boolean;
  isBidi: boolean;
  bidiTestSkipPredicate: (info: TestInfo) => boolean;
  nodeVersion: { major: number; minor: number; patch: number };
  // pageWorkerFixtures
  headless: boolean;
  channel: string | undefined;
  screenshot: 'off';
  trace: 'off';
  video: 'off';
  electronMajorVersion: number;
  // testMode
  mode: 'default';
  toImplInWorkerScope: any;
  // daemonProcess (worker-scoped childProcess)
  daemonProcess: any;
};

type BrowserTestTestFixtures = {
  createUserDataDir: () => Promise<string>;
  launchPersistent: (options?: BrowserContextOptions) => Promise<{ context: BrowserContext; page: import('@playwright/test').Page }>;
  startRemoteServer: never;
  contextFactory: (options?: BrowserContextOptions) => Promise<BrowserContext>;
  pageWithHar: (options?: { outputPath?: string; content?: 'embed' | 'attach' | 'omit'; omitContent?: boolean }) => Promise<{ context: BrowserContext; page: import('@playwright/test').Page; getLog: () => Promise<any>; getZip: () => Promise<Map<string, Buffer>> }>;
  autoSkipBidiTest: void;
  ohosAutoSkip: void;
  // toImpl is only used in mode:'default' tests; skip on OHOS
  toImpl: any;
  // commonFixtures
  childProcess: any;
  waitForPort: (port: number) => Promise<void>;
  findFreePort: () => Promise<number>;
  // serverFixtures (extra)
  proxyServer: any;
};

// ── Build merged test ─────────────────────────────────────────────────────────

const merged = mergeTests(ohosBase as any, platformTest)
  .extend<ServerFixtures, ServerWorkerOptions>(serverFixtures as any);

export const test = merged.extend<BrowserTestTestFixtures, BrowserTestWorkerFixtures>({
  // ── worker-scoped static shims ─────────────────────────────────────────────
  mode: ['default', { scope: 'worker' }],
  toImplInWorkerScope: [async ({}, use) => { await use(undefined); }, { scope: 'worker' }],
  daemonProcess: [async ({}, use) => { await use(() => { throw new Error('daemonProcess not supported in OHOS'); }); }, { scope: 'worker' }],
  headless: [false, { scope: 'worker' }],
  channel: [undefined, { scope: 'worker' }],
  screenshot: ['off', { scope: 'worker' }],
  trace: ['off', { scope: 'worker' }],
  video: ['off', { scope: 'worker' }],
  electronMajorVersion: [0, { scope: 'worker' }],
  isAndroid: [false, { scope: 'worker' }],
  isElectron: [false, { scope: 'worker' }],
  isHeadlessShell: [false, { scope: 'worker' }],
  isFrozenWebkit: [false, { scope: 'worker' }],
  isBidi: [false, { scope: 'worker' }],
  allowsThirdParty: [false, { scope: 'worker' }],
  defaultSameSiteCookieValue: ['Lax', { scope: 'worker' }],
  bidiTestSkipPredicate: [async ({}, run) => { await run(() => false); }, { scope: 'worker' }],

  browserType: [async ({}, run) => {
    await run(chromium as any);
  }, { scope: 'worker' }],

  browserVersion: [async ({ browser }, run) => {
    await run(browser.version());
  }, { scope: 'worker' }],

  browserMajorVersion: [async ({ browserVersion }, run) => {
    await run(Number((browserVersion as string).split('.')[0]));
  }, { scope: 'worker' }],

  nodeVersion: [async ({}, use) => {
    const [major, minor, patch] = process.versions.node.split('.');
    await use({ major: +major, minor: +minor, patch: +patch });
  }, { scope: 'worker' }],

  // ── test-scoped fixtures ───────────────────────────────────────────────────

  autoSkipBidiTest: [async ({}, run) => { await run(); }, { auto: true, scope: 'test' }],

  ohosAutoSkip: [async ({}, run, testInfo) => {
    const file: string = (testInfo as any).file ?? '';
    const title: string = testInfo.titlePath.join(' > ');
    for (const { filePattern, titlePattern, reason } of OHOS_FILE_FIXME) {
      if ((filePattern && filePattern.test(file)) || (titlePattern && titlePattern.test(title))) {
        testInfo.fixme(true, reason);
        break;
      }
    }
    await run();
  }, { auto: true, scope: 'test' }],

  toImpl: async ({}, use, testInfo) => {
    testInfo.skip(true, 'toImpl not available in connectOverCDP mode');
    await use(undefined);
  },

  childProcess: async ({}, run) => {
    await run(() => { throw new Error('childProcess not supported in OHOS upstream fixture — skip this test'); });
  },

  waitForPort: async ({}, run) => {
    await run(async (port: number) => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        try {
          await new Promise<void>((res, rej) => {
            const { createConnection } = require('net');
            const s = createConnection(port, '127.0.0.1', res);
            s.on('error', rej);
          });
          return;
        } catch { await new Promise(r => setTimeout(r, 100)); }
      }
      throw new Error(`Port ${port} not open after 10s`);
    });
  },

  findFreePort: async ({}, run) => {
    await run(async () => {
      const { createServer } = require('net');
      return new Promise<number>((res, rej) => {
        const srv = createServer();
        srv.listen(0, '127.0.0.1', () => {
          const port = (srv.address() as any).port;
          srv.close(() => res(port));
        });
        srv.on('error', rej);
      });
    });
  },

  proxyServer: async ({}, run, testInfo) => {
    testInfo.skip(true, 'proxyServer (TestProxy) not supported via connectOverCDP — use page.route() instead');
    await run(undefined as any);
  },

  contextFactory: async ({ browser }, run) => {
    const contexts: BrowserContext[] = [];
    await run(async (options?: BrowserContextOptions) => {
      const ctx = await browser.newContext(options);
      contexts.push(ctx);
      return ctx;
    });
    // Do NOT call ctx.close() — Target.disposeBrowserContext crashes the ArkWeb CDP
    // WebSocket, killing all subsequent tests. Navigate each page to about:blank instead.
    for (const ctx of contexts) {
      for (const p of ctx.pages()) await p.goto('about:blank').catch(() => {});
    }
  },

  createUserDataDir: async ({}, run, testInfo) => {
    testInfo.skip(true, 'launchPersistentContext not supported in connectOverCDP mode');
    await run(async () => { throw new Error('not supported'); });
  },

  launchPersistent: async ({}, run, testInfo) => {
    testInfo.skip(true, 'launchPersistentContext not supported in connectOverCDP mode');
    await run(async (_opts?: any) => { throw new Error('not supported'); });
  },

  startRemoteServer: async ({}, run, testInfo) => {
    testInfo.skip(true, 'Remote server not supported in connectOverCDP mode');
    await (run as any)(undefined as never);
  },

  pageWithHar: async ({ contextFactory }, use, testInfo) => {
    const pageWithHar = async (options: { outputPath?: string; content?: 'embed' | 'attach' | 'omit'; omitContent?: boolean } = {}) => {
      const harPath = testInfo.outputPath(options.outputPath ?? 'test.har');
      const context = await contextFactory({ recordHar: { path: harPath, content: options.content, omitContent: options.omitContent }, ignoreHTTPSErrors: true });
      const page = await context.newPage();
      return {
        page,
        context,
        getLog: async () => {
          await context.close();
          const { readFileSync } = await import('fs');
          return JSON.parse(readFileSync(harPath, 'utf8'))['log'];
        },
        getZip: async () => {
          throw new Error('pageWithHar getZip not supported without coreBundle parseHar');
        },
      };
    };
    await use(pageWithHar);
  },
});

// Aliases expected by library specs.
export const playwrightTest = test;
export const browserTest = test;
export const contextTest = test;

// Re-export expect with the toContainYaml extension used by page specs.
export const expect = baseExpect.extend({
  toContainYaml(received: string, expected: string) {
    const trimmed = expected.split('\n').filter(a => !!a.trim());
    const maxPrefix = Math.min(...trimmed.map(line => line.match(/^\s*/)![0].length));
    const trimmedExpected = trimmed.map(line => line.substring(maxPrefix)).join('\n');
    try {
      if (this.isNot) expect(received).not.toContain(trimmedExpected);
      else expect(received).toContain(trimmedExpected);
      return { pass: !this.isNot, message: () => '' };
    } catch (e: any) {
      return { pass: this.isNot, message: () => e.message };
    }
  },
});

// rafraf re-export so specs that do `import { rafraf } from './pageTest'` work.
export { rafraf } from './upstream-utils.js';
