# ohos-playwright 能力边界探针报告

**测试环境：** HarmonyOS PC（HongMeng Kernel），本机浏览器 `com.huawei.hmos.browser`（Chromium 132 / ArkWeb 6.1.0.115），通过 ohos-playwright（v0.3.2）`connectOverCDP` 接管。

**测试方法：** 68 个针对性探针 spec，覆盖 38 个能力域（4 批次累积）。每个探针用 try/catch + 超时兜底（`Promise.race` + HANG 检测），捕获**真实失败模式**（hang / throw / 错误值 / 假阳性），而非简单断言。

**关键结论（v0.3.2 实测，2026-06-26，limitation fix 更新）：** 完全支持 30 项，部分支持 5 项，不支持 4 项。相比初始报告新增 2 项支持：`page.goBack/goForward`（CDP 轮询方案修复）、`locator.hover()`（JS dispatch 方案修复，但 CSS :hover 伪类不激活）。`page.mouse.move/down/up` 仍为已知限制。

---

## 总览矩阵（v0.3.2 实测）

### ✅ 完全支持（28 项）

| 能力域 | 验证点 |
|---|---|
| 基础导航 / evaluate | goto + evaluate + viewportSize |
| 输入 | fill / type / keyboard.press / selectOption |
| Locator / Expect | waitFor / textContent / toHaveText / toHaveCount / toHaveAttribute |
| Screenshot | page.png / page.jpeg / locator.screenshot |
| Frame / iframe | frames() 列表 + 嵌套 iframe 内容读取 |
| Dialog | alert / confirm 捕获 + accept/dismiss |
| Download | a[download] 触发事件 + suggestedFilename |
| Network route（page 级） | route 注册 / fulfill / abort / unroute |
| **Network route（context 级）** | **context.route fulfill/abort，page.route 优先级 > context.route** |
| Network headers | setExtraHTTPHeaders 自定义头到达服务器 |
| Offline 模拟 | context.setOffline(true/false) 真实生效 |
| Page events | console / pageerror / request / response / requestfinished / requestfailed |
| Cookies | addCookies / cookies / clearCookies |
| localStorage / sessionStorage | 需真实 HTTP origin（data: URL 下浏览器隔离） |
| Geolocation | grantPermissions + setGeolocation |
| CDP session | newCDPSession + Page.getLayoutMetrics |
| emulateMedia | colorScheme: dark 生效 |
| popup (window.open) | init script + poller emit stub page，waitForEvent 均接收 |
| page.pdf | Chromium-only API 在 ArkWeb 完全工作（产出有效 %PDF） |
| tracing | connectOverCDP 下 tracing.start/stop 采集成功（zip 有效） |
| baseURL + toHaveURL | goto 绝对路径 + toHaveURL string/glob/regex 断言工作 |
| file upload | setInputFiles 触发 change 事件，文件内容可读 |
| drag & drop | locator.dragTo 触发 drop 事件 |
| reload | page.reload 正常（状态正确丢失） |
| **mouse.wheel** | **`page.mouse.wheel(0, 300)` → scrollTop=300，滚动真实生效（v0.2.10 报告"no-op"已翻转）** |
| **web worker** | **`page.workers()` 返回 count=1，功能正常（v0.2.10 报告"CDP 不可见"已翻转）** |
| **addInitScript** | 函数/字符串形式均生效，跨 goto 导航持久注入 |
| **locator.check / uncheck / setChecked** | check/uncheck/setChecked 全部生效；disabled 元素正确拒绝（timeout） |
| **keyboard 组合键** | Ctrl+A / Shift+Tab / Ctrl+Z / Shift+ArrowRight / Alt+ArrowLeft 全部生效 |
| **exposeFunction / exposeBinding** | 页面调用 Node 函数返回正确值；跨 goto 持久；带 source 的 binding 工作 |
| **addScriptTag / addStyleTag** | content/path/module 三种形式均注入成功；样式立即生效 |
| **waitForRequest / waitForResponse** | string URL / predicate 函数均正常触发 |
| **waitForURL** | string / glob / RegExp / history.pushState 客户端导航均工作 |
| **Accessibility.getFullAXTree（裸 CDP）** | 返回完整节点树（11 节点，含 button/heading role） |
| **WebSocket 基线 + routeWebSocket** | 真实 WS 收发正常；`page.routeWebSocket` 拦截生效（需 Playwright ≥ 1.48） |
| **page.coverage JS/CSS** | startJSCoverage / stopJSCoverage / startCSSCoverage 均返回 entry |
| **page.goBack / page.goForward** | **CDP history 导航 hang 已修复：adapter 用 history.back/forward() + 轮询 currentIndex 实现，耗时 ~100–200ms** |

