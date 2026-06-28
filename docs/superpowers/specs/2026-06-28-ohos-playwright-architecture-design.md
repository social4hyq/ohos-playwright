# ohos-playwright 架构重设计

**日期**：2026-06-28  
**状态**：待实现  
**目标**：将 ohos-playwright 重设计为对标 `playwright.android` 的 OHOS 原生平台适配层，为未来向 `playwright/playwright` 上游提 PR 做架构准备，同时保持现有前端工程零改动。

---

## 背景

ohos-playwright 当前通过 `connectOverCDP` + monkey-patch 方式适配 ArkWeb，存在以下问题：

- `browser.newContext()` 过度拦截（忽略 options，始终返回共享 context）→ cookie 污染、credentials/CSP/device 测试失败
- `browser.newPage()` 未被 override → `_page` TypeError
- ArkWeb 限制用硬编码正则表（`ohos-skip.ts`）管理，版本升级后无法自动解锁
- `process.platform` 等全局副作用在 import 时立即生效，不利于测试和上游对齐
- 无正式的 ArkWeb 能力声明和优化诉求追踪机制

**当前 test:upstream 状态**：~60 个失败（96% 通过率），其中 ~51 个属于可修复的架构问题。

---

## 设计原则

| 原则 | 体现 |
|---|---|
| 对标 `playwright.android` | 相同的 namespace / device / capabilities 模式 |
| 能力声明式降级 | `OhosCapabilities` 替代硬编码 fixme 表 |
| PR-ready 文件布局 | `src/ohos/` 镜像未来 `playwright-core/src/server/ohos/` |
| 向后兼容 | `withOpenHarmony()` / `fixture` / CLI 保持现有 API |

---

## 第 1 节：架构总览

### 全局架构

```
ohos-playwright (npm 包)
│
├── playwright.ohos              ← 新顶层 namespace（镜像 playwright.android）
│   ├── ohos.devices()          ← hdc 设备发现（镜像 android.devices()）
│   └── ohos.connect(opts)      ← 连接指定设备
│
├── OhosDevice                   ← 镜像 AndroidDevice
│   ├── device.browser()        ← connectOverCDP + 自动注入 ArkWeb patch
│   ├── device.capabilities()   ← 运行时能力声明
│   └── device.close()
│
├── OhosCapabilities             ← 能力声明接口（flag + ArkWeb issue 链接）
│
├── src/ohos/                    ← 核心实现（PR-ready 布局）
│   ├── device.mts
│   ├── connection.mts          ← hdc + CDP 生命周期
│   ├── capabilities.mts
│   └── patches/
│       ├── browser-patch.mts
│       ├── context-patch.mts
│       ├── input-patch.mts
│       └── page-patch.mts
│
└── 兼容层（现有 API 不变）
    ├── withOpenHarmony()        → 内部调用 OhosDeviceConnection
    ├── ohos-playwright/fixture  → 内部使用 OhosDevice.browser()
    └── ohos-playwright test CLI → 内部调用 ohos.devices()
```

### 与现有代码的映射

| 现有模块 | 新架构位置 | 变化性质 |
|---|---|---|
| `setup.mts` | `src/ohos/connection.mts` | 重构为 `OhosDeviceConnection` 类 |
| `fixture.mts`（patch 逻辑）| `src/ohos/patches/` | 拆分为可独立测试的 patch 函数 |
| `config.mts` | 兼容 shim → `src/ohos/device.mts` | API 不变，内部重定向 |
| `register.mts`（platform patch）| 移入 `connection.mts` 初始化路径 | 副作用显式化 |
| `ohos-skip.ts`（hardcode fixme 表）| → `OhosCapabilities` flag | 替代为声明式 |

---

## 第 2 节：设备发现与连接层

### 公开 API

```typescript
import { ohos } from 'ohos-playwright'

// 枚举已连接设备（hdc list targets）
const [device] = await ohos.devices()

// 或显式连接
const device = await ohos.connect({
  serial: '127.0.0.1:5555',
  hdcBinary: '/data/service/hnp/bin/hdc',
  bundle: 'com.huawei.hmos.browser',
})

const browser = await device.browser()       // connectOverCDP + 自动打 patch
const caps    = await device.capabilities()  // OhosCapabilities
await device.close()                         // fport rm + 清理
```

### `OhosDevice` 类（`src/ohos/device.mts`）

