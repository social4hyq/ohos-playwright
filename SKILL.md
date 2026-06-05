---
name: ohos-playwright-migrate
description: Use when the user asks to make a project's Playwright e2e tests run on OpenHarmony / ArkWeb, or to "add ohos-playwright", "适配 OpenHarmony", "用 ohos-playwright 跑 e2e"，or when you see a Playwright config in a repo that's expected to support OpenHarmony but still uses stock `playwright test`.
---

# ohos-playwright 迁移 SKILL

把一个使用 stock Playwright 的工程改造成可以在 OpenHarmony 上接管华为浏览器（ArkWeb）跑 e2e，同时**保持在 Windows / Linux / macOS 上的原行为不变**。整个适配在非 OpenHarmony 主机上自动降级为 no-op。

## 适用场景（什么时候应该启动这个 SKILL）

满足任一即可：

- 用户明说"接入 ohos-playwright"、"适配 OpenHarmony e2e"、"让 Playwright 在鸿蒙上跑"。
- 工程根目录有 `playwright.config.ts` / `playwright.config.js`，并且工程目标平台包含 OpenHarmony。
- 工程在 OpenHarmony 上跑 `playwright test` 直接报 `<unknown>` 平台 / 找不到浏览器二进制。

不要启动这个 SKILL 的场景：

- 工程不用 Playwright（比如 Cypress / WebdriverIO）。
- 用户只想在 Linux/macOS/Windows 上跑 Playwright，并不关心鸿蒙。

## 前置检查（动手前必须确认）

1. **包管理器**：检查 `pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` 确定是 pnpm / npm / yarn 中的哪一个。后续 `pnpm add` / `npm install` / `yarn add` 命令对应替换。
2. **是否 workspace**：根目录有 `pnpm-workspace.yaml` 或 `package.json` 里有 `workspaces` 字段 → 是 monorepo。如果 `ohos-playwright` 已作为 workspace 包存在，依赖应该写 `"ohos-playwright": "workspace:*"` 而不是从 registry 装。
3. **现有 Playwright 版本**：`@playwright/test` 必须 ≥ 1.59.0（`ohos-playwright` 的 peerDependency 下限）。低于的话先升级。
4. **Node 版本**：`ohos-playwright` 的 `engines.node` 是 `>=24`（OpenHarmony 上只支持 Node 24+）。低于的话先升级，否则 install 时会有 EBADENGINE 警告，运行时也可能崩。
5. **现有 config 形态**：读 `playwright.config.ts`，记录是 `defineConfig({...})` 还是 `defineConfig({...} satisfies PlaywrightTestConfig)`，是否已有 `globalSetup` / `globalTeardown` / `workers` 等字段。

## 改造步骤

按顺序做，每一步做完都跑验证再继续。

### 步骤 1：安装 `ohos-playwright`

- **workspace 内部**：在工程根 `package.json` 的 `devDependencies` 加 `"ohos-playwright": "workspace:*"`。
- **独立工程**：`pnpm add -D ohos-playwright`（或对应包管理器命令）。

然后跑一次安装让 bin 链接生效：

```sh
pnpm install
```

验证：`pnpm exec ohos-playwright --version` 能输出 Playwright 版本号。

### 步骤 2：包装 `playwright.config.ts`

最小改动：加两行，包一层。

```ts
import { defineConfig, devices } from '@playwright/test'
import { withOpenHarmony } from 'ohos-playwright/config'

export default defineConfig(withOpenHarmony({
  // ...原有所有配置一字不动
}))
```

**`withOpenHarmony` 的行为**：

- 非 OpenHarmony 主机：原样返回 config，等于没包。
- OpenHarmony 主机：
  - `workers` 强制为 1（ArkWeb 单实例，多 worker 会抢同一份状态）。
  - `globalSetup` / `globalTeardown` 注入为 `ohos-playwright/setup` / `ohos-playwright/teardown`。
  - `projects` 过滤为只剩 `name === 'chromium'`（firefox / webkit 跑不了 ArkWeb）。

**注意事项**：

- 不要自己再写 `workers: 1` 或 `globalSetup` —— `withOpenHarmony` 在 OpenHarmony 上会覆盖。但在其他主机上你的写法保留，所以原本 `workers: process.env.CI ? 1 : undefined` 这类按主机逻辑可以保留。
- 如果用户原本就有 `globalSetup`，迁移后会被 `withOpenHarmony` 覆盖。**不要默默覆盖** —— 把这个冲突告诉用户，让他决定：原 globalSetup 是否纯为 e2e 服务，能否放弃；如果不能，需要在 spec 启动前先手动调用其逻辑，或者改造 ohos-playwright/setup 的封装方式。
- `projects` 数组里 chromium project 必须存在且 `name: 'chromium'`，否则 OpenHarmony 上没东西可跑。

### 步骤 3：改 npm script

`package.json` 里把 `test:e2e` 从 `playwright test` 换成 `ohos-playwright test`。其他参数（`--workers`、`--project`、`--grep` 等）原样保留 —— `ohos-playwright` 透传给 Playwright CLI。

```json
{
  "scripts": {
    "test:e2e": "ohos-playwright test"
  }
}
```

不要再加 `--workers=1` / `--project=chromium`，这些由 `withOpenHarmony` 在 OpenHarmony 上自动处理；在非 OH 主机上你也不希望被强制锁住。

### 步骤 4：验证迁移

按以下顺序验证：

1. **类型检查**：跑工程现有的 type-check 命令（如 `pnpm typecheck` / `tsc --noEmit`）。`defineConfig(withOpenHarmony({...}))` 里的对象字面量应该有完整的 `PlaywrightTestConfig` 上下文类型；故意写一个错字段名应该报 `TS2353`。
2. **列出测试**：`pnpm test:e2e --list`。
   - 在 OpenHarmony 上：只应该出现 `[chromium]` 开头的用例。
   - 在其他主机上：原本配置里的所有 project 都应该列出。
