// Ported from playwright-official/tests/library/chromium/session.spec.ts
// Tests newCDPSession against ArkWeb via ohos-playwright attach mode.
// Upstream fixture dependencies (server, browserTest, kTargetClosedErrorMessage)
// are inlined or replaced with data URLs — see header notes per test.

import { test, expect } from '@playwright/test'

// kTargetClosedErrorMessage from playwright-official/tests/config/errors.ts
const kTargetClosedErrorMessage = 'Target page, context or browser has been closed'

test('should work', async ({ page }) => {
  const client = await page.context().newCDPSession(page)

  await Promise.all([
    client.send('Runtime.enable'),
    client.send('Runtime.evaluate', { expression: 'window.foo = "bar"' }),
  ])
  const foo = await page.evaluate(() => window['foo'])
  expect(foo).toBe('bar')
})

test('should only accept a page or frame', async ({ page }) => {
  // @ts-expect-error newCDPSession expects a Page or Frame
  const error = await page.context().newCDPSession(page.context()).catch(e => e)
  expect(error.message).toContain('page: expected Page or Frame')

  // @ts-expect-error newCDPSession expects a Page or Frame
  const errorAlt = await page.context().newCDPSession({}).catch(e => e)
  expect(errorAlt.message).toContain('page: expected Page or Frame')
})

test('should enable and disable domains independently', async ({ page }) => {
  const client = await page.context().newCDPSession(page)
  await client.send('Runtime.enable')
  await client.send('Debugger.enable')
  // JS coverage enables and then disables Debugger domain.
  await page.coverage.startJSCoverage()
  await page.coverage.stopJSCoverage()
  // generate a script in page and wait for the event.
  await Promise.all([
    new Promise<void>(f => client.on('Debugger.scriptParsed', event => {
      if (event.url === 'foo.js')
        f()
    })),
    page.evaluate('//# sourceURL=foo.js'),
  ])
})

test('should be able to detach session', async ({ page }) => {
  const client = await page.context().newCDPSession(page)
  await client.send('Runtime.enable')
  const evalResponse = await client.send('Runtime.evaluate', { expression: '1 + 2', returnByValue: true })
  expect(evalResponse.result.value).toBe(3)
  await client.detach()
  let error = null
  try {
    await client.send('Runtime.evaluate', { expression: '3 + 1', returnByValue: true })
  } catch (e) {
    error = e
  }
  expect(error.message).toContain('Target page, context or browser has been closed')
})

test('should throw nice errors', async ({ page }) => {
  const client = await page.context().newCDPSession(page)
  const error = await theSourceOfTheProblems().catch(error => error)
  expect(error.stack).toContain('theSourceOfTheProblems')
  expect(error.message).toContain('ThisCommand.DoesNotExist')

  async function theSourceOfTheProblems() {
    // @ts-expect-error invalid command
    await client.send('ThisCommand.DoesNotExist')
  }
})

test('should work with main frame', async ({ page }) => {
  const client = await page.context().newCDPSession(page.mainFrame())

  await Promise.all([
    client.send('Runtime.enable'),
    client.send('Runtime.evaluate', { expression: 'window.foo = "bar"' }),
  ])
  const foo = await page.evaluate(() => window['foo'])
  expect(foo).toBe('bar')
})

test('should emit close event when session is detached', async ({ page }) => {
  const client = await page.context().newCDPSession(page)
  let closedSession: any = null
  client.on('close', session => closedSession = session)
  await client.detach()
  expect(closedSession).toBe(client)
})
