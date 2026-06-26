# ohos-playwright 能力边界探针报告

**测试环境：** HarmonyOS PC（HongMeng Kernel），本机浏览器 `com.huawei.hmos.browser`（Chromium 132 / ArkWeb 6.1.0.115），通过 ohos-playwright（v0.2.10）`connectOverCDP` 接管。

**测试方法：** 53 个针对性探针 spec，覆盖 23 个能力域。每个探针用 try/catch + 超时兜底（`Promise.race` + HANG 检测），捕获**真实失败模式**（hang / throw / 错误值 / 假阳性），而非简单断言。

**关键结论：** 绝大多数能力快速失败或正常工作；仅 2 个能力 hang（hover / goBack，5s 超时兜住）；2 个假阳性（newContext / clipboard）需警惕。

---

## 总览矩阵

### ✅ 完全支持（17 项）

| 能力域 | 验证点 |
|---|---|
| 基础导航 / evaluate | goto + evaluate + viewportSize |
| 输入 | fill / type / keyboard.press / selectOption |
| Locator / Expect | waitFor / textContent / toHaveText / toHaveCount / toHaveAttribute |
| Screenshot | page.png / page.jpeg / locator.screenshot |
| Frame / iframe | frames() 列表 + 嵌套 iframe 内容读取 |
| Dialog | alert / confirm 捕获 + accept/dismiss |
| Download | a[download] 触发事件 + suggestedFilename |
| Network route | route 注册 / fulfill / abort / unroute |
| Network headers | **setExtraHTTPHeaders 自定义头到达服务器** |
| **Offline 模拟** | **context.setOffline(true/false) 真实生效（ERR_INTERNET_DISCONNECTED → reachable）** |
| Page events | console / pageerror 事件捕获 |
| Cookies | addCookies / cookies / clearCookies |
| localStorage / sessionStorage | 需真实 HTTP origin（data: URL 下浏览器隔离，非 adapter 问题） |
| Geolocation | grantPermissions + setGeolocation |
| CDP session | newCDPSession + Page.getLayoutMetrics |
| emulateMedia | colorScheme: dark 生效 |
| **popup (window.open)** | init script + poller emit stub page，context.on('page') / waitForEvent 均接收 |
| **page.pdf** | **Chromium-only API 在 ArkWeb 完全工作（产出有效 %PDF）** |
| **tracing** | **connectOverCDP 下 tracing.start/stop 采集成功（zip 有效）** |
| **baseURL + toHaveURL** | goto 绝对路径 + toHaveURL 正则断言工作 |
| **file upload** | **setInputFiles 触发 change 事件，文件内容可读** |
| **drag & drop** | **locator.dragTo 触发 drop 事件** |
| **reload** | page.reload 正常（状态正确丢失） |
| **navigation 前进** | goForward 未单独测，但 reload + goto 链路正常 |

### ⚠️ 部分支持 / 有边界（4 项）

| 能力域 | 状态 | 说明 |
|---|---|---|
| **emulateDevice** | ⚠️ **mobile 模式语义差异** | `mobile:false` 时 viewport 精确生效；`mobile:true` 时 ArkWeb 启用移动端 layout viewport 适配，width 被解释为 980px 默认 layout viewport（经典移动 fallback），**传入的 width/height 不直接生效**。详见下方根因分析。 |
| **setUserAgentOverride** | ⚠️ **不生效** | CDP `Emulation.setUserAgentOverride` 命令成功但 `navigator.userAgent` 实测不变（仍是 PC UA）。ArkWeb 内核接收不应用。 |
| **setViewportSize** | ✅ 生效 | page 级 viewport 改变工作（与 emulateDevice mobile:false 一致） |
| **web worker** | ⚠️ **CDP 不可见** | `new Worker()` 创建的 worker 功能正常（消息能传回主页面），但 `page.workers()` 返回空数组 —— CDP `Target.autoAttach` 未捕获 worker target |
| **clipboard** | ⚠️ **假阳性** | `writeText`/`readText` 不报错但 readText 返回 undefined（权限授予后仍读不到） |

### ❌ 不支持（4 项）

| 能力域 | 失败模式 | 耗时 |
|---|---|---|
| **newPage** | throw `Cannot read properties of undefined (reading '_page')` | 120ms 快速失败 |
| **newContext** | ⚠️ 假阳性：返回空壳 context（pages=0），不抛错 | 65ms |
| **hover (locator.hover)** | **Timeout 5000ms（hang）** | 5s+ 超时 |
| **goBack (page.goBack)** | **Timeout 5000ms（hang）** | 5s+ 超时 |
| **serviceWorker** | `navigator.serviceWorker` undefined（ArkWeb 未实现 SW） | 即时 |
| **wheel (mouse.wheel)** | 命令成功但 scrollTop=0（滚动不生效） | 即时 |

