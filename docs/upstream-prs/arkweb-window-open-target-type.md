# [ArkWeb] window.open() popup invisible to CDP: Target.createTarget hangs, Target.targetCreated not emitted, type='other' instead of 'page'

**Target repo:** ArkWeb CDPCore
**Priority:** P0
**ohos-playwright workaround:** `src/fixture.mts:130-169` (~42 lines)

## Problem

When a page calls `window.open(url)`, ArkWeb creates a new tab internally, but the CDP layer fails to surface it to external DevTools clients in three compounding ways:

1. **`Target.targetCreated` is not emitted.** Playwright (and any CDP client) listens for this event to discover new targets. Since it never fires, the popup is completely invisible.

2. **`Target.createTarget` hangs.** When Playwright's `context.newPage()` calls `Target.createTarget` internally, ArkWeb never responds to the command. The call hangs until a timeout fires.

3. **Attached targets carry `type: 'other'` instead of `type: 'page'`.** Even when `PW_CHROMIUM_ATTACH_TO_OTHER=1` is set (an upstream Playwright escape hatch) so that `type='other'` targets are accepted, Playwright's `crBrowser._onAttachedToTarget` only promotes targets to its internal page registry if their type is `'page'`. With `type='other'` the target is detached and `context.newPage()` throws `"Cannot read properties of undefined (reading '_page')"`.

The combined effect is that `page.waitForEvent('popup')` / `context.waitForEvent('page')` never resolve for any `window.open()` call, even though the new tab genuinely opens in the ArkWeb browser.

## Reproduction

### Raw CDP reproduction

```jsonc
// Enable Target discovery
{"id":1,"method":"Target.setDiscoverTargets","params":{"discover":true}}

// In the page, trigger window.open (e.g. via Runtime.evaluate)
{"id":2,"method":"Runtime.evaluate","params":{"expression":"window.open('https://example.com')"}}

// Expected: Target.targetCreated event with targetInfo.type='page'
// Actual:   No event arrives. The window.open call returns null (ArkWeb returns null to JS).

// Attempt to list targets
{"id":3,"method":"Target.getTargets"}
// The new tab does NOT appear in the targets list.
```

### Playwright-level reproduction

```typescript
import { chromium } from '@playwright/test'

const browser = await chromium.connectOverCDP('ws://127.0.0.1:9222/...')
const ctx = browser.contexts()[0]
const [page] = ctx.pages()

await page.goto('data:text/html,<button id="b">open</button>')
await page.evaluate(() => {
  document.getElementById('b')!.addEventListener('click', () =>
    window.open('https://example.com')
  )
})

// waitForEvent('page') never fires — times out after 5 s:
const popupPromise = ctx.waitForEvent('page', { timeout: 5000 })
await page.click('#b')
await popupPromise  // TimeoutError

// context.newPage() also hangs:
await ctx.newPage()  // TimeoutError (Target.createTarget never responds)
```

## Expected behavior

1. When `window.open(url)` opens a new tab, ArkWeb should emit `Target.targetCreated` with `targetInfo.type = 'page'` for the new target.
2. `Target.createTarget` should respond promptly, and the resulting target should carry `type: 'page'`.
3. Playwright's `page.waitForEvent('popup')` / `context.waitForEvent('page')` should resolve normally.

## Actual behavior

1. `Target.targetCreated` is never emitted.
2. `Target.createTarget` hangs indefinitely.
3. Targets created via `window.open()` carry `type: 'other'` even when visible under special conditions, causing Playwright to reject them.

Verified on ArkWeb 6.1.0.115 (Chromium 132), HarmonyOS PC (HongMeng Kernel 1.12.0).

## Proposed fix

**In ArkWeb CDPCore:**

1. When a new tab is created as the result of `window.open()`, emit `Target.targetCreated` with `targetInfo.type = 'page'` (matching Chrome's behavior).
2. Implement `Target.createTarget` so it opens a new tab and responds with the new `targetId`.
3. Ensure all programmatically-created tabs carry `type: 'page'` rather than `type: 'other'` in their `TargetInfo`.

**Note on `context.newPage()` and `PW_CHROMIUM_ATTACH_TO_OTHER`:** The upstream Playwright escape hatch `PW_CHROMIUM_ATTACH_TO_OTHER=1` partially works as an opt-in — with it set, Playwright will accept `type='other'` targets and `newPage()`/`goto()`/`evaluate()` can all succeed. However this workaround also causes Playwright to treat ArkWeb-internal "other" targets (e.g., shared workers) as pages, which can perturb `browser.pages()` counts. The proper fix is to emit the correct `type: 'page'` from ArkWeb.

## ohos-playwright workaround（当前规避方案）

由于 `Target.targetCreated` 不触发、`Target.createTarget` 挂起，ohos-playwright 在 `src/fixture.mts:130-169` 通过完全绕开 CDP Target 机制来支持 popup：

1. 在 `installPageWrappers` 中向页面注入 `addInitScript`，将 `window.open` 替换为一个拦截函数，该函数把 URL 压入页面内 `window.__ohosPopupQueue` 数组并返回 `null`（返回真实 Window 对象会导致 CDP 序列化挂起）。
2. 启动 150 ms 定时轮询器，周期性调用 `page.evaluate()` 消费队列，对每条 URL 构造一个最小化 stub 对象（实现 `waitForLoadState` / `url()` / `close()`），通过 `context.emit('page', stub)` 注入到 Playwright 的 BrowserContext 事件总线，使 `waitForEvent('page')` 可以收到通知。
3. Fixture 销毁时 `clearInterval(popupPoller)` 清理轮询器。

此方案产出的 popup 是 stub，不能执行真实导航或截图——上游修复后可整体删除，替换为标准 `context.waitForEvent('page')`。
