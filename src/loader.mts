import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ResolveHookContext, ResolveFnOutput } from 'node:module'

const FIXTURE_URL = pathToFileURL(resolvePath(import.meta.dirname!, 'fixture.mts')).href
const TARGET = '@playwright/test'
const TEST_FILE = /\.(spec|test)\.[mc]?[tj]sx?$/
// Also intercept from fixture helper files (e.g. fixtures.ts, fixtures.mts) that
// live outside our own compiled dist/ — this covers the common pattern where spec
// files delegate to a shared fixtures.ts that itself imports @playwright/test.
const FIXTURE_HELPER = /\bfixtures?\.[mc]?[tj]sx?$/
const OWN_DIST_URL = pathToFileURL(resolvePath(import.meta.dirname!) + '/').href
const PACKAGE_ROOT_URL = pathToFileURL(resolvePath(import.meta.dirname!, '..') + '/').href
const PROJECT_ANCHOR = pathToFileURL(resolvePath(process.cwd(), 'noop.mjs')).href

export function resolve(
  specifier: string,
  context: ResolveHookContext,
  nextResolve: (specifier: string, context?: Partial<ResolveHookContext>) => ResolveFnOutput,
): ResolveFnOutput {
  if (specifier === TARGET) {
    const parent = context.parentURL ?? ''
    const isFromOwnDist = parent.startsWith(OWN_DIST_URL)
    // Only redirect EXTERNAL consumer fixtures — internal package fixtures (like
    // tests/upstream/fixtures/upstream-fixture.ts) explicitly import from
    // ohos-playwright/fixture directly and need the real @playwright/test for
    // mergeTests / chromium / expect. Excluding PACKAGE_ROOT_URL here lets
    // the next branch handle them with the PROJECT_ANCHOR context change.
    if (TEST_FILE.test(parent) || (FIXTURE_HELPER.test(parent) && !isFromOwnDist && !parent.startsWith(PACKAGE_ROOT_URL))) {
      return nextResolve(FIXTURE_URL, context)
    }
    if (parent.startsWith(PACKAGE_ROOT_URL)) {
      return nextResolve(specifier, { ...context, parentURL: PROJECT_ANCHOR })
    }
  }
  return nextResolve(specifier, context)
}