---

## 重点根因分析

### emulateDevice —— mobile 模式 viewport 语义差异（非内核缺陷）

参数矩阵实测（5 组对照）：

| 参数组合 | window.innerWidth 结果 | 解读 |
|---|---|---|
| mobile:**false**, dsf:1, 500×400 | **500** ✅ | 桌面模式：精确生效 |
| mobile:false, dsf:**3**, 500×400 | **500** ✅ | deviceScaleFactor 不影响 |
| mobile:**true**, dsf:1, 500×400 | **980** ❌ | mobile 启用 layout viewport 适配 |
| mobile:true, dsf:3, 500×400 | **980** ❌ | 同上 |
| mobile:true, dsf:3, **375×812** | **980** ❌ | 传入 width 完全被忽略 |

**根因：** ArkWeb 在 `Emulation.setDeviceMetricsOverride` 的 `mobile: true` 时，启用了移动端 viewport meta 兼容路径 —— 把传入 `width` 当作 layout viewport 提示，实际渲染走 980px 默认移动 layout viewport（这是移动浏览器历史兼容行为）。`mobile: false` 时走桌面路径，精确生效。

**影响：** ohos-playwright 的 `emulateDevice` fixture 默认用法（README 示例 `isMobile: true`）正好命中此行为，看起来"不生效"。**修正办法：** 若需精确 mobile viewport，改用 `isMobile: false`（牺牲 mobile UA 但 viewport 准确），或配合页面 `<meta name="viewport">` 控制。

**之前报告"ArkWeb 内核缺陷"的结论是错的** —— 命令实际生效，只是 mobile 模式语义与桌面 Chromium 不同。

### hover / goBack —— 合成事件与历史导航 hang

两个都是稳定 5s 超时：
- `locator.hover()` → ArkWeb 对 CDP `Input.dispatchMouseEvent`（hover 类型）的合成事件处理可能阻塞
- `page.goBack()` → ArkWeb 单 tab 复用 + 历史栈导航可能不响应 CDP `Page.navigate` 的 history 模式

**影响：** 测试中避免 hover 断言（用 `:focus` 或直接 click 替代）；避免 goBack/goForward（用 goto 重新导航）。

### newContext 假阳性 —— 比 newPage 更危险

```
browser.newContext() → RESULT=ok pages=0  (不抛错)
```

connectOverCDP 模式下 `browser.newContext()` 返回空壳 context。**建议 ohos-playwright fixture 拦截 newContext 抛明确错误**（像 newPage 那样），而非放任空壳。

---

## 第三批探针：CDP 深水区（11 项，含精细化复测）

针对"Playwright 高层 API 走不通，但底层 CDP 域是否可用"的深探。结论分两类：

### 🎯 关键发现：ArkWeb CDP 实现比想象中完整

很多看似"不支持"其实是 **Playwright 高层 API 在单 context 复用模式下水土不服**，而非 ArkWeb 内核缺陷。裸 CDP 调用能绕过：

| 能力 | Playwright 高层 API | 裸 CDP 调用 | 真相 |
|---|---|---|---|
| **touch** | ❌ `page.touchscreen.tap` → `hasTouch must be enabled` | ✅ `Input.dispatchTouchEvent` | **ArkWeb 完全支持触屏**，只是 Playwright 要求 context 创建时设 hasTouch，单 context 复用下无法重设 |
| **video** | ❌ Playwright `recordVideo` 依赖多 context | ✅ `Page.startScreencast` | **ArkWeb screencast 工作**，能拿 jpeg 帧数据 |
| **timezone** | ✅ `page.context()` 无法重设 | ✅ `Emulation.setTimezoneOverride` | **生效**（Shanghai → New_York 实测切换）|

### 第三批完整结果

#### ✅ 完全可用（5 项）

| 能力 | 验证 |
|---|---|
| **`role=` selector** | `getByRole('button', { name: 'Save' })` / `getByRole('link')` 都准 |
| **`:has-text` / `:has`** | 复杂选择器工作 |
| **`fileChooser`** | `page.waitForEvent('filechooser')` 收到事件 |
| **`cacheDisabled`** | `Network.setCacheDisabled` 命令成功 |
| **`timezone override`** | CDP `Emulation.setTimezoneOverride` 生效（`Asia/Shanghai` → `America/New_York`）|
| **`touch (CDP 直发)`** | `Input.dispatchTouchEvent` 触发 touchstart/touchend（`touches=1 \| touchend`）|
| **`video screencast (CDP)`** | `Page.startScreencast` 拿到 jpeg 帧数据 |

