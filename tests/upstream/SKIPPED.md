# Skipped Upstream Specs

Specs excluded from `tests/upstream/` because they require features
fundamentally incompatible with `connectOverCDP` + `com.huawei.hmos.browser`.

## Inspector / Codegen (16 specs)

`library/inspector/*` — requires Inspector UI, Recorder, codegen CLI. The
port has no UI mode or Inspector support.

## Trace Viewer UI (2 specs)

`library/trace-viewer.spec.ts`, `library/trace-viewer-scrub.spec.ts` — the
Trace Viewer is an Electron app launched by `playwright show-trace`. Not
available in the port.

## Debug Controller (2 specs)

`library/debug-controller.spec.ts`, `library/debugger.spec.ts` — require the
Playwright debug-controller channel. Not available via CDP.

## Video / Screencast (4 specs)

`library/video.spec.ts`, `library/screencast.spec.ts`,
`library/screencast-actions.spec.ts`, `library/screencast-overlay.spec.ts` —
require `Page.startScreencast` CDP command which ArkWeb does not implement.

## launchServer / WS Connect (4 specs)

`library/browser-server.spec.ts`, `library/browsertype-launch-server.spec.ts`,
`library/multiclient.spec.ts`, `library/browsertype-connect.spec.ts` — the
port only supports `chromium.connectOverCDP()`. `launchServer()` and
`connect()` over Playwright WebSocket are not available.

## Selenium (1 spec)

`library/browsertype-launch-selenium.spec.ts` — Selenium Grid integration;
not applicable.

## Persistent Context (3 specs)

`library/defaultbrowsercontext-1.spec.ts`, `library/defaultbrowsercontext-2.spec.ts`,
`library/browsercontext-reuse.spec.ts` — require `launchPersistentContext()`.
The system browser is managed by the OS; data directories are not accessible.

## Firefox (1 spec)

`library/firefox/launcher.spec.ts` — Firefox is not available on OpenHarmony.

## Codegen (2 specs)

`library/locator-generator.spec.ts`, `library/selector-generator.spec.ts` —
require codegen / Recorder tooling. Not in the port.

## Launch Knobs (3 specs)

`library/launcher.spec.ts`, `library/headful.spec.ts`, `library/slowmo.spec.ts`
— test `browserType.launch()` options. The port uses `connectOverCDP` and
cannot pass launch arguments to the system browser.

## Internal Unit Tests (23 specs)

`library/events/*` (19), `library/unit/*` (4) — test playwright-core's
internal EventEmitter and utility classes. No browser involvement; not
meaningful for port validation.

## Snapshot Renderer (1 spec)

`library/snapshot-renderer.spec.ts` — tests the internal `SnapshotRenderer`
component from playwright-core. Playwright-internal; not a port concern.

## Entirely Separate Products

These test directories are for products that are not `playwright-core`:
- `playwright-test/*` (100) — `@playwright/test` runner self-tests
- `mcp/*` (87) — Playwright MCP server
- `android/*` (5) — Android WebView driver
- `electron/*` (4) — Electron driver
- `extension/*` (4) — Chrome extension support
- `installation/*` (21) — npm install / browser download
- `stress/*` (4) — long-running stress tests
- `components/*`, `bidi/*` — components / BiDi (not applicable)
