# ohos-playwright

让 Playwright 在 OpenHarmony 上跑 e2e —— 接管设备上的系统浏览器（ArkWeb，Chromium 内核）。同一份 `playwright.config.ts` 和 spec 在 Windows / Linux / macOS 上仍按原版 Playwright 跑，**不需要写两份**。

## 它解决什么问题

OpenHarmony 上没有官方的 Playwright：没有适配的浏览器二进制可下载，Playwright 自己的平台检测在 OpenHarmony 上直接崩。

ohos-playwright 换了个思路 —— **不让 Playwright 自己启动浏览器**，而是通过 `hdc` 把设备上正在运行的系统浏览器的调试通道转发回本机，让 Playwright "接管"它。spec 文件一行不动，`playwright.config.ts` 只多一层包装；CI / 本地 / 鸿蒙开发机共用同一份配置。

## 快速开始

### 1. 安装

```sh
pnpm add -D ohos-playwright @playwright/test
```

> `@playwright/test` 是 peer dependency，版本 `>=1.59.0`。

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
    // firefox / webkit 在 OpenHarmony 上会被自动裁掉，留着也不影响其他主机
  ],
  // ...其他正常的 Playwright 配置
}))
```

非 OpenHarmony 主机上 `withOpenHarmony` 原样返回 config；OpenHarmony 上它会注入 setup/teardown、把 workers 锁 1、过滤掉 firefox/webkit。

### 3. 改 npm script

```json
{ "scripts": { "test:e2e": "ohos-playwright test" } }
```

`ohos-playwright` 这个 bin 在非 OpenHarmony 上等价于 `playwright`，所有参数透传。

### 4. spec 文件不用动

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

第一次跑会自动找设备、拉起系统浏览器、转发调试端口、让 Playwright 接管。

## 工作原理

**非 OpenHarmony 主机**：什么都不做，等价于 stock Playwright，所以配置可以跨平台共用。

**OpenHarmony 主机**：

- **复用而非启动**：Playwright 不再自己起浏览器，而是接管设备上正在跑的系统浏览器，通过 `hdc` 把它的调试通道转发到本机。
- **Spec 无感**：你写的还是 `@playwright/test`，底层透明替换为走 CDP 复用设备上现有 page 的实现。
- **配置自动收紧**：`workers` 锁 1、firefox / webkit project 自动裁掉、globalSetup / globalTeardown 自动注入 —— 都由 `withOpenHarmony` 在 OpenHarmony 上完成，其他主机不受影响。
- **设备没连会自救**：测试启动时如果设备没连，先 LAN 广播找设备并自动连上，找不到再弹提示。

## 环境变量

| 变量 | 默认 | 何时需要设 |
| --- | --- | --- |
| `OHOS_PW_HDC` | `/data/service/hnp/bin/hdc` | `hdc` 不在默认路径 |
| `OHOS_PW_BUNDLE` | `com.huawei.hmos.browser` | 接管别的浏览器 bundle |
| `OHOS_PW_LAUNCH_URL` | `http://localhost:5173` | 浏览器**首次启动**时导航到的 URL（dev server 端口不是 5173 必设） |
| `OHOS_PW_INFO_PATH` | `os.tmpdir()/ohos-playwright-cdp.json` | 想固定 CDP info 文件位置（CI 多 job 隔离等） |
| `OHOS_PW_AUTO_CONNECT` | （未设） | 设 `0` 跳过自动 discover / tconn 流程 |
| `OHOS_PW_HOST` | 自动 | 内部标志位，**不要手动设** |

## 约束

设备和 ArkWeb 本身带来的硬约束，不是 ohos-playwright 能解决的：

- **`workers: 1`**：设备上只有一个浏览器实例，多 worker 会互相抢同一份 localStorage / URL。
- **不能并发 project**：firefox / webkit 在 ArkWeb 上跑不了，会被自动裁掉。
- **不能 `newContext` / `newPage`**：全程复用一个 context、一个 page。要做用例隔离，用 `localStorage.clear()` + `page.reload()` 代替独立 context。
- **测试结束不关浏览器**：浏览器进程归 OS 管，不归测试管。
- **`process.platform` 在测试进程里被改成 `'linux'`**：如果你在 spec / fixture 里读 `process.platform` 做平台分支，会拿到 `'linux'`。判断真实主机身份请用 `process.env.OHOS_PW_HOST`。
- **设备必须开发者模式 + 无线调试或 USB 调试**：自动连接依赖 `hdc discover`（UDP:8710），CI 上推荐预先 `hdc tconn`。

## 排错

| 报错 | 怎么处理 |
| --- | --- |
| `Cannot find module 'ohos-playwright/config'` | 没装或没 install，按"快速开始"重做 |
| `defineConfig({...})` 没有类型提示 | `tsconfig` 的 `moduleResolution` 改成 `bundler` 或 `nodenext` |
| `未发现设备...`（中文） | 设备上开「开发者选项 → 无线调试」；本机防火墙放行 UDP:8710；CI 上预先手动 `hdc tconn <ip:port>` |
| `Failed to launch com.huawei.hmos.browser` | 设备上没装该浏览器，或 bundle name 不对，设 `OHOS_PW_BUNDLE` |
| `DevTools socket not found for pid` | 该浏览器没暴露 CDP（不是所有 OpenHarmony 浏览器都启用了 devtools） |
| `CDP probe failed` | `hdc fport` 转发没起来，`hdc fport ls` 看现有 ruler、`hdc fport rm` 清残留 |
| `await page.goto('/foo')` 不拼 baseURL | 检查 `use.baseURL` 是否设了非空值 |

## 兼容性

- **Playwright**：`>=1.59.0`（测试覆盖 1.60）
- **Node**：`>=24`（OpenHarmony 上只支持 Node 24+）
- **OpenHarmony**：`hdc` 可用 + 系统浏览器暴露 CDP。已验证 `com.huawei.hmos.browser`（华为浏览器，Chromium 132）
- **其他主机**：Windows / Linux / macOS 上自动降级为 stock Playwright，无副作用

## 协议

MIT
