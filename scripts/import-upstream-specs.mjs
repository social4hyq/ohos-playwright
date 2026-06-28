#!/usr/bin/env node
// Import upstream Playwright specs into tests/upstream/.
//
// Usage:
//   node scripts/import-upstream-specs.mjs [--src page|library|chromium|all] [--dry-run]
//
// Each spec's import statements are rewritten so that:
//   './pageTest'              → '../fixtures/upstream-fixture'
//   '../config/browserTest'  → '../fixtures/upstream-fixture'
//   '../../config/browserTest' → '../../fixtures/upstream-fixture'
//   '../config/utils'        → '../fixtures/upstream-utils'
//   '../../config/utils'     → '../../fixtures/upstream-utils'
//   (rafraf export is re-exported from upstream-fixture too)
//
// Assets are NOT copied by this script — run copy-upstream-assets.mjs for that.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, unlinkSync } from 'fs';
import { join, dirname, relative, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OFFICIAL = join(ROOT, 'playwright-official', 'tests');
const UPSTREAM = join(ROOT, 'tests', 'upstream');

// ── SKIP sets (relative to playwright-official/tests/) ───────────────────────
const SKIP_LIBRARY = new Set([
  // Inspector / codegen UI
  'library/inspector',
  // Trace viewer UI
  'library/trace-viewer.spec.ts',
  'library/trace-viewer-scrub.spec.ts',
  // Debug controller
  'library/debug-controller.spec.ts',
  'library/debugger.spec.ts',
  // Video / screencast
  'library/video.spec.ts',
  'library/screencast.spec.ts',
  'library/screencast-actions.spec.ts',
  'library/screencast-overlay.spec.ts',
  // launchServer / WS connect
  'library/browser-server.spec.ts',
  'library/browsertype-launch-server.spec.ts',
  'library/multiclient.spec.ts',
  'library/browsertype-connect.spec.ts',
  // Selenium
  'library/browsertype-launch-selenium.spec.ts',
  // Persistent context
  'library/defaultbrowsercontext-1.spec.ts',
  'library/defaultbrowsercontext-2.spec.ts',
  'library/browsercontext-reuse.spec.ts',
  // Firefox
  'library/firefox',
  // Codegen
  'library/locator-generator.spec.ts',
  'library/selector-generator.spec.ts',
  // Launch knobs (no launch)
  'library/launcher.spec.ts',
  'library/headful.spec.ts',
  'library/slowmo.spec.ts',
  // Internal unit tests (no browser)
  'library/events',
  'library/unit',
  // Snapshot renderer (internal visual diff)
  'library/snapshot-renderer.spec.ts',
]);

// ── Rewrite rules ─────────────────────────────────────────────────────────────
// Each rule: [search-pattern, replacement] applied in order.
// Using string.replace() with global flag would change ALL occurrences.
const REWRITE_RULES = [
  // pageTest → upstream-fixture (both test and expect re-exported)
  [/from ['"]\.\/pageTest['"]/g, "from '../fixtures/upstream-fixture.js'"],
  // browserTest (1-level up from library/)
  [/from ['"]\.\.\/config\/browserTest['"]/g, "from '../fixtures/upstream-fixture.js'"],
  // browserTest (2-level up from library/chromium/)
  [/from ['"]\.\.\/\.\.\/config\/browserTest['"]/g, "from '../../fixtures/upstream-fixture.js'"],
  // pageTest as imported by library specs (1-level-up path)
  [/from ['"]\.\.\/page\/pageTest['"]/g, "from '../fixtures/upstream-fixture.js'"],
  // pageTest as imported by library/chromium specs (2-level-up path)
  [/from ['"]\.\.\/\.\.\/page\/pageTest['"]/g, "from '../../fixtures/upstream-fixture.js'"],
  // utils (1-level up from library/ or library/chromium)
  [/from ['"]\.\.\/config\/utils['"]/g, "from '../fixtures/upstream-utils.js'"],
  // utils (2-level up from library/chromium/)
  [/from ['"]\.\.\/\.\.\/config\/utils['"]/g, "from '../../fixtures/upstream-utils.js'"],
  // errors (1-level up)
  [/from ['"]\.\.\/config\/errors['"]/g, "from '../fixtures/errors.js'"],
  // errors (2-level up)
  [/from ['"]\.\.\/\.\.\/config\/errors['"]/g, "from '../../fixtures/errors.js'"],
  // testserver (1-level up)
  [/from ['"]\.\.\/config\/testserver['"]/g, "from '../fixtures/testserver.js'"],
  // testserver (2-level up)
  [/from ['"]\.\.\/\.\.\/config\/testserver['"]/g, "from '../../fixtures/testserver.js'"],
  // proxy (1-level up) — stub
  [/from ['"]\.\.\/config\/proxy['"]/g, "from '../fixtures/coreBundle-stub.js'"],
  // proxy (2-level up) — stub
  [/from ['"]\.\.\/\.\.\/config\/proxy['"]/g, "from '../../fixtures/coreBundle-stub.js'"],
  // coreBundle (1-level up from page/)
  [/from ['"]\.\.\/\.\.\/packages\/playwright-core\/lib\/coreBundle['"]/g, "from '../fixtures/coreBundle-stub.js'"],
  // coreBundle (2-level up from library/)
  [/from ['"]\.\.\/\.\.\/\.\.\/packages\/playwright-core\/lib\/coreBundle['"]/g, "from '../../fixtures/coreBundle-stub.js'"],
  // coreBundle (3-level up from library/chromium/)
  [/from ['"]\.\.\/\.\.\/\.\.\/\.\.\/packages\/playwright-core\/lib\/coreBundle['"]/g, "from '../../../fixtures/coreBundle-stub.js'"],
  // coreBundle (fallback — any relative path ending in coreBundle)
  [/from ['"][^'"]*\/playwright-core\/lib\/coreBundle['"]/g, "from '../fixtures/coreBundle-stub.js'"],
  // comparator (1-level up)
  [/from ['"]\.\.\/config\/comparator['"]/g, "from '../fixtures/coreBundle-stub.js'"],
  // packages/playwright-test → coreBundle-stub (for devices and internal types)
  // Can't use @playwright/test because devices isn't in its ESM named exports.
  [/from ['"][^'"]*\/packages\/playwright-test['"]/g, "from '../fixtures/coreBundle-stub.js'"],
  // import { devices } from '@playwright/test' — devices is not an ESM named export of @playwright/test
  // Redirect to coreBundle-stub which provides a Proxy-based devices object.
  // Only rewrite when 'devices' is in the import (other imports from @playwright/test are fine).
  [/import\s*\{([^}]*\bdevices\b[^}]*)\}\s*from\s*['"]@playwright\/test['"]/g,
    "import {$1} from '../fixtures/coreBundle-stub.js'"],
  // packages/trace/src/har and packages/trace/src/trace → stub for types
  [/from ['"][^'"]*\/packages\/trace\/[^'"]*['"]/g, "from '../fixtures/coreBundle-stub.js'"],
  // packages/playwright/src/isomorphic/folders → stub
  [/from ['"][^'"]*\/packages\/playwright\/[^'"]*['"]/g, "from '../fixtures/coreBundle-stub.js'"],
  // packages/utils/third_party/extractZip → stub
  [/from ['"][^'"]*\/packages\/utils\/[^'"]*['"]/g, "from '../fixtures/coreBundle-stub.js'"],
  // Stable test runner (playwright-test self-tests — shouldn't appear in our selection but guard anyway)
  [/from ['"].*stable-test-runner.*['"]/g, "from '@playwright/test'"],
  // playwright-test/stable-test-runner/node_modules imports
  [/require\(['"].*stable-test-runner.*['"]\)/g, "require('@playwright/test')"],
];

function shouldSkip(relPath) {
  // relPath is relative to playwright-official/tests/, e.g. 'library/video.spec.ts'
  for (const skip of SKIP_LIBRARY) {
    if (relPath === skip || relPath.startsWith(skip + '/')) return true;
  }
  return false;
}

const CJS_GLOBALS_PREAMBLE =
  `import { fileURLToPath as __fileURLToPath } from 'url';\n` +
  `const __filename = __fileURLToPath(import.meta.url);\n` +
  `const __dirname = __filename.replace(/\\/[^\\/]+$/, '');\n`;

function rewrite(content) {
  let result = content;
  for (const [pattern, replacement] of REWRITE_RULES) {
    result = result.replace(pattern, replacement);
  }
  // Inject CJS __filename/__dirname polyfill for ESM spec files that use them.
  if (/\b__filename\b|\b__dirname\b/.test(result) &&
      !result.includes('__fileURLToPath')) {
    // Insert after the last top-level import statement.
    const lastImport = result.lastIndexOf('\nimport ');
    const insertAt = lastImport >= 0
      ? result.indexOf('\n', lastImport + 1) + 1
      : 0;
    result = result.slice(0, insertAt) + CJS_GLOBALS_PREAMBLE + result.slice(insertAt);
  }
  return result;
}

function collectSpecs(srcDir, relPrefix = '') {
  const results = [];
  for (const entry of readdirSync(srcDir)) {
    const full = join(srcDir, entry);
    const rel = relPrefix ? `${relPrefix}/${entry}` : entry;
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...collectSpecs(full, rel));
    } else if (entry.endsWith('.spec.ts')) {
      results.push({ full, rel });
    }
  }
  return results;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const srcArg = args.find(a => a.startsWith('--src='))?.split('=')[1] ?? 'all';

const sources = [];
if (srcArg === 'all' || srcArg === 'page') {
  sources.push({ dir: join(OFFICIAL, 'page'), prefix: 'page', destPrefix: 'page' });
}
if (srcArg === 'all' || srcArg === 'library') {
  sources.push({ dir: join(OFFICIAL, 'library'), prefix: 'library', destPrefix: 'library' });
}

let copied = 0;
let skipped = 0;

for (const { dir, prefix, destPrefix } of sources) {
  const specs = collectSpecs(dir, prefix);
  for (const { full, rel } of specs) {
    if (shouldSkip(rel)) {
      // Also remove the file if it was previously copied and is now skipped.
      const dest = join(UPSTREAM, destPrefix, rel.substring(prefix.length + 1));
      if (!dryRun && existsSync(dest)) {
        unlinkSync(dest);
        console.log(`DEL   ${rel}`);
      } else {
        console.log(`SKIP  ${rel}`);
      }
      skipped++;
      continue;
    }
    const dest = join(UPSTREAM, destPrefix, rel.substring(prefix.length + 1));
    const destDir = dirname(dest);
    if (!dryRun) {
      mkdirSync(destDir, { recursive: true });
      const original = readFileSync(full, 'utf8');
      const rewritten = rewrite(original);
      writeFileSync(dest, rewritten, 'utf8');
    }
    console.log(`COPY  ${rel} → ${relative(ROOT, dest)}`);
    copied++;
  }
}

console.log(`\nDone: ${copied} copied, ${skipped} skipped${dryRun ? ' (dry-run)' : ''}.`);
console.log(`Next: copy assets with  node scripts/copy-upstream-assets.mjs`);
