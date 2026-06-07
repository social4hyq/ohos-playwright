# ohos-playwright

让 Playwright 在 OpenHarmony / ArkWeb 上跑 e2e，同一份 `playwright.config.ts` 和 spec 在 Windows / Linux / macOS 上仍按原版 Playwright 跑，**不需要写两份**。

## 它解决什么问题

OpenHarmony 上没有官方的 Playwright：没有适配的浏览器二进制，Playwright 的平台检测在 `openharmony` 上直接崩。

ohos-playwright **不让 Playwright 自己启动浏览器**，而是通过 `hdc` 把设备上正在运行的系统浏览器的 CDP 调试通道转发回本机，让 Playwright "接管"它。spec 一行不动，config 只多一层包装。

## 快速开始

### 1. 安装

```sh
pnpm add -D ohos-playwright @playwright/test
```

> `@playwright/test` 是 peer dependency，版本 `>=1.59.0`。Node ≥ 24。

### 2. 包一层 config

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'
import { withOpenHarmony } from 'ohos-playwright/config'

export default defineConfig(withOpenHarmony({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:5173' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // firefox / webkit 在 OpenHarmony 上会被自动裁掉
  ],
}))
```

`withOpenHarmony` 在非 OH 主机上原样返回 config；在 OH 上注入 setup/teardown、锁 workers=1、过滤非 chromium project。

### 3. npm script

```json
{ "scripts": { "test:e2e": "ohos-playwright test" } }
```

`ohos-playwright` 在非 OH 上等价于 `playwright`，所有参数透传。

### 4. spec 不用动

```ts
import { test, expect } from '@playwright/test'

test('something', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/.../)
})
```

### 5. 运行

```sh
pnpm test:e2e
```

首次跑会自动找设备、拉起浏览器、转发 CDP 端口。如果本机就是 OpenHarmony 设备，会通过 `param get persist.hdc.port` 自动发现端口并连接，无需手动配置。

## 工作原理

**非 OpenHarmony 主机**：什么都不做，等价于 stock Playwright。

**OpenHarmony 主机**：

- **复用而非启动**：Playwright 不再自己起浏览器，接管设备上正在跑的系统浏览器，通过 `hdc` 把 CDP 通道转发到本机。
- **Spec 无感**：底层透明替换 `@playwright/test` 导入，走 CDP 复用设备上现有 page。
- **配置自动收紧**：`workers` 锁 1、firefox/webkit 裁掉、globalSetup/Teardown 自动注入。
- **智能设备发现**（v0.2.0）：
  1. 已有连接 → 直接复用
  2. 本机就是 OH 设备 → 读 `persist.hdc.port` 秒连
  3. LAN 广播 `hdc discover` → 找独立设备
  4. 找不到 → TTY 提示手动输入 / CI 直接报错

## 设备连接

### 本机即设备（一台 OH 机器跑全部）

无需额外配置，`ensureDeviceConnected()` 会自动通过 `param get persist.hdc.port` 连上本机 hdc 守护进程。

### 固定无线调试端口（一劳永逸）

无线调试每次开关端口都会变。设固定端口后不再需要看屏幕：

```sh
# 先连上（USB 或看屏幕临时端口）
hdc tconn 127.0.0.1:<临时端口>

# 设固定端口（会重启设备）
hdc tmode port 5555

# 之后永远用固定端口
hdc tconn 127.0.0.1:5555
```

设好后 `param get persist.hdc.port` 也返回固定值，ohos-playwright 自动识别。

### 跳过自动连接

```sh
OHOS_PW_AUTO_CONNECT=0 pnpm test:e2e
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OHOS_PW_HDC` | `/data/service/hnp/bin/hdc` | hdc 二进制路径 |
| `OHOS_PW_BUNDLE` | `com.huawei.hmos.browser` | 接管的目标浏览器 bundle |
| `OHOS_PW_LAUNCH_URL` | `http://localhost:5173` | 浏览器首次启动时的导航 URL |
| `OHOS_PW_INFO_PATH` | `os.tmpdir()/ohos-playwright-cdp.json` | CDP info 文件位置 |
| `OHOS_PW_AUTO_CONNECT` | （未设） | 设为 `0` 跳过自动 discover/tconn 流程 |
| `OHOS_PW_HOST` | 自动 | 内部标志位，**不要手动设** |

## 约束

设备和 ArkWeb 本身的硬约束：

- **`workers: 1`**：设备上只有一个浏览器实例。
- **不能并发 project**：firefox/webkit 在 ArkWeb 上跑不了，自动裁掉。
- **不能 `newContext` / `newPage`**：全进程复用一个 context、一个 page。用例隔离用 `localStorage.clear()` + `page.reload()`。
- **测试结束不关浏览器**：浏览器进程归 OS 管。
- **`process.platform` 被改成 `'linux'`**：判断真实主机用 `process.env.OHOS_PW_HOST`。
- **设备需要开发者模式 + 无线调试或 USB 调试**。

## 排错

| 报错 | 处理 |
|---|---|
| `Cannot find module 'ohos-playwright/config'` | 没装或没 install |
| `defineConfig({...})` 没有类型提示 | `tsconfig` 的 `moduleResolution` 改成 `bundler` 或 `nodenext` |
| `未发现设备...` | 设备上开「开发者选项 → 无线调试」；本机防火墙放行 UDP:8710；CI 预先 `hdc tconn` |
| `Failed to launch com.huawei.hmos.browser` | 设备上没装该浏览器，或设 `OHOS_PW_BUNDLE` |
| `DevTools socket not found for pid` | 浏览器没暴露 CDP，或等几秒重试 |
| `CDP probe failed` | `hdc fport ls` 查现 ruler，`hdc fport rm` 清残留 |
| `await page.goto('/foo')` 不拼 baseURL | 检查 `use.baseURL` 是否非空 |

## TypeScript

项目源码使用 TypeScript（`.mts`），Node 24 原生支持类型剥离，无需编译步骤。

支持类型检查：

```sh
npm run typecheck   # tsc --noEmit
```

`withOpenHarmony` 从 `ohos-playwright/config` 导入时有完整的 `PlaywrightTestConfig` 类型提示（直接从源码推断，无需 `.d.ts` 文件）。

## 兼容性

- **Playwright**：`>=1.59.0`
- **Node**：`>=24`（OpenHarmony 上只支持 Node 24+）
- **OpenHarmony**：`hdc` 可用 + 系统浏览器暴露 CDP。已验证 `com.huawei.hmos.browser`（华为浏览器，Chromium 132）
- **其他主机**：Windows / Linux / macOS 上自动降级为 stock Playwright，无副作用

## 协议

MIT
