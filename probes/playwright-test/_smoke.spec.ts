// Smoke test: verifies _fixtures.mts + dist/cli.mjs spawn chain works end-to-end.
// Mirrors the simplest test in upstream basic.spec.ts.

import { test, expect } from './_fixtures';

test('smoke: runInlineTest spawns ohos-playwright bin and passes', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('passes', () => {
        expect(1).toBe(1);
      });
    `,
  });
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(1);
  expect(result.failed).toBe(0);
});

test('smoke: runInlineTest spawns ohos-playwright bin and fails', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('fails', () => {
        expect(1).toBe(2);
      });
    `,
  });
  expect(result.exitCode).toBe(1);
  expect(result.failed).toBe(1);
});
