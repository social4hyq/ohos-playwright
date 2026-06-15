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
| Network interception | `page.route()`, `route.fulfill()`, `route.abort()`, `page.unroute()` |
| Network headers | `page.setExtraHTTPHeaders()` — custom headers reach the server |
| Network conditions | `context.setOffline(true / false)` — actually applies (`ERR_INTERNET_DISCONNECTED` ↔ reachable) |
| Screenshot | `page.screenshot({ type: 'jpeg' \| 'png' })`, `locator.screenshot()` |
| PDF | `page.pdf()` — Chromium-only API, implemented by ArkWeb (produces a valid `%PDF` document) |
| Tracing | `context.tracing.start()` / `stop({ path })` — works under `connectOverCDP`; the resulting zip contains trace + screenshots + source maps |
| Geolocation | `context.setGeolocation()`, `context.grantPermissions(['geolocation'])` |
| Device emulation | `emulateDevice` fixture (see below — `isMobile: false` for a precise viewport) |
| Input | `locator.fill()`, `locator.type()`, `keyboard.press()`, `page.selectOption()` |
| Drag & drop | `locator.dragTo()` — triggers a `drop` event |
| File upload | `page.setInputFiles()` — fires `change`, file content readable |
| Cookies | `context.addCookies()`, `context.cookies()`, `context.clearCookies()` |
| Dialog | `page.on('dialog')`, `dialog.accept()`, `dialog.dismiss()`, `dialog.message()`, `dialog.type()` |
| Popup | `context.waitForEvent('page')` + `window.open()` — stub Page with `url()`, `waitForLoadState()`, `close()` |
| Page events | `page.on('pageerror')`, `page.on('console')`, `page.on('download')` |
| Frames | `page.frames()`, `page.mainFrame()`, `frame.url()` |
| Viewport | `page.viewportSize()` (pre-fetched via `Page.getLayoutMetrics` for reused CDP tabs), `page.setViewportSize()` (applies precisely) |
| Media emulation | `page.emulateMedia({ colorScheme })` |

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
> When `Emulation.setDeviceMetricsOverride` is called with `mobile: true`, ArkWeb enables its mobile layout-viewport compatibility path and renders at the 980px default mobile layout viewport — the passed `width`/`height` are effectively ignored (`window.innerWidth` reads 980 regardless). `deviceScaleFactor` has no effect on this. Use `isMobile: false` when you need an exact pixel viewport. Note that `userAgent` is also not applied (`Emulation.setUserAgentOverride` is acked but ignored by ArkWeb); the browser UA cannot be changed via CDP.

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
- **One context, one page.** `newContext()` / `newPage()` aren't supported (both throw an explicit error). Isolate tests with `localStorage.clear()` + `page.reload()`. For device emulation use the `emulateDevice` fixture instead of `browser.newContext({ ...device })`.
- **`locator.hover()` hangs** on ArkWeb (CDP `Input.dispatchMouseEvent` mouseMoved blocks until the Playwright timeout). Use `:focus`-driven styles or a direct `click()` instead of hover-driven assertions.
- **`page.goBack()` / `page.goForward()` hang** (CDP history navigation never resolves). Re-navigate with `page.goto()` instead.
- **`Emulation.setUserAgentOverride` is ignored** — the command is acked but `navigator.userAgent` is unchanged. The browser UA cannot be changed via CDP.
- **`mouse.wheel()` is a no-op** — the command succeeds but `scrollTop` stays 0. Scroll via `page.evaluate(() => el.scrollTo(...))`.
- **Service Workers unavailable** — `navigator.serviceWorker` is `undefined` on ArkWeb; PWA / SW-based tests are not possible.
- **`page.workers()` returns empty** for web workers — CDP does not auto-attach worker targets. The workers themselves run fine (messages reach the main page), only the listing is affected.
- **Clipboard is a false positive** — `navigator.clipboard.writeText/readText` do not throw but `readText` returns `undefined`. Don't assert on clipboard contents.
- **`emulateDevice({ isMobile: true })` does not apply the viewport** — see the note in the `emulateDevice` fixture section above.
- **`process.platform` reads `'linux'`** during the run — we patch it because Playwright's hostPlatform detection only branches on linux/darwin/win32 and falls through to `<unknown>` on openharmony. For real platform checks use `process.env.OHOS_PW_HOST`.

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
