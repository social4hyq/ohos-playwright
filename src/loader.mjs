import { resolve as resolvePath, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_URL = pathToFileURL(resolvePath(__dirname, 'fixture.mjs')).href

const TARGET = '@playwright/test'

// Match Playwright's default testMatch: *.spec.* or *.test.* with common
// JS/TS extensions. Only files matching this pattern get '@playwright/test'
// rewritten — user config (playwright.config.ts), helpers, and node_modules
// stay on stock Playwright.
const TEST_FILE = /\.(spec|test)\.[mc]?[tj]sx?$/

export async function resolve(specifier, context, nextResolve) {
  if (specifier === TARGET) {
    const parent = context.parentURL ?? ''
    if (TEST_FILE.test(parent)) {
      return nextResolve(FIXTURE_URL, context)
    }
  }
  return nextResolve(specifier, context)
}
