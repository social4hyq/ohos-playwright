import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const { resolve } = await import('./loader.mts')

interface ResolveContext {
  parentURL?: string
  [key: string]: unknown
}

interface NextResolve {
  (specifier: string, context?: ResolveContext): { url: string } | Promise<{ url: string }>
  calls?: Array<{ specifier: string; context: ResolveContext }>
}

function mockNextResolve(): NextResolve {
  const calls: Array<{ specifier: string; context: ResolveContext }> = []
  const fn = (async (specifier: string, context?: ResolveContext) => {
    calls.push({ specifier, context: context ?? {} })
    return { url: specifier }
  }) as NextResolve
  fn.calls = calls
  return fn
}

describe('loader.resolve(@playwright/test)', () => {
  const TARGET = '@playwright/test'

  it('redirects spec-file parentURL to the fixture', async () => {
    const next = mockNextResolve()
    const expectedFixture = new URL('fixture.mts', import.meta.url).href
    const ctx: ResolveContext = { parentURL: 'file:///user/proj/e2e/app.spec.ts' }
    await resolve(TARGET, ctx, next)
    assert.equal(next.calls!.length, 1)
    assert.equal(next.calls![0].specifier, expectedFixture)
    assert.equal(next.calls![0].context, ctx)
  })

  it('redirects package-internal non-spec parent to project anchor', async () => {
    const next = mockNextResolve()
    const packageRoot = new URL('../', import.meta.url).href
    const ctx: ResolveContext = { parentURL: new URL('src/fixture.mts', packageRoot).href }
    await resolve(TARGET, ctx, next)
    assert.equal(next.calls!.length, 1)
    assert.equal(next.calls![0].specifier, TARGET)
    const anchor = new URL(next.calls![0].context.parentURL!)
    assert.ok(anchor.pathname.endsWith('/noop.mjs'), `expected noop.mjs, got ${anchor.pathname}`)
    assert.equal(Object.keys(next.calls![0].context).length, Object.keys(ctx).length)
  })

  it('passes through for external parent URLs', async () => {
    const next = mockNextResolve()
    const ctx: ResolveContext = { parentURL: 'file:///user/proj/node_modules/some-lib/helper.mjs' }
    await resolve(TARGET, ctx, next)
    assert.equal(next.calls!.length, 1)
    assert.equal(next.calls![0].specifier, TARGET)
    assert.equal(next.calls![0].context, ctx)
  })

  it('passes through for non-target specifiers', async () => {
    const next = mockNextResolve()
    const ctx: ResolveContext = { parentURL: 'file:///user/proj/e2e/app.spec.ts' }
    await resolve('some-other-package', ctx, next)
    assert.equal(next.calls!.length, 1)
    assert.equal(next.calls![0].specifier, 'some-other-package')
    assert.equal(next.calls![0].context, ctx)
  })

  it('passes through for external parent URL that includes "ohos-playwright" in path', async () => {
    const next = mockNextResolve()
    const ctx: ResolveContext = { parentURL: 'file:///user/projects/ohos-playwright-demo/src/util.mjs' }
    await resolve(TARGET, ctx, next)
    assert.equal(next.calls!.length, 1)
    assert.equal(next.calls![0].specifier, TARGET)
    assert.equal(next.calls![0].context, ctx)
  })

  it('passes through when parentURL is undefined', async () => {
    const next = mockNextResolve()
    const ctx: ResolveContext = {}
    await resolve(TARGET, ctx, next)
    assert.equal(next.calls!.length, 1)
    assert.equal(next.calls![0].specifier, TARGET)
    assert.equal(next.calls![0].context, ctx)
  })
})
