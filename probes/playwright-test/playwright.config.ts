// Separate config for ported playwright-test runner conformance specs.
//
// These specs test the @playwright/test runner itself via the runInlineTest
// meta-test pattern (spawning dist/cli.mjs as a subprocess against embedded
// test files). They do NOT interact with a browser directly, so they bypass
// the withOpenHarmony wrapper used by probes/playwright.config.ts.
//
// Run with:
//   ./dist/cli.mjs test --config=probes/playwright-test/playwright.config.ts

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: import.meta.dirname,
  fullyParallel: false,
  timeout: 120000,
  expect: { timeout: 30000 },
  reporter: [['list']],
});
