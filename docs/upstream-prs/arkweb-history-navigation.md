# [ArkWeb] Page.navigateToHistoryEntry hangs; Page.frameNavigated not emitted after history navigation

**Target repo:** ArkWeb CDPCore
**Priority:** P0
**ohos-playwright workaround:** `src/fixture.mts:68-112` (~46 lines)

## Problem

ArkWeb's CDP implementation has two related defects in history navigation:

1. `Page.navigateToHistoryEntry` is accepted (no error response) but never resolves — the CDP call hangs indefinitely until the caller's timeout fires.
2. After a history navigation triggered by any means (including `history.back()` / `history.forward()` evaluated inside the page), ArkWeb does **not** emit the `Page.frameNavigated` CDP event. As a result, Playwright's `page.waitForURL()` and all navigation-await mechanisms never settle.

Together these two defects make `page.goBack()` and `page.goForward()` completely non-functional via the standard CDP path.

## Reproduction

### Minimal CDP WebSocket reproduction

Connect to the ArkWeb DevTools endpoint, then issue the following sequence over the raw WebSocket:

```jsonc
// 1. Open two pages in sequence so that a history entry exists
{"id":1,"method":"Page.navigate","params":{"url":"https://example.com/page-a"}}
// wait for Page.frameNavigated ...

{"id":2,"method":"Page.navigate","params":{"url":"https://example.com/page-b"}}
// wait for Page.frameNavigated ...

// 2. Fetch the history to get the previous entry id
{"id":3,"method":"Page.getNavigationHistory"}
// Response example:
// {"id":3,"result":{"currentIndex":1,"entries":[{"id":0,"url":"...page-a",...},{"id":1,"url":"...page-b",...}]}}

// 3. Navigate to the previous entry — THIS HANGS
{"id":4,"method":"Page.navigateToHistoryEntry","params":{"entryId":0}}
// No response ever arrives. The WebSocket stays open but silent.
// No Page.frameNavigated is emitted either.
```

### Playwright-level reproduction (without ohos-playwright workaround)

```typescript
import { chromium } from '@playwright/test'

const browser = await chromium.connectOverCDP('ws://127.0.0.1:9222/...')
const [page] = browser.contexts()[0].pages()

await page.goto('https://example.com/page-a')
await page.goto('https://example.com/page-b')

// Hangs until Playwright's default 30 s timeout fires:
await page.goBack()
// TimeoutError: page.goBack: Timeout 30000ms exceeded
```

## Expected behavior

1. `Page.navigateToHistoryEntry` navigates to the requested history entry and resolves promptly (matching Chrome DevTools Protocol specification).
2. `Page.frameNavigated` is emitted with the restored URL after the navigation completes.
3. Consequently, `page.goBack()` / `page.goForward()` work correctly in Playwright tests running against ArkWeb.

## Actual behavior

1. `Page.navigateToHistoryEntry` never resolves; the CDP message gets no response.
2. `Page.frameNavigated` is never emitted after any form of history navigation.
3. `page.goBack()` / `page.goForward()` always time out (30 s by default).

Verified on ArkWeb 6.1.0.115 (Chromium 132) running on HarmonyOS PC (HongMeng Kernel 1.12.0).

## Proposed fix

**In ArkWeb CDPCore:**

1. Implement the `Page.navigateToHistoryEntry` handler so that it calls the WebContents history navigation API and sends a CDP response once the navigation commits (or fails).
2. Ensure `Page.frameNavigated` is emitted for history-initiated navigations (same as same-document `history.pushState` navigations, which do already emit the event for `navigationType: "Other"`).

## ohos-playwright workaround（当前规避方案）

因 `Page.navigateToHistoryEntry` 永久挂起且不触发 `Page.frameNavigated`，ohos-playwright 在 `src/fixture.mts:68-112` 完整替换了 `page.goBack()` 和 `page.goForward()` 的实现：

- 先通过 `Page.getNavigationHistory` 记录当前 `currentIndex`
- 在页面内调用 `history.back()` / `history.forward()`（JS evaluate 路径，不经 CDP 原生命令）
- 以 80 ms 为间隔轮询 `Page.getNavigationHistory.currentIndex`，直到 index 变化后返回
- 超时后抛出友好错误

这段 polyfill 约 46 行，上游修复后可整体删除。