```typescript
class OhosDevice {
  readonly serial: string
  readonly model: string
  private _conn: OhosDeviceConnection
  private _browser: Browser | null = null

  async browser(): Promise<Browser> {
    if (this._browser) return this._browser
    // PW_CHROMIUM_ATTACH_TO_OTHER=1：多 context 前提，由 OhosDevice 管理，不外露
    process.env.PW_CHROMIUM_ATTACH_TO_OTHER = '1'
    const endpoint = await this._conn.connect()
    const raw = await chromium.connectOverCDP(endpoint)
    applyBrowserPatches(raw, this._conn)
    raw.on('disconnected', () => this._conn.reconnect())
    this._browser = raw
    return raw
  }

  async capabilities(): Promise<OhosCapabilities> {
    return detectCapabilities(await this.browser())
  }

  async close(): Promise<void> {
    await this._conn.teardown()
    this._browser = null
  }
}
```

### `OhosDeviceConnection`（`src/ohos/connection.mts`）

重构自现有 `setup.mts` / `teardown.mts`，封装为类：

```typescript
class OhosDeviceConnection {
  constructor(private opts: OhosConnectOptions) {}

  async connect(): Promise<string>    // 现 globalSetup() 逻辑平移
  async reconnect(): Promise<string>  // 现 reconnect() 逻辑平移
  async teardown(): Promise<void>     // 现 globalTeardown() 逻辑平移

  // 内部方法（现有逻辑平移，不重写）
  private ensureDeviceConnected(): Promise<void>
  private findBrowserPid(): number | null
  private setupForward(port: number, socket: string): void
  private probeCdp(port: number): Promise<CdpProbeResult>
}
```

**关键变化**：`PW_CHROMIUM_ATTACH_TO_OTHER=1` 和 `process.platform='linux'` 从 `register.mts`（import 时全局副作用）移入 `OhosDeviceConnection.connect()` 调用路径，**建立连接时才生效**。

### `ohos` namespace 入口（`src/ohos/namespace.mts`）

```typescript
export const ohos = {
  async devices(opts?: { hdcBinary?: string }): Promise<OhosDevice[]> {
    // hdc list targets → 枚举，镜像 android.devices()
  },
  async connect(opts: OhosConnectOptions): Promise<OhosDevice> {
    return new OhosDevice(opts)
  },
}
```

### 兼容 shim

现有 `globalSetup` / `globalTeardown` 内部等价于 `OhosDeviceConnection.connect()` / `.teardown()`，对用户透明：

```typescript
// src/setup.mts（变为薄 shim）
export default async function globalSetup() {
  const conn = new OhosDeviceConnection(readOptsFromEnv())
  await conn.connect()
}
```

---

## 第 3 节：能力声明系统

### `OhosCapabilities` 接口（`src/ohos/capabilities.mts`）

```typescript
export interface OhosCapabilities {
  // Context & Pages
  multipleContexts: boolean            // Target.createBrowserContext 可创建隔离 context
  newPageInNonDefaultContext: boolean  // 新 context 中 ctx.newPage() 可用
  contextScreenshot: boolean           // 新 context 中 Page.captureScreenshot 有响应

  // Lifecycle
  beforeunloadDismiss: boolean         // CDP Dialog.* 可 dismiss beforeunload 弹窗
  persistentContext: boolean           // launchPersistentContext 可用

  // Input
  rawMouseEvents: boolean              // page.mouse.* → DOM 事件正常投递
  cssHoverFromInput: boolean           // Input.dispatchMouseEvent → :hover 伪类激活

  // Network
  userAgentOverride: boolean           // Emulation.setUserAgentOverride → HTTP UA 生效
  proxyConfig: boolean                 // proxy 作为 context 创建选项

  // 媒体 / 录制
  recordHar: boolean                   // context 级 HAR 录制
  videoRecording: boolean              // 页面录屏
  screencast: boolean                  // Page.startScreencast 实现

  // 覆盖率 & 事件
  jsCoverageAcrossNavigations: boolean // JS 覆盖率跨导航累计
  webSocketCreatedEvent: boolean       // CDP Network.webSocketCreated 事件

  // Playwright 内部
  exposeBindingHandle: boolean         // exposeBinding({ handle: true }) 有效
  playwrightInspector: boolean         // Inspector / debug UI 可用

  // 元信息
  readonly arkwebVersion: string       // 例：'132.0.6834.89'
  readonly ohosVersion: string         // 例：'5.0'
}
```

