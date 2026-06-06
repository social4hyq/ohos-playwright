#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

// Resolve @playwright/test from the consumer's project root (process.cwd()),
// not from this package's own directory (which has no node_modules/ for its
// peer dependencies when installed via a file: symlink).
// noop.mjs doesn't need to exist on disk -- createRequire uses it only to
// anchor the module resolution base path.
const req = createRequire(resolve(process.cwd(), 'noop.mjs'))

// @playwright/test's exports map blocks direct subpath resolution to cli.js,
// so resolve the main entry and walk up to the package root, then append it.
let pwEntry
try {
  pwEntry = req.resolve('@playwright/test')
} catch {
  console.error(
    `[ohos-playwright] Cannot find @playwright/test from ${process.cwd()}.\n` +
    'Make sure it is installed in the current project or an ancestor:\n' +
    '  npm install -D @playwright/test\n' +
    '  pnpm add -D @playwright/test',
  )
  process.exit(1)
}
let pkgRoot = dirname(pwEntry)
while (!existsSync(resolve(pkgRoot, 'package.json'))) pkgRoot = dirname(pkgRoot)
const playwrightCli = resolve(pkgRoot, 'cli.js')

const register = resolve(import.meta.dirname, 'register.mjs')

const child = spawn(
  process.execPath,
  ['--import', register, playwrightCli, ...process.argv.slice(2)],
  { stdio: 'inherit' },
)
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