3. **跑一遍全量**：`pnpm test:e2e`。
   - OpenHarmony 上日志应该出现 `[ohos-playwright] browser pid=...` / `CDP ready: Chrome/...`。
   - 浏览器进程在跑完后**不应该**被关闭（归 OS 管理）。

## 用户自定义场景

下面这些用户经常会问，预先准备好答案：

### 设备上的 `hdc` 不在默认路径

设置环境变量 `OHOS_PW_HDC`，例如 `OHOS_PW_HDC=/path/to/hdc pnpm test:e2e`。默认值 `/data/service/hnp/bin/hdc`。

### 想接管别的浏览器 bundle

设 `OHOS_PW_BUNDLE`，默认 `com.huawei.hmos.browser`。

### dev server 端口不是 5173

`withOpenHarmony` 会保留 `webServer` 配置和 `use.baseURL`，所以工程里改 dev server 端口正常生效。但浏览器**首次启动**时的导航 URL 由 `OHOS_PW_LAUNCH_URL` 控制，默认 `http://localhost:5173`，如果你的 dev server 不是这个端口，需要设这个环境变量。

### CDP info 文件位置

默认在 `os.tmpdir()/ohos-playwright-cdp.json`，setup 写、fixture 和 teardown 读。需要确定性位置就设 `OHOS_PW_INFO_PATH`。

### spec 文件里用 `newContext` / `newPage`

ArkWeb CDP **不实现** `Target.createBrowserContext`。fixture 复用 `browser.contexts()[0]` 和它已有的 page，所以 `page.context().newPage()` 会报错。改造 spec 使用 `localStorage.clear()` + `page.reload()` 实现隔离。

### `hdc list targets` 返回 `[Empty]`（设备没连）

setup 会自动救场：先 `hdc discover` 在 LAN 上 UDP 广播找听 TCP 的 daemon，找到就 `hdc tconn <ip:port>` 连上去。整套要求用户**在设备上**：① 进入「关于本机」连点版本号开启「开发者选项」；② 在「开发者选项」里启用「无线调试」；③ 设备与本机同 Wi-Fi；④ 本机防火墙放行 UDP:8710 入站。

如果广播找不到设备：

- 当前是 TTY → setup 用 readline 提示用户粘贴 `ip:port`，回车继续。
- 非 TTY（CI / daemonized）→ 直接 `throw` 带步骤的中文提示。CI 上的正解是先在 host 上手动跑过 `hdc tconn <ip:port>`，让 hdc 把连接信息持久化。

要完全跳过这套自动连接：设 `OHOS_PW_AUTO_CONNECT=0`，setup 会把"没设备"的报错让位给后续的 `hdc shell` 自己抛。

## 排错

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| `Cannot find module 'ohos-playwright/config'` | 没装或没 `pnpm install` | 按步骤 1 重做 |
| `defineConfig({...})` 里失去类型提示 | TS 没找到 `config.d.mts` | 确认 `moduleResolution` 是 `bundler` / `nodenext`；如果用的是 `node16` 老式解析，可能要在 `package.json` 的 exports 加 types 路径（包内已ship .d.mts，正常解析模式都能找到）|
| `Failed to launch com.huawei.hmos.browser` | 设备上没装该浏览器，或 bundle name 不对 | 用 `OHOS_PW_BUNDLE` 改成实际的 bundle name |
| `DevTools socket not found for pid` | 浏览器没开 devtools，或 `/proc/net/unix` 看不到 `webview_devtools_remote_<pid>` | 一般等几秒后 setup 会重试；持续失败说明 ArkWeb 版本不支持 CDP |
| `CDP probe failed` | `hdc fport` 转发没生效 | 手动跑 `hdc fport ls` 看 ruler 是否存在；`hdc fport rm` 清掉残留后重试 |
| `未发现设备。请在设备上：...` | 设备没连且 LAN 广播没找到 | 按提示在设备开「无线调试」；本机放行 UDP:8710；非 TTY 场景预先 `hdc tconn` |
| `hdc tconn ... failed` | 网络不通 / 端口不对 / 设备拒绝 | 确认 ip:port 准确、双方同网段；设备屏幕上的端口可能每次启用无线调试都变 |
| 用例里 `await page.goto('/foo')` 不拼 baseURL | fixture 包装漏了 | 检查 `playwright.config.ts` 的 `use.baseURL` 是否非空；fixture 只在 baseURL 存在时才包 `page.goto` |
| OpenHarmony 上跑了一遍后 firefox/webkit 测试莫名跑不了 | 你没在 OpenHarmony 上，但 `process.env.OHOS_PW_HOST` 被遗留 | 这个 env var 由 `register.mjs` 在 OpenHarmony 上自动设；如果在其他主机看到它，说明误手动设置了 |

## 不应该做的事

- **不要**为了"让它跨平台"自己写 `process.platform === 'openharmony'` 的分支 —— `withOpenHarmony` + `register.mjs` 已经处理；register 在 OpenHarmony 上会把 `process.platform` 改成 `'linux'`，所以你的检测也会失效。要查"是不是 OpenHarmony 主机"用 `process.env.OHOS_PW_HOST`。
- **不要**给 `playwright-core` 打 patch 来改 hostPlatform 检测。本包用进程级 `Object.defineProperty(process, 'platform', ...)` 代替，跨版本鲁棒。
- **不要**手动管理 `hdc fport` 端口 —— setup 自己挑空闲端口、自己拆。
- **不要**在测试结束后 `await browser.close()`。浏览器进程不归测试管。
