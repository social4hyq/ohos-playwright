# ohos-playwright 能力边界探针报告

**测试环境：** HarmonyOS PC（HongMeng Kernel），本机浏览器 `com.huawei.hmos.browser`（Chromium 132 / ArkWeb 6.1.0.115），通过 ohos-playwright（v0.3.2）`connectOverCDP` 接管。

**测试方法：** 68 个针对性探针 spec，覆盖 38 个能力域（4 批次累积）。每个探针用 try/catch + 超时兜底（`Promise.race` + HANG 检测），捕获**真实失败模式**（hang / throw / 错误值 / 假阳性），而非简单断言。

**关键结论（v0.3.2 实测，2026-06-26，limitation fix + HTTPS A/B 验证更新）：** 完全支持 33 项，部分支持 5 项，不支持 1 项。相比初始报告新增 5 项支持：`page.goBack/goForward`、`locator.hover()`（事件触达）、`emulateLocale` fixture、**Service Workers（HTTPS 安全上下文）**、**Clipboard write/read（HTTPS 安全上下文）**。`page.mouse.move/down/up` 从"不支持"降为窄边界场景（仅在 data: URL + 换行 + 共享函数引用组合下失败）。

---

## 2026-06-27 复审更新（Limitations 重审）

新增 4 个跨引擎 A/B 探针（`ua-header-http` / `ab-mouse` / `ab-hover-css` / `ab-new-context`），连接 ArkWeb 132 + Edge 149 (Windows LAN) 双腿对照。**4 项原判定被推翻或细化**，详见 `docs/superpowers/reports/2026-06-27-limitations-reaudit.md`：

| # | 原判定（2026-06-26） | 复审实证（2026-06-27） | 处置 |
|---|---|---|---|
| L1 newContext | ArkWeb 根本性，抛错 | `browser.newContext()` 实际成功（pages=0），仅 `ctx.newPage()` 抛 `_page` 错；根因是 ArkWeb 把 `Target.createTarget` 创建的 target 标为 `type:'other'` 而非 `'page'`，playwright `_onAttachedToTarget` 跳过 | README 已更正；默认 fixture 拦截抛友好错误；**opt-in `PW_CHROMIUM_ATTACH_TO_OTHER=1` env 可让 newPage/goto/evaluate 全恢复**（详见 `docs/superpowers/reports/2026-06-27-newpage-breakthrough.md`） |
| L2 HTTP UA | 不可改，ArkWeb 根本性 | `Emulation.setUserAgentOverride` 实测**改了** HTTP UA header（旧结论基于 `page.route` 拦截，是误测——拦截发生在 network stack 早期，UA override 还未应用）| README 已更正 |
| L3 page.mouse.\* | 不触发 DOM 事件（窄边界） | ArkWeb 132 上 `mousemove/mousedown/mouseup/click` **全部触发**；与 Edge 149 一致 | README 已更正（窄边界描述移除） |
| L4 :hover 伪类 | 根本性，JS dispatch 副作用 | fixture 已重写为 `boundingBox + page.mouse.move` 走真实 CDP Input 路径；`:hover` 现在**激活=true**；boundingBox hang 时 fallback JS dispatch | README 已更正；fixture.mts 已更新 |
| L5 exposeBinding handle | 需 vendored fork | playwright 1.60 公开 API 已无 `{ handle: true }` 选项（`client/page.ts:360` 签名只有 name + callback）；Edge 上同样返回 undefined | 详见 `docs/superpowers/reports/2026-06-26-exposebinding-handle-fork-eval.md` |
| L6 process.platform | 已有折中 | 维持；新增 `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-arm64` env 作双保险（注释说明 env 单独不够——20+ 处直读 process.platform）| register.mts 已更新 |

