import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'

const FIXTURE_URL = pathToFileURL(resolvePath(import.meta.dirname!, 'fixture.mts')).href
const TARGET = '@playwright/test'
const TEST_FILE = /\.(spec|test)\.[mc]?[tj]sx?$/
const PACKAGE_ROOT_URL = pathToFileURL(resolvePath(import.meta.dirname!, '..') + '/').href
const PROJECT_ANCHOR = pathToFileURL(resolvePath(process.cwd(), 'noop.mjs')).href

interface ResolveContext { parentURL?: string; [key: string]: unknown }
interface NextResolve {
  (specifier: string, context: ResolveContext): { url: string } | Promise<{ url: string }>
}

export async function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve,
): Promise<{ url: string }> {
  if (specifier === TARGET) {
    const parent = context.parentURL ?? ''
    if (TEST_FILE.test(parent)) {
      const result = await nextResolve(FIXTURE_URL, context)
      return { url: result.url }
    }
    if (parent.startsWith(PACKAGE_ROOT_URL)) {
      return nextResolve(specifier, { ...context, parentURL: PROJECT_ANCHOR })
    }
  }
  return nextResolve(specifier, context)
}
