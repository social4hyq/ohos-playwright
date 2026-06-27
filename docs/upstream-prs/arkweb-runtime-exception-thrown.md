# [ArkWeb] Runtime.exceptionThrown not emitted for exceptions inside page.evaluate()

**Target repo:** ArkWeb CDPCore
**Priority:** P1
**ohos-playwright workaround:** `src/fixture.mts:171-182` (~12 lines)

## Problem

When JavaScript code executed via `Runtime.evaluate` (or `Runtime.callFunctionOn`) throws an exception, ArkWeb does **not** emit the `Runtime.exceptionThrown` CDP event. The exception is only surfaced as a rejected CDP response (`exceptionDetails` in the `Runtime.evaluate` result), but the broadcast event that Playwright listens to for `page.on('pageerror', ...)` never fires.

This means that `throw` inside `page.evaluate()` silently disappears from the perspective of any `pageerror` listener:

```typescript
const errors: Error[] = []
page.on('pageerror', e => errors.push(e))

await page.evaluate(() => { throw new Error('test-error') })
// Promise rejects (caught), but errors.length === 0 — pageerror never fires
```

**Distinguishing behavior:** Window-level uncaught exceptions (e.g., from `setTimeout(() => { throw new Error(...) }, 0)` injected via `addScriptTag`) **do** correctly trigger `pageerror`, demonstrating that ArkWeb's `Runtime.exceptionThrown` mechanism is functional in general — it is specifically the evaluate-context exceptions that are not broadcast.

This was verified with the `probes/ab-pageerror.spec.ts` probe, which bypasses the ohos-playwright fixture wrapper and tests ArkWeb's native CDP behavior directly:

```
[PROBE ab-pageerror] wrapper-bypassed native-pageerror-fired=false  (wrapper still needed)
[PROBE ab-pageerror] uncaught-window-pageerror-fired=true
```

## Reproduction

### Raw CDP reproduction

```jsonc
// 1. Enable Runtime events
{"id":1,"method":"Runtime.enable"}

// 2. Execute a script that throws
{"id":2,"method":"Runtime.evaluate","params":{"expression":"(function(){ throw new Error('cdp-throw-test') })()"}}

// Expected: Runtime.exceptionThrown event arrives on the WebSocket
// Actual:   Only the evaluate response arrives with exceptionDetails set.
//           No Runtime.exceptionThrown event is broadcast.

// Response (arrives):
// {"id":2,"result":{"exceptionDetails":{"text":"Uncaught","exception":{"type":"object","subtype":"error",...}}}}

// Missing event (never arrives):
// {"method":"Runtime.exceptionThrown","params":{"timestamp":...,"exceptionDetails":{...}}}
```

### Playwright-level reproduction

```typescript
import { chromium } from '@playwright/test'

const browser = await chromium.connectOverCDP('ws://127.0.0.1:9222/...')
const [page] = browser.contexts()[0].pages()

const pageErrors: Error[] = []
page.on('pageerror', e => pageErrors.push(e))

await page.goto('about:blank')

// Throw inside evaluate:
try {
  await page.evaluate(() => { throw new Error('evaluate-throw') })
} catch {
  // Promise rejection caught
}

await page.waitForTimeout(300)
console.log('pageerror count:', pageErrors.length)  // prints 0, expected 1

// Contrast: window-level uncaught throw does fire pageerror
await page.addScriptTag({ content: 'setTimeout(()=>{ throw new Error("window-throw") }, 10)' })
await page.waitForTimeout(300)
console.log('pageerror count:', pageErrors.length)  // prints 1, correct
```

## Expected behavior

When `Runtime.evaluate` or `Runtime.callFunctionOn` executes code that throws an unhandled exception, ArkWeb should emit `Runtime.exceptionThrown` in addition to returning `exceptionDetails` in the evaluate response. This matches Chrome's behavior and the CDP specification.

Playwright maps `Runtime.exceptionThrown` events to `page.on('pageerror', ...)`. Without the broadcast event, test code cannot detect errors thrown inside `page.evaluate()` through the standard event listener API.

## Actual behavior

`Runtime.exceptionThrown` is **not** emitted for evaluate-context exceptions. Only the direct CDP response carries `exceptionDetails`. `page.on('pageerror', ...)` listeners receive no notification.

Window-level uncaught exceptions (thrown outside of an evaluate context) correctly emit `Runtime.exceptionThrown` and do trigger `pageerror`.

Verified on ArkWeb 6.1.0.115 (Chromium 132), HarmonyOS PC (HongMeng Kernel 1.12.0), using probe `probes/ab-pageerror.spec.ts`.

## Proposed fix

**In ArkWeb CDPCore `Runtime` domain handler:**

When processing a `Runtime.evaluate` or `Runtime.callFunctionOn` call that results in an exception, in addition to setting `exceptionDetails` in the response, also broadcast a `Runtime.exceptionThrown` notification to all attached DevTools clients for that target. This matches the behavior documented in the CDP specification and implemented in Chrome.

Pseudocode (C++):

```cpp
// After evaluate completes with an exception:
if (result.has_exception_details()) {
  // Existing: set exceptionDetails in the response
  response->set_exception_details(result.exception_details());

  // Missing: also broadcast Runtime.exceptionThrown
  auto notification = std::make_unique<protocol::Runtime::ExceptionThrownNotification>();
  notification->set_timestamp(CurrentTimestamp());
  notification->set_exception_details(result.exception_details().Clone());
  frontend_->ExceptionThrown(std::move(notification));  // broadcast to all clients
}
```

## Impact on ohos-playwright

`Runtime.exceptionThrown` 在 evaluate 上下文中不触发，导致 `page.on('pageerror', ...)` 无法接收到 `page.evaluate()` 内抛出的错误。ohos-playwright 在 `src/fixture.mts:171-182` 通过包装 `page.evaluate()` 来弥补这一缺陷：

```typescript
// fixture.mts:174-182（精简版）
const origEvaluate = page.evaluate.bind(page)
;(page as any).evaluate = async (fn: unknown, arg?: unknown) => {
  try {
    return await origEvaluate(fn, arg)
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e))
    page.emit('pageerror', err)   // 手动补发事件
  }
}
```

此 wrapper 的边界：只覆盖通过 `page.evaluate()` 发起的调用；通过 `page.locator().evaluate()` 或裸 CDP `Runtime.evaluate` 直接调用的情况不在覆盖范围内。上游修复 `Runtime.exceptionThrown` 广播后，可删除 fixture.mts 中这约 12 行 wrapper，并同步恢复 cleanup 函数中的 `page.evaluate = savedEvaluate` 还原逻辑。