**下表与下文保留 2026-06-26 原始判定作为历史记录。最新状态以上表和 README 为准。**

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
| **clipboard** | ⚠️ 不可用 | `navigator.clipboard` 为 `undefined`（writeText/readText 调用直接 throw；权限授予无效） |
| **page.mouse.move/down/up/click（原始）** | ⚠️ 事件不触发 DOM 元素监听器 | 命令成功不报错，但 mousemove/mousedown/mouseup/click 事件未到达目标元素（events=""）。`locator.click()` 正常工作，推测 locator 走不同内部路径 |
| **locator.hover()** | ⚠️ mouseover/mouseenter 有效，CSS :hover 无效 | JS dispatch 方案修复了 hang，事件监听器可触达；但 JS 合成事件不设置真实指针位置，`:hover` 伪类不激活 |
| **exposeBinding handle 模式** | ⚠️ 返回 undefined | `{ handle: true }` 时回调接收到的 handle.jsonValue() 返回 undefined |
| **JS coverage 跨页累积** | ⚠️ 部分工作 | `resetOnNavigation: false` 下 entryCount 仍为 1（未累积到 ≥2），单页 entry 本身有效 |
| **CDP Network.webSocketCreated 事件** | ⚠️ 不触发 | `Network.enable` 后 WS 连接建立，但 CDP 事件 `events=[]`（ArkWeb 未推送 WS 网络事件） |

### ⚠️ 部分支持（新增项）

| 能力域 | 状态 | 说明 |
|---|---|---|
| **emulateLocale** | ⚠️ JS 层有效，HTTP/UI 无效 | `emulateLocale(tag)` fixture 通过 `addInitScript` 改写 `navigator.language` / `navigator.languages`（PASS）；`Emulation.setLocaleOverride` CDP 命令被 ArkWeb 忽略；HTTP `Accept-Language` 和浏览器 UI 语言不受影响 |

### ❌ 不支持（3 项）

| 能力域 | 失败模式 | 耗时 |
|---|---|---|
| **newPage** | throw `Cannot read properties of undefined (reading '_page')` | 120ms |
| **newContext** | throw 明确错误（v0.3.2 已修复假阳性，现在正确抛出） | <1ms |
| **serviceWorker（非安全上下文）** | `navigator.serviceWorker` undefined（`data:` / `about:blank` 是非安全上下文，所有浏览器均不暴露；HTTPS 下正常工作）| 即时 |

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

## Limitations 最终可行性判定（2026-06-26 收尾）

**方法：** 对每项 limitation 追踪 playwright-core 内部调用链（`node_modules/playwright-core/lib/`）定位 CDP 命令发送点，结合本仓库已交付的探针实证数据（A/B baseline + HTTPS A/B + UA-override 直发 CDP），给出本仓库对每项的最终处置决定。

| # | Limitation | playwright-core 调用点 | 判定 | 本仓库处置 |
|---|---|---|---|---|
| 1 | `newContext` / `newPage` 抛错 | `crBrowser.ts:111` Target.createBrowserContext | **ArkWeb 根本性**（Target domain 无 createBrowserContext / createTarget）| 仅文档化 |
| 2 | `setUserAgentOverride` 时序问题 | `crPage.ts:997` Emulation.setUserAgentOverride | **判定更正**：ArkWeb 实际执行 UA override，**但只对下一次 `page.goto()` 生效**（不改写当前已加载页的 `navigator.userAgent`）。HTTP User-Agent header 不受影响（Network domain UA override 对出站请求头无效）。`emulateDevice({ userAgent })` 后跟 `page.goto()` 即可得到修改后的 UA | 已文档化；fixture 注释已更正；HTTP 层无法修复（ArkWeb 根本性）|
| 3 | `page.mouse.*` 不触发 DOM 事件 | `crInput.ts:106-157` Input.dispatchMouseEvent | **ArkWeb 根本性**（Input domain 鼠标事件不传递至 DOM）；仅 data: URL + 换行 + 共享函数引用这一窄边界在正常页面也失败 | 仅文档化；JS-synth fallback fixtures 已交付 |
| 4 | `locator.hover()` 不激活 CSS `:hover` | `dom.ts:537` → 同上 crInput 路径 | **ArkWeb 根本性**（CSS `:hover` 需真实指针位置）| 仅文档化（已交付 mouseover/mouseenter 触达修复）|
| 5 | `exposeBinding({ handle: true })` undefined | `server/page.ts:1033-1046` PageBinding.dispatch 忽略 handle | **必须 vendored playwright-core fork**（binding dispatch 是 server 内部，adapter 拦不住）| **本仓库不做**——用户后续单开计划 |
| 6 | `process.platform === 'linux'` 兜底 | `crPage.ts:940-944`、`registry/index.ts` | Node 级 patch 已在位（`process.env.OHOS_PW_HOST`）；干净修法需上游合并 OpenHarmony 平台检测 | 维持现状 |