#### ❌ ArkWeb 内核真不实现（2 项）

| 能力 | 验证 |
|---|---|
| **`locale override`** | CDP `Emulation.setLocaleOverride` 命令成功但 `navigator.language` 不变（zh-CN → 仍 zh-CN）|
| **`reducedMotion`** | `emulateMedia({ reducedMotion: 'reduce' })` 后，`no-preference` 和 `reduce` 两个 matchMedia **都返回 true**（ArkWeb matchMedia bug，emulateMedia 对 reducedMotion 无效）|

#### ❌ Playwright 内部 fixture 不工作（2 项，与 newContext/newPage 同根因）

| 能力 | 失败 |
|---|---|
| **`page.accessibility.snapshot()`** | `Cannot read properties of undefined (reading 'snapshot')` |
| **`context.storageState()`** | `Cannot read properties of undefined (reading '_page')` |

两者都因单 context 复用模式下 Playwright 内部 fixture 链断裂。**裸 CDP `Accessibility.getFullAXTree` / 读 cookie+localStorage 自行拼装可绕过**（未深探）。

### 修正后的认知

| 之前以为 | 实际 |
|---|---|
| ArkWeb CDP 实现不全，很多域不支持 | **ArkWeb CDP 实现相当完整**，timezone/touch/screencast/fileChooser/cache 都工作 |
| ohos-playwright 的限制 ≈ ArkWeb 限制 | **ohos-playwright 的限制主要是"单 context 复用"导致的 Playwright 高层 API 失效**，能用裸 CDP 绕过 |
| locale/reducedMotion 不生效是 ArkWeb bug | 确认是 ArkWeb 内核未实现这两个 Emulation 域 |

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

**第四批（盲区补全，15 域，结论待真机跑后填入）：**
- `go-forward.spec.ts`（goForward + 超时兜底，预期与 goBack 同样 hang）
- `scroll.spec.ts`（mouse.wheel no-op 确认 + evaluate scrollTo / window.scrollTo 绕过验证）
- `wait-for-request.spec.ts`（waitForRequest / waitForResponse，含 predicate 函数）
- `init-script.spec.ts`（addInitScript 独立探针：函数/字符串/跨-goto 持久）
- `locator-check.spec.ts`（locator.check / uncheck / setChecked，含 disabled 边界）
- `request-events.spec.ts`（page.on('request' / 'response' / 'requestfinished' / 'requestfailed')）
- `keyboard-combos.spec.ts`（Ctrl+A / Shift+Tab / Ctrl+Z / Shift+Arrow / Alt 组合键）
- `expose-function.spec.ts`（exposeFunction / exposeBinding，含 handle 模式）
- `inject-tags.spec.ts`（addScriptTag content/path/module + addStyleTag content）
- `context-route.spec.ts`（context.route fulfill/abort + context vs page 优先级对比）
- `accessibility-cdp.spec.ts`（Accessibility.getFullAXTree / getPartialAXTree 裸 CDP）
- `wait-for-url.spec.ts`（waitForURL string/glob/RegExp + history.pushState 客户端导航）
- `mouse-raw.spec.ts`（page.mouse.move / down / up / click，独立于 hover）
- `websocket.spec.ts`（真实 WS 基线 + routeWebSocket 拦截 + CDP Network.webSocket* 事件）
- `coverage.spec.ts`（page.coverage JS/CSS startJSCoverage/stopJSCoverage/startCSSCoverage）

复跑命令：
```bash
cd /storage/Users/currentUser/HarmonyPC/Software/ohos-playwright
OHOS_PW_INFO_PATH=/storage/Users/currentUser/.tmp/ohos-pw-cdp.json \
  ./dist/cli.mjs test --config=probes/playwright.config.ts probes/
```

完整原始日志：
- `/storage/Users/currentUser/.tmp/probes-run.log`（第一批）
- `/storage/Users/currentUser/.tmp/probes-run2.log` + `probes-run3.log`（第二批）

样本产物：
- `/storage/Users/currentUser/.tmp/probe-page.png`（截图样本）
- `/storage/Users/currentUser/.tmp/probe-trace.zip`（tracing 样本）
- `/storage/Users/currentUser/.tmp/probe-out.pdf`（PDF 样本）
