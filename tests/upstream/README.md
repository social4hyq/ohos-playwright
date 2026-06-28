# tests/upstream — Upstream Playwright Tests for ohos-playwright

Unbiased oracle for verifying the ohos-playwright port. Each spec is
**copied verbatim from playwright-official (Microsoft Playwright v1.60.0)**
with only import paths rewritten — no functional changes, no probe-style
hand-tuning.

## Why this exists

`probes/` was written to test what the port *can* do. These tests test what
the upstream API *should* do. A passing + fixme ≥ 95% rate is the port's
ground truth.

## Running

```bash
# First run: copy assets from upstream
npm run copy-upstream-assets

# Import spec files (idempotent)
npm run import-upstream  # or: --src=page | --src=library

# List tests without running (sanity check)
npm run test:upstream -- --list

# Full run (real device, hdc connected)
npm run test:upstream

# Single spec smoke test
npm run test:upstream -- tests/upstream/page/page-basic.spec.ts
```

## Fixture wiring

```
ohos-playwright/fixture  (browser/context/page via connectOverCDP)
     +
platform-fixtures.ts     (platform/isWindows/isMac/isLinux)
     +
server-fixtures.ts       (server/httpsServer at localhost:890x)
     +
shims                    (browserName='chromium', contextFactory, etc.)
     =
tests/upstream/fixtures/upstream-fixture.ts
```

Upstream specs import:
```ts
import { test, expect } from '../fixtures/upstream-fixture'   // page specs
import { browserTest, expect } from '../fixtures/upstream-fixture'  // library specs
```

## Test server network access

The test server runs on the host (Node.js process). The browser runs on the
HarmonyOS device (same physical machine via hdc). The server listens on
`0.0.0.0`; the device browser accesses it via `127.0.0.1:PORT`.

No `hdc rport` is required when host == device (typical HarmonyOS dev setup).
For remote device access (OHOS container at 172.16.105.2), set `loopback` to
the host's LAN IP or configure `hdc rport` manually.

## Spec selection

- **INCLUDE**: `tests/page/` (127 specs) + `tests/library/browsercontext-*` +
  `tests/library/chromium/` + selected `tests/library/*.spec.ts` (~38)
- **SKIP**: see `SKIPPED.md`

## fixme policy

Tests that fail due to documented ArkWeb limitations get `test.fixme()` with
a reason string referencing `docs/superpowers/reports/2026-06-27-limitations-reaudit.md`.
Unfixme'd failures are bugs.

## Success criteria

- (passed + fixme) / total ≥ 95%
- Every `failed` test has an assigned category: (a) port defect, (b) ArkWeb
  known limitation, (c) API fundamentally incompatible with connectOverCDP
- `RUN-REPORT-<date>.md` records the raw pass rate (excluding fixme)