**汇总：** 6 项中，3 项 ArkWeb 根本性（任何层都补不了），1 项需 vendored core fork（#5），1 项已有 Node 级折中（#6），1 项判定更正为"时序限制而非根本性缺陷"（#2）。本仓库不承担 playwright-core fork。

**已经从 limitation 摘除的项**（A/B 实证为非缺陷或大幅收窄）：

| 旧条目 | 实证 | 现状 |
|---|---|---|
| Service Workers undefined | HTTPS A/B（`probes/ab-https.spec.ts`）：ArkWeb 完整暴露 SW API，`register()` 返回与 Chrome 同样的 TypeError | ✅ Supported（HTTPS 安全上下文）|
| Clipboard 不可用 | HTTPS A/B + grantPermissions：`writeText`/`readText` 返回 `ok:ohos-pw-test` | ✅ Supported（HTTPS + grantPermissions）|
| mouse.move/down/up 不触发 DOM | 二分定位（`probes/mouse-var-vs-const.spec.ts`）：仅在 data: URL（含换行）+ 共享函数引用注册多事件类型时静默失败 | ⚠️ 窄边界（README 已改述）|
| setLocaleOverride 被忽略 | ArkWeb CDP 命令无效，但 `addInitScript` 可改写 JS 层 `navigator.language` / `languages` | ⚠️ 已修（emulateLocale fixture）|

---

## 跨引擎 A/B baseline（ArkWeb vs 局域网 Chrome）

**工具：** `probes/ab-baseline.spec.ts`，通过 `OHOS_PW_CDP_URL` 环境变量切换目标引擎。Chrome 腿从非 OpenHarmony 宿主执行（loader 不挂 fixture override，等价于 stock playwright）。

**实测对比（2026-06-26，ArkWeb 132 / Edge 149 on Windows LAN via OHOS_PW_CDP_URL）：**

非安全上下文（`data:` / `about:blank`）探针：

| 探针 | ArkWeb 132 | Edge 149 | 结论 |
|---|---|---|---|
| `navigator.userAgent` | `ArkWeb/6.1.0.117...` | `Edg/149.0.0.0...` | 均正常 |
| `navigator.language` | `zh-CN` | `zh-CN` | 均正常 |
| `ServiceWorkerContainer`（data: URL）| `undefined` | `undefined` | ⚠️ 非安全上下文两边均不暴露，无区分度 |
| `Clipboard`（data: URL）| `undefined` | `undefined` | ⚠️ 同上 |
| `Input.dispatchMouseEvent`（独立内联函数）| `mousemove mousedown` ✅ | `mousemove mousedown` ✅ | 两边均可 |

HTTPS 安全上下文探针（`https://www.baidu.com`）：

| 探针 | ArkWeb 132 | Edge 149 | 结论 |
|---|---|---|---|
| `ServiceWorkerContainer` | `function` ✅ | `function` ✅ | **ArkWeb 实现了 SW API** |
| `navigator.serviceWorker` | `true` ✅ | `true` ✅ | HTTPS 下均可访问 |
| `sw.register()`（文件不存在）| `TypeError`（同 Edge）✅ | `TypeError` ✅ | ArkWeb SW API 工作，只是文件不存在 |
| `clipboard.writeText+readText` | `ok:ohos-pw-test` ✅ | `ok:` (空，剪贴板隔离) | **ArkWeb clipboard 完整工作** |

*ArkWeb 腿日志：`logs/ab-arkweb.log`。Edge 腿通过 `OHOS_PW_CDP_URL=http://192.168.3.60:9222` 在同一宿主运行。*

UA-override 直发 CDP 探针（`probes/ua-override.spec.ts`）：

| 探针 | ArkWeb 132 | Edge 149 | 结论 |
|---|---|---|---|
| `Emulation.setUserAgentOverride` → `navigator.userAgent` | `matches=true` ✅ | `matches=true` ✅ | **两边均生效**（navigate 后读取）|
| `Network.setUserAgentOverride` → `navigator.userAgent` | `matches=true` ✅ | `matches=true` ✅ | 两边均生效 |
| `Network.setUserAgentOverride` → HTTP User-Agent header | `""` ❌ | `matches=true` ✅ | ArkWeb 不改出站请求头；Edge 正常 |

*日志：`logs/ua-override-arkweb.log` / `logs/ua-override-edge.log`。*

