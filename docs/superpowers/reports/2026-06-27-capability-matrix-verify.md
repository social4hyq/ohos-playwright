# 能力矩阵第三方报告验证（2026-06-27）

**触发**：外部补丁方案报告（11 个测试用例 T1-T3 / S1-S3 / L1 / P1-P2 / C1-C2）评估 ohos-playwright v0.3.5 的能力边界。当前版本 v0.5.1，需验证报告中的判定是否仍准确。

**工具**：
- `probes/capability-matrix.spec.ts`：11 个用例的最小复现（try/catch + RESULT=pass/fail 输出）
- `probes/s1-diag.spec.ts`：S1 失败的五层对照（A/B/C/D/E）
- `probes/s1-cdp.spec.ts`：S1 裸 CDP 命令级定位
- 运行环境：HarmonyOS PC + ArkWeb 132.0.6834.89 + `PW_CHROMIUM_ATTACH_TO_OTHER=1`

**结论**：**11 个用例中 5 项与原报告判定不符**。原报告基于 v0.3.5，未跟踪 v0.4.0/v0.5.0 的 fixture 重构。

## 验证矩阵

| 用例 | 原报告（v0.3.5） | v0.5.1 实测 | 处置 |
|---|---|---|---|
| T1 newContext + newPage | ⚠️ 副作用：type:'other' 误识别为 page | ✅ pass；Target.getTargets 全是 `type:'page'`，type:'other' 副作用已消失 | **推翻**：副作用前提已不存在（v0.5.0 fixture 重构） |
| T2 多 context 独立关闭 | ❌ ctx.close() 会断开浏览器 | ✅ pass；connectedAfterCtx1=true / connectedAfterCtx2=true | **推翻**：v0.5.1 已无此问题 |
| T3 newPage + evaluate | ⚠️ 依赖 PW_CHROMIUM_ATTACH_TO_OTHER=1 | ✅ pass；evaluate=42 | **维持**：仍需 opt-in，但能力正常 |
| S1 新 context 截图 | ⚠️ CDP 截图可用时通过 | ❌ timeout；根因见下文 | **细化**：CDP 截图仅对默认 context 可用，新 context 中 `Page.captureScreenshot` 不响应 |
| S2 导航后截图 | ⚠️ 部分设备失败 | ✅ pass；bytes=6011 | **维持**：默认 context 路径正常 |
| S3 失败自动截图 | ❌ CDP 不可用时直接报错 | ⚠️ pass（截图本身成功）；错误为 "snapshot doesn't exist, writing actual"（基线写入流程） | **维持**：当前设备 CDP 可用，无法证伪报告 |
| L1 fixture browser 启动 | ❌ 必须改配置和 CLI | ✅ pass；fixture 直接提供 browser | **维持**：当前仍需 `withOpenHarmony()` + `ohos-playwright test` |
| P1 window.open 真 Page | ❌ stub 不支持 evaluate | ❌ fail；`newPage.evaluate is not a function` | **维持**：stub popup 机制未变 |
| P2 新标签页完整 API | ❌ stub 无 setContent | ❌ fail；`newPage.setContent is not a function` | **维持**：同上 |
| C1 关非默认 context | ❌ 浏览器断连 | ✅ pass；connected=true, defaultPages=4 | **推翻**：v0.5.1 已无此问题 |
| C2 context.pages() 列表 | ❌ pages() 不完整 | ✅ pass；pages=2, allUsable=true | **推翻**：v0.5.1 已无此问题 |

## S1 A/B 跨引擎对照（2026-06-27 追加）

为确认 S1 是 ArkWeb 特有问题还是 `connectOverCDP + newContext` 通病，新增 `probes/ab-s1-newcontext-screenshot.spec.ts` 跨 ArkWeb 132 + Edge 149 双引擎对照。

### 探针设计（同一份代码，环境变量切换 endpoint）

| 步骤 | 验证点 |
|---|---|
| 1 | 默认 context `contexts()[0].pages()[0].screenshot()` —— 基线 |
| 2 | 新 context `newContext + newPage + page.evaluate(1+1)` —— 会话可用性 |
| 3 | 新 context `page.screenshot()` —— Playwright 层截图 |
| 4 | 新 context 裸 CDP `Page.captureScreenshot` —— 内核层截图 |

### 实测结果

| 步骤 | ArkWeb 132 (本机) | Edge 149 (Windows LAN 172.16.100.2:9222) |
|---|---|---|
| 1. 默认 context screenshot | ✅ bytes=20475 | ✅ bytes=1232949 |
| 2. 新 context evaluate | ✅ evaluate=2 | ✅ evaluate=2 |
| 3. 新 context `page.screenshot()` | ❌ **TIMEOUT 5s** | ✅ bytes=4254 |
| 4. 新 context 裸 CDP captureScreenshot | ❌ **CDP_TIMEOUT 5s** | ✅ dataLen=11352 |

### 结论

**S1 是 ArkWeb 内核特有问题，非 connectOverCDP 通病。** Edge 149 上同样的 `connectOverCDP + newContext + newPage + screenshot` 流程在所有四个步骤全部通过；ArkWeb 132 在步骤 3、4 均无响应（5s timeout）。这把根因从「connectOverCDP 模式下 newContext 通用限制」精确化为「ArkWeb 对 `Target.createBrowserContext` 创建的 target 不实现 `Page.captureScreenshot` 命令路径」。

