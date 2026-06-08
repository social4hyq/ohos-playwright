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
let pwEntry: string
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
let levels = 0
while (!existsSync(resolve(pkgRoot, 'package.json')) && levels++ < 50) {
  pkgRoot = dirname(pkgRoot)
}
if (!existsSync(resolve(pkgRoot, 'package.json'))) {
  console.error(
    `[ohos-playwright] Cannot find @playwright/test package.json (walked up from ${dirname(pwEntry)}). ` +
    'Please verify @playwright/test is correctly installed.',
  )
  process.exit(1)
}
const playwrightCli = resolve(pkgRoot, 'cli.js')

// Node 24 has native TypeScript support; register.mts is resolved directly.
const register = resolve(import.meta.dirname!, 'register.mts')

const argv = process.argv.slice(2)

// On OpenHarmony, Playwright's bundled Chromium cannot exec inside the app
// sandbox (unsigned ELF). Two of Playwright's CLI modes try to launch it:
//   --ui    : opens a Chromium window to host the UI app
//   --debug : opens a Chromium window for the Inspector (via PWDEBUG=1)
// For --ui, Playwright skips the local Chromium when --ui-host or --ui-port
// is provided (runner/index.js: runUIMode). Inject defaults so users don't
// need to remember the flags. For --debug, no such escape hatch exists —
// fail fast with guidance.
if ((process.platform as string) === 'openharmony') {
  const hasFlag = (name: string): boolean =>
    argv.some((a) => a === name || a.startsWith(name + '='))

  if (hasFlag('--debug')) {
    console.error(
      '[ohos-playwright] --debug is not supported on OpenHarmony.\n' +
      '  Playwright Inspector launches a bundled Chromium that the OHOS app sandbox cannot exec.\n' +
      '  Alternatives:\n' +
      '    1) Use `await page.pause()` inside a test for step-through inspection.\n' +
      '    2) Run `ohos-playwright test --debug` from a host (Linux/macOS/Windows) connected to the device via hdc.',
    )
    process.exit(2)
  }

  if (hasFlag('--ui') && !hasFlag('--ui-host') && !hasFlag('--ui-port')) {
    const host = process.env.OHOS_PW_UI_HOST ?? '0.0.0.0'
    const port = process.env.OHOS_PW_UI_PORT ?? '8765'
    argv.push(`--ui-host=${host}`, `--ui-port=${port}`)
    console.error(`[ohos-playwright] UI server bound to ${host}:${port} — open http://<device-ip>:${port} in any browser. Override with OHOS_PW_UI_HOST / OHOS_PW_UI_PORT.`)
  }
}

const child = spawn(
  process.execPath,
  ['--import', register, playwrightCli, ...argv],
  { stdio: 'inherit' },
)
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