**结论：** ArkWeb 对 `Emulation.setUserAgentOverride` 和 `Network.setUserAgentOverride` 均执行 JS 层 `navigator.userAgent` 改写，但要求发出命令后执行一次 `page.goto()`（navigate-to-apply 语义）。原文档"UA 被忽略"的结论是错误的——实为时序问题。HTTP 层 User-Agent 无法通过 CDP 改变（ArkWeb 根本性限制）。

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

**第五批（limitations audit + A/B 对比验证，2026-06-26）：**
- `ab-baseline.spec.ts`（跨引擎 A/B baseline：userAgent / language / serviceWorker / clipboard / mouse DOM 事件；两条腿通过 `OHOS_PW_CDP_URL` 切换）
- `locale.spec.ts`（emulateLocale fixture：addInitScript 改写 navigator.language / languages；PASS on ArkWeb）

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

---

## 第五批：跨引擎 A/B 覆盖补全（v0.3.5，2026-06-27）

**目标**：验证此前未覆盖的 API 域——`toHaveScreenshot`、`APIRequestContext`、`addLocatorHandler`、`httpCredentials`、`proxy`、`emulateMedia` 全选项、`context.recordVideo`。双腿对比：ArkWeb（本机 132）+ Edge（Windows 149）。

### 结果汇总

| 探针 | ArkWeb | Edge | 说明 |
|---|---|---|---|
| `ab-visual-screenshot` | ✅ 3/3 | ✅ 3/3 | `toHaveScreenshot` / 元素截图 / buffer 非空均通过。需 `SNAPSHOT_ENGINE=arkweb/edge` 区分基线目录（platform shim 导致两引擎用相同文件名 `*-linux.png`）|
| `ab-api-request` | ✅ 3/3 | ✅ 3/3 | `request` fixture GET/POST、`playwright.request.newContext()` 独立上下文均通过。服务端运行在 Node.js（test runner），与浏览器解耦 |
| `ab-locator-handler` | ✅ 2/2 | ✅ 2/2 | `page.addLocatorHandler()` 自动 dismiss overlay 正常工作；`removeLocatorHandler` 后不再触发 |
| `ab-emulate-media-full` | ✅ 8/8 | ✅ 8/8 | `reducedMotion` / `forcedColors` / `media` / `colorScheme` + 组合均生效；各个 `@media` 查询返回正确值 |
| `ab-proxy` | ✅ 3/3 | ✅ 3/3 | `page.route() fulfill`（代理拦截）/ `route.continue` 等效（modify header）均通过。`launchOptions.proxy` 已记录不支持（CDP attach 无 launch 阶段）|
| `ab-http-credentials` | ✅ 2/2 | ✅ 2/2 | ArkWeb：with-creds `status=200 authed=true`，no-creds `status=401`。Edge：with-creds `status=200 authed=true`，no-creds `ERR_INVALID_AUTH_CREDENTIALS`（Edge 弹 auth dialog 而非返回 401，行为差异已记录）|
| `ab-video-context` | ✅ 2/2 | ✅ 2/2 | `page.video() is null without recordVideo` 两引擎均通过。`recordVideo` 均不完整支持：ArkWeb = `"Video recording has not been started."`（ArkWeb 不实现 `Page.startScreencast`）；Edge = ffmpeg `EACCES`（HarmonyOS 执行 ffmpeg-linux 需签名）|

### 关键发现

**httpCredentials + page.route() 冲突**：两者底层都调用 `Fetch.enable`，同时使用时凭据注入失效（auth 字段为空）。探针改用真实 HTTP server（`0.0.0.0`）避免冲突；跨机 Edge 场景浏览器用 HarmonyOS LAN IP `172.16.100.1` 访问。

**Edge 跨机 Basic Auth 行为**：Edge 在无凭据时收到 401 + `WWW-Authenticate` 后，会弹出凭据对话框，Playwright 捕获为 `ERR_INVALID_AUTH_CREDENTIALS`（thrown）而非 response status=401。ArkWeb 则直接返回 status=401 响应对象。

**context.recordVideo 不可用于生产**：
- ArkWeb：CDP `Page.startScreencast` 未实现
- Edge via HarmonyOS runner：ffmpeg 二进制需 HarmonyOS 签名才可执行（`EACCES`）

**跨引擎 A/B 基线隔离**：`process.platform = 'linux'` shim（`src/register.mts`）导致两引擎截图基线文件名相同（`*-linux.png`）。用 `SNAPSHOT_ENGINE=arkweb/edge` + `probes/playwright.config.ts` 中的 `snapshotDir` 分离。

