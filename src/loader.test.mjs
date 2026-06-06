import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Import the module-level state and the resolve function.
// PACKAGE_ROOT_URL, FIXTURE_URL and PROJECT_ANCHOR are all computed at
// import time based on import.meta.dirname and process.cwd().
const { resolve } = await import('./loader.mjs')

/**
 * Factory for a mock nextResolve that records every call.
 */
function mockNextResolve() {
  const calls = []
  const fn = async (specifier, context) => {
    calls.push({ specifier, context })
    return { specifier, context }
  }
  fn.calls = calls
  return fn
}

describe('loader.resolve(@playwright/test)', () => {
  const TARGET = '@playwright/test'

  it('redirects spec-file parentURL to the fixture', async () => {
    const next = mockNextResolve()
    const expectedFixture = new URL('fixture.mjs', import.meta.url).href
    const ctx = { parentURL: 'file:///user/proj/e2e/app.spec.ts' }
    await resolve(TARGET, ctx, next)
    assert.equal(next.calls.length, 1)
    // Must resolve to the exact fixture URL, not a loose substring match
    assert.equal(next.calls[0].specifier, expectedFixture)
    // context passed through unchanged
    assert.equal(next.calls[0].context, ctx)
  })

  it('redirects package-internal non-spec parent to project anchor', async () => {
    const next = mockNextResolve()
    // Construct a parent URL that is guaranteed to be inside the package root,
    // mirroring how loader.mjs computes PACKAGE_ROOT_URL at import time.
    const packageRoot = new URL('../', import.meta.url).href
    const ctx = { parentURL: new URL('src/fixture.mjs', packageRoot).href }
    await resolve(TARGET, ctx, next)
    assert.equal(next.calls.length, 1)
    assert.equal(next.calls[0].specifier, TARGET)
    // Should have replaced parentURL with a file:// URL pointing to cwd/noop.mjs
    const anchor = new URL(next.calls[0].context.parentURL)
    assert.ok(anchor.pathname.endsWith('/noop.mjs'), `expected noop.mjs, got ${anchor.pathname}`)
    // All other context keys preserved
    assert.equal(Object.keys(next.calls[0].context).length, Object.keys(ctx).length)
  })

  it('passes through for external parent URLs', async () => {
    const next = mockNextResolve()
    const ctx = { parentURL: 'file:///user/proj/node_modules/some-lib/helper.mjs' }
    await resolve(TARGET, ctx, next)
    assert.equal(next.calls.length, 1)
    assert.equal(next.calls[0].specifier, TARGET)
    assert.equal(next.calls[0].context, ctx)
  })

  it('passes through for non-target specifiers', async () => {
    const next = mockNextResolve()
    const ctx = { parentURL: 'file:///user/proj/e2e/app.spec.ts' }
    await resolve('some-other-package', ctx, next)
    assert.equal(next.calls.length, 1)
    assert.equal(next.calls[0].specifier, 'some-other-package')
    assert.equal(next.calls[0].context, ctx)
  })

  it('passes through for external parent URL that includes "ohos-playwright" in path', async () => {
    // Regression: consumer project named "ohos-playwright-demo" should not trigger anchor
    const next = mockNextResolve()
    const ctx = { parentURL: 'file:///user/projects/ohos-playwright-demo/src/util.mjs' }
    await resolve(TARGET, ctx, next)
    assert.equal(next.calls.length, 1)
    assert.equal(next.calls[0].specifier, TARGET)
    assert.equal(next.calls[0].context, ctx)
  })

  it('passes through when parentURL is undefined', async () => {
    const next = mockNextResolve()
    const ctx = {}
    await resolve(TARGET, ctx, next)
    assert.equal(next.calls.length, 1)
    assert.equal(next.calls[0].specifier, TARGET)
    assert.equal(next.calls[0].context, ctx)
  })
})
