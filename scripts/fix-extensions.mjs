// Post-build: tsc's rewriteRelativeImportExtensions handles import paths,
// but hardcoded string literals like 'fixture.mts' still need .mjs fixup.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

for (const name of readdirSync(dist)) {
  if (!name.endsWith('.mjs')) continue
  const path = resolve(dist, name)
  let content = readFileSync(path, 'utf8')
  let next = content.replace(/'([^']*)\.mts'/g, "'$1.mjs'").replace(/"([^"]*)\.mts"/g, '"$1.mjs"')
  if (next !== content) writeFileSync(path, next)
}

console.log('[build] fixed .mts string literals → .mjs')