### 能力检测（静态 + 动态）

```typescript
export async function detectCapabilities(browser: Browser): Promise<OhosCapabilities> {
  const version = browser.version()
  const arkwebVersion = parseArkWebVersion(version)

  // 静态表：基于 ArkWeb 实测结论（reaudit 2026-06-27）
  const caps: OhosCapabilities = {
    multipleContexts:              true,   // ✅ reaudit L1
    newPageInNonDefaultContext:    true,   // ✅ capability matrix T1
    contextScreenshot:             false,  // ❌ S1: captureScreenshot 无响应
    beforeunloadDismiss:           false,  // ❌ 系统级弹窗
    persistentContext:             false,  // ❌ 无 launch 步骤
    rawMouseEvents:                true,   // ✅ reaudit L3
    cssHoverFromInput:             false,  // ❌ reaudit L4
    userAgentOverride:             true,   // ✅ reaudit L2
    proxyConfig:                   false,  // ❌ 无 launch 步骤
    recordHar:                     false,  // ❌ 需 context 创建选项
    videoRecording:                false,  // ❌ startScreencast 未实现
    screencast:                    false,  // ❌ 同上
    jsCoverageAcrossNavigations:   false,  // ❌ 实测不累计
    webSocketCreatedEvent:         false,  // ❌ 事件未触发
    exposeBindingHandle:           false,  // ❌ PW 1.60 已移除公开 API
    playwrightInspector:           false,  // ❌ 需 Inspector 进程
    arkwebVersion: version,
    // detectOhosVersion：hdc shell param get const.ohos.apiversion → 主版本字符串
    ohosVersion: await detectOhosVersion(),
  }

  // 动态探针：对版本边界不确定的项执行（如未来 ArkWeb 修复后自动解锁）
  if (arkwebVersion.major >= 140) {
    caps.cssHoverFromInput = await probeCssHover(browser)
  }

  return caps
}
```

### Fixture 集成

```typescript
// tests/upstream/fixtures/upstream-fixture.ts

capabilities: [async ({ device }, use) => {
  await use(await device.capabilities())
}, { scope: 'worker' }],

ohosAutoSkip: [async ({ capabilities: caps }, run, testInfo) => {
  const file = testInfo.file
  const check = (flag: keyof OhosCapabilities, pattern: RegExp, note: string) => {
    if (!caps[flag] && pattern.test(file))
      testInfo.fixme(true, `ArkWeb[${flag}]: ${note} — ${ARKWEB_ISSUE_URL[flag]}`)
  }

  check('recordHar',          /browsercontext-har/,       'HAR 录制需 context 创建选项')
  check('beforeunloadDismiss',/beforeunload/,              '系统级 beforeunload 弹窗无法 dismiss')
  check('proxyConfig',        /browsercontext-proxy/,     'proxy 为 launch-time 选项')
  check('screencast',         /screencast|video/,         'Page.startScreencast 未实现')
  check('playwrightInspector',/inspector|debug-ctrl/,     'Inspector 进程不可用')
  check('persistentContext',  /defaultbrowsercontext|browsercontext-reuse/, 'persistent context 需 launch 步骤')
  check('contextScreenshot',  /screenshot.*context|context.*screenshot/, '新 context captureScreenshot 无响应')

  await run()
}, { auto: true }],
```

---

## 第 4 节：ArkWeb 降级处理与 Patch 层

### 降级决策树

```
1. 原生 CDP 路径可用？            → 直接使用，无 patch
2. 替代 CDP 命令可行？            → 实现替代路径，透明降级
3. 有语义等价的软件层 workaround？→ 实现 workaround，capability flag = false
4. 无任何可行路径？               → capability flag = false，fixture 层 fixme
```

### Patch 文件布局

| 文件 | 作用范围 | 主要内容 |
|---|---|---|
| `src/ohos/patches/browser-patch.mts` | Browser 对象 | 包裹 `newContext`，新增 `newPage` |
| `src/ohos/patches/context-patch.mts` | BrowserContext 对象 | `newPage` + `close` + `goto` |
| `src/ohos/patches/input-patch.mts` | Page 对象 | `locator().hover()` → CDP Input |
| `src/ohos/patches/page-patch.mts` | Page 对象 | beforeunload tracking |