**ctx.close() / browser.close() 在 connectOverCDP 模式下可能 hang**：原始 CDP attach 探针（`ab-http-credentials`、`ab-video-context`）需用 `Promise.race(..., timeout)` 包裹关闭操作，否则 Edge 场景 30s 超时。

### 运行命令

```bash
# ArkWeb
OHOS_PW_HOST=1 PW_CHROMIUM_ATTACH_TO_OTHER=1 ./dist/cli.mjs test \
  --config=probes/playwright.config.ts \
  probes/ab-visual-screenshot.spec.ts probes/ab-api-request.spec.ts \
  probes/ab-locator-handler.spec.ts probes/ab-emulate-media-full.spec.ts \
  probes/ab-proxy.spec.ts probes/ab-http-credentials.spec.ts \
  probes/ab-video-context.spec.ts

# Edge
OHOS_PW_CDP_URL=http://172.16.100.2:9222 PW_CHROMIUM_ATTACH_TO_OTHER=1 ./dist/cli.mjs test \
  --config=probes/playwright.config.ts \
  probes/ab-visual-screenshot.spec.ts probes/ab-api-request.spec.ts \
  probes/ab-locator-handler.spec.ts probes/ab-emulate-media-full.spec.ts \
  probes/ab-proxy.spec.ts probes/ab-http-credentials.spec.ts \
  probes/ab-video-context.spec.ts
```

---

## 第六批：Phase 2 条件性探针（v0.5.0，2026-06-27）

**目标**：验证 `fixture.mts` 三处 workaround 在 ArkWeb / Edge 现状下是否仍然必要。ArkWeb 双腿均验证；Edge（172.16.100.2）因网络中断在本批次不可达（HTTP timeout）——早先同会话 Edge 数据补充说明。

### 结果汇总

| 探针 | ArkWeb | Edge | 决策 |
|---|---|---|---|
| `ab-newcontext-cookies` | ✅ 1/1 `newContext=ok cookies=ok storage=ok newPage=throw:_page` | 机器离线（网络中断） | **已删除 newContext 拦截**（v0.5.0 BREAKING） |
| `ab-pageerror` | ✅ 2/2 `native-fired=false` / `with-wrapper-fired=true` | 机器离线 | **保留 wrapper**（CDP 不转发 evaluate 异常为 pageerror） |
| `ab-locale-cdp` | ✅ 2/2 `matches=false CDP ignored` / `initScript matches=true` | 早先验证 `matches=false`（同结论） | **保留 emulateLocale fixture**（CDP 命令被 ArkWeb 忽略） |

### 关键发现

**newContext 拦截已不必要（删除）**：探针证明 `browser.newContext()` + `addCookies` / `storageState()` 在 connectOverCDP 模式下无需 `PW_CHROMIUM_ATTACH_TO_OTHER` 即可工作。受限的是 `ctx.newPage()`（ArkWeb 返回 `type='other'` 目标导致 `_page undefined`），而非 `newContext()` 本身。移除拦截后用户得到 Playwright 的自然错误而非 ohos-playwright 的友好消息。

**evaluate wrapper 仍需保留**：ArkWeb CDP 将 `evaluate()` 内的 `throw` 处理为 Promise rejection，不触发 `Runtime.exceptionThrown` / `pageerror` 事件。`addScriptTag` 注入的窗口级 uncaught error 则正常触发 pageerror，说明 ArkWeb 的 `Runtime.exceptionThrown` 本身正常，只是 evaluate 的异常路径有别于浏览器原生执行。

**emulateLocale CDP 路径仍无效**：`Emulation.setLocaleOverride` 被 ArkWeb ack 但实际不改变 `navigator.language`（返回原始系统语言 `zh-CN`）。`addInitScript` 覆盖路径（fixture 现行实现）正常工作，保留。

### Phase 2 净 LOC 削减

仅 2.1（newContext 拦截）成功落地：-24 行（`fixture.mts` 从 408 行降至 ~384 行）。2.2 和 2.3 保留待上游 ArkWeb 修复。

### 运行命令

```bash
# ArkWeb（全部通过）
OHOS_PW_HOST=1 ./dist/cli.mjs test --config=probes/playwright.config.ts \
  probes/ab-newcontext-cookies.spec.ts probes/ab-pageerror.spec.ts \
  probes/ab-locale-cdp.spec.ts
```
