# [Playwright] Add 'openharmony' as a recognized platform value

**Target repo:** microsoft/playwright
**Priority:** P1
**ohos-playwright workaround:** `src/register.mts:27` (global `process.platform` monkey-patch)

## Problem

Playwright's internal platform detection (`packages/playwright-core/src/utils/hostPlatform.ts`) only recognizes `linux`, `darwin`, and `win32`. On OpenHarmony (HarmonyOS), `process.platform` returns `'openharmony'`, which causes Playwright to fall through to `"<unknown>"` in `calculatePlatform()`. This breaks:

- `registry/index.ts` — throws "Unsupported platform" when resolving browser executable paths
- `userAgent.ts` — returns an incorrect UA string
- `crPage.ts` — headful window inset calculation falls through to a wrong branch
- `input.ts` — keyboard modifier key lookup fails
- `tracing.ts` — trace metadata records `"<unknown>"` as the platform

There are **20+ direct `process.platform` reads** scattered across `playwright-core` hot paths that cannot be addressed by environment variables alone. The existing upstream escape hatch `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` (introduced in `hostPlatform.ts:41`) fixes `calculatePlatform()` but does not reach these direct reads.

## Reproduction

On an OpenHarmony device or HarmonyOS PC where `process.platform === 'openharmony'`:

```typescript
// Without the ohos-playwright register shim:
import { chromium } from '@playwright/test'

// Throws immediately, before any browser connection:
// Error: Unsupported platform: openharmony
const browser = await chromium.connectOverCDP('ws://...')
```

When `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-arm64` is set but `process.platform` is not overridden:

```typescript
// calculatePlatform() returns 'ubuntu24.04-arm64' ✓
// But crPage.ts:940 still reads process.platform directly → 'openharmony' → wrong branch
// input.ts:182 reads process.platform directly → modifier key logic breaks
// (20+ other sites also break)
```

## Expected behavior

Playwright should recognize `'openharmony'` as a valid `process.platform` value and map it to Linux-compatible behavior (same as `'linux'`), since OpenHarmony uses a Linux kernel, glibc/musl userspace, and a Chromium-based browser (ArkWeb) that speaks standard CDP.

Concretely:

1. `calculatePlatform()` in `hostPlatform.ts` should branch on `'openharmony'` the same way it branches on `'linux'`.
2. All direct `process.platform === 'linux'` / `process.platform !== 'win32'` guards in `playwright-core` should also accept `'openharmony'`.
3. Screenshot baseline filenames should use a distinct suffix (e.g., `*-openharmony.png`) rather than inheriting `*-linux.png`, so that ArkWeb and desktop Linux Chrome baselines can coexist in the same test suite.

## Actual behavior

`'openharmony'` falls through every platform guard to `"<unknown>"`. The library crashes before it can connect to a browser.

## Proposed fix

**In `packages/playwright-core/src/utils/hostPlatform.ts`:**

```typescript
// Before (pseudocode):
function calculatePlatform(): string {
  if (process.platform === 'linux') { ... }
  else if (process.platform === 'darwin') { ... }
  else if (process.platform === 'win32') { ... }
  return '<unknown>'   // OpenHarmony falls here
}

// After:
function calculatePlatform(): string {
  const p = process.platform as string
  if (p === 'linux' || p === 'openharmony') { ... }   // treat as linux-arm64 family
  else if (p === 'darwin') { ... }
  else if (p === 'win32') { ... }
  return '<unknown>'
}
```

**In all other direct `process.platform` reads across `playwright-core`:** replace bare `process.platform === 'linux'` checks with a helper `isLinuxLike()` that includes `'openharmony'`, or centralize platform detection so that only `hostPlatform.ts` needs updating.

**For screenshot baselines:** expose `openharmony` as its own `snapshotPathTemplate` platform token so test suites can keep separate baselines for ArkWeb vs. desktop Linux Chrome.

## Notes

- OpenHarmony uses a Linux kernel (`uname -s` returns `Linux`) and a musl/glibc userspace; it is not a macOS or Windows variant. Treating it as `linux`-compatible at the CDP/Playwright layer is semantically correct.
- ohos-playwright connects exclusively via `connectOverCDP` and never touches Playwright's bundled browser binaries, so no browser download changes are required.
- The TypeScript type `NodeJS.Platform` does not include `'openharmony'`; the type definition in `@types/node` would also need updating (separate upstream issue in DefinitelyTyped / Node.js).

## Impact on ohos-playwright

一旦上游合并，可删除 `src/register.mts` 中的全局 shim（`Object.defineProperty(process, 'platform', { value: 'linux' })`，第 27 行）。该 shim 是 `process.platform` 的全局 monkey-patch，有以下副作用：

1. **污染用户测试代码**：测试中任何 `process.platform === 'linux'` 或 `process.platform !== 'openharmony'` 判断都会得到错误结果，导致 platform-conditional 测试逻辑失效。
2. **截图基线文件名冲突**：`toHaveScreenshot()` 使用 `process.platform` 作为基线文件名的一部分。当前 patch 导致 ArkWeb 和桌面 Linux Chrome 的基线都写入 `*-linux.png`，无法在同一仓库中区分两套引擎的视觉基准。
3. **`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` 不够**：README 注释（`register.mts:14-26`）已记录 env 变量只能修复 `calculatePlatform()`，无法覆盖 20+ 处直接读取 `process.platform` 的热路径，因此两种手段目前必须同时保留。

上游修复后，`src/register.mts` 中的 platform shim 可以移除，整个适配层减少约 10 行，且用户测试代码中的 `process.platform` 将正确返回 `'openharmony'`。