### `browser-patch.mts`

```typescript
export function applyBrowserPatches(browser: Browser, conn: OhosDeviceConnection): void {
  // 默认 context（connectOverCDP 时已存在）立即注入 patch
  for (const ctx of browser.contexts()) applyContextPatches(ctx)

  // 包裹 newContext：创建真实隔离 context + 自动注入 patch
  const realNewContext = browser.newContext.bind(browser)
  ;(browser as any).newContext = async (opts?: BrowserContextOptions) => {
    const ctx = await realNewContext(opts ?? {})
    applyContextPatches(ctx)
    return ctx
  }

  // 新增 newPage：委托给 patched newContext + ctx.newPage()
  ;(browser as any).newPage = async (opts?: BrowserContextOptions) => {
    const ctx = await (browser as any).newContext(opts)
    return ctx.newPage()
  }

  browser.on('disconnected', () => conn.reconnect())
}
```

### `context-patch.mts`

从现有 `fixture.mts` 提取，幂等，应用到所有 context 对象：

```typescript
export function applyContextPatches(ctx: BrowserContext): void {
  if ((ctx as any).__ohosPatch) return
  ;(ctx as any).__ohosPatch = true

  // close：navigate to about:blank + emit close（替代 Target.disposeBrowserContext）
  ;(ctx as any).close = async () => { /* 现有逻辑平移 */ }

  // newPage：createPopupPage（Target.createTarget）+ fallback → reset seedPage
  ;(ctx as any).newPage = async () => { /* 现有逻辑平移 */ }
}
```

### `input-patch.mts`

CDP `Input.dispatchMouseEvent` 替代 JS `dispatchEvent`（isTrusted:false 副作用）：

```typescript
export function applyInputPatches(page: Page): void {
  const origLocator = page.locator.bind(page)
  ;(page as any).locator = (...args: Parameters<typeof page.locator>) => {
    const loc = origLocator(...args)
    ;(loc as any).hover = async () => {
      const box = await loc.boundingBox()
      if (!box) throw new Error('[ohos] hover: element has no bounding box')
      const session = await page.context().newCDPSession(page)
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height / 2),
        button: 'none', modifiers: 0, buttons: 0,
        clickCount: 0, deltaX: 0, deltaY: 0, pointerType: 'mouse',
      })
      await session.detach()
    }
    return loc
  }
}
```

### Cookie 隔离

- 新 context（credentials / CSP / device 测试）：真实隔离，天然干净
- 共享默认 context：`context` fixture setup 阶段调用 `await ctx.clearCookies()`

### 移除错误 fixme

`ohos-skip.ts` 中以下条目因 reaudit 推翻而删除：
- `page.mouse.*`（L3 推翻：mouse 事件正常触发）
- UA override HTTP 条目（L2 推翻：HTTP UA header 生效）

### 预期修复覆盖

| 分类 | 当前失败 | 修复机制 | 预期 |
|---|---|---|---|
| Cookie 断言（context 污染）| ~27 | 真实隔离 context + clearCookies | → 0 |
| `_page` TypeError | ~24 | browser-patch + context-patch 全覆盖 | → ~4 |
| target closed | ~2 | context teardown 改善 | → 0 |
| 已知限制（正确分类）| ~7 | capability fixme（计入 fixme 不计入失败）| → 0 失败 |
| **合计** | **~60** | | **→ ~4（98%+）** |

---

## 第 5 节：向后兼容层

### 设计原则

现有前端工程零改动。新架构内部落地，所有 import 路径、API、CLI 行为不变。

### Package Exports 对照

| 路径 | 导出 | 变化 |
|---|---|---|
| `ohos-playwright` | `withOpenHarmony` + 新增 `ohos` | 新增可选 |
| `ohos-playwright/fixture` | `test` | 内部改用 `OhosDevice`，接口不变 |
| `ohos-playwright/config` | `withOpenHarmony` | 不变 |
| `ohos-playwright/setup` | globalSetup | 薄 shim |
| `ohos-playwright/teardown` | globalTeardown | 薄 shim |
| `ohos-playwright/parallel` | `test` | 不变 |

### `withOpenHarmony()` shim

外部签名和行为完全不变，workers 逻辑保持现状：