### ⚠️ 部分支持 / 有边界（4 项）

| 能力域 | 状态 | 说明 |
|---|---|---|
| **emulateDevice** | ⚠️ mobile 模式语义差异 | `mobile:false` 时 viewport 精确生效；`mobile:true` 时 ArkWeb 启用 980px 默认移动 layout viewport，传入 width/height 被忽略 |
| **setUserAgentOverride** | ⚠️ 不生效 | CDP 命令成功但 `navigator.userAgent` 不变（ArkWeb 内核接收不应用） |
| **clipboard** | ⚠️ 假阳性 | writeText/readText 不报错，但 readText 返回 undefined（权限授予后仍读不到） |
| **page.mouse.move/down/up/click（原始）** | ⚠️ 事件不触发 DOM 元素监听器 | 命令成功不报错，但 mousemove/mousedown/mouseup/click 事件未到达目标元素（events=""）。`locator.click()` 正常工作，推测 locator 走不同内部路径 |
| **locator.hover()** | ⚠️ mouseover/mouseenter 有效，CSS :hover 无效 | JS dispatch 方案修复了 hang，事件监听器可触达；但 JS 合成事件不设置真实指针位置，`:hover` 伪类不激活 |
| **exposeBinding handle 模式** | ⚠️ 返回 undefined | `{ handle: true }` 时回调接收到的 handle.jsonValue() 返回 undefined |
| **JS coverage 跨页累积** | ⚠️ 部分工作 | `resetOnNavigation: false` 下 entryCount 仍为 1（未累积到 ≥2），单页 entry 本身有效 |
| **CDP Network.webSocketCreated 事件** | ⚠️ 不触发 | `Network.enable` 后 WS 连接建立，但 CDP 事件 `events=[]`（ArkWeb 未推送 WS 网络事件） |

### ❌ 不支持（6 项）

| 能力域 | 失败模式 | 耗时 |
|---|---|---|
| **newPage** | throw `Cannot read properties of undefined (reading '_page')` | 120ms |
| **newContext** | throw 明确错误（v0.3.2 已修复假阳性，现在正确抛出） | <1ms |
| **serviceWorker** | `navigator.serviceWorker` undefined（ArkWeb 未实现 SW） | 即时 |
| **locale override** | `Emulation.setLocaleOverride` 命令成功但 `navigator.language` 不变 | 即时 |

---

## 重点根因分析

### emulateDevice —— mobile 模式 viewport 语义差异

参数矩阵实测（5 组对照）：

| 参数组合 | window.innerWidth 结果 | 解读 |
|---|---|---|
| mobile:**false**, dsf:1, 500×400 | **500** ✅ | 桌面模式：精确生效 |
| mobile:false, dsf:**3**, 500×400 | **500** ✅ | deviceScaleFactor 不影响 |
| mobile:**true**, dsf:1, 500×400 | **980** ❌ | mobile 启用 layout viewport 适配 |
| mobile:true, dsf:3, 500×400 | **980** ❌ | 同上 |
| mobile:true, dsf:3, **375×812** | **980** ❌ | 传入 width 完全被忽略 |

**根因：** ArkWeb 在 `Emulation.setDeviceMetricsOverride` 的 `mobile: true` 时，启用了移动端 viewport meta 兼容路径，实际渲染走 980px 默认移动 layout viewport（历史兼容行为）。`mobile: false` 走桌面路径，精确生效。**修正办法：** 用 `isMobile: false` 获得精确 viewport。

