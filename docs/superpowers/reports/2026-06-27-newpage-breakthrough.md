# L1 突破 — newPage 修复路径定位

**日期**：2026-06-27
**触发**：用户追问「newPage 真的无法修复吗」
**结论**：可修复，路径已定位；通过 `PW_CHROMIUM_ATTACH_TO_OTHER=1` env 实现 opt-in。

## 调用链定位

`crBrowser.ts:372-375`（bundle `coreBundle.js:37148`）：
```ts
override async doCreateNewPage(): Promise<Page> {
  const { targetId } = await this._browser._session.send('Target.createTarget', {...});
  return this._browser._crPages.get(targetId)!._page;  // ← undefined._page
}
```

## 根因（经三步诊断定位）

1. **`Target.createTarget` 在 ArkWeb 上正常返回**（targetId 非空，不 hang）。fixture.mts:230 旧注释「Target.createTarget hangs」错误。
2. **`Target.targetCreated` 事件触发**——但 `Target.attachedToTarget` 事件**不主动触发**（除非用户显式调 `Target.attachToTarget` 命令）。
3. **关键问题**：ArkWeb 把 `Target.createTarget` 创建的 target 标为 `type: 'other'`，**不是** `type: 'page'`。playwright-core 的 `_onAttachedToTarget`（`crBrowser.ts:191`）只注册 `type === 'page'` 的 target 进 `_crPages`——`'other'` 类型直接 `session.detach()` 丢弃。

## 修法

playwright-core 上游提供官方 escape hatch `PW_CHROMIUM_ATTACH_TO_OTHER`（`crBrowser.ts:181`）：
```ts
const treatOtherAsPage = targetInfo.type === 'other' && process.env.PW_CHROMIUM_ATTACH_TO_OTHER;
```

设为 `'1'` 后，`'other'` target 被当 page 处理，`_crPages` 正常填充，`ctx.newPage()` / `goto()` / `evaluate()` 全部恢复。

## 副作用与权衡

env 是全局开关——也会让 ArkWeb 的内部 `'other'` target（shared workers、辅助 worker）被当 page 注册，导致：
- `touchscreen.tap()` 抛 `Target page, context or browser has been closed`
- `context.recordHar()` 偶发连接问题

因此 fixture 默认**不开** env，拦截 `browser.newContext()` 抛友好错误并指引用户显式 opt-in。需要 multi-context 的用户在 import `@playwright/test` 前设：
```ts
process.env.PW_CHROMIUM_ATTACH_TO_OTHER = '1'
```

## 实测结果

ab-new-context 探针（env=1）：
```
[PROBE ab-new-context] result=newContext=ok(pages=0) newPage=ok(text="hello-ohos")
```

`browser.newContext()` + `ctx.newPage()` + `page.goto()` + `page.evaluate()` 全链路工作。

## 诊断探针（已删除，路径记录在此）

- `probes/diag-new-page.spec.ts`：raw `Target.createTarget` + 事件监听
- `probes/diag-auto-attach.spec.ts`：`setAutoAttach` flatten true/false 对照
- `probes/diag-target-lifecycle.spec.ts`：手动 attach + childSession navigate

## 速度参考

- 调用链定位 + 三步诊断：~30 分钟
- 实际 fixture 改动：5 行（条件拦截 + 文档化）
- 上游 escape hatch 选用：避免 fork playwright-core

**结论**：L1 从「根本性限制」修正为「opt-in 可用」。README Limitations 已同步。