```typescript
export function withOpenHarmony(config: PlaywrightTestConfig): PlaywrightTestConfig {
  if (!process.env.OHOS_PW_HOST) return config
  // PW_CHROMIUM_ATTACH_TO_OTHER 在 config 评估时检查（globalSetup 之前）。
  // OhosDevice.browser() 会在 globalSetup 内部设置它，但对此处无效。
  // 行为与现有一致：用户如需多 worker，仍需显式设 PW_CHROMIUM_ATTACH_TO_OTHER=1。
  const multiContextOk = process.env.PW_CHROMIUM_ATTACH_TO_OTHER === '1'
  return {
    ...config,
    workers: multiContextOk ? config.workers : 1,
    globalSetup: 'ohos-playwright/setup',
    globalTeardown: 'ohos-playwright/teardown',
    projects: config.projects?.filter(p => p.name === 'chromium') ?? config.projects,
  }
}
```

### `ohos-playwright/fixture` shim

公开 API 不变，内部改用 `OhosDevice`，新增 `device` / `capabilities` fixture：

```typescript
// 对外不变
import { test } from 'ohos-playwright/fixture'

// 内部新增（upstream-fixture.ts 可使用）
device: [async ({}, use) => {
  await use(await getOhosDevice())
}, { scope: 'worker' }],
```

### 迁移路径

新 API 增量添加，旧 API 无 deprecation warning（避免干扰现有 CI）：

```typescript
// 旧 API（继续有效）
import { withOpenHarmony } from 'ohos-playwright'

// 新 API（推荐，可选迁移）
import { ohos } from 'ohos-playwright'
const device = await ohos.connect()
```

---

## 第 6 节：test:upstream 集成

### `playwright.config.ts` 调整

```typescript
// PW_CHROMIUM_ATTACH_TO_OTHER 由 OhosDevice 内部管理，upstream 测试始终生效
const multiContextOk = true  // 原: process.env.PW_CHROMIUM_ATTACH_TO_OTHER === '1'

export default defineConfig({
  workers: isOhos ? (config.workers ?? 2) : undefined,  // 可配置，2 为保守默认值
  // 其余不变
})
```

### `upstream-fixture.ts` 改动摘要

- 新增 `capabilities` fixture（worker 级，来自 `device.capabilities()`）
- `ohosAutoSkip` 改写：正则表 → capability flag 驱动（见第 3 节）
- `contextFactory` 简化：`ctx.close()` 替代 navigate-to-about:blank teardown

### `ohos-skip.ts` 精简

文件仅保留 issue URL 字典，删除 `OHOS_FILE_FIXME` / `OHOS_FIXME` 正则表：

```typescript
export const ARKWEB_ISSUE_URL: Record<string, string> = {
  contextScreenshot:    'https://gitee.com/openharmony/web_webview/issues/CAP-01',
  beforeunloadDismiss:  'https://gitee.com/openharmony/web_webview/issues/CAP-02',
  // … 其余 capability → issue 映射
}
```

---

## 第 7 节：ArkWeb 优化诉求

### 文档位置

- `docs/arkweb-feature-requests.md` → 提交到 `gitee.com/openharmony/web_webview`
- `docs/playwright-upstream-requests.md` → 提交到 `github.com/microsoft/playwright`

### ArkWeb 诉求清单

| ID | Capability flag | 现状 | 优先级 |
|---|---|---|---|
| CAP-01 | `contextScreenshot` | 新 context 中 `Page.captureScreenshot` 无响应 | 🔴 高 |
| CAP-02 | `beforeunloadDismiss` | 系统级弹窗 CDP 无法 dismiss | 🔴 高 |
| CAP-03 | `cssHoverFromInput` | CDP 鼠标输入不激活 `:hover` 伪类 | 🟡 中 |
| CAP-04 | `webSocketCreatedEvent` | `Network.webSocketCreated` 事件未触发 | 🟡 中 |
| CAP-05 | `jsCoverageAcrossNavigations` | JS 覆盖率不跨导航累计 | 🟢 低 |
| CAP-06 | `screencast` | `Page.startScreencast` 未实现 | 🟡 中 |

### Playwright 上游诉求

| ID | 内容 | 优先级 |
|---|---|---|
| P-01 | `calculatePlatform()` 识别 `openharmony` 平台 | 🔴 高（PR 入口点）|
| P-02 | `playwright.ohos` namespace（对标 `playwright.android`）| 🟡 中（长期目标）|

### 状态追踪