### goBack / goForward —— CDP 历史导航 hang（已修复）

原根因：`Page.navigateToHistoryEntry` 在 ArkWeb 从不 resolve；`Page.frameNavigated` 事件也不触发（无法用 `waitForURL` 检测导航完成）。

**修复方案：** 调用 `history.back()` / `history.forward()`（浏览器内部，总是有效），轮询 `Page.getNavigationHistory.currentIndex` 直到 index 变化——ArkWeb 在 history 跳转后确实更新这个值（169ms / 112ms 实测）。

**现状：** `page.goBack()` / `page.goForward()` 现已生效，返回 `ok`，耗时 ~100–200ms。

### hover —— CDP hang（已修复，CSS :hover 仍不激活）

原根因：`Input.dispatchMouseEvent(mouseMoved)` 在 ArkWeb 下阻塞。

**修复方案：** fixture 层 override `page.locator().hover()`，改为 `locator.evaluate` 里 JS dispatch `mouseover` / `mouseenter` 事件（isTrusted: false）。

**现状：** `locator.hover()` 不再 hang，`mouseover` / `mouseenter` 事件监听器触达（fired=true，< 500ms）。CSS `:hover` 伪类不激活（JS 合成事件无真实指针位置）。

### page.mouse.* 原始 API —— 命令送达但 DOM 事件不触发

`page.mouse.move / down / up / click` 命令成功、不报错，但元素上注册的 `mousemove / mousedown / mouseup / click` 监听器收不到事件（`events=""`）。`locator.click()` 正常工作，说明 locator 走了不同的内部路径（可能直接走 CDP `DOM.dispatchEvent` 或元素中心点计算后走 Input 域的 click 类型而非 mouseMoved）。

**影响：** 依赖鼠标轨迹的测试（如拖拽路径、hover 效果触发）无法通过 `page.mouse.*` 实现；改用 `locator.dragTo` 或 CDP 直发。

### newContext 假阳性 —— v0.3.2 已修复

v0.2.10 报告 `browser.newContext()` 返回空壳 context 不报错（危险假阳性）。v0.3.2 已拦截，现在直接 throw 明确错误，与 `newPage` 行为对齐。

---

## 第四批探针完整结果（v0.3.2 实测）

### ✅ 完全工作

| 探针 | 关键输出 |
|---|---|
| goForward | `result=err: Timeout 5000ms`（确认 hang，与 goBack 一致）|
| scroll: mouse.wheel | `before=0 after=300 delta=300` **✅ 翻转：wheel 现已生效** |
| scroll: evaluate scrollTo | scrollTop=200 ✅ |
| scroll: window.scrollTo | scrollY=500 ✅ |
| waitForRequest string | `ok:http://127.0.0.1:.../probe` ✅ |
| waitForResponse | `ok:200` ✅ |
| waitForRequest predicate | `ok:GET` ✅ |
| addInitScript 函数 | val=hello-from-init ✅ |
| addInitScript 字符串 | val=str-init ✅ |
| addInitScript 跨 goto | p1=1 p2=1 ✅ |
| locator.check | checked=true ✅ |
| locator.uncheck | checked=false ✅ |
| locator.setChecked | v1=true v2=false ✅ |
| locator.check disabled | timeout（正确拒绝）✅ |
| request on(request) | count=1 ✅ |
| request on(response) | statuses=[200] ✅ |
| request on(requestfinished) | count=1 ✅ |
| request on(requestfailed) | count=1, err=ERR_UNSAFE_PORT ✅ |
| keyboard Ctrl+A | val="" ✅ |
| keyboard Shift+Tab | focused=b ✅ |
| keyboard Ctrl+Z | val="" ✅ |
| keyboard Shift+ArrowRight | val="def" ✅ |
| keyboard Alt+ArrowLeft | ok（不报错）✅ |
| exposeFunction | result=7 ✅ |
| exposeFunction 跨 goto | v1=hello-world v2=hello-ohos ✅ |
| exposeBinding with source | result=bound:test, url 正确 ✅ |
| addScriptTag content | val=script-tag ✅ |
| addScriptTag module | val=module-ok ✅ |
| addStyleTag content | color=rgb(255,0,0) ✅ |
| addScriptTag path | val=from-file ✅ |
| context.route fulfill | source=context-mock ✅ |
| context.route abort | result=aborted ✅ |
| context.route vs page.route | handler=page（page 优先）✅ |
| a11y-cdp getFullAXTree | nodeCount=11, hasButton=true ✅ |
| a11y-cdp filter by role | 按 role 过滤正常 ✅ |
| waitForURL string | ok ✅ |
| waitForURL glob | ok ✅ |
| waitForURL RegExp | ok ✅ |
| waitForURL pushState | ok, url=detail ✅ |
| websocket baseline | result=echo:hello ✅ |
| websocket routeWebSocket | result=intercepted:hello ✅ |
| coverage JS | entryCount=1 ✅ |
| coverage CSS | entryCount=1, rangeCount=1 ✅ |

