# ArkWeb CDP Limitations

ohos-playwright drives ArkWeb (HarmonyOS WebView) via CDP (Chrome DevTools Protocol).
ArkWeb's CDP implementation has gaps vs standard Chromium that affect Playwright
compatibility. This document catalogs the known limitations, their impact on
upstream Playwright test compatibility, and workarounds (where they exist).

## Summary

| Category | Tests Affected | Fixable? |
|----------|---------------|----------|
| [Browser Context Isolation](#1-browser-context-isolation) | ~20 | No |
| [Context-Level Events](#2-context-level-events) | ~55 | No |
| [Navigation Execution Context](#3-navigation-execution-context) | ~47 | No |
| [Popup / window.open](#4-popup--windowopen) | ~41 | No |
| [CDP Cascade Disconnect](#5-cdp-cascade-disconnect) | ~14 | Partial |
| [Internal API / Test Hooks](#6-internal-api--test-hooks) | ~40 | No |
| [Viewport & Mobile Emulation](#7-viewport--mobile-emulation) | ~13 | No |
| [Rendering Differences](#8-rendering-differences) | ~11 | No |
| [Bindings & initScripts](#9-bindings--initscripts) | ~14 | Partial |
| [Other](#10-other) | ~197 | No |

## 1. Browser Context Isolation

**CDP command**: `Target.createBrowserContext`

**Status**: Returns `"Not allowed"`. ArkWeb does not support creating isolated
browser contexts (similar to Chrome Incognito windows).

**Impact**: Tests that use `browser.newContext()` for cookie/storage/permission
isolation cannot work. Each `newContext()` call creates a non-default context
that can't be properly disposed (calling `Target.disposeBrowserContext` crashes
the CDP WebSocket).

**Workaround**: None. All test state is in a single shared default context.
Cookies, routes, and bindings must be explicitly cleared between tests.

**Affected specs**: `browsercontext-basic`, `browsercontext-add-cookies`,
`browsercontext-credentials`, and others that test multi-context scenarios.

## 2. Context-Level Events

**CDP commands**: Various event subscriptions at browser context level.

**Status**: ArkWeb does not emit the following CDP events at the context level:
- `Runtime.consoleAPICalled` (console.log/warn/error)
- `Page.dialogOpened` (alert/confirm/prompt)
- `Runtime.exceptionThrown` (pageerror)
- `Page.frameNavigated` for history navigation
- `BrowserContext.page` close events

**Impact**: `context.waitForEvent('console')`, `context.waitForEvent('dialog')`,
`context.waitForEvent('weberror')`, `context.waitForEvent('pageclose')` all fail.
Tests that listen for popup dialogs or console messages at context level cannot
work.

**Workaround**: None. Page-level equivalents (`page.waitForEvent('console')` etc.)
work partially but are inconsistent.

**Affected specs**: `browsercontext-events`, `page-event-console`,
`page-event-pageerror`, `page-event-dialog`.

## 3. Navigation Execution Context

**CDP behavior**: During navigation (page.goto, setContent), ArkWeb destroys
the old execution context immediately, before the new page starts loading.
Chrome keeps the old context alive until the new page commits.

**Impact**: Calling `page.evaluate()` or `page.$eval()` right after a navigation
triggers `"Execution context was destroyed"` errors. Affected patterns:
- `page.goto(url); page.evaluate(...)` — race condition
- `page.setContent(html)` — creates navigation internally
- `page.emulateMedia()` — triggers page reload
- `page.waitForNavigation()` — unreliable timing

**Workaround**: `installPageWrappers` patches `evaluate()` to re-emit exceptions
via `pageerror` event. Tests that depend on precise navigation timing cannot be
fixed without ArkWeb-side changes.

**Affected specs**: `page-set-content`, `page-emulate-media`,
`page-wait-for-navigation`, `page-wait-for-response`,
`page-evaluate`.

## 4. Popup / window.open

**CDP behavior**: `window.open()` calls do not create proper CDP targets that
Playwright can track. The new window appears as type `'other'` instead of
`'page'` in CDP target discovery.

**Impact**:
- `page.waitForEvent('popup')` never fires for `window.open()` calls
- `popup.opener()` returns null (no opener relationship established)
- `window.close()` from a popup does not emit close events
- Click with Shift/Ctrl modifiers does not create trackable popups
- `window.open('javascript:...')` does not work at all

**Workaround**: `installPageWrappers` intercepts `window.open()` via client-side
script injection, collects the target URL, and uses CDP `Target.createTarget`
to create a new page directly. This works for simple navigation popups but
fails for `window.open('')` (blank), `javascript:` URLs, and opener tracking.

**Affected specs**: `browsercontext-page-event`, `page-event-popup`,
`browsercontext-locale` (popup tests), `page-basic` (opener tests).

## 5. CDP Cascade Disconnect

**Root cause**: Each `browser.newContext()` call creates a non-default CDP
context that cannot be properly disposed (see #1). These unreleased contexts
accumulate in ArkWeb, and after ~4-8 contexts, the CDP WebSocket becomes
unstable and drops.

**Symptoms**:
- Tests pass when run individually but fail when run in sequence
- Failures manifest as `"Target page, context or browser has been closed"`
- The failing test varies between runs (whack-a-mole)

**Workaround**: As of v0.5.3, the framework:
- Creates per-test pages via CDP `Target.createTarget` (verified stable)
- Closes pages via CDP `Target.closeTarget` (verified stable)
- Reuses the CDP default context instead of creating new ones
- Clears cookies and tracked bindings between tests

This resolves cascade failures for tests that don't explicitly require
`browser.newContext()`. Tests that do require it remain unfixable.

**Affected specs**: `browsercontext-add-cookies`, `browsercontext-credentials`,
`browsercontext-cookies-third-party`, `browsercontext-csp`.

## 6. Internal API / Test Hooks

**Status**: Some Playwright upstream tests import internal APIs not available
in the bundled `playwright-core` used by ohos-playwright.

**Examples**:
- `role-utils` — internal role computation utilities
- `component-parser` — internal React component parser
- `locator-highlight` — internal highlight overlay (uses open shadow root)
- `proxy-pattern` — `utils.parsePattern` not exported
- `coreBundle-stub` — various internal APIs stubbed out

**Workaround**: None. These tests can never pass with the bundled Playwright core.

**Affected specs**: `role-utils`, `component-parser`, `locator-highlight`,
`css-parser`, `proxy-pattern`.

## 7. Viewport & Mobile Emulation

**CDP commands**: `Emulation.setDeviceMetricsOverride`, `Emulation.setTouchEmulationEnabled`

**Status**: When `isMobile: true`, ArkWeb uses a fixed 980px mobile layout
viewport; the passed `width`/`height` values are ignored. `window.scroll()`
does not apply correctly in iPhone emulation. Touch emulation is incomplete.

**Impact**:
- `window.innerWidth`/`innerHeight` don't match requested viewport size
- `window.orientation`/`screen.orientation` not emulated
- `window.scrollY` stays 0 after `window.scroll(0, N)` in mobile mode
- Click coordinates don't map correctly to mobile viewport
- `devicePixelRatio` has subpixel precision drift (3.0000000696... vs 3)

**Workaround**: Set `isMobile: false` for precise viewport sizes. The built-in
`emulateDevice` fixture warns when `isMobile: true` is used. Device descriptors
must not rely on mobile emulation features.

**Affected specs**: `browsercontext-device`, `browsercontext-viewport`,
`browsercontext-viewport-mobile`, `page-tap`.

## 8. Rendering Differences

**Status**: ArkWeb's text rendering, anti-aliasing, and subpixel precision
differ from desktop Chromium. This causes screenshot comparisons to fail.

**Impact**:
- `toHaveScreenshot` baseline mismatches
- `boundingBox` returns subpixel float values (tests expect integers)
- `scrollIntoViewIfNeeded` leaves subpixel scroll residue
- Font rendering differences cause text layout variations

**Workaround**: None. Screenshot-based tests must use ArkWeb-specific baselines.

**Affected specs**: `elementhandle-screenshot`, `elementhandle-bounding-box`,
`page-screenshot`.

## 9. Bindings & initScripts

**Status**: Context-level `exposeBinding`/`exposeFunction` and `addInitScript`
accumulate in the shared default context (see #1). There is no CDP command to
remove bindings (`Runtime.removeBinding` doesn't exist) or init scripts
(`Page.removeScriptToEvaluateOnNewDocument` is unreliable on ArkWeb).

**Impact**: 
- Binding name conflicts between tests in shared context
- `disposable.dispose()` doesn't actually remove context-level init scripts
  from new pages
- `exposeFunction` + `newPage` can trigger target close on ArkWeb

**Workaround**: As of v0.5.3, binding names are tracked via `__ohosBindings`
Set and cleared between tests. Tests that conflict on binding names can be
fixed by using unique names. Context-level init scripts remain persistent.

**Affected specs**: `browsercontext-expose-function`, `browsercontext-add-init-script`,
`page-add-init-script`.

## 10. Other

Various smaller ArkWeb-specific limitations:

- **file:// URLs**: Return `ERR_ACCESS_DENIED` (sandbox restriction)
- **SSL errors**: Not propagated to CDP; `page.goto` doesn't throw
- **navigator.webdriver**: Not set to `true` (automation mode not enabled)
- **Referrer-Policy**: `no-referrer` honored but subresources may still carry referer
- **response.body()**: Returns Latin-1 decoded string instead of raw buffer
- **Page.setDownloadBehavior**: Not supported
- **Browser.setPermission**: Not supported for all permission types
- **Emulation.setLocaleOverride**: ACKed but ignored
- **Page.addScriptToEvaluateOnNewDocument**: Works but `removeScript` is unreliable
- **Temporary directories**: `/tmp` is read-only on HarmonyOS; use `TMPDIR=/data/storage/el3/base`

## CDP Commands Verified on ArkWeb

| Command | Status |
|---------|--------|
| `Target.createTarget` | ✅ Stable |
| `Target.closeTarget` | ✅ Stable |
| `Target.attachToTarget` | ✅ Stable (flat & non-flat) |
| `Target.getTargets` | ✅ Stable |
| `Target.activateTarget` | ✅ Stable |
| `Page.navigate` | ✅ Stable |
| `Runtime.evaluate` | ✅ Stable |
| `Target.createBrowserContext` | ❌ "Not allowed" |
| `Target.disposeBrowserContext` | ❌ Crashes WebSocket |
| `Page.frameNavigated` (history) | ❌ Not emitted |

## Related

- [ohos-playwright README](../README.md) — fixture usage and API reference
- [Upstream Playwright tests](../tests/upstream/) — tests ported from Playwright
- [OpenHarmony v6.1 Release Notes](https://docs.openharmony.cn/) — ArkWeb CDP status