### 运行命令

```bash
# ArkWeb 腿
PW_CHROMIUM_ATTACH_TO_OTHER=1 ./dist/cli.mjs test \
  --config=probes/playwright.config.ts probes/ab-s1-newcontext-screenshot.spec.ts

# Edge 腿
OHOS_PW_CDP_URL=http://172.16.100.2:9222 PW_CHROMIUM_ATTACH_TO_OTHER=1 \
  ./dist/cli.mjs test --config=probes/playwright.config.ts \
  probes/ab-s1-newcontext-screenshot.spec.ts
```

注：Edge 腿 Playwright 标记 ✘ 是因为 base.test 模式下 browser.close 超时（30s test timeout），但所有 PROBE 数据行在 timeout 前已完整输出，不影响结论。

---

## S1 根因（ArkWeb 新 context 不响应 captureScreenshot）

### 现象

`browser.newContext()` + `context.newPage()` 创建的 page 上调用 `page.screenshot()` 必定 5s+ timeout；同一时刻默认 context 的 page 截图正常（bytes=20475）。

### 五层对照（s1-diag）

| 探针 | 步骤 | 结果 |
|---|---|---|
| A | newContext + newPage + goto + screenshot | ❌ screenshot timeout 5s |
| B | A + setViewportSize | ❌ screenshot timeout 5s |
| C | data: URL 替代 about:blank | ❌ screenshot timeout 5s |
| D | setContent 替代 goto | ❌ screenshot timeout 5s |
| E | 无 screenshot（仅 goto + Target.getTargets） | ✅ pass |

**关键变量**：唯一引发 timeout 的是 `page.screenshot()` 调用，与 navigation / viewport / URL 类型无关。

### 裸 CDP 命令定位（s1-cdp）

对新 context 的 page 创建 CDP session 后逐命令验证：

| CDP 命令 | 新 context 的 page | 默认 context 的 page |
|---|---|---|
| `Runtime.evaluate` (1+1) | ✅ 返回 2 | ✅ |
| `Page.captureScreenshot` | ❌ 5s 无响应 | ✅ bytes=20475 |

**结论**：ArkWeb 内核对 `Target.createBrowserContext` 创建的新 context 中的 target，CDP session 部分命令工作（Runtime/Page 导航/Page DOM），但 `Page.captureScreenshot` 命令**完全不响应**（无回复，导致客户端 timeout）。

### 与原报告对照

原报告 3.1 节描述的 newContext 副作用："ArkWeb 内部 type:'other' target 也被识别为 page" 在 v0.5.1 上**已不再以该形式出现**——`Target.getTargets` 实测返回的 targetInfo 全部 `type:'page'`，无 type:'other' 误识别。

但 ArkWeb 新 context 路径下 captureScreenshot 不响应的内核缺陷未修复。原报告 S1 判定 "⚠️ CDP 截图可用时通过" **不准确**：CDP 截图对默认 context 可用（S2 验证）但**对新 context 不可用**——这是默认/新 context 的差异，不是设备差异。

## 与 README 对照

README `Limitations` 第 128 行已声明 `ctx.newPage()` 需要 `PW_CHROMIUM_ATTACH_TO_OTHER=1`，但未提及新 context 中的 screenshot 限制。建议补充：

> **新 context 中 `page.screenshot()` 不可用**：ArkWeb 对 `Target.createBrowserContext` 创建的 target 不响应 `Page.captureScreenshot`。新 context 中的 page 其他能力（goto/evaluate/setContent）正常。截图需求请使用默认 context 的 page。

## 后续建议

### 立即（文档同步）
1. README Limitations 章节补充 newContext + screenshot 限制说明
2. probes/REPORT.md 在「部分支持」表中新增 `page.screenshot() in newContext` 一行

### 短期（fixture 改进）
1. 可选：在 `fixture.mts` 检测到新 context 调用 `screenshot()` 时给友好错误（避免 5s+ timeout）
2. S3 测试方法补充：在 CDP 截图可用的设备上无法区分 ohos-playwright 与补丁方案，需在 ArkWeb-only 设备上复测才能验证 HDC fallback 的差异化价值

### 长期（根因修复）
1. 提交上游 issue 给 ArkWeb：`Target.createBrowserContext` 创建的 target 不响应 `Page.captureScreenshot`
2. 评估是否在 ohos-playwright 层为新 context 的截图做 HDC snapshot fallback（与补丁方案对应）

## 实测日志索引

- `logs/capability-matrix-2026-06-27-*.log`：11 个用例完整运行日志
- `logs/s1-diag-2026-06-27-*.log`：S1 五层对照诊断
- `logs/ab-s1-arkweb-2026-06-27-*.log`：S1 A/B ArkWeb 腿
- `logs/ab-s1-edge-2026-06-27-*.log`：S1 A/B Edge 腿
- s1-cdp 运行 stdout（嵌入式验证，未单独存档）
- 测试文件：
  - `probes/capability-matrix.spec.ts`
  - `probes/s1-diag.spec.ts`
  - `probes/s1-cdp.spec.ts`
  - `probes/ab-s1-newcontext-screenshot.spec.ts`