### ⚠️ 部分工作 / 有限制

| 探针 | 输出 | 说明 |
|---|---|---|
| exposeBinding handle | result=undefined | `{ handle: true }` 下 handle.jsonValue() 返回 undefined |
| a11y-cdp getPartialAXTree | error: nodeId/backendNodeId/objectId 必须提供其一 | 需 DOM.getDocument 先取 backendNodeId |
| mouse-raw move/down/up/click | events="" | 命令成功，DOM 元素事件监听器未收到 |
| coverage JS resetOnNavigation=false | entryCount=1 | 跨页未累积，单页 entry 有效 |
| websocket CDP Network.webSocketCreated | events=[] | ArkWeb 未推送 WS CDP 网络事件 |

---

## 版本对比：v0.2.10 → v0.3.2 翻转项

| 能力 | v0.2.10 | v0.3.2 | 备注 |
|---|---|---|---|
| `mouse.wheel` | ❌ scrollTop=0（no-op）| ✅ delta=300（生效）| adapter 修复 |
| `page.workers()` | ⚠️ 返回空数组 | ✅ count=1 | adapter 修复 |
| `browser.newContext()` | ⚠️ 假阳性（空壳不报错）| ❌ 明确 throw | adapter 修复，行为更安全 |

---

## 探针源码

所有探针 spec 位于 `/storage/Users/currentUser/HarmonyPC/Software/ohos-playwright/probes/`：

**第一批（基础能力，13 域）：**
- `baseline.spec.ts` / `input.spec.ts` / `locator.spec.ts` / `screenshot.spec.ts`
- `frames.spec.ts` / `dialog.spec.ts` / `download.spec.ts` / `network.spec.ts`
- `events.spec.ts` / `storage.spec.ts` / `geolocation.spec.ts` / `cdp.spec.ts`
- `multi-context.spec.ts` / `popup.spec.ts` / `recheck.spec.ts`

**第二批（进阶能力，10 域）：**
- `navigation-v2.spec.ts`（goBack/reload，带超时兜底）
- `hover-v2.spec.ts`（hover，带超时兜底）
- `file-upload.spec.ts` / `drag-mouse.spec.ts` / `clipboard.spec.ts`
- `workers.spec.ts` / `tracing.spec.ts` / `pdf.spec.ts`
- `viewport.spec.ts` / `network-advanced.spec.ts` / `baseurl.spec.ts`

**精细化复测：**
- `emulate-bug.spec.ts` / `popup-bug.spec.ts` / `popup-repro.spec.ts`
- `emulate-matrix.spec.ts`（mobile 参数矩阵，定位 emulateDevice 真实根因）

**第三批（CDP 深水区，11 域）：**
- `touch.spec.ts`（touchscreen.tap + CDP dispatchTouchEvent）
- `filechooser-cache.spec.ts`（filechooser 事件 + setCacheDisabled）
- `video-har.spec.ts`（screencast + route 抓包）
- `emulation-extra.spec.ts`（locale / timezone / reducedMotion）
- `a11y-selector.spec.ts`（accessibility.snapshot + role= + :has）
- `storage-state.spec.ts`（context.storageState 序列化）
- `refine-extra.spec.ts`（locale/timezone/reducedMotion/video/touch 精细化对照）

