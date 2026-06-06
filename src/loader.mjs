import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'

const FIXTURE_URL = pathToFileURL(resolvePath(import.meta.dirname, 'fixture.mjs')).href

const TARGET = '@playwright/test'

// Match Playwright's default testMatch: *.spec.* or *.test.* with common
// JS/TS extensions. Only files matching this pattern get '@playwright/test'
// rewritten — user config (playwright.config.ts), helpers, and node_modules
// stay on stock Playwright.
const TEST_FILE = /\.(spec|test)\.[mc]?[tj]sx?$/

// Compute the package root URL from the loader's own location.  Used below to
// detect when the importing module lives inside ohos-playwright, regardless of
// what the package directory is named or how it was installed (file: symlink,
// pnpm store hash, etc.).  Trailing '/' is critical to avoid matching sibling
// directories whose names happen to share the same prefix.
const PACKAGE_ROOT_URL = pathToFileURL(resolvePath(import.meta.dirname, '..') + '/').href

// Anchor URL in the consumer project root for ESM resolution fallback.
// When ohos-playwright is a file: symlink, modules inside it can't resolve
// peer dependencies from the consumer's node_modules. Overriding parentURL
// to a file inside the project restores normal resolution.
// noop.mjs doesn't need to exist on disk.
// PROJECT_ANCHOR is computed once at module-load time.  By the time this
// module is --import'ed (via register.mjs), process.cwd() is guaranteed to be
// the directory where the user invoked ohos-playwright test — Node sets cwd
// before running --import hooks.  Do NOT defer this to the resolve hook; the
// string is needed for synchronous prefix matching in the hot path.
const PROJECT_ANCHOR = pathToFileURL(resolvePath(process.cwd(), 'noop.mjs')).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === TARGET) {
    const parent = context.parentURL ?? ''
    if (TEST_FILE.test(parent)) {
      // Spec files -> use custom ArkWeb fixture
      return nextResolve(FIXTURE_URL, context)
    }
    if (parent.startsWith(PACKAGE_ROOT_URL)) {
      // Internal modules (fixture.mjs, etc.) -> resolve from consumer project
      return nextResolve(specifier, { ...context, parentURL: PROJECT_ANCHOR })
    }
  }
  return nextResolve(specifier, context)
}
