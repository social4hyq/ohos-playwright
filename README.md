# ohos-playwright

Playwright adapter for **HarmonyOS / OpenHarmony ArkWeb** (Chromium 132-based) — runs your existing Playwright e2e suite against the device's system browser over CDP, no bundled browser binaries needed. Spec files don't change.

The MCP server counterpart lives at [`ohos-playwright-mcp`](https://github.com/social4hyq/ohos-playwright-mcp).

## Why this exists

Playwright's bundled browsers don't ship for the `openharmony` platform, and ArkWeb's sandbox blocks the `AF_UNIX` sockets Playwright uses internally — running stock Playwright on a HarmonyOS PC just crashes. This adapter skips the binary download, uses `hdc` to attach to the browser that's already on the device, and drives it through the Chrome DevTools Protocol over a TCP forward. If the browser isn't running it's launched automatically; when the test run ends the `hdc` forward is cleaned up but the browser stays open.

On Windows / macOS / Linux `withOpenHarmony` is a no-op and the config passes through to stock Playwright.

## Install

```bash
pnpm add -D ohos-playwright @playwright/test
```

Node ≥ 24. `hdc` must be on `PATH` and an OpenHarmony / HarmonyOS device reachable.

## Wire it into playwright.config

```ts
import { defineConfig } from '@playwright/test'
import { withOpenHarmony } from 'ohos-playwright/config'

export default defineConfig(withOpenHarmony({ /* your config */ }))
```

```json
{ "scripts": { "test:e2e": "ohos-playwright test" } }
```

## Supported APIs

The following Playwright APIs have been validated on ArkWeb / HarmonyOS 6.1 (Chromium 132):

| Category | APIs |
|---|---|
| Network interception | `page.route()`, `context.route()`, `route.fulfill()`, `route.abort()`, `page.unroute()` — `page.route` takes priority over `context.route` |
| Network headers | `page.setExtraHTTPHeaders()` — custom headers reach the server |
| Network conditions | `context.setOffline(true / false)` — actually applies (`ERR_INTERNET_DISCONNECTED` ↔ reachable) |
| Network events | `page.on('request')`, `page.on('response')`, `page.on('requestfinished')`, `page.on('requestfailed')` |
| Network intercept wait | `page.waitForRequest()`, `page.waitForResponse()` — string URL, glob, and predicate all work |
| Screenshot | `page.screenshot({ type: 'jpeg' \| 'png' })`, `locator.screenshot()` |
| PDF | `page.pdf()` — Chromium-only API, implemented by ArkWeb (produces a valid `%PDF` document) |
| Tracing | `context.tracing.start()` / `stop({ path })` — works under `connectOverCDP`; the resulting zip contains trace + screenshots + source maps |
| Coverage | `page.coverage.startJSCoverage()` / `stopJSCoverage()`, `startCSSCoverage()` / `stopCSSCoverage()` — returns per-page entries with ranges |
| Geolocation | `context.setGeolocation()`, `context.grantPermissions(['geolocation'])` |
| Device emulation | `emulateDevice` fixture (see below — `isMobile: false` for a precise viewport) |
| Input | `locator.fill()`, `locator.type()`, `keyboard.press()`, `page.selectOption()` |
| Keyboard combos | `keyboard.press('Control+a')`, `'Shift+Tab'`, `'Control+z'`, `'Shift+ArrowRight'`, `'Alt+ArrowLeft'` — modifier combinations work |
| Checkbox | `locator.check()`, `locator.uncheck()`, `locator.setChecked()` — disabled elements correctly rejected |
| Drag & drop | `locator.dragTo()` — triggers a `drop` event |
| Scroll | `page.mouse.wheel()` — scrolls correctly; `page.evaluate(() => el.scrollTo(...))` also works |
| File upload | `page.setInputFiles()` — fires `change`, file content readable |
| Cookies | `context.addCookies()`, `context.cookies()`, `context.clearCookies()` |
| Dialog | `page.on('dialog')`, `dialog.accept()`, `dialog.dismiss()`, `dialog.message()`, `dialog.type()` |
| Popup | `context.waitForEvent('page')` + `window.open()` — stub Page with `url()`, `waitForLoadState()`, `close()` |
| Page events | `page.on('pageerror')`, `page.on('console')`, `page.on('download')` |
| Script / style injection | `page.addScriptTag({ content \| path \| type:'module' })`, `page.addStyleTag({ content })` |
| Init script | `page.addInitScript()` — function or string, persists across `goto()` navigations |
| Expose to page | `page.exposeFunction()`, `page.exposeBinding()` — persists across navigations; `handle` mode not supported |
| Navigation wait | `page.waitForURL()` — string, glob, RegExp, and `history.pushState` client-side navigation |
| Frames | `page.frames()`, `page.mainFrame()`, `frame.url()` |
| Viewport | `page.viewportSize()` (pre-fetched via `Page.getLayoutMetrics` for reused CDP tabs), `page.setViewportSize()` (applies precisely) |
| Media emulation | `page.emulateMedia({ colorScheme })` |
| Web workers | `page.workers()` — returns the list of active workers |
| WebSocket | `page.routeWebSocket()` (requires Playwright ≥ 1.48) — intercepts WebSocket connections |
| Accessibility (CDP) | `newCDPSession` + `Accessibility.getFullAXTree` — returns the full AX node tree |
| Navigation history | `page.goBack()`, `page.goForward()` — implemented via `history.back/forward()` + CDP polling; returns when the history index changes |
| Hover events | `locator.hover()` — fires `mouseover` / `mouseenter` event listeners **and** activates the CSS `:hover` pseudo-class via the real `Input.dispatchMouseEvent` path. Falls back to JS-only dispatch (DOM events without `:hover`) if Playwright's `boundingBox()` hangs for more than 5 s. |
| Locale (partial) | `emulateLocale(tag)` fixture — rewrites `navigator.language` / `navigator.languages` via `addInitScript`; does not affect HTTP `Accept-Language` or browser UI locale |
| User-Agent | `emulateDevice({ userAgent })` — overrides both `navigator.userAgent` and the outgoing HTTP `User-Agent` header; call before `page.goto()` for the override to take effect. (`context.setExtraHTTPHeaders({ 'User-Agent': ... })` does **not** override UA — ArkWeb preserves the browser default there.) |
| Service Workers | `navigator.serviceWorker.register()` — works on HTTPS pages; `navigator.serviceWorker` is `undefined` on non-secure origins (`data:`, `about:blank`) as in all browsers |
| Clipboard | `navigator.clipboard.writeText()` / `readText()` — works on HTTPS pages after `context.grantPermissions(['clipboard-read', 'clipboard-write'])`; unavailable on non-secure origins |

### `emulateDevice` fixture

Because `newContext()` is not supported in connectOverCDP mode, device emulation is exposed as a Playwright fixture parameter backed by CDP `Emulation.*` commands.

```ts
import { test, expect } from '@playwright/test'
import type { DeviceDescriptor } from 'ohos-playwright/fixture'

test('precise viewport', async ({ page, emulateDevice }) => {
  // isMobile: false applies the viewport precisely (window.innerWidth === 375).
  await emulateDevice({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 3,
    isMobile: false,
  })
  expect(await page.evaluate(() => window.innerWidth)).toBe(375)
})
```

`emulateDevice` settings persist for the lifetime of the page. Call it again with `{ viewport: { width: 1280, height: 720 }, isMobile: false }` to restore defaults.

> **⚠️ `isMobile: true` does not produce a precise viewport on ArkWeb.**
> When `Emulation.setDeviceMetricsOverride` is called with `mobile: true`, ArkWeb enables its mobile layout-viewport compatibility path and renders at the 980px default mobile layout viewport — the passed `width`/`height` are effectively ignored (`window.innerWidth` reads 980 regardless). `deviceScaleFactor` has no effect on this. Use `isMobile: false` when you need an exact pixel viewport.
>
> **`userAgent` override applies to both JS and HTTP layers.** Call `await emulateDevice({ userAgent: '...' })` before `page.goto(url)` — `navigator.userAgent` on the destination page will reflect the override, and the outgoing HTTP `User-Agent` header is rewritten as well. Use `emulateDevice` rather than `context.setExtraHTTPHeaders({ 'User-Agent': ... })` — the latter does not override UA on ArkWeb.

### `tap` fixture

ArkWeb fully implements touch input via CDP `Input.dispatchTouchEvent`, but Playwright's `page.touchscreen.tap()` refuses to run unless the context was created with `hasTouch: true` — impossible in single-context reuse mode. The `tap` fixture exposes a CDP-backed tap that works regardless:

```ts
import { test, expect } from '@playwright/test'

test('tap a button', async ({ page, tap }) => {
  await page.goto('http://localhost:5173/')
  const box = await page.locator('#submit').boundingBox()
  await tap(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('#result')).toHaveText('Done')
})
```

Coordinates are CSS pixels relative to the viewport (same as `touchscreen.tap`). Each call issues a `touchStart` + `touchEnd` pair, which also synthesises a `click` event on the targeted element — so it works for both touch handlers and click handlers.

## Limitations

- **Chromium only.** firefox and webkit aren't available on HarmonyOS.
- **`newPage()` after `browser.newContext()` throws.** The raw `browser.newContext()` call succeeds (returns an empty context, 0 pages) but `ctx.newPage()` fails with `Cannot read properties of undefined (reading '_page')`. ArkWeb's CDP `Target.createBrowserContext` / `Target.createTarget` aren't usable in `connectOverCDP` mode. Tests share one context and one page — isolate with `localStorage.clear()` + `page.reload()`. For device emulation use the `emulateDevice` fixture instead of `browser.newContext({ ...device })`.
- **HTTP `User-Agent` header can be changed via CDP, but not via `setExtraHTTPHeaders`.** `Emulation.setUserAgentOverride` (sent by `emulateDevice({ userAgent })`) rewrites both `navigator.userAgent` and the outgoing HTTP UA header — call it before `page.goto()` so it applies to the destination page. `context.setExtraHTTPHeaders({ 'User-Agent': '...' })` does **not** override UA on ArkWeb (the header is preserved as browser default).
- **`locator.hover()` activates CSS `:hover` on typical pages.** The fixture goes through the real `Input.dispatchMouseEvent` path via `page.mouse.move`. On pages where Playwright's `boundingBox()` hangs (e.g. some MutationObserver configurations), it falls back to a JS `mouseover` dispatch after a 5 s timeout — DOM listeners still fire but `:hover` will not activate in that fallback path.
- **`page.mouse.move()` / `page.mouse.down()` / `page.mouse.up()` work normally.** DOM listeners receive `mousemove` / `mousedown` / `mouseup` / `click` in ArkWeb just as they do on stock Chromium. A narrow edge case (data: URL with embedded newlines AND a shared function reference registered for multiple event types on the same element) was previously documented; reaudit could not reproduce it. The `mouseMove` / `mouseDown` / `mouseUp` fixtures remain available as JS-dispatch fallbacks for unusual cases.
- **`emulateDevice({ isMobile: true })` does not apply the viewport** — see the note in the `emulateDevice` fixture section above.
- **`exposeBinding({ handle: true })` is not supported.** Playwright 1.60's public `exposeBinding` signature is `(name, callback)` — the third `{ handle }` argument is silently ignored. The callback receives a serialized form of the argument (DOM nodes arrive as the string `"ref: <Node>"`), not a JSHandle. Use `exposeFunction` or a plain `exposeBinding` callback that reads element properties directly and returns a by-value object.
- **`process.platform` reads `'linux'`** during the run — Playwright's `calculatePlatform()` only branches on linux/darwin/win32 (falls through to `<unknown>` on openharmony), and 20+ other sites in `playwright-core` read `process.platform` directly (UA string assembly, headful window insets, modifier keys, registry). The adapter patches `process.platform` to `'linux'` and pins `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-arm64` for `calculatePlatform()`. For real platform checks use `process.env.OHOS_PW_HOST`.

## Environment variables

| Variable | Default |
|---|---|
| `OHOS_PW_BUNDLE` | `com.huawei.hmos.browser` |
| `OHOS_PW_LAUNCH_URL` | `about:blank` (set to your dev server URL, e.g. `http://localhost:5173`) |
| `OHOS_PW_HDC` | `/data/service/hnp/bin/hdc` |
| `OHOS_PW_AUTO_CONNECT` | auto (set `0` to skip device auto-connect) |
| `OHOS_PW_INFO_PATH` | `<tmpdir>/ohos-playwright-cdp.json` |
| `OHOS_PW_UI_HOST` | `0.0.0.0` — used when `--ui` is passed without `--ui-host` on an OHOS device |
| `OHOS_PW_UI_PORT` | `8765` — used when `--ui` is passed without `--ui-port` on an OHOS device |
| `OHOS_PW_CDP_URL` | unset — when set, overrides the hdc-derived CDP endpoint entirely (e.g. `http://192.168.1.10:9222`) — used for LAN Chrome A/B comparison runs |

### LAN Chrome A/B comparison

`OHOS_PW_CDP_URL` lets you point the probe runner at an arbitrary CDP endpoint — useful for confirming whether a behaviour is an ArkWeb-specific gap or a general Chromium/CDP constraint.

**Windows Chrome setup** (PowerShell / cmd):

```
chrome.exe --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 ^
  --user-data-dir=C:\cdp-profile --remote-allow-origins=* about:blank
```

> Binding to the LAN IP directly (e.g. `--remote-debugging-address=192.168.1.10`) is more reliable than `0.0.0.0` with Chrome ≥ M111. SSH tunnel fallback: `ssh -L 9222:127.0.0.1:9222 <windows-host>` then use `http://127.0.0.1:9222`.

**Running the Chrome leg** — must be from a **non-OpenHarmony host** so the adapter loader does not apply ArkWeb-specific fixture overrides:

```bash
OHOS_PW_CDP_URL=http://192.168.1.10:9222 npx playwright test probes/ab-baseline.spec.ts
```

**ArkWeb leg** (from the HarmonyPC host, as usual):

```bash
./dist/cli.mjs test --config=probes/playwright.config.ts probes/ab-baseline.spec.ts
```

Compare the `[PROBE ab-baseline]` log lines between the two runs to isolate ArkWeb-specific behaviour.

### `--ui` and `--debug` on an OHOS device

Playwright's bundled Chromium cannot exec inside the OHOS app sandbox, which breaks the local windows that `--ui` and `--debug` normally open.

- **`--ui`** auto-injects `--ui-host=0.0.0.0 --ui-port=8765` when run on OHOS, so the UI server starts as HTTP-only. Open `http://<device-ip>:8765` in any browser on your LAN.
- **`--debug`** has no equivalent escape hatch; running it on OHOS exits with guidance. Use `await page.pause()` inside a test, or run `--debug` from a host (Linux/macOS/Windows) connected to the device via hdc.

## Compatibility

| | Required |
|---|---|
| Node | ≥ 24 |
| Playwright | ≥ 1.59 |
| Verified browser | `com.huawei.hmos.browser` (Chromium 132) |

## Troubleshooting

**`Cannot find module 'ohos-playwright/config'`** — not installed, or `pnpm install` not run.

**`defineConfig(...)` has no type hints** — set `moduleResolution` to `bundler` or `nodenext` in tsconfig.

**`未发现设备` / no device found** — on the device, enable Developer Options → Wireless Debugging, make sure it's on the same Wi-Fi as the host, and allow inbound UDP:8710 (used by `hdc discover` broadcast). In CI, run `hdc tconn <ip:port>` manually before tests.

**`Failed to launch` the browser** — bundle not installed or wrong bundle name. List installed browsers with:

```
hdc shell "bm dump -a" | grep -iE "browser|webview|chrom|arkweb"
```

Then set `OHOS_PW_BUNDLE` (e.g. `OHOS_PW_BUNDLE=com.quark.ohosbrowser`).

**`DevTools socket not found`** — browser doesn't expose CDP, or hasn't finished loading. Usually a retry after a few seconds works; persistent failure means this browser doesn't support CDP.

**`CDP probe failed`** — leftover `hdc` forward rule from a prior crashed run. `hdc fport ls` to inspect, `hdc fport rm tcp:<port> localabstract:<socket>` to clear.

**`page.goto('/foo')` doesn't prepend baseURL** — Playwright's standard behavior is `/foo` → `http://localhost:5173/foo`. If it's not working, check `use.baseURL` in `playwright.config.ts`.

## License

MIT © 2026 social4hyq