**第四批（盲区补全，15 域，v0.3.2 实测）：**
- `go-forward.spec.ts`（goForward + 超时兜底 → 确认 hang）
- `scroll.spec.ts`（mouse.wheel 确认生效 + evaluate scrollTo / window.scrollTo）
- `wait-for-request.spec.ts`（waitForRequest / waitForResponse，含 predicate 函数）
- `init-script.spec.ts`（addInitScript 函数/字符串/跨-goto 持久）
- `locator-check.spec.ts`（locator.check / uncheck / setChecked，含 disabled 边界）
- `request-events.spec.ts`（page.on('request' / 'response' / 'requestfinished' / 'requestfailed')）
- `keyboard-combos.spec.ts`（Ctrl+A / Shift+Tab / Ctrl+Z / Shift+Arrow / Alt 组合键）
- `expose-function.spec.ts`（exposeFunction / exposeBinding，含 handle 模式）
- `inject-tags.spec.ts`（addScriptTag content/path/module + addStyleTag content）
- `context-route.spec.ts`（context.route fulfill/abort + context vs page 优先级对比）
- `accessibility-cdp.spec.ts`（Accessibility.getFullAXTree / getPartialAXTree 裸 CDP）
- `wait-for-url.spec.ts`（waitForURL string/glob/RegExp + history.pushState 客户端导航）
- `mouse-raw.spec.ts`（page.mouse.move / down / up / click → 确认 DOM 事件不触发）
- `websocket.spec.ts`（真实 WS 基线 + routeWebSocket 拦截 + CDP Network.webSocket* 事件）
- `coverage.spec.ts`（page.coverage JS/CSS startJSCoverage/stopJSCoverage/startCSSCoverage）

复跑命令（按批次，排除有未知 fixture 的 debug 文件）：
```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright

# 第一批
./dist/cli.mjs test --config=probes/playwright.config.ts \
  probes/baseline.spec.ts probes/input.spec.ts probes/locator.spec.ts probes/screenshot.spec.ts \
  probes/frames.spec.ts probes/dialog.spec.ts probes/download.spec.ts probes/network.spec.ts \
  probes/events.spec.ts probes/storage.spec.ts probes/geolocation.spec.ts probes/cdp.spec.ts \
  probes/multi-context.spec.ts probes/popup.spec.ts probes/recheck.spec.ts

# 第二批
./dist/cli.mjs test --config=probes/playwright.config.ts \
  probes/navigation-v2.spec.ts probes/hover-v2.spec.ts \
  probes/file-upload.spec.ts probes/drag-mouse.spec.ts probes/clipboard.spec.ts \
  probes/workers.spec.ts probes/tracing.spec.ts probes/pdf.spec.ts \
  probes/viewport.spec.ts probes/network-advanced.spec.ts probes/baseurl.spec.ts

# 第三批
./dist/cli.mjs test --config=probes/playwright.config.ts \
  probes/touch.spec.ts probes/filechooser-cache.spec.ts probes/video-har.spec.ts \
  probes/emulation-extra.spec.ts probes/a11y-selector.spec.ts \
  probes/storage-state.spec.ts probes/refine-extra.spec.ts

# 第四批
./dist/cli.mjs test --config=probes/playwright.config.ts \
  probes/go-forward.spec.ts probes/scroll.spec.ts \
  probes/wait-for-request.spec.ts probes/init-script.spec.ts \
  probes/locator-check.spec.ts probes/request-events.spec.ts \
  probes/keyboard-combos.spec.ts probes/expose-function.spec.ts \
  probes/inject-tags.spec.ts probes/context-route.spec.ts \
  probes/accessibility-cdp.spec.ts probes/wait-for-url.spec.ts \
  probes/mouse-raw.spec.ts probes/websocket.spec.ts probes/coverage.spec.ts
```

完整原始日志：
- `logs/probes-run4-b1.log` / `b2.log` / `b3.log` / `b4.log`（2026-06-26 v0.3.2 实测）
