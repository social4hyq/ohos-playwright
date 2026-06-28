# Playwright 上游诉求

目标仓库：https://github.com/microsoft/playwright

| ID | 内容 | 状态 |
|---|---|---|
| P-01 | 识别 `openharmony` 平台 | 🔴 待提交 |
| P-02 | `playwright.ohos` namespace | 🟡 待提交 |

---

## P-01：`calculatePlatform()` 识别 `openharmony` 平台

**文件：** `packages/playwright-core/src/utils/hostPlatform.ts`  
**现状：** `calculatePlatform()` 只识别 `linux/darwin/win32`；OpenHarmony 上返回 `<unknown>`。当前 workaround：`process.platform = 'linux'`（全局副作用，PR 不友好）。  
**期望：**
```typescript
// hostPlatform.ts（建议修改）
case 'openharmony':
  return `ubuntu24.04-${arch}`  // 或专属 ohos-arm64
```
**或** 提供官方 `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` 文档化支持，避免 process.platform 欺骗。  
**PR 优先级：** 🔴 高（是 ohos-playwright 进入上游的入口点）

---

## P-02：`playwright.ohos` namespace（长期目标）

**参照：** `packages/playwright-core/src/server/android/`  
**期望：** 在 playwright-core 中添加 `playwright.ohos` namespace，内置 hdc 设备发现、`OhosDevice`、`OhosCapabilities`，使 OpenHarmony 成为 Playwright 一等公民平台（镜像 Android WebView 支持）。  
**当前状态：** ohos-playwright 的 `src/ohos/` 作为参考实现，架构已对齐。  
**PR 优先级：** 🟡 中（先提 P-01）
