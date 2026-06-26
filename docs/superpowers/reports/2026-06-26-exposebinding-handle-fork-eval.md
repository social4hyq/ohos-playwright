# L5 — `exposeBinding({ handle: true })` 返回 undefined 的真相复核

**日期**：2026-06-26
**触发**：ohos-playwright limitations 重审（plan: golden-strolling-yao）
**结论**：REPORT.md 第 210 行「需 vendored playwright-core fork」判定**错误**。这是 probe 对 API 的误用，不是 ArkWeb 限制，也不是 playwright-core 缺陷。

## 重新验证（2026-06-26）

跨引擎 A/B 实测（`probes/expose-function.spec.ts` test 4）：

| 引擎 | `[PROBE exposeBinding-handle] result` |
|---|---|
| ArkWeb 132 | `undefined` |
| Edge 149 (Windows LAN via `OHOS_PW_CDP_URL=http://192.168.3.60:9222`) | `undefined` |

**两条腿行为一致——`{ handle: true }` 在 Edge 上同样返回 undefined。**

## 真实根因

### playwright 1.60 公开 API 已无 handle 选项

`playwright-core/src/client/page.ts:360`：
```ts
async exposeBinding(name: string, callback: (source: structs.BindingSource, ...args: any[]) => any) {
  const result = await this._channel.exposeBinding({ name });
  this._bindings.set(name, callback);
  return DisposableObject.from(result.disposable);
}
```

签名只有 `name + callback`，**没有第三个参数**。用户传的 `{ handle: true }` 被静默忽略。

### 序列化器对 DOM 节点的处理

`isomorphic/utilityScriptSerializers.ts:192-205`：
```ts
function serialize(value, handleSerializer, visitorInfo) {
  if (value && typeof value === 'object') {
    if (typeof globalThis.Window === 'function' && value instanceof globalThis.Window)
      return 'ref: <Window>';
    if (typeof globalThis.Document === 'function' && value instanceof globalThis.Document)
      return 'ref: <Document>';
    if (typeof globalThis.Node === 'function' && value instanceof globalThis.Node)
      return 'ref: <Node>';
  }
  return innerSerialize(value, handleSerializer, visitorInfo);
}
```

DOM 节点（`instanceof Node`）被序列化为字符串 `"ref: <Node>"`——**不是 CDP remote object reference**。

### 完整调用链

1. 用户调 `page.exposeBinding('nodeHandle', fn, { handle: true })`——`{ handle: true }` 被忽略
2. 页面调 `window.nodeHandle(element)`
3. BindingsController 注入的 wrapper：`serializeAsCallArgument(element, v => ({ fallThrough: v }))` → 字符串 `"ref: <Node>"`
4. payload `{ name, seq, serializedArgs: ["ref: <Node>"] }` 通过 CDP `Runtime.bindingCalled` 事件传给 server
5. server `PageBinding.dispatch`：`args = serializedArgs.map(parseEvaluationResultValue)` → `["ref: <Node>"]`
6. 调用户 binding 函数 `fn(source, "ref: <Node>")`
7. 用户 fn 内 `handle.jsonValue()`——字符串没 jsonValue 方法，抛 TypeError
8. dispatch catch 路径：`evaluateExpressionHandle(..., { name, seq, error })`，error 也走嵌套序列化
9. ArkWeb/Edge 同样行为：`arg.result = undefined`，promise resolve(undefined)

**这不是 ArkWeb 的问题**——是 probe 写法期望了一个不存在的 API。

## patch-package 试用结论

按 plan 试用 patch-package，加 server-side by-value 序列化：
- 修改点：`node_modules/playwright-core/lib/coreBundle.js:20460`（PageBinding.dispatch）
- 试用结果：诊断日志显示 **handle 模式的 dispatch 根本没被触发到 try 块**——因为 binding 函数在第一步就抛错（字符串.jsonValue）
- 已回滚 patch，未保留 patches/ 目录

**patch-package 在此处无意义**——问题不在 server 端序列化，在 client 端 serializer 把 DOM 节点变成字符串。要真正实现 handle 模式需要：

1. client 端注入的 controller 改用 CDP `DOM.resolveNode` 把 element 转成 `backendNodeId`，再转 `objectId`
2. server 端 `parseEvaluationResultValue` 把 `backendNodeId` 重构为 JSHandle
3. playwright 上游已不再支持此路径——重写代价远超收益

## 推荐处置

### 1. 修正 probe（必做）

`probes/expose-function.spec.ts` test 4 改为：
```ts
test('exposeBinding: by-value element access (recommended pattern)', async ({ page }) => {
  await page.exposeBinding('nodeProps', async (source, el) => ({
    tag: el?.tagName,
    x: el?.getAttribute('data-x'),
    text: el?.textContent,
  }))
  await page.goto('data:text/html,<div id=t data-x=42>hi</div>')
  const result = await page.evaluate(() => (window as any).nodeProps(document.getElementById('t')))
  console.log(`[PROBE exposeBinding-by-value] result=${JSON.stringify(result)}`)
})
```

### 2. 修正 REPORT.md（必做）

第 200-213 行 Limitations 表第 5 行更新：
- 旧：`exposeBinding({handle:true}) undefined → 必须 vendored fork`
- 新：`exposeBinding handle 模式在 playwright 1.60 公开 API 中不存在；用 by-value 序列化替代`

### 3. README 更新

Limitations L5 改写为：playwright 1.60 起 `exposeBinding` 不再支持 handle 选项；用户应直接在 binding 函数中读取 element 属性返回 by-value 对象。

## 不在范围

- 向 playwright 上游提 PR 恢复 handle 模式（API 设计取舍，超出 ohos-playwright 仓库职责）
- 在 ohos-playwright fixture 层 monkey-patch `exposeBinding` 提供 handle-like 语法糖（YAGNI，by-value 模式覆盖 90% 场景）

## 速查表

- 公开 API：`page.exposeBinding(name, callback)`（playwright 1.60）
- 注入点：`bindingsController.ts:50-65`（addBinding wrapper）
- 序列化器：`utilityScriptSerializers.ts:192-205`（Node → "ref: <Node>"）
- server dispatch：`page.ts:1033-1048`（bundle `coreBundle.js:20458-20465`）
- playwright-core 版本：1.60.0
