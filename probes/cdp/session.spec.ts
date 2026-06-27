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

// --- Tests originally depending on `server` fixture — adapted with data URLs ---

test('should send events', async ({ page }) => {
  const client = await page.context().newCDPSession(page)
  await client.send('Network.enable')
  const events: any[] = []
  client.on('Network.requestWillBeSent', event => events.push(event))
  // Adapted: server.EMPTY_PAGE → data URL
  await page.goto('data:text/html,<html></html>')
  // Adapted: assert at least 1 event (data URL nav may fire >1 sub-resource event)
  expect(events.length).toBeGreaterThanOrEqual(1)
})

test('should throw if target is part of main', async ({ page }) => {
  // Adapted: server.PREFIX + '/frames/one-frame.html' → data URL with iframe
  await page.goto('data:text/html,<iframe src="data:text/html,frame-body"></iframe>')
  expect(page.frames().length).toBe(2)
  // The child iframe's URL is a data: URL — verify it loaded
  expect(page.frames()[1].url()).toMatch(/^data:/)

  const error = await page.context().newCDPSession(page.frames()[1]).catch((e: Error) => e)
  expect(error.message).toContain(`This frame does not have a separate CDP session, it is a part of the parent frame's session`)
})

test('should emit event for each CDP event', async ({ page }) => {
  const client = await page.context().newCDPSession(page)
  await client.send('Network.enable')
  const events: any[] = []
  client.on('event', event => events.push(event))
  // Adapted: server.EMPTY_PAGE → data URL
  const targetUrl = 'data:text/html,<html></html>'
  await page.goto(targetUrl)
  expect(events.length).toBeGreaterThan(0)
  const requestEvent = events.find(e => e.method === 'Network.requestWillBeSent')
  expect(requestEvent).toBeTruthy()
  // Adapted: URL is the data: URL, not server.EMPTY_PAGE
  expect(requestEvent.params.request.url).toBe(targetUrl)
})