每条诉求包含：现状描述、期望行为、Chromium/Edge 对照结果、影响测试数、issue 链接。  
Capability flag 变为 `true` 时，静态声明改为动态探针，允许新版 ArkWeb 自动解锁。

---

## 第 8 节：文件结构与 PR-ready 布局

### 新文件结构

```
src/
├── ohos/                          ← 核心实现，未来 PR 提取点
│   ├── namespace.mts              ← ohos.devices() / ohos.connect()
│   ├── device.mts                 ← OhosDevice class
│   ├── connection.mts             ← OhosDeviceConnection（从 setup.mts 提取）
│   ├── capabilities.mts           ← OhosCapabilities + detectCapabilities()
│   └── patches/
│       ├── browser-patch.mts
│       ├── context-patch.mts
│       ├── input-patch.mts
│       └── page-patch.mts
│
├── index.mts                      ← 主入口：export { ohos, withOpenHarmony }
├── cli.mts                        ← 不变
├── config.mts                     ← withOpenHarmony() shim
├── fixture.mts                    ← fixtures，新增 device / capabilities
├── loader.mts                     ← 不变
├── parallel.mts                   ← 不变
├── register.mts                   ← 精简：仅做 registerHooks
├── setup.mts                      ← 薄 shim → OhosDeviceConnection.connect()
├── teardown.mts                   ← 薄 shim → OhosDeviceConnection.teardown()
└── info-path.mts                  ← 不变
```

### 现有文件迁移

| 现有文件 | 变化 | 核心逻辑去向 |
|---|---|---|
| `setup.mts` | 变为薄 shim | → `ohos/connection.mts` |
| `teardown.mts` | 变为薄 shim | → `ohos/connection.mts` |
| `fixture.mts` | 大幅精简 | patch → `ohos/patches/`；连接 → `ohos/device.mts` |
| `register.mts` | 精简 | platform patch 留原位，PW_CHROMIUM_ATTACH_TO_OTHER 移入 `device.mts` |

### 未来 Playwright PR 映射

```
ohos-playwright/src/ohos/      →  playwright-core/src/server/ohos/
  namespace.mts                →    ohos.ts（参照 android.ts）
  device.mts                   →    ohosDevice.ts（参照 androidDevice.ts）
  connection.mts               →    ohosConnection.ts
  capabilities.mts             →    ohosCapabilities.ts
  patches/                     →    内联进 ohosPage.ts 等
```

PR 提交时 `src/ohos/` 几乎可直接复制，改动点仅是 import 路径和内部类型。

### Package Exports

```json
{
  "exports": {
    ".":          "./dist/index.mjs",
    "./fixture":  "./dist/fixture.mjs",
    "./config":   "./dist/config.mjs",
    "./setup":    "./dist/setup.mjs",
    "./teardown": "./dist/teardown.mjs",
    "./parallel": "./dist/parallel.mjs"
  }
}
```

现有 exports 路径完全不变，`ohos` namespace 通过主入口 `"."` 导出。

---

## 实现顺序建议

以下顺序使每步都可独立验证：

1. **`src/ohos/connection.mts`**：从 `setup.mts` 提取 `OhosDeviceConnection`，现有 setup.mts 变薄 shim，验证：现有测试仍通过
2. **`src/ohos/patches/`**：从 `fixture.mts` 提取 4 个 patch 函数，验证：单元测试
3. **`src/ohos/capabilities.mts`**：静态能力表，验证：`device.capabilities()` 返回正确结构
4. **`src/ohos/device.mts`** + **`namespace.mts`**：`OhosDevice` + `ohos.connect()`，验证：新 API 可用
5. **`fixture.mts` 改写**：内部改用 `OhosDevice`，新增 `device` fixture，验证：现有 fixture 测试通过
6. **`tests/upstream/` 改写**：capabilities 驱动 ohosAutoSkip，`contextFactory` 简化，验证：`test:upstream` 通过率 ≥ 98%
7. **`docs/arkweb-feature-requests.md`** + **`docs/playwright-upstream-requests.md`**：完善诉求文档

## 成功标准

- `test:upstream` 通过率从 96% 提升至 ≥ 98%（失败 ≤ 4 个，均为能力声明 fixme）
- `npm test`（单元测试）全部通过
- `npm run typecheck` 零错误
- 现有用户 `playwright.config.ts` 零改动
- `src/ohos/` 可作为独立模块提取，无循环依赖
