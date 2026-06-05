#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const register = resolve(__dirname, 'register.mjs')

// @playwright/test's exports map blocks direct subpath resolution to cli.js,
// so resolve the main entry and walk up to the package root, then append it.
const req = createRequire(import.meta.url)
let pkgRoot = dirname(req.resolve('@playwright/test'))
while (!existsSync(resolve(pkgRoot, 'package.json'))) pkgRoot = dirname(pkgRoot)
const playwrightCli = resolve(pkgRoot, 'cli.js')

const child = spawn(
  process.execPath,
  ['--import', register, playwrightCli, ...process.argv.slice(2)],
  { stdio: 'inherit' },
)
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
