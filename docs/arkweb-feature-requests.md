# ArkWeb CDP 优化诉求

目标仓库：https://gitee.com/openharmony/web_webview

| ID | Capability | 状态 | Issue |
|---|---|---|---|
| CAP-01 | contextScreenshot | 🔴 待提交 | — |
| CAP-02 | beforeunloadDismiss | 🔴 待提交 | — |
| CAP-03 | cssHoverFromInput | 🔴 待提交 | — |
| CAP-04 | webSocketCreatedEvent | 🟡 待提交 | — |
| CAP-05 | jsCoverageAcrossNavigations | 🟢 待提交 | — |
| CAP-06 | screencast | 🟡 待提交 | — |

---

## CAP-01：新 context 截图无响应

**Capability:** `contextScreenshot`  
**现状：** `Target.createBrowserContext` 创建的 context 中，`Page.captureScreenshot` CDP 命令无回复（5 s timeout）；默认 context 正常（bytes=20475）。  
**期望：** 新 context 中的 target 实现完整 `Page.*` 命令路径，与 Chromium / Edge 一致。  
**对照：** Edge 149 同命令正常响应（bytes=4254）。  
**影响：** screenshot 相关测试无法在新 context 中运行。  
**优先级：** 🔴 高

---

## CAP-02：beforeunload 弹窗无法通过 CDP dismiss

**Capability:** `beforeunloadDismiss`  
**现状：** ArkWeb 触发系统级 "离开页面？" 弹窗，`Page.javascriptDialogOpening` 事件不触发，`Dialog.handleJavaScriptDialog` 无法 dismiss，导致 CDP WebSocket 挂起。  
**期望：** CDP 标准 Dialog 事件流触发，允许程序化 dismiss。  
**影响：** `beforeunload.spec` 全部失败。  
**优先级：** 🔴 高

---

## CAP-03：CDP 鼠标输入不激活 `:hover` 伪类

**Capability:** `cssHoverFromInput`  
**现状：** `Input.dispatchMouseEvent(mouseMoved)` 可触发 DOM `mousemove` 事件，但不激活 CSS `:hover` 状态。  
**期望：** CDP 鼠标输入产生与真实用户操作等价的悬停效果。  
**对照：** Edge 149 同样行为（可能是 headless CDP 通用问题）。  
**优先级：** 🟡 中

---

## CAP-04：`Network.webSocketCreated` 事件未触发

**Capability:** `webSocketCreatedEvent`  
**现状：** 页面创建 WebSocket 时，CDP 不发出 `Network.webSocketCreated` 事件。  
**期望：** 与 Chromium 一致触发完整 WebSocket 生命周期事件。  
**优先级：** 🟡 中

---

## CAP-05：JS 覆盖率不跨导航累计

**Capability:** `jsCoverageAcrossNavigations`  
**现状：** `Profiler.startPreciseCoverage` + `resetOnNavigation:false` 导航后覆盖率重置。  
**期望：** 跨导航保持累计覆盖率。  
**优先级：** 🟢 低

---

## CAP-06：`Page.startScreencast` 未实现

**Capability:** `screencast` / `videoRecording`  
**现状：** `Page.startScreencast` CDP 命令无响应或返回错误。  
**期望：** 实现 screencast 完整命令路径。  
**优先级：** 🟡 中
