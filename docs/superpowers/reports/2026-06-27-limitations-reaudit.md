# Limitations 复审报告（2026-06-27）

**触发**：plan `golden-strolling-yao` 重审 6 项 limitation
**工具**：`OHOS_PW_CDP_URL` + 4 个新探针（`ua-header-http` / `ab-mouse` / `ab-hover-css` / `ab-new-context`）跨 ArkWeb 132 + Edge 149 双引擎对照
**结论**：**6 项 limitation 中 4 项判定需要修正**——REPORT.md（2026-06-26 收尾）基于不充分的 A/B 工具得出多个错误论断。

## 复审矩阵

| # | REPORT 原判定 | 复审实证 | 新判定 |
|---|---|---|---|
| L1 | `newContext` 抛错，ArkWeb 根本性 | `browser.newContext()` 成功（pages=0），仅 `ctx.newPage()` 抛 `_page` 错 | **部分推翻**：newContext 实际可用（cookies / storageState 等不依赖 newPage 的操作）；fixture.mts:71 拦截是过度保护 |
| L2 | HTTP UA 不可改，ArkWeb 根本性 | `Emulation.setUserAgentOverride` 实测改了 HTTP UA header（`OhosPwHeaderProbe/1.0` 到达 echo server）| **推翻**：HTTP UA 可改；REPORT 第 254-263 行基于 `page.route` 拦截的论断是误测（route 拦截发生在 network stack 早期，UA override 还未应用） |
| L3 | `page.mouse.*` 不触发 DOM 事件，ArkWeb 根本性 | ArkWeb 132 上 `mousemove/mousedown/mouseup/click` 全部触发（events=`"mousemove,mousedown,mouseup,click,..."`）；Edge 同 | **推翻**：mouse 事件正常触发；REPORT 第 116-120 行论断完全错误（可能基于旧版 ArkWeb 或不同测试条件） |
| L4 | `:hover` 伪类不激活 | ArkWeb + Edge 上都不激活；但**原因不是 ArkWeb**——是 fixture.mts:218 `locator().hover()` override 用 JS `dispatchEvent`（isTrusted:false），两条腿都不激活 | **细化**：fixture workaround 的副作用，非 ArkWeb 限制 |
| L5 | 需 vendored fork | playwright 1.60 公开 API 已无 `{ handle: true }` 选项；Edge 同样返回 undefined | **推翻**：probe 写法错误，非 ArkWeb 问题（详见 `2026-06-26-exposebinding-handle-fork-eval.md`）|
| L6 | process.platform 兜底，需上游合并 | grep 实证 playwright-core 主路径有 20+ 处直读 process.platform（不只 hostPlatform 一处）；env override 不够 | **维持**：当前 patch 已是最佳折中 |

## 工具链有效性确认

| 工具 | 用途 | 状态 |
|---|---|---|
| `OHOS_PW_CDP_URL` | 跨引擎切换 endpoint | ✅ work（Edge 腿全部跑通） |
| `probes/ab-baseline.spec.ts` | 基础能力对照 | ✅ 已就绪 |
| `probes/ua-override.spec.ts` | UA override 路径对照 | ⚠️ 用 `page.route` 拦截，**会得出错误结论**（见 L2 推翻）|
| `probes/ua-header-http.spec.ts` | 真实 HTTP echo server | ✅ 新增，能准确测 HTTP UA header |
| `probes/ab-mouse.spec.ts` | mouse 事件 DOM 投递 | ✅ 新增，证伪 L3 |
| `probes/ab-hover-css.spec.ts` | `:hover` 伪类激活 | ✅ 新增，揭示 L4 真因 |
| `probes/ab-new-context.spec.ts` | raw newContext 行为 | ✅ 新增，证伪 L1 |

## 后续建议

### 立即（文档同步）
1. REPORT.md 第 200-213 行 Limitations 表：根据复审矩阵更新 5 项判定
2. REPORT.md 第 254-263 行 ua-override A/B 段：标注 page.route 拦截的限制，引用新探针结论
3. README.md Limitations 章节：同步精简表述

### 短期（fixture 改进）
1. `fixture.mts:71` newContext 拦截：改为只拦截 newPage，允许 newContext 用于 cookies/storageState
2. `fixture.mts:218` locator.hover override：考虑用 CDP `Input.dispatchMouseEvent(mouseMoved)` 直发（已测 ArkWeb 实际响应；之前判定为 hang 可能是其他原因），如可行则恢复 :hover

### 长期（深度验证）
1. 补全 L1 的 `Target.createTarget` 实测（REPORT 第 230 行说 hangs，需复测）
2. 跑全 probes 回归确认 L6 双保险改动（register.mts）不破坏现有能力

## 实测日志索引

- ArkWeb 腿（2026-06-27）：
  - `ua-header-http` 3 腿 + JS UA baseline：`OhosPwHeaderProbe/1.0` matches=true on Emulation 路径
  - `ab-mouse` events 全部触发
  - `ab-hover-css` activated=false（fixture JS dispatch 副作用）
  - `ab-new-context` `newContext=ok(pages=0) newPage=throw:_page`
- Edge 149 腿（Windows LAN 192.168.3.60:9222）：
  - `ab-mouse` 同 ArkWeb 行为
  - `ab-hover-css` 同 ArkWeb 行为（fixture 一致副作用）
  - `ua-header-http` 因 Windows↔OHOS 网络隔离无法访问本机 echo server，跳过
