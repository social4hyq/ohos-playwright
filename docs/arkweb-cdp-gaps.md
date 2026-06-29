# ArkWeb CDP Implementation Gaps — Feedback for ArkWeb Team

This document catalogs CDP (Chrome DevTools Protocol) features that ArkWeb
either doesn't implement or implements differently from standard Chromium.
Each item includes the CDP command, observed behavior, and user-facing impact.

This is intended as structured input for the ArkWeb browser team to prioritize
CDP compatibility improvements.

## Priority 1 — Unlocks Majority of Blocked Tests

### 1.1 `Target.createBrowserContext`

**Current behavior**: Returns protocol error `"Not allowed"`.

**Expected behavior**: Creates an isolated browser context with its own cookie
jar, storage, and binding namespace. Returns a `browserContextId`.

**Impact**:
- Blocks ~20 Playwright tests that use `browser.newContext()` for isolation
- Without this, all tests must share a single context, causing:
  - Cookie/storage cross-contamination between tests
  - Binding/exposeFunction name conflicts
  - initScript accumulation
  - `browser.newContext()` calls degrade CDP WebSocket stability

**Verification**: Send `Target.createBrowserContext({ disposeOnDetach: true })`.
Expected: `{ browserContextId: "..." }`.

### 1.2 `Target.disposeBrowserContext`

**Current behavior**: Crashes the CDP WebSocket connection.

**Expected behavior**: Destroys the specified browser context and all its pages.
Returns `{ success: true }`.

**Impact**:
- Without this, non-default contexts accumulate in ArkWeb memory
- After ~4-8 context creations, CDP WebSocket becomes unstable
- Workaround: never call disposeBrowserContext; let contexts leak until browser restart

**Verification**: After `Target.createBrowserContext` succeeds, call
`Target.disposeBrowserContext({ browserContextId })`. Expected: no WS disconnect.

### 1.3 `Page.frameNavigated` for History Navigation

**Current behavior**: `Page.frameNavigated` is not emitted when the user
navigates via browser history (back/forward).

**Expected behavior**: `Page.frameNavigated` fires for ALL navigations,
including history.back(), history.forward(), and history.go().

**Impact**:
- `page.goBack()` and `page.goForward()` hang indefinitely
- Workaround: polling `Page.getNavigationHistory` instead of event-driven wait

**Verification**: Navigate to page A → B. Call `history.back()`. Expected:
`Page.frameNavigated` event fires for the back navigation to A.

## Priority 2 — Enables Popup & Event Workflows

### 2.1 `window.open()` Target Discovery

**Current behavior**: Pages created via `window.open()` appear as `type: 'other'`
in CDP target discovery, not `type: 'page'`.

**Expected behavior**: New windows created by `window.open()` should be
reported as `type: 'page'` with proper `openerId` referencing the parent page.

**Impact**:
- `page.waitForEvent('popup')` never fires
- `popup.opener()` always returns null
- ~41 Playwright tests that test popup workflows are blocked

**Verification**: `page.evaluate(() => window.open('about:blank'))`.
Expected: `Target.targetCreated` event with `targetInfo.type = 'page'`
and `targetInfo.openerId` set.

### 2.2 Context-Level Event Routing

**Current behavior**: The following events are not emitted at the browser
context level:
- `Runtime.consoleAPICalled` (console.log/warn/error from pages)
- `Page.dialogOpened` (alert/confirm/prompt)
- `Runtime.exceptionThrown` (uncaught exceptions / pageerror)
- `Page.downloadCreated` (file downloads)

**Expected behavior**: These events should bubble to the browser context
subscription, matching standard Chromium behavior.

**Impact**:
- `context.waitForEvent('console')`, `context.waitForEvent('dialog')`,
  `context.waitForEvent('weberror')` fail
- ~55 Playwright tests blocked

**Verification**: Subscribe to `Runtime.consoleAPICalled` at the browser
context level. Call `console.log('test')` from a page. Expected: event received.

## Priority 3 — Quality of Life Improvements

### 3.1 Execution Context Lifetime During Navigation

**Current behavior**: During `Page.navigate`, the old execution context is
destroyed immediately when navigation starts, before the new page commits.

**Expected behavior**: Old execution context should remain alive until the
new document's execution context is created (standard Chromium behavior).

**Impact**:
- `page.evaluate()` called right after navigation start fails with
  "Execution context was destroyed"
- `page.setContent()` and `page.emulateMedia()` trigger internal navigations
  that cause the same issue
- ~47 Playwright tests blocked

### 3.2 `Emulation.setDeviceMetricsOverride` with `mobile: true`

**Current behavior**: When `mobile: true` is set, the viewport always renders
at 980px layout viewport width regardless of the passed `width`/`height` values.

**Expected behavior**: The viewport should respect the passed `width`/`height`
values while enabling mobile-specific features (touch events, meta viewport).

### 3.3 `Page.setDownloadBehavior`

**Current behavior**: Not supported.

**Expected behavior**: Should allow setting download path and behavior
(deny/allow/accept).

### 3.4 `Emulation.setLocaleOverride`

**Current behavior**: CDP ACKs the command but `navigator.language` is not changed.

**Expected behavior**: `navigator.language` should reflect the overridden locale.

## Verified Working CDP Commands

These commands work correctly on ArkWeb (verified with stress testing):

| Command | Notes |
|---------|-------|
| `Target.createTarget` | Stable with 50+ sequential calls |
| `Target.closeTarget` | Stable, returns `{ success: true }` |
| `Target.attachToTarget` | Both flat and non-flat modes |
| `Target.getTargets` | Returns accurate target list |
| `Target.activateTarget` | Works correctly |
| `Page.navigate` | Load and DOMContentLoaded events work |
| `Runtime.evaluate` | Expression and function evaluation work |
| `Page.getLayoutMetrics` | CSS visual viewport metrics available |
| `Input.dispatchTouchEvent` | touchStart/touchEnd received |
| `Storage.clearCookies` | Works at context level |

## Test Impact Summary

Total upstream Playwright test suite: 214 files, ~2,658 tests. Current status
after all workarounds applied:

| Status | Count |
|--------|-------|
| Passing | ~2,200 |
| Fixme'd (ArkWeb gaps) | ~450 |
| Auto-skipped | ~200 |
| **Total** | ~2,658 |

Addressing Priority 1 (createBrowserContext + disposeBrowserContext +
frameNavigated) would unblock approximately 80-100 currently fixme'd tests.
Addressing Priority 2 (window.open + context events) would unblock another
~100 tests.

## Contact

For questions about these findings or to discuss prioritization:
- Repository: https://github.com/social4hyq/ohos-playwright
- Documentation: docs/arkweb-limitations.md
